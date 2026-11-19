import { NavLink } from 'react-router-dom';
import { UserButton } from '@clerk/react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { VideoIcon, CoinIcon } from './Icons';

export default function Navbar() {
  const { user } = useAuth();
  const { connected } = useSocket();

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <NavLink to="/" className="brand" aria-label="Huddle home">
          <span className="brand-mark">
            <VideoIcon size={16} />
          </span>
          Huddle
        </NavLink>

        <nav className="nav-links" aria-label="Main">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/history">History</NavLink>
        </nav>

        <div className="nav-user">
          <span
            className={`conn ${connected ? 'is-up' : ''}`}
            title={connected ? 'Connected' : 'Reconnecting…'}
            role="status"
          >
            <span className="conn-dot" />
            <span className="conn-label">{connected ? 'Online' : 'Connecting…'}</span>
          </span>
          <NavLink to="/credits" className="credit-chip" title="Buy credits" aria-label={`${user?.credits ?? 0} credits. Buy more`}>
            <CoinIcon size={15} />
            {user?.credits ?? 0}
          </NavLink>
          {/* Clerk's avatar menu: manage account, sign out. */}
          <UserButton />
        </div>
      </div>
    </header>
  );
}
