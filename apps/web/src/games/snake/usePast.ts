import { useEffect, useState } from 'react';
import { serverNow } from '../../net/session.ts';

/**
 * True once the server clock has passed `at` (+ `extraMs`); schedules exactly one re-render
 * at that moment (overlays tied to a server start time clear without waiting for a patch).
 */
export function usePast(at: number, extraMs = 0): boolean {
  const [, bump] = useState(0);
  const past = at <= 0 || serverNow() >= at + extraMs;
  useEffect(() => {
    if (past) return;
    const id = window.setTimeout(() => bump((n) => n + 1), Math.max(16, at + extraMs - serverNow() + 16));
    return () => window.clearTimeout(id);
  }, [at, extraMs, past]);
  return past;
}
