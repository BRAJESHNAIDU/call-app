import { useEffect, useRef } from 'react';

// Renders a MediaStream in a <video> (or <audio>) element.
export default function MediaView({ stream, audioOnly = false, muted = false, mirrored = false, className = '' }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream ?? null;
    if (stream) el.play?.().catch(() => {});
  }, [stream]);

  if (audioOnly) return <audio ref={ref} autoPlay />;

  return (
    <video
      ref={ref}
      className={`${className} ${mirrored ? 'is-mirrored' : ''}`}
      autoPlay
      playsInline
      muted={muted}
    />
  );
}
