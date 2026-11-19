import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { API_BASE } from '../api';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);
export const useSocket = () => useContext(SocketContext);

export function SocketProvider({ children }) {
  const { isSignedIn, user, getToken, setCredits } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState(() => new Set());

  // Always read the latest getToken without reconnecting when its identity changes.
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const userId = user?.id;

  useEffect(() => {
    if (!isSignedIn || !userId) return undefined;

    const s = io(API_BASE || window.location.origin, {
      // Clerk tokens expire after about a minute, so fetch a fresh one on every (re)connect.
      auth: (cb) => {
        getTokenRef
          .current()
          .then((token) => cb({ token }))
          .catch(() => cb({}));
      },
    });

    let retryTimer;
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => {
      setConnected(false);
      setOnline(new Set());
    });
    // Socket.IO doesn't retry after a rejected login, so try again shortly
    // (covers a token that expired in flight, or the server still starting up).
    s.on('connect_error', (err) => {
      if (err.message === 'unauthorized') retryTimer = setTimeout(() => s.connect(), 3000);
    });

    s.on('credits:update', ({ credits }) => setCredits(credits));

    // Full list when we connect, then incremental updates.
    s.on('presence:list', (ids) => setOnline(new Set(ids)));
    s.on('presence:update', ({ userId: id, online: isOnline }) => {
      setOnline((prev) => {
        const next = new Set(prev);
        if (isOnline) next.add(id);
        else next.delete(id);
        return next;
      });
    });

    setSocket(s);
    return () => {
      clearTimeout(retryTimer);
      s.close();
      setSocket(null);
      setConnected(false);
      setOnline(new Set());
    };
  }, [isSignedIn, userId, setCredits]);

  const value = useMemo(() => ({ socket, connected, online }), [socket, connected, online]);
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}
