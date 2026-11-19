import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from './Navbar';

export default function ProtectedLayout() {
  const { user, isSignedIn, loading, error, retry } = useAuth();
  const location = useLocation();

  if (loading) return <div className="splash">Loading…</div>;
  if (!isSignedIn) return <Navigate to="/login" replace state={{ from: location }} />;

  // Signed in with Clerk, but our server couldn't load the account.
  if (!user) {
    return (
      <div className="splash" style={{ padding: 24, textAlign: 'center' }}>
        <div>
          <h2>Couldn't load your account</h2>
          <p className="muted" style={{ margin: '8px 0 16px' }}>{error || 'Please try again.'}</p>
          <button className="btn btn-primary" onClick={retry}>Try again</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Navbar />
      <main className="page">
        <Outlet />
      </main>
    </>
  );
}
