/**
 * Music Video Booth decor: two cartoon speakers that bounce with the music's loudness and a spinning
 * star sticker on the cover art. Pure CSS; frozen under reduced motion / fx off.
 */
import type { CSSProperties } from 'react';
import type { JukeboxDecorContext } from '../types.ts';

export function SaturdayJukeboxDecor({ playing, level, reducedMotion, fx }: JukeboxDecorContext) {
  const live = playing && !reducedMotion && fx !== 'off';
  const lv = live ? Math.max(0, Math.min(1, level)) : 0;
  return (
    <div className="sm-booth" data-live={live ? 'true' : undefined} style={{ '--lv': lv.toFixed(3) } as CSSProperties}>
      <i className="sm-booth__spk sm-booth__spk--l">
        <b />
      </i>
      <i className="sm-booth__spk sm-booth__spk--r">
        <b />
      </i>
      <i className="sm-booth__star" />
    </div>
  );
}
