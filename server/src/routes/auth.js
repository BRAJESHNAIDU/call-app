import { Router } from 'express';
import { fetchProfile, requireAuth } from '../middleware/auth.js';

// Registration, passwords and sessions are all handled by Clerk.
// The only auth route left is "who am I", which also keeps our copy of the
// person's name / email in step with their Clerk profile.
const router = Router();

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = req.user;
    const fresh = await fetchProfile(user.clerkId);
    if (fresh) {
      const changed = ['name', 'username', 'email'].some((k) => (fresh[k] ?? null) !== (user[k] ?? null));
      if (changed) {
        Object.assign(user, fresh);
        await user.save();
      }
    }
    res.json({ user: user.toSelf() });
  } catch (err) {
    next(err);
  }
});

export default router;
