/**
 * Orbital Entertainment Console: a holographic projector. A chrome emitter at the bottom of the
 * display projects a translucent cone with a slowly turning "holo-disc" whose glow follows the
 * music's loudness. Pure CSS transforms; frozen under reduced motion / fx off.
 */
import type { CSSProperties } from 'react';
import type { JukeboxDecorContext } from '../types.ts';

export function SpaceJukeboxDecor({ playing, level, reducedMotion, fx }: JukeboxDecorContext) {
  const live = playing && !reducedMotion && fx !== 'off';
  const lv = Math.max(0, Math.min(1, level));
  return (
    <div className="sc-holo" data-live={live ? 'true' : undefined} style={{ '--lv': lv.toFixed(3) } as CSSProperties}>
      <i className="sc-holo__cone" />
      <i className="sc-holo__disc" />
      <i className="sc-holo__disc sc-holo__disc--2" />
      <i className="sc-holo__emitter" />
      <span className="sc-holo__tag">HOLO-LIB v8.8</span>
    </div>
  );
}
