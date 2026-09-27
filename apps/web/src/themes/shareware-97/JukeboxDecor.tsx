/**
 * The DAS-CD Player's disc tray: an iridescent CD (conic gradients, original art) in a sunken tray
 * at the top-right of the LCD, with a tiny red activity LED. The disc spins only while playing,
 * with motion allowed and the tab visible; loudness nudges the LED glow.
 */
import type { CSSProperties } from 'react';
import type { JukeboxDecorContext } from '../types.ts';
import { usePageVisible } from './usePageVisible.ts';

export function JukeboxDecor({ playing, reducedMotion, fx, level }: JukeboxDecorContext) {
  const visible = usePageVisible();
  const spin = playing && visible && !reducedMotion && fx !== 'off';
  return (
    <div
      className="sw-cd"
      data-spin={spin ? 'on' : 'off'}
      data-playing={playing ? 'true' : 'false'}
      style={{ '--sw-level': Math.max(0, Math.min(1, level)).toFixed(2) } as CSSProperties}
    >
      <span className="sw-cd__tray">
        <i className="sw-cd__disc">
          <i className="sw-cd__label" />
        </i>
      </span>
      <i className="sw-cd__led" />
      <span className="sw-cd__tag">CD</span>
    </div>
  );
}
