import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useAuth as useClerkAuth } from '@clerk/react';
import { api, setTokenGetter } from '../api';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

/**
 * Sign-in itself is Clerk's job. This provider adds the app's own record of the
 * person (their credits, loaded from our server) on top of Clerk's session.
 */
export function AuthProvider({ children }) {
  const { isLoaded, isSignedIn, userId, getToken } = useClerkAuth();
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  // Layout effects run before any child's useEffect, so API calls made by
  // children on mount already have a token source.
  useLayoutEffect(() => {
    setTokenGetter(() => getToken());
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded) return undefined;
    if (!isSignedIn) {
      setUser(null);
      setStatus('ready');
      return undefined;
    }

    let cancelled = false;
    setUser(null);
    setStatus('loading');
    api('/api/auth/me')
      .then((data) => {
        if (cancelled) return;
        setUser(data.user);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, userId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Live balance updates from the server (purchases and per-minute call charges).
  const setCredits = useCallback((credits) => setUser((u) => (u ? { ...u, credits } : u)), []);

  const loading = !isLoaded || (isSignedIn && status === 'loading');

  const value = useMemo(
    () => ({ isLoaded, isSignedIn: !!isSignedIn, user, loading, error, retry, getToken, setCredits }),
    [isLoaded, isSignedIn, user, loading, error, retry, getToken, setCredits]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
