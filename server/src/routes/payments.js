import { Router } from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import User from '../models/User.js';
import Payment from '../models/Payment.js';
import { requireAuth } from '../middleware/auth.js';
import { COST_PER_MINUTE, CURRENCY, PACKS } from '../config.js';

const router = Router();

const keyId = () => process.env.RAZORPAY_KEY_ID;
const keySecret = () => process.env.RAZORPAY_KEY_SECRET;
const enabled = () => Boolean(keyId() && keySecret());

const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Turn a paid order into credits. Safe to call many times for the same order
 * (verify endpoint and webhook can both fire): only the call that flips the
 * order from "created" to "paid" adds the credits.
 */
async function fulfill(req, orderId, paymentId) {
  const payment = await Payment.findOneAndUpdate(
    { orderId, status: 'created' },
    { status: 'paid', paymentId, paidAt: new Date() },
    { new: true }
  );
  if (!payment) return; // unknown order, or already fulfilled

  try {
    const user = await User.findByIdAndUpdate(
      payment.user,
      { $inc: { credits: payment.credits } },
      { new: true }
    ).select('credits');
    req.app.get('io')?.to(`user:${payment.user}`).emit('credits:update', { credits: user.credits });
  } catch (err) {
    // Put the order back so the webhook retry (or the user) can try again.
    await Payment.updateOne({ _id: payment._id }, { status: 'created', $unset: { paidAt: 1 } });
    throw err;
  }
}

const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many payment attempts. Please try again in a few minutes.' },
});

// Packs, call prices and the public key the checkout window needs.
router.get('/config', requireAuth, (_req, res) => {
  res.json({
    enabled: enabled(),
    keyId: enabled() ? keyId() : null,
    currency: CURRENCY,
    packs: PACKS,
    costs: COST_PER_MINUTE,
  });
});

// Start a purchase. The price always comes from the server, never the client.
router.post('/order', requireAuth, orderLimiter, async (req, res, next) => {
  try {
    if (!enabled()) return res.status(503).json({ error: 'Payments are not set up yet.' });

    const pack = PACKS.find((p) => p.id === String(req.body?.packId ?? ''));
    if (!pack) return res.status(400).json({ error: 'Unknown credit pack.' });

    const auth = Buffer.from(`${keyId()}:${keySecret()}`).toString('base64');
    const rp = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: pack.amount,
        currency: CURRENCY,
        receipt: `h_${req.userId.slice(-8)}_${Date.now()}`,
        notes: { userId: req.userId, packId: pack.id },
      }),
    });
    const order = await rp.json().catch(() => null);
    if (!rp.ok || !order?.id) {
      console.error('Razorpay order failed:', rp.status, order?.error?.description);
      return res.status(502).json({ error: 'Could not start the payment. Please try again.' });
    }

    await Payment.create({
      user: req.userId,
      orderId: order.id,
      packId: pack.id,
      credits: pack.credits,
      amount: pack.amount,
      currency: CURRENCY,
    });

    res.status(201).json({
      keyId: keyId(),
      orderId: order.id,
      amount: pack.amount,
      currency: CURRENCY,
    });
  } catch (err) {
    next(err);
  }
});

// Called by the browser after checkout succeeds. Checks Razorpay's signature.
router.post('/verify', requireAuth, async (req, res, next) => {
  try {
    if (!enabled()) return res.status(503).json({ error: 'Payments are not set up yet.' });

    const orderId = String(req.body?.razorpay_order_id ?? '');
    const paymentId = String(req.body?.razorpay_payment_id ?? '');
    const signature = String(req.body?.razorpay_signature ?? '');

    if (!safeEqual(hmac(keySecret(), `${orderId}|${paymentId}`), signature)) {
      return res.status(400).json({ error: 'Payment could not be verified.' });
    }

    // The order must belong to the signed-in user.
    const payment = await Payment.findOne({ orderId, user: req.userId }).lean();
    if (!payment) return res.status(404).json({ error: 'Order not found.' });

    await fulfill(req, orderId, paymentId);
    const user = await User.findById(req.userId).select('credits').lean();
    res.json({ credits: user.credits });
  } catch (err) {
    next(err);
  }
});

// Purchase history.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const payments = await Payment.find({ user: req.userId, status: 'paid' })
      .sort({ paidAt: -1 })
      .limit(50)
      .lean();
    res.json({
      payments: payments.map((p) => ({
        id: String(p._id),
        credits: p.credits,
        amount: p.amount,
        currency: p.currency,
        paidAt: p.paidAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Razorpay webhook: credits the user even if they close the tab before the
 * browser calls /verify. Mounted in index.js with a raw body parser, because
 * the signature is computed over the exact bytes Razorpay sent.
 */
export async function webhookHandler(req, res) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Webhook not configured.' });

  const raw = req.body;
  if (!Buffer.isBuffer(raw) || !safeEqual(hmac(secret, raw), req.headers['x-razorpay-signature'] ?? '')) {
    return res.status(400).json({ error: 'Invalid signature.' });
  }

  try {
    const event = JSON.parse(raw.toString('utf8'));
    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      const p = event.payload?.payment?.entity;
      if (p?.order_id && p?.id) await fulfill(req, p.order_id, p.id);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(500).json({ error: 'Webhook failed.' }); // Razorpay retries
  }
}

export default router;
