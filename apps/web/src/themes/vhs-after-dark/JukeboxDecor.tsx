/**
 * VHS After Dark jukebox decor: the display becomes the mixtape itself — cassette-shell corners with
 * screws, the label's two colour stripes along the top, the head opening along the bottom with two
 * small capstans that turn while music plays (fx on, no reduced motion, tab visible), and a PLAY lamp
 * that follows the music's level. Everything hugs the edges so it never sits under text; the reels
 * themselves are drawn by the visualizer ('reels').
 */
import type { CSSProperties } from 'react';
import type { JukeboxDecorContext } from '../types.ts';
import { useDocVisible } from './art.ts';

export function VhsJukeboxDecor({ fx, reducedMotion, playing, level }: JukeboxDecorContext) {
  const visible = useDocVisible();
  const animate = playing && fx !== 'off' && !reducedMotion && visible;
  return (
    <span
      className="vh-jb"
      data-animate={animate ? 'true' : undefined}
      data-playing={playing ? 'true' : undefined}
      style={{ '--vh-jb-level': Math.min(1, Math.max(0, level)).toFixed(2) } as CSSProperties}
    >
      <span className="vh-jb__stripes" />
      <i className="vh-jb__screw vh-jb__screw--tl" />
      <i className="vh-jb__screw vh-jb__screw--tr" />
      <i className="vh-jb__screw vh-jb__screw--bl" />
      <i className="vh-jb__screw vh-jb__screw--br" />
      <span className="vh-jb__head">
        <i className="vh-jb__capstan" />
        <i className="vh-jb__capstan" />
      </span>
      <span className="vh-jb__lamp" />
    </span>
  );
}
