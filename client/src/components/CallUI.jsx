import { useEffect } from 'react';
import { useCall } from '../context/CallContext';
import CallScreen from './CallScreen';

// Mounted once at the app root so the call screen works from any page.
export default function CallUI() {
  const { status, notice, clearNotice } = useCall();

  // Auto-dismiss notices.
  useEffect(() => {
    if (!notice) return undefined;
    const id = setTimeout(clearNotice, 5000);
    return () => clearTimeout(id);
  }, [notice, clearNotice]);

  return (
    <>
      {status !== 'idle' && <CallScreen />}
      {notice && (
        <div className="toast" role="status" aria-live="polite" onClick={clearNotice}>
          {notice.message}
        </div>
      )}
    </>
  );
}
