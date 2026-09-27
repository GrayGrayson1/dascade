/** Shot-path sampling shared by the presenter (pure; unit tested). */
import { SHOT_SAMPLE_MS } from '@dascade/shared/games/tanks';

/** Position + heading along a sampled path at local time `t` (ms since launch). */
export function pathAt(pts: number[], t: number, total: number): { x: number; y: number; dx: number; dy: number } {
  const n = pts.length / 2;
  if (n <= 1) return { x: pts[0] ?? 0, y: pts[1] ?? 0, dx: 1, dy: 0 };
  const regular = n - 1;
  let k = Math.floor(t / SHOT_SAMPLE_MS);
  let seg0: number;
  let seg1: number;
  if (k >= regular - 1) {
    k = regular - 1;
    seg0 = k * SHOT_SAMPLE_MS;
    seg1 = Math.max(seg0 + 0.001, total);
  } else {
    seg0 = k * SHOT_SAMPLE_MS;
    seg1 = seg0 + SHOT_SAMPLE_MS;
  }
  const f = Math.max(0, Math.min(1, (t - seg0) / (seg1 - seg0)));
  const x0 = pts[k * 2]!;
  const y0 = pts[k * 2 + 1]!;
  const x1 = pts[k * 2 + 2]!;
  const y1 = pts[k * 2 + 3]!;
  return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, dx: x1 - x0 || 0.001, dy: y1 - y0 };
}
