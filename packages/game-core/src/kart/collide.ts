/**
 * Kart–kart bumps: circles in the ground plane, weight-scaled impulses (heavier karts shove
 * lighter ones), a minimum separation speed so a bump always reads as a bump, and positional
 * separation split by mass. Mutates both states (then re-quantizes them).
 */
import { f32, qvel } from './math.ts';
import type { KartState } from './kart.ts';
import type { KartSpec } from './spec.ts';

export const BUMP = {
  restitution: 0.5,
  /** Minimum separating speed after a bump (u/s). */
  minSeparation: 3.2,
  /** Karts must be this close in height to touch. */
  maxDz: 1.6,
} as const;

export interface BumpResult {
  /** Closing speed along the contact normal (u/s). */
  impact: number;
  x: number;
  y: number;
  z: number;
}

export function collideKarts(a: KartState, sa: KartSpec, b: KartState, sb: KartSpec): BumpResult | null {
  const r = sa.radius + sb.radius;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r || Math.abs(a.z - b.z) > BUMP.maxDz) return null;
  let dist = Math.sqrt(d2);
  let nx: number;
  let ny: number;
  if (dist < 1e-6) {
    nx = 1;
    ny = 0;
    dist = 0;
  } else {
    nx = dx / dist;
    ny = dy / dist;
  }
  const ma = sa.mass;
  const mb = sb.mass;
  const inv = 1 / ma + 1 / mb;
  const pen = r - dist + 0.02;
  a.x = f32(a.x - nx * pen * (1 / ma / inv));
  a.y = f32(a.y - ny * pen * (1 / ma / inv));
  b.x = f32(b.x + nx * pen * (1 / mb / inv));
  b.y = f32(b.y + ny * pen * (1 / mb / inv));
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  let impact = 0;
  if (vn < BUMP.minSeparation) {
    impact = Math.max(0, -vn);
    const target = Math.max(BUMP.minSeparation, -vn * BUMP.restitution);
    const j = (target - vn) / inv;
    a.vx = qvel(a.vx - (nx * j) / ma);
    a.vy = qvel(a.vy - (ny * j) / ma);
    b.vx = qvel(b.vx + (nx * j) / mb);
    b.vy = qvel(b.vy + (ny * j) / mb);
  }
  return { impact, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}
