/**
 * Mall Arcade '92 jukebox decor: the jukebox standing in its own corner — a lit arch over the
 * display and two glowing bubble tubes up its sides (original concept). Bubbles rise only while
 * music plays (fx high, no reduced motion, tab visible); the glow follows the music's level.
 */
import type { CSSProperties } from 'react';
import type { JukeboxDecorContext } from '../types.ts';
import { useDocVisible } from './art.ts';

const BUBBLES = [0, 1, 2, 3, 4, 5];

function Tube({ side }: { side: 'l' | 'r' }) {
  return (
    <span className={`ma-jb__tube ma-jb__tube--${side}`}>
      {BUBBLES.map((i) => (
        <i key={i} style={{ '--i': i } as CSSProperties} />
      ))}
    </span>
  );
}

export function MallJukeboxDecor({ fx, reducedMotion, playing, level }: JukeboxDecorContext) {
  const visible = useDocVisible();
  const animate = playing && fx !== 'off' && !reducedMotion && visible;
  const glow = fx === 'off' ? 0.5 : 0.55 + Math.min(1, Math.max(0, level)) * 0.45;
  return (
    <span
      className="ma-jb"
      data-animate={animate ? 'true' : undefined}
      data-playing={playing ? 'true' : undefined}
      style={{ '--ma-jb-glow': glow.toFixed(2) } as CSSProperties}
    >
      <span className="ma-jb__arch" />
      <Tube side="l" />
      <Tube side="r" />
    </span>
  );
}
