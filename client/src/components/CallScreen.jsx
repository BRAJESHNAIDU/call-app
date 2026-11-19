import { useEffect, useState } from 'react';
import { useCall } from '../context/CallContext';
import { formatDuration } from '../utils';
import Avatar from './Avatar';
import MediaView from './MediaView';
import { HangUpIcon, MicIcon, MicOffIcon, ScreenIcon, VideoIcon, VideoOffIcon } from './Icons';

function useElapsed(since) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!since) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [since]);
  return since ? (Date.now() - since) / 1000 : 0;
}

function ControlButton({ label, active = true, danger = false, disabled = false, onClick, children }) {
  return (
    <button
      type="button"
      className={`ctl ${danger ? 'ctl-danger' : ''} ${active ? '' : 'is-off'}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={danger ? undefined : !active}
      title={label}
    >
      {children}
    </button>
  );
}

export default function CallScreen() {
  const {
    status, peer, previewStream, remoteStream, micOn, camOn, sharing, peerMedia,
    connectedAt, reconnecting, toggleMic, toggleCamera, startScreenShare, stopScreenShare, endCall,
  } = useCall();

  const elapsed = useElapsed(connectedAt);
  const searching = status === 'searching';
  const canShare = status === 'active' && !!navigator.mediaDevices?.getDisplayMedia;

  let statusText;
  if (searching) statusText = 'Searching…';
  else if (status === 'connecting') statusText = 'Connecting…';
  else if (reconnecting) statusText = 'Reconnecting…';
  else statusText = formatDuration(elapsed);

  const showRemoteVideo = status === 'active' && !!remoteStream && peerMedia.video;

  return (
    <div
      className="call-screen"
      role="dialog"
      aria-modal="true"
      aria-label={searching ? 'Finding someone to talk to' : `Call with ${peer?.name}`}
    >
      <div className="call-top">
        <div className="call-peer">
          <strong>{searching ? 'Finding someone…' : peer?.name}</strong>
          {status === 'active' && !peerMedia.audio && (
            <span className="call-muted" title="Muted">
              <MicOffIcon size={14} /> Muted
            </span>
          )}
        </div>
        <span className="call-status" role="status">{statusText}</span>
      </div>

      <div className="call-stage">
        {searching ? (
          <>
            {/* While waiting, show your own camera full-screen. */}
            <MediaView stream={previewStream} muted mirrored className="remote-video" />
            <div className="search-overlay">
              <div className="spinner" aria-hidden="true" />
              <h2>Looking for someone to talk to…</h2>
              <p>
                We'll connect you with a random person as soon as another user is ready. Keep this screen open.
              </p>
            </div>
          </>
        ) : (
          <>
            {/* Keep the remote element mounted so audio never drops when their camera toggles. */}
            <MediaView stream={remoteStream} className={`remote-video ${showRemoteVideo ? '' : 'is-hidden'}`} />

            {!showRemoteVideo && (
              <div className="call-center">
                <div className={`avatar-ring ${status === 'connecting' ? 'is-pulsing' : ''}`}>
                  <Avatar name={peer?.name} size={120} />
                </div>
                <h2>{peer?.name}</h2>
                <p>{status === 'active' && !peerMedia.video ? 'Camera is off' : statusText}</p>
              </div>
            )}

            {previewStream && (
              <div className="pip">
                <MediaView stream={previewStream} muted mirrored={!sharing} />
                {sharing && <span className="pip-badge">Sharing your screen</span>}
                {!sharing && !camOn && <span className="pip-off">Camera off</span>}
              </div>
            )}
          </>
        )}
      </div>

      <div className="call-controls">
        <ControlButton label={micOn ? 'Mute microphone' : 'Unmute microphone'} active={micOn} onClick={toggleMic}>
          {micOn ? <MicIcon size={22} /> : <MicOffIcon size={22} />}
        </ControlButton>

        <ControlButton
          label={camOn ? 'Turn camera off' : 'Turn camera on'}
          active={camOn}
          disabled={sharing}
          onClick={toggleCamera}
        >
          {camOn ? <VideoIcon size={22} /> : <VideoOffIcon size={22} />}
        </ControlButton>

        {canShare && (
          <ControlButton
            label={sharing ? 'Stop sharing screen' : 'Share your screen'}
            active={!sharing}
            onClick={sharing ? stopScreenShare : startScreenShare}
          >
            <ScreenIcon size={22} />
          </ControlButton>
        )}

        <ControlButton label={searching ? 'Cancel search' : 'End call'} danger onClick={endCall}>
          <HangUpIcon size={22} />
        </ControlButton>
      </div>
    </div>
  );
}
