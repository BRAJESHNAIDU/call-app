import { Server } from 'socket.io';
import mongoose from 'mongoose';
import { ensureUser, verifyClerkToken } from './middleware/auth.js';
import User from './models/User.js';
import Call from './models/Call.js';
import { COST_PER_MINUTE } from './config.js';

const COST = COST_PER_MINUTE.video;

/**
 * Random video matching + WebRTC signaling.
 *
 * Flow
 *  - A user presses "Start video call" -> `match:find`. They need >= COST credits.
 *  - They wait in a queue. When two or more people are waiting, the longest-waiting
 *    person is paired with a RANDOM other waiting person.
 *  - Both are charged the first minute, then again every 60 s. If either can't pay,
 *    the call ends. Nobody is charged while still waiting.
 *  - `match:found` tells each side who they got; the `initiator` creates the WebRTC
 *    offer. Offers/answers/ICE are relayed only between the two paired sockets.
 *
 * State (presence, queue, active calls) lives in memory, so this runs as a single
 * instance. To scale out, use the Socket.IO Redis adapter and move it to Redis.
 */
export function initSocket(httpServer, corsOrigins) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
    maxHttpBufferSize: 1e5, // signaling messages are tiny
  });

  /** userId -> Set<socketId> (a user can have several tabs) */
  const sockets = new Map();
  /** userId -> call. Both people in a call point at the same object. */
  const calls = new Map();
  /** People waiting for a match, oldest first: { userId, socketId } */
  let queue = [];

  const room = (userId) => `user:${userId}`;
  const isLive = (entry) => !!sockets.get(entry.userId)?.has(entry.socketId);
  const otherParty = (call, userId) => (call.caller === userId ? call.callee : call.caller);
  const socketOf = (call, userId) => (call.caller === userId ? call.callerSocket : call.calleeSocket);
  const logError = (what) => (err) => console.error(`[socket] ${what}:`, err.message);

  // ---- billing ------------------------------------------------------------
  // One atomic, conditional update: the balance can never go below zero, even if
  // several charges race. Returns the new balance, or null if they can't afford it.
  async function charge(userId, amount) {
    try {
      const u = await User.findOneAndUpdate(
        { _id: userId, credits: { $gte: amount } },
        { $inc: { credits: -amount } },
        { new: true }
      )
        .select('credits')
        .lean();
      if (!u) return null;
      io.to(room(userId)).emit('credits:update', { credits: u.credits });
      return u.credits;
    } catch (err) {
      logError('charge')(err);
      return null;
    }
  }

  async function refund(userId, amount) {
    try {
      const u = await User.findByIdAndUpdate(userId, { $inc: { credits: amount } }, { new: true })
        .select('credits')
        .lean();
      if (u) io.to(room(userId)).emit('credits:update', { credits: u.credits });
    } catch (err) {
      logError('refund')(err);
    }
  }

  async function finish(call, status) {
    if (call.finished) return;
    call.finished = true;
    clearInterval(call.billTimer);
    if (calls.get(call.caller) === call) calls.delete(call.caller);
    if (calls.get(call.callee) === call) calls.delete(call.callee);

    const endedAt = new Date();
    const update = { status, endedAt, creditsCharged: call.charged };
    if (call.answeredAt) {
      update.duration = Math.max(0, Math.round((endedAt - call.answeredAt) / 1000));
    }
    try {
      await call.persisted; // make sure the document exists before updating it
      await Call.findByIdAndUpdate(call.id, update);
    } catch (err) {
      logError('finish call')(err);
    }
  }

  // Every 60 s while a call is active: both people pay for the next minute in
  // advance. If either can't, hang up (and give back whoever did pay).
  async function bill(call) {
    if (call.finished) return;
    const [a, b] = await Promise.all([charge(call.caller, COST), charge(call.callee, COST)]);

    if (call.finished) {
      if (a !== null) refund(call.caller, COST);
      if (b !== null) refund(call.callee, COST);
      return;
    }
    if (a === null || b === null) {
      if (a !== null) refund(call.caller, COST);
      if (b !== null) refund(call.callee, COST);
      io.to(call.callerSocket).emit('call:ended', { reason: a === null ? 'no_credits' : 'partner_no_credits' });
      io.to(call.calleeSocket).emit('call:ended', { reason: b === null ? 'no_credits' : 'partner_no_credits' });
      finish(call, 'completed');
      return;
    }
    call.charged += COST;
  }

  // ---- matchmaking --------------------------------------------------------
  function pruneQueue() {
    queue = queue.filter((e) => isLive(e) && !calls.has(e.userId));
  }

  function tryMatch() {
    pruneQueue();
    while (queue.length >= 2) {
      const a = queue.shift(); // waited longest
      const b = queue.splice(Math.floor(Math.random() * queue.length), 1)[0]; // random partner
      pair(a, b); // reserves both users synchronously (see below)
    }
  }

  function requeue(entry) {
    if (isLive(entry) && !calls.has(entry.userId) && !queue.some((e) => e.userId === entry.userId)) {
      queue.unshift(entry); // they already waited, so keep their place at the front
    }
  }

  async function pair(a, b) {
    const _id = new mongoose.Types.ObjectId();
    const call = {
      id: String(_id),
      caller: a.userId, // just names for the two sides; both pay the same
      callee: b.userId,
      callerSocket: a.socketId,
      calleeSocket: b.socketId,
      state: 'pairing',
      answeredAt: null,
      finished: false,
      charged: 0,
      billTimer: null,
      persisted: null,
    };
    // Reserve both users right away so nothing else can match or call them.
    calls.set(a.userId, call);
    calls.set(b.userId, call);

    const [balA, balB] = await Promise.all([charge(a.userId, COST), charge(b.userId, COST)]);

    if (calls.get(a.userId) === call) calls.delete(a.userId);
    if (calls.get(b.userId) === call) calls.delete(b.userId);

    const sides = [
      { entry: a, bal: balA },
      { entry: b, bal: balB },
    ];
    const failed = sides.some((s) => s.bal === null || !isLive(s.entry));
    if (failed) {
      for (const { entry, bal } of sides) {
        if (bal !== null) refund(entry.userId, COST); // never charge for a match that didn't happen
        if (bal === null && isLive(entry)) {
          io.to(entry.socketId).emit('match:error', {
            code: 'no_credits',
            message: `You need at least ${COST} credits to start a video call. Add credits to continue.`,
          });
        } else if (bal !== null) {
          requeue(entry); // their partner dropped out: keep searching
        }
      }
      tryMatch();
      return;
    }

    call.state = 'active';
    call.answeredAt = new Date();
    call.charged = COST;
    calls.set(a.userId, call);
    calls.set(b.userId, call);

    call.persisted = Call.create({
      _id,
      caller: a.userId,
      callee: b.userId,
      type: 'video',
      status: 'active',
      answeredAt: call.answeredAt,
      creditsCharged: COST,
    }).catch(logError('create call'));
    call.billTimer = setInterval(() => bill(call), 60_000);

    const info = (socketId) => {
      const d = io.sockets.sockets.get(socketId)?.data ?? {};
      return { id: d.userId, name: d.name, username: d.username };
    };
    io.to(a.socketId).emit('match:found', { callId: call.id, peer: info(b.socketId), initiator: true });
    io.to(b.socketId).emit('match:found', { callId: call.id, peer: info(a.socketId), initiator: false });
  }

  // ---- authentication -----------------------------------------------------
  io.use(async (socket, next) => {
    try {
      const payload = await verifyClerkToken(socket.handshake.auth?.token);
      const user = await ensureUser(payload.sub);
      socket.data.userId = String(user._id);
      socket.data.name = user.name;
      socket.data.username = user.username;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const me = socket.data.userId;

    // ---- presence ---------------------------------------------------------
    socket.join(room(me));
    const mine = sockets.get(me) ?? new Set();
    const cameOnline = mine.size === 0;
    mine.add(socket.id);
    sockets.set(me, mine);

    if (cameOnline) socket.broadcast.emit('presence:update', { userId: me, online: true });
    socket.emit('presence:list', [...sockets.keys()]);

    // ---- matching ---------------------------------------------------------
    socket.on('match:find', async () => {
      if (calls.has(me)) {
        return socket.emit('match:error', { message: 'You are already in a call.' });
      }
      if (queue.some((e) => e.userId === me)) return;

      // No credits, no calls. Checked here as well as in the UI, so it can't be bypassed.
      const user = await User.findById(me).select('credits').lean().catch(() => null);
      if (!user || (user.credits ?? 0) < COST) {
        return socket.emit('match:error', {
          code: 'no_credits',
          message: `You need at least ${COST} credits to start a video call. Add credits to continue.`,
        });
      }

      // State may have changed during the await.
      if (calls.has(me) || queue.some((e) => e.userId === me) || !isLive({ userId: me, socketId: socket.id })) return;

      queue.push({ userId: me, socketId: socket.id });
      tryMatch();
    });

    socket.on('match:cancel', () => {
      queue = queue.filter((e) => e.userId !== me);
    });

    // ---- in a call --------------------------------------------------------
    socket.on('call:end', () => {
      const call = calls.get(me);
      if (!call || call.state !== 'active' || socketOf(call, me) !== socket.id) return;
      io.to(socketOf(call, otherParty(call, me))).emit('call:ended', {});
      finish(call, 'completed');
    });

    // Offer / answer / ICE candidates: relayed only to the other side of the call.
    socket.on('rtc:signal', (data) => {
      if (!data || typeof data !== 'object') return;
      const call = calls.get(me);
      if (!call || call.state !== 'active' || socketOf(call, me) !== socket.id) return;
      io.to(socketOf(call, otherParty(call, me))).emit('rtc:signal', data);
    });

    // Mute / camera state, so the other side can show indicators.
    socket.on('call:media', (payload) => {
      const call = calls.get(me);
      if (!call || call.state !== 'active' || socketOf(call, me) !== socket.id) return;
      io.to(socketOf(call, otherParty(call, me))).emit('call:peer-media', {
        audio: !!payload?.audio,
        video: !!payload?.video,
      });
    });

    // ---- disconnect -------------------------------------------------------
    socket.on('disconnect', () => {
      queue = queue.filter((e) => e.socketId !== socket.id);

      const set = sockets.get(me);
      set?.delete(socket.id);
      if (set && set.size === 0) {
        sockets.delete(me);
        io.emit('presence:update', { userId: me, online: false });
        User.findByIdAndUpdate(me, { lastSeen: new Date() }).catch(logError('lastSeen'));
      }

      const call = calls.get(me);
      if (!call || call.state !== 'active' || socketOf(call, me) !== socket.id) return;
      io.to(socketOf(call, otherParty(call, me))).emit('call:ended', { reason: 'disconnected' });
      finish(call, 'completed');
    });
  });

  return io;
}
