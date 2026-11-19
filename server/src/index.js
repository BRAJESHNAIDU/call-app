import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';

import authRoutes from './routes/auth.js';
import callRoutes from './routes/calls.js';
import iceRoutes from './routes/ice.js';
import paymentRoutes, { webhookHandler } from './routes/payments.js';
import { initSocket } from './socket.js';
import Call from './models/Call.js';
import User from './models/User.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/huddle';

if (!process.env.CLERK_SECRET_KEY || !process.env.CLERK_PUBLISHABLE_KEY) {
  console.error(
    'Missing Clerk keys. Set CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY in server/.env ' +
      '(Clerk dashboard → API keys).'
  );
  process.exit(1);
}

// Clerk's browser script and API live on your instance's "frontend API" host, which is
// encoded in the publishable key (pk_test_ + base64 of "host$"). The CSP must allow it.
const clerkOrigin = (() => {
  try {
    const encoded = process.env.CLERK_PUBLISHABLE_KEY.replace(/^pk_(test|live)_/, '');
    const host = Buffer.from(encoded, 'base64').toString('utf8').replace(/\$$/, '');
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : '';
  } catch {
    return '';
  }
})();

const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.set('trust proxy', 1); // behind Render/Railway/Nginx, so rate limiting sees real IPs

app.use(
  helmet({
    // Razorpay's checkout opens popups for some payment methods (UPI, netbanking).
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        // Socket.IO websocket + Razorpay checkout.
        // Also Clerk's sign-in widget (script, API, avatars, bot check).
        'script-src': ["'self'", 'https://checkout.razorpay.com', 'https://challenges.cloudflare.com', clerkOrigin].filter(Boolean),
        'frame-src': [
          "'self'",
          'https://api.razorpay.com',
          'https://checkout.razorpay.com',
          'https://challenges.cloudflare.com',
        ],
        'connect-src': [
          "'self'",
          'ws:',
          'wss:',
          'https://api.razorpay.com',
          'https://checkout.razorpay.com',
          'https://lumberjack.razorpay.com',
          'https://clerk-telemetry.com',
          clerkOrigin,
        ].filter(Boolean),
        'img-src': ["'self'", 'data:', 'https://img.clerk.com'],
        'worker-src': ["'self'", 'blob:'],
      },
    },
  })
);
app.use(cors({ origin: allowedOrigins, credentials: true }));

// Must come before express.json(): the webhook signature covers the raw bytes.
app.post('/api/payments/webhook', express.raw({ type: '*/*', limit: '100kb' }), webhookHandler);

app.use(express.json({ limit: '10kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/ice', iceRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

// In production a single service serves the built React app too.
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

const server = http.createServer(app);
app.set('io', initSocket(server, allowedOrigins)); // payments use it to push balance updates

async function start() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('MongoDB connected');

    // Drop leftover indexes from the old login system (unique username/email).
    await User.syncIndexes();

    // Presence and call state live in memory, so after a restart any call that
    // was ringing or active can no longer be live.
    await Call.updateMany(
      { status: { $in: ['ringing', 'active'] } },
      { status: 'failed', endedAt: new Date() }
    );

    server.listen(PORT, () => console.log(`Huddle server listening on :${PORT}`));
  } catch (err) {
    console.error('Failed to start:', err.message);
    process.exit(1);
  }
}

function shutdown() {
  server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
