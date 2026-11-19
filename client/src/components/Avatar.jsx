import { avatarHue, initials } from '../utils';

export default function Avatar({ name, size = 44, online }) {
  const hue = avatarHue(name);
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `hsl(${hue} 45% 28%)`,
        color: `hsl(${hue} 80% 88%)`,
      }}
      aria-hidden="true"
    >
      {initials(name)}
      {online !== undefined && <span className={`presence-dot ${online ? 'is-online' : ''}`} />}
    </span>
  );
}
