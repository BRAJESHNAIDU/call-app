import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// ICE servers for WebRTC. STUN is enough on most home networks; a TURN relay is
// needed for strict NATs / corporate firewalls. Credentials stay on the server
// and are only handed to signed-in users.
router.get('/', requireAuth, (_req, res) => {
  const iceServers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];

  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(',').map((s) => s.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }

  res.json({ iceServers });
});

export default router;
