import { useEffect, useState } from 'react';
import { api } from '../api';
import Avatar from '../components/Avatar';
import { formatDuration, formatWhen } from '../utils';

function outcome(call) {
  if (call.status === 'completed') return { text: formatDuration(call.duration), tone: 'ok' };
  if (call.status === 'failed') return { text: 'Failed', tone: 'bad' };
  return { text: 'In progress', tone: 'neutral' };
}

export default function History() {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api('/api/calls')
      .then((data) => !cancelled && setCalls(data.calls))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Call history</h1>
          <p className="muted">Your last 100 calls.</p>
        </div>
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}
      {loading && <p className="muted">Loading…</p>}

      {!loading && !error && calls.length === 0 && (
        <div className="empty">
          <h3>No calls yet</h3>
          <p className="muted">People you talk to will show up here.</p>
        </div>
      )}

      <ul className="people">
        {calls.map((c) => {
          const result = outcome(c);
          return (
            <li key={c.id} className="person">
              <Avatar name={c.peer.name} />
              <div className="person-info">
                <strong>{c.peer.name}</strong>
                <span className="muted">
                  Video call · {formatWhen(c.createdAt)}
                  {c.creditsCharged > 0 && ` · −${c.creditsCharged} credits`}
                </span>
              </div>
              <span className={`pill pill-${result.tone}`}>{result.text}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
