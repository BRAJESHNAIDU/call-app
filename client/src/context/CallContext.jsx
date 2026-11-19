import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useSocket } from './SocketContext';
import { useBilling } from './BillingContext';

const CallContext = createContext(null);
export const useCall = () => useContext(CallContext);

const FALLBACK_ICE = [{ urls: ['stun:stun.l.google.com:19302'] }];

function mediaErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera or microphone access was blocked. Allow it in your browser settings and try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera or microphone was found on this device.';
    case 'NotReadableError':
      return 'Your camera or microphone is being used by another app.';
    case 'InsecureContext':
      return 'Video calls need a secure connection (HTTPS or localhost).';
    default:
      return 'Could not access your camera or microphone.';
  }
}

async function getLocalMedia() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('Insecure context'), { name: 'InsecureContext' });
  }
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
  });
}

/**
 * Status flow:  idle -> searching -> connecting -> active -> idle
 *
 * "searching": camera is on and we're waiting in the server's queue for a random match.
 * "connecting": matched; setting up the WebRTC connection.
 * Signaling goes over Socket.IO; media goes peer-to-peer. Of the two matched people,
 * the server names one the "initiator", who creates the WebRTC offer.
 */
export function CallProvider({ children }) {
  const { socket } = useSocket();
  const { canAfford, costs } = useBilling();

  const [status, setStatus] = useState('idle');
  const [peer, setPeer] = useState(null);
  const [previewStream, setPreviewStream] = useState(null); // what the self-view shows
  const [remoteStream, setRemoteStream] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [peerMedia, setPeerMedia] = useState({ audio: true, video: true });
  const [connectedAt, setConnectedAt] = useState(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [notice, setNotice] = useState(null);

  // Refs hold the "live" values that socket/WebRTC callbacks need without going stale.
  const statusRef = useRef('idle');
  const pcRef = useRef(null);
  const localRef = useRef(null); // camera + mic stream
  const screenRef = useRef(null); // screen-share stream while sharing
  const cameraTrackRef = useRef(null);
  const pendingIceRef = useRef([]);
  const pendingSignalsRef = useRef([]); // signals that arrive before our peer connection exists
  const iceServersRef = useRef(null);

  const changeStatus = useCallback((next) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const showNotice = useCallback((message) => setNotice({ id: Date.now(), message }), []);
  const clearNotice = useCallback(() => setNotice(null), []);

  // Tear everything down and return to idle.
  const cleanup = useCallback(
    (message) => {
      const pc = pcRef.current;
      if (pc) {
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.onconnectionstatechange = null;
        pc.close();
        pcRef.current = null;
      }
      localRef.current?.getTracks().forEach((t) => t.stop());
      screenRef.current?.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      localRef.current = null;
      screenRef.current = null;
      cameraTrackRef.current = null;
      pendingIceRef.current = [];
      pendingSignalsRef.current = [];

      setPreviewStream(null);
      setRemoteStream(null);
      setPeer(null);
      setMicOn(true);
      setCamOn(true);
      setSharing(false);
      setPeerMedia({ audio: true, video: true });
      setConnectedAt(null);
      setReconnecting(false);
      changeStatus('idle');
      if (message) showNotice(message);
    },
    [changeStatus, showNotice]
  );

  const attachLocal = useCallback((stream) => {
    localRef.current = stream;
    cameraTrackRef.current = stream.getVideoTracks()[0] ?? null;
    setPreviewStream(stream);
    setMicOn(true);
    setCamOn(true);
  }, []);

  const loadIceServers = useCallback(async () => {
    if (iceServersRef.current) return iceServersRef.current;
    try {
      const { iceServers } = await api('/api/ice');
      iceServersRef.current = iceServers;
    } catch {
      iceServersRef.current = FALLBACK_ICE;
    }
    return iceServersRef.current;
  }, []);

  const broadcastMedia = useCallback(() => {
    const audio = localRef.current?.getAudioTracks()[0]?.enabled ?? false;
    const video = screenRef.current ? true : cameraTrackRef.current?.enabled ?? false;
    socket?.emit('call:media', { audio, video });
  }, [socket]);

  const createPeerConnection = useCallback(async () => {
    const iceServers = await loadIceServers();
    // The call may have been cancelled while we were awaiting.
    if (statusRef.current === 'idle' || !localRef.current) return null;

    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;

    localRef.current.getTracks().forEach((track) => pc.addTrack(track, localRef.current));

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('rtc:signal', { type: 'ice', candidate: e.candidate.toJSON() });
    };

    pc.ontrack = (e) => {
      setRemoteStream(e.streams[0] ?? new MediaStream([e.track]));
    };

    pc.onconnectionstatechange = () => {
      if (pcRef.current !== pc) return;
      const state = pc.connectionState;
      if (state === 'connected') {
        setReconnecting(false);
        if (statusRef.current !== 'active') {
          changeStatus('active');
          setConnectedAt(Date.now());
        }
      } else if (state === 'disconnected') {
        setReconnecting(true); // often recovers on its own
      } else if (state === 'failed') {
        socket.emit('call:end');
        cleanup('The connection failed. This is usually a network or firewall issue.');
      }
    };

    return pc;
  }, [socket, loadIceServers, changeStatus, cleanup]);

  // ---- actions --------------------------------------------------------------
  const startSearch = useCallback(async () => {
    if (!socket || statusRef.current !== 'idle') return;

    // No credits, no call (the server checks this too).
    if (!canAfford()) {
      showNotice(`You need at least ${costs.video} credits to start a video call. Add credits from the Credits page.`);
      return;
    }

    // Claim the slot immediately so a double-click can't start two searches
    // while the browser's permission prompt is open.
    changeStatus('searching');
    try {
      const stream = await getLocalMedia();
      if (statusRef.current !== 'searching') {
        stream.getTracks().forEach((t) => t.stop()); // cancelled meanwhile
        return;
      }
      attachLocal(stream);
      loadIceServers(); // warm up so connecting is faster once matched
      socket.emit('match:find');
    } catch (err) {
      cleanup(mediaErrorMessage(err));
    }
  }, [socket, canAfford, costs, showNotice, changeStatus, attachLocal, loadIceServers, cleanup]);

  // Cancel the search, or hang up.
  const endCall = useCallback(() => {
    const current = statusRef.current;
    if (current === 'idle') return;
    if (socket) socket.emit(current === 'searching' ? 'match:cancel' : 'call:end');
    cleanup();
  }, [socket, cleanup]);

  const toggleMic = useCallback(() => {
    const track = localRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
    broadcastMedia();
  }, [broadcastMedia]);

  const toggleCamera = useCallback(() => {
    const track = cameraTrackRef.current;
    if (!track || screenRef.current) return;
    track.enabled = !track.enabled;
    setCamOn(track.enabled);
    broadcastMedia();
  }, [broadcastMedia]);

  const stopScreenShare = useCallback(async () => {
    const display = screenRef.current;
    if (!display) return;
    screenRef.current = null;
    display.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });

    const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video');
    if (sender && cameraTrackRef.current) {
      try {
        await sender.replaceTrack(cameraTrackRef.current);
      } catch {
        /* call may be ending */
      }
    }
    setSharing(false);
    setPreviewStream(localRef.current);
    broadcastMedia();
  }, [broadcastMedia]);

  const startScreenShare = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || screenRef.current) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      showNotice('Screen sharing is not supported on this device or browser.');
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = display.getVideoTracks()[0];
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (!sender || pcRef.current !== pc) {
        display.getTracks().forEach((t) => t.stop());
        return;
      }
      // replaceTrack swaps what we send without renegotiating the connection.
      await sender.replaceTrack(track);
      screenRef.current = display;
      track.onended = () => stopScreenShare(); // user clicked the browser's "Stop sharing"
      setSharing(true);
      setPreviewStream(display);
      broadcastMedia();
    } catch (err) {
      if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') {
        showNotice('Could not start screen sharing.');
      }
    }
  }, [broadcastMedia, stopScreenShare, showNotice]);

  // ---- socket events --------------------------------------------------------
  useEffect(() => {
    if (!socket) return undefined;

    const flushIce = async (pc) => {
      const queued = pendingIceRef.current.splice(0);
      for (const candidate of queued) {
        try {
          await pc.addIceCandidate(candidate);
        } catch {
          /* stale candidate */
        }
      }
    };

    const handleSignal = async (pc, data) => {
      try {
        if (data.type === 'offer') {
          await pc.setRemoteDescription(data.sdp);
          await flushIce(pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('rtc:signal', { type: 'answer', sdp: { type: answer.type, sdp: answer.sdp } });
        } else if (data.type === 'answer') {
          await pc.setRemoteDescription(data.sdp);
          await flushIce(pc);
        } else if (data.type === 'ice' && data.candidate) {
          // Candidates can arrive before the remote description is set; queue them.
          if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
          else pendingIceRef.current.push(data.candidate);
        }
      } catch (err) {
        console.error('WebRTC signaling error', err);
      }
    };

    const onSignal = (data) => {
      if (!data) return;
      const pc = pcRef.current;
      if (pc) handleSignal(pc, data);
      // Matched, but our peer connection isn't ready yet: hold it until it is.
      else if (statusRef.current === 'connecting') pendingSignalsRef.current.push(data);
    };

    // Matched with someone. The initiator sends the offer; the other side answers.
    const onMatchFound = async ({ peer: matched, initiator }) => {
      if (statusRef.current !== 'searching') {
        socket.emit('call:end'); // we cancelled just as the match happened
        return;
      }
      setPeer(matched);
      changeStatus('connecting');
      try {
        const pc = await createPeerConnection();
        if (!pc) return;

        for (const data of pendingSignalsRef.current.splice(0)) await handleSignal(pc, data);

        if (initiator) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('rtc:signal', { type: 'offer', sdp: { type: offer.type, sdp: offer.sdp } });
        }
      } catch {
        socket.emit('call:end');
        cleanup('Could not set up the call. Please try again.');
      }
    };

    const onMatchError = ({ message }) => {
      if (statusRef.current === 'searching') cleanup(message);
    };

    const onEnded = ({ reason } = {}) => {
      if (reason === 'no_credits') cleanup('You ran out of credits, so the call ended. Add more to keep calling.');
      else if (reason === 'disconnected') cleanup('The other person lost connection.');
      else cleanup('The other person left the call.');
    };

    const onPeerMedia = (m) => setPeerMedia(m);
    const onDisconnect = () => {
      if (statusRef.current !== 'idle') cleanup('Lost connection to the server.');
    };

    socket.on('match:found', onMatchFound);
    socket.on('match:error', onMatchError);
    socket.on('rtc:signal', onSignal);
    socket.on('call:ended', onEnded);
    socket.on('call:peer-media', onPeerMedia);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('match:found', onMatchFound);
      socket.off('match:error', onMatchError);
      socket.off('rtc:signal', onSignal);
      socket.off('call:ended', onEnded);
      socket.off('call:peer-media', onPeerMedia);
      socket.off('disconnect', onDisconnect);
      // The socket is going away (logout / token change): drop any call in progress.
      if (statusRef.current !== 'idle') cleanup();
    };
  }, [socket, changeStatus, createPeerConnection, cleanup]);

  // Hang up cleanly if the tab is closed mid-call.
  useEffect(() => {
    const onUnload = () => {
      if (statusRef.current !== 'idle') endCall();
    };
    window.addEventListener('pagehide', onUnload);
    return () => window.removeEventListener('pagehide', onUnload);
  }, [endCall]);

  const value = useMemo(
    () => ({
      status,
      peer,
      previewStream,
      remoteStream,
      micOn,
      camOn,
      sharing,
      peerMedia,
      connectedAt,
      reconnecting,
      notice,
      clearNotice,
      startSearch,
      endCall,
      toggleMic,
      toggleCamera,
      startScreenShare,
      stopScreenShare,
    }),
    [
      status, peer, previewStream, remoteStream, micOn, camOn, sharing, peerMedia,
      connectedAt, reconnecting, notice, clearNotice, startSearch, endCall,
      toggleMic, toggleCamera, startScreenShare, stopScreenShare,
    ]
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
