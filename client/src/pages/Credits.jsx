import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useBilling } from '../context/BillingContext';
import { CoinIcon } from '../components/Icons';
import { formatWhen } from '../utils';

const money = (amount, currency) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount / 100);

function loadCheckout() {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function Credits() {
  const { user, setCredits } = useAuth();
  const { config, costs } = useBilling();
  const [payments, setPayments] = useState([]);
  const [busyPack, setBusyPack] = useState(null);
  const [message, setMessage] = useState(null); // { type: 'ok' | 'error', text }

  const loadHistory = useCallback(() => {
    api('/api/payments')
      .then((data) => setPayments(data.payments))
      .catch(() => {});
  }, []);

  useEffect(loadHistory, [loadHistory]);

  async function buy(pack) {
    setMessage(null);
    setBusyPack(pack.id);
    try {
      if (!(await loadCheckout())) {
        throw new Error('Could not load the payment window. Check your connection and try again.');
      }
      const order = await api('/api/payments/order', { method: 'POST', body: { packId: pack.id } });

      await new Promise((resolve) => {
        const rzp = new window.Razorpay({
          key: order.keyId,
          order_id: order.orderId,
          amount: order.amount,
          currency: order.currency,
          name: 'Huddle',
          description: `${pack.credits} call credits`,
          prefill: { name: user.name, email: user.email },
          theme: { color: '#4da3ff' },
          handler: async (response) => {
            try {
              const result = await api('/api/payments/verify', { method: 'POST', body: response });
              setCredits(result.credits);
              setMessage({ type: 'ok', text: `Payment received. ${pack.credits} credits added.` });
              loadHistory();
            } catch (err) {
              setMessage({
                type: 'error',
                text: `Your payment went through, but we couldn't confirm it yet (${err.message}). Your credits will be added shortly. Refresh this page in a minute.`,
              });
            }
            resolve();
          },
          modal: { ondismiss: resolve },
        });
        rzp.on('payment.failed', (res) => {
          setMessage({ type: 'error', text: res.error?.description || 'Payment failed. Please try again.' });
        });
        rzp.open();
      });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setBusyPack(null);
    }
  }

  const packs = config?.packs ?? [];

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Credits</h1>
          <p className="muted">You need credits to start a call. Each person in a call pays for their own minutes.</p>
        </div>
      </div>

      <div className="balance-card">
        <span className="balance-icon">
          <CoinIcon size={26} />
        </span>
        <div>
          <div className="balance-value">{user?.credits ?? 0}</div>
          <div className="muted">credits available</div>
        </div>
        <p className="balance-rates muted">
          Video call: {costs.video} credits/min
        </p>
      </div>

      {message && (
        <div className={message.type === 'ok' ? 'banner' : 'form-error'} role="status">
          {message.text}
        </div>
      )}

      {config && !config.enabled && (
        <div className="banner" role="status">
          Payments aren't set up on this server yet. The site owner needs to add Razorpay keys.
        </div>
      )}

      <h2 className="section-title">Buy credits</h2>
      <div className="packs">
        {packs.map((pack) => (
          <div key={pack.id} className="pack">
            <span className="pack-label">{pack.label}</span>
            <strong className="pack-credits">{pack.credits} credits</strong>
            <span className="muted">
              ≈ {Math.floor(pack.credits / costs.video)} minutes of video
            </span>
            <button
              className="btn btn-primary btn-block"
              disabled={!config?.enabled || busyPack !== null}
              onClick={() => buy(pack)}
            >
              {busyPack === pack.id ? 'Opening…' : `Pay ${money(pack.amount, config.currency)}`}
            </button>
          </div>
        ))}
      </div>

      <h2 className="section-title">Purchase history</h2>
      {payments.length === 0 ? (
        <p className="muted">No purchases yet.</p>
      ) : (
        <ul className="people">
          {payments.map((p) => (
            <li key={p.id} className="person">
              <div className="person-info">
                <strong>+{p.credits} credits</strong>
                <span className="muted">{formatWhen(p.paidAt)}</span>
              </div>
              <span className="pill pill-neutral">{money(p.amount, p.currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
