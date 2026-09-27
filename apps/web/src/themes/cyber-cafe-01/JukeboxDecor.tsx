/**
 * Cyber Café jukebox decor: a translucent "broadband" signal orb peeking in from the display's
 * corner — chrome rim, aqua rings that breathe with the music (level), a lime link LED.
 * Behind the display content (the host layer is z-index 0, pointer-events none, aria-hidden).
 */
import type { CSSProperties } from 'react';
import type { JukeboxDecorContext } from '../types.ts';

export default function CafeJukeboxDecor({ playing, level, fx, reducedMotion }: JukeboxDecorContext) {
  const live = playing && fx !== 'off' && !reducedMotion;
  const l = live ? Math.max(0, Math.min(1, level)) : 0;
  return (
    <div className="cc-jbd" data-live={live ? 'true' : undefined} style={{ '--l': l.toFixed(3) } as CSSProperties}>
      <span className="cc-jbd__ring cc-jbd__ring--3" />
      <span className="cc-jbd__ring cc-jbd__ring--2" />
      <span className="cc-jbd__ring cc-jbd__ring--1" />
      <span className="cc-jbd__orb" />
      <span className="cc-jbd__led" data-on={playing ? 'true' : undefined} />
    </div>
  );
}
