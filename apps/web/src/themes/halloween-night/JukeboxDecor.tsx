/**
 * Halloween Night jukebox decor (inside the expanded player's now-playing screen): cobwebs in the top
 * corners, two candles in the bottom gutters whose flames grow with the music's level and flicker while
 * it plays (fx on, no reduced motion, tab visible), and a tiny ghost peeking in at the edge. Everything
 * hugs the edges so it never sits under text.
 */
import type { CSSProperties } from 'react';
import type { JukeboxDecorContext } from '../types.ts';
import { useDocVisible } from './art.ts';

export function HalloweenJukeboxDecor({ fx, reducedMotion, playing, level }: JukeboxDecorContext) {
  const visible = useDocVisible();
  const animate = playing && fx !== 'off' && !reducedMotion && visible;
  const glow = fx === 'off' ? 0.5 : 0.55 + Math.min(1, Math.max(0, level)) * 0.45;
  return (
    <span
      className="hn-jb"
      data-animate={animate ? 'true' : undefined}
      data-playing={playing ? 'true' : undefined}
      style={{ '--hn-jb-glow': glow.toFixed(2) } as CSSProperties}
    >
      <i className="hn-jb__web hn-jb__web--l" />
      <i className="hn-jb__web hn-jb__web--r" />
      <i className="hn-jb__candle hn-jb__candle--l">
        <b className="hn-jb__flame" />
      </i>
      <i className="hn-jb__candle hn-jb__candle--r">
        <b className="hn-jb__flame" />
      </i>
      <i className="hn-jb__ghost" />
    </span>
  );
}
