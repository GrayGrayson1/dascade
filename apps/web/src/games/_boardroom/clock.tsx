/**
 * DAS Boardroom kit — clock display. The server publishes each side's remaining time as of
 * `turnStartedAt`; the running clock is extrapolated locally against the synced server clock.
 * The ticking text is written straight to the DOM from a rAF loop (no React re-render per frame).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clockRemaining, type BoardClockView, type BoardSide } from '@dascade/shared/games/boardroom';
import { PixelIcon, cx } from '@dascade/ui';
import { serverNow } from '../../net/hooks.ts';
import { formatClock, lowTimeMs } from './format.ts';

export { formatClock, lowTimeMs } from './format.ts';

/** Remaining ms for a side, re-rendering ~5×/s while that clock runs (for sounds/logic, not display). */
export function useClockMs(clock: BoardClockView | undefined, side: BoardSide): number {
  const [ms, setMs] = useState(() => (clock ? clockRemaining(clock, side, serverNow()) : 0));
  const running = clock?.running === side && clock.enabled;
  useEffect(() => {
    if (!clock) return;
    const tick = () => setMs(clockRemaining(clock, side, serverNow()));
    tick();
    if (!running) return;
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [clock, side, running]);
  return ms;
}

export interface BoardClockProps {
  clock: BoardClockView;
  side: BoardSide;
  /** Accessible owner name ("White", "Ada"). */
  owner: string;
  className?: string;
  size?: 'md' | 'lg';
}

/** Chess-clock readout: tabular numerals, running glow, low-time warning, flag. */
export function BoardClock({ clock, side, owner, className, size = 'md' }: BoardClockProps) {
  const textRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const running = clock.enabled && clock.running === side;
  const flagged = clock.flagged === side;
  const low = lowTimeMs(clock);

  // The text node is owned by this effect (React renders the span empty), so rAF writes never fight React.
  useLayoutEffect(() => {
    const paint = () => {
      const ms = clockRemaining(clock, side, serverNow());
      if (textRef.current) textRef.current.textContent = formatClock(ms);
      rootRef.current?.toggleAttribute('data-low', clock.enabled && ms <= low);
    };
    paint();
    if (!running) return;
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      // ~20 fps is plenty for tenths.
      if (t - last > 45) {
        last = t;
        paint();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [clock, side, running, low]);

  if (!clock.enabled) {
    return (
      <div className={cx('br-clock br-clock--untimed', size === 'lg' && 'br-clock--lg', className)} aria-label={`${owner}: untimed`}>
        <PixelIcon name="clock" />
        <span className="br-clock__time">∞</span>
      </div>
    );
  }
  return (
    <div
      ref={rootRef}
      className={cx('br-clock', size === 'lg' && 'br-clock--lg', className)}
      data-running={running || undefined}
      data-flagged={flagged || undefined}
      role="timer"
      aria-label={`${owner} clock`}
    >
      {flagged ? <PixelIcon name="flag" className="br-clock__flag" /> : null}
      <span ref={textRef} className="br-clock__time" />
    </div>
  );
}
