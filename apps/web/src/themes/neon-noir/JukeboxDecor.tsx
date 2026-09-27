/**
 * Neon Noir jukebox decor: a few rain beads trickling down the console's glass screen, catching the
 * spectrum's light as the music gets louder. CSS-only motion (compositor transforms); static beads
 * under reduced motion / fx off. Sits inside [data-part="decor"] (pointer-events none, aria-hidden).
 */
import type { CSSProperties } from 'react';
import type { JukeboxDecorContext } from '../types.ts';

const BEADS = [
  { x: 12, d: 9.5, delay: -2, s: 3 },
  { x: 34, d: 12, delay: -7, s: 2 },
  { x: 58, d: 10.5, delay: -4, s: 3.5 },
  { x: 77, d: 13, delay: -9, s: 2.5 },
  { x: 91, d: 11, delay: -1, s: 2 },
];

export default function NoirJukeboxDecor({ playing, level, fx, reducedMotion }: JukeboxDecorContext) {
  const still = reducedMotion || fx === 'off';
  return (
    <div
      className="nn-jb-decor"
      data-still={still || undefined}
      style={{ '--nn-level': (playing ? 0.35 + level * 0.65 : 0.25).toFixed(2) } as CSSProperties}
    >
      {BEADS.map((b, i) => (
        <i
          key={i}
          style={{ '--x': `${b.x}%`, '--d': `${b.d}s`, '--delay': `${b.delay}s`, '--s': `${b.s}px` } as CSSProperties}
        />
      ))}
    </div>
  );
}
