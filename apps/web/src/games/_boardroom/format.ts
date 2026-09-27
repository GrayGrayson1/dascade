/** DAS Boardroom kit — pure display helpers (unit tested). */
import type { BoardClockView } from '@dascade/shared/games/boardroom';

/** "1:02:03", "4:59", "0:09.8" (tenths under 10 s). */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 10_000) {
    const tenths = Math.floor(clamped / 100);
    return `0:0${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  const total = Math.floor(clamped / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Low-time threshold: 10% of the base time, clamped to 10–30 s. */
export function lowTimeMs(clock: Pick<BoardClockView, 'baseMs'>): number {
  return Math.min(30_000, Math.max(10_000, clock.baseMs * 0.1));
}
