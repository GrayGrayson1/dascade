/**
 * Basement LAN jukebox decor: somebody's burned CD-R ("MIX 02" in marker) peeking out of the
 * shared computer's display. Spins while music plays (CSS only; still under reduced motion / fx off).
 */
import type { JukeboxDecorContext } from '../types.ts';

export default function LanJukeboxDecor({ playing, fx, reducedMotion }: JukeboxDecorContext) {
  const spin = playing && fx !== 'off' && !reducedMotion;
  return (
    <div className="lp-jbd" data-spin={spin ? 'true' : undefined}>
      <svg className="lp-jbd__cd" viewBox="0 0 120 120" aria-hidden focusable="false">
        <defs>
          <radialGradient id="lp-cd-sheen" cx="0.35" cy="0.3" r="0.8">
            <stop offset="0" stopColor="#f4f1e6" />
            <stop offset="0.45" stopColor="#b9c3c9" />
            <stop offset="0.7" stopColor="#d6c7e6" />
            <stop offset="1" stopColor="#9fb0b8" />
          </radialGradient>
        </defs>
        <circle cx="60" cy="60" r="58" fill="url(#lp-cd-sheen)" />
        <circle cx="60" cy="60" r="56" fill="none" stroke="#6d6a60" strokeWidth="1" opacity="0.6" />
        <path d="M60 4 A56 56 0 0 1 116 60 L92 60 A32 32 0 0 0 60 28z" fill="#f7f3e6" opacity="0.92" />
        <text x="92" y="36" textAnchor="middle" fontFamily="'LAN VT323', monospace" fontSize="15" fill="#1d2a6b" transform="rotate(40 92 36)">
          MIX 02
        </text>
        <circle cx="60" cy="60" r="16" fill="#d8d4c8" />
        <circle cx="60" cy="60" r="7" fill="#15130f" />
      </svg>
    </div>
  );
}
