import * as backend from '@clerk/backend';
import User from '../models/User.js';
import { SIGNUP_CREDITS } from '../config.js';

let client;
const clerk = () => (client ??= backend.createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY }));

/**
 * Check a Clerk session token and return its claims (`sub` is the Clerk user id).
 * Throws if the token is missing, expired or forged. Written to cope with both
 * result styles the SDK has used: the payload itself, or { data, errors }.
 */
export async function verifyClerkToken(token) {
  if (!token || typeof token !== 'string') throw new Error('Missing token');
  const result = await backend.verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
  if (result?.errors?.length) throw new Error('Invalid token');
  const payload = result && typeof result === 'object' && 'data' in result ? result.data : result;
  if (!payload?.sub) throw new Error('Invalid token');
  return payload;
}

/** Name, username and email from Clerk, or null if Clerk can't be reached. */
export async function fetchProfile(clerkId) {
  try {
    const u = await clerk().users.getUser(clerkId);
    const primary =
      u.emailAddresses?.find((e) => e.id === u.primaryEmailAddressId) ?? u.emailAddresses?.[0];
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || 'User';
    return {
      name: name.slice(0, 80),
      username: u.username ? u.username.toLowerCase() : undefined,
      email: primary?.emailAddress ? primary.emailAddress.toLowerCase() : undefined,
    };
  } catch (err) {
    console.error('Could not load profile from Clerk:', err.message);
    return null;
  }
}

/** The app's user for a Clerk user id. Created on first sign-in, with any signup credits. */
export async function ensureUser(clerkId) {
  const existing = await User.findOne({ clerkId });
  if (existing) return existing;

  const profile = (await fetchProfile(clerkId)) ?? { name: 'User' };
  try {
    return await User.create({ clerkId, ...profile, credits: SIGNUP_CREDITS });
  } catch (err) {
    // Two requests for a brand-new user can race: the loser just reads the winner's record.
    if (err?.code === 11000) {
      const winner = await User.findOne({ clerkId });
      if (winner) return winner;
    }
    throw err;
  }
}

export async function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  let payload;
  try {
    payload = await verifyClerkToken(token);
  } catch {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }

  try {
    req.user = await ensureUser(payload.sub);
    req.userId = String(req.user._id);
    next();
  } catch (err) {
    next(err);
  }
}
