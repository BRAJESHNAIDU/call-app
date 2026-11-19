import { Router } from 'express';
import Call from '../models/Call.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Call history for the signed-in user, newest first.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const me = req.userId;
    const calls = await Call.find({ $or: [{ caller: me }, { callee: me }] })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('caller callee', 'name username')
      .lean();

    res.json({
      calls: calls.map((c) => {
        const outgoing = String(c.caller?._id ?? c.caller) === me;
        const other = outgoing ? c.callee : c.caller;
        return {
          id: String(c._id),
          type: c.type,
          status: c.status,
          direction: outgoing ? 'outgoing' : 'incoming',
          duration: c.duration || 0,
          creditsCharged: c.creditsCharged || 0, // each person pays the same
          createdAt: c.createdAt,
          peer: other?._id
            ? { id: String(other._id), name: other.name, username: other.username }
            : { id: null, name: 'Deleted user', username: '' },
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
