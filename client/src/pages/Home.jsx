import { Link } from 'react-router-dom';
import { useBilling } from '../context/BillingContext';
import { useCall } from '../context/CallContext';
import { useSocket } from '../context/SocketContext';
import { VideoIcon } from '../components/Icons';

export default function Home() {
  const { online, connected } = useSocket();
  const { startSearch, status } = useCall();
  const { canAfford, costs, credits } = useBilling();

  const others = Math.max(0, online.size - 1);
  const affordable = canAfford();
  const disabled = !connected || status !== 'idle' || !affordable;

  return (
    <section className="home-hero">
      <h1>Meet someone new</h1>
      <p className="muted">
        Press the button and we'll connect you by video with a random person who is online and ready to chat.
      </p>

      {!connected && (
        <div className="banner" role="status">
          Reconnecting to the server… you can start a call once you're back online.
        </div>
      )}
      {connected && !affordable && (
        <div className="banner" role="status">
          You're out of credits, so calling is turned off. <Link to="/credits">Add credits</Link> to start a call.
        </div>
      )}

      <button className="btn btn-primary btn-lg" disabled={disabled} onClick={startSearch}>
        <VideoIcon size={22} />
        Start video call
      </button>

      <p className="muted">
        {costs.video} credits per minute · You have {credits} credit{credits === 1 ? '' : 's'} ·{' '}
        {others} other {others === 1 ? 'person' : 'people'} online
      </p>
    </section>
  );
}
