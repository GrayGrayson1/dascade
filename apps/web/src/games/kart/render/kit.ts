/**
 * Shared detail kits for MeshBuilder models (containers, crane loads) so every container in the
 * world gets the same treatment: ribbed sides, door end with locking bars, roof ribs, corner castings.
 */
import type { MeshBuilder } from '../art/builder.ts';
import { shadeInt } from '../art/palette.ts';

/** A shipping container centred at (x, y, z), long axis along X (L × H × W). Doors on the +X end. */
export function container(b: MeshBuilder, x: number, y: number, z: number, color: number, L = 6, H = 2.5, W = 2.4, hazard = false): void {
  const rib = shadeInt(color, -0.22);
  const end = shadeInt(color, -0.18);
  b.box(x, y, z, L, H, W, color);
  const n = Math.max(3, Math.round(L / 0.5));
  for (let k = 0; k <= n; k++) {
    const rx = x - L / 2 + 0.2 + (k * (L - 0.4)) / n;
    b.box(rx, y, z + W / 2 + 0.02, 0.1, H * 0.9, 0.04, rib).box(rx, y, z - W / 2 - 0.02, 0.1, H * 0.9, 0.04, rib);
  }
  for (let k = 0; k <= Math.round(L / 0.6); k++) b.box(x - L / 2 + 0.3 + k * 0.6, y + H / 2 + 0.02, z, 0.12, 0.04, W * 0.95, rib);
  // door end: two leaves, locking bars, handles
  b.box(x + L / 2 + 0.02, y, z, 0.04, H * 0.95, W * 0.95, end);
  b.box(x + L / 2 + 0.04, y, z, 0.02, H * 0.95, 0.04, shadeInt(color, -0.45));
  for (const bz of [-0.36, -0.12, 0.12, 0.36]) {
    b.box(x + L / 2 + 0.05, y, z + bz * W, 0.03, H * 0.92, 0.05, 0xc0c7d2);
    b.box(x + L / 2 + 0.07, y - H * 0.08, z + bz * W, 0.04, 0.05, 0.14, 0xc0c7d2);
  }
  // blank end: vertical corrugation
  for (let k = -3; k <= 3; k++) b.box(x - L / 2 - 0.02, y, z + (k * W) / 8, 0.04, H * 0.85, 0.08, rib);
  // corner castings
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) b.box(x + sx * (L / 2 - 0.06), y + sy * (H / 2 - 0.06), z + sz * (W / 2 - 0.06), 0.16, 0.16, 0.16, 0x1c1f2b);
  if (hazard) {
    const cells = Math.round(L / 0.5);
    for (let k = 0; k < cells; k++) {
      const col = k % 2 ? 0x1b1b22 : 0xffd23f;
      const cx = x - L / 2 + 0.25 + k * 0.5;
      b.box(cx, y - H / 2 + 0.2, z + W / 2 + 0.04, 0.5, 0.3, 0.03, col).box(cx, y - H / 2 + 0.2, z - W / 2 - 0.04, 0.5, 0.3, 0.03, col);
    }
  }
}

/** Crane spreader + four chains + hook block above a load whose top is at `top` (centre x, z). */
export function spreader(b: MeshBuilder, x: number, top: number, z: number, L: number, W: number): number {
  b.box(x, top + 0.12, z, L + 0.1, 0.16, 0.34, 0xffd23f);
  b.box(x - L / 2 + 0.15, top + 0.12, z, 0.3, 0.16, W, 0xffd23f).box(x + L / 2 - 0.15, top + 0.12, z, 0.3, 0.16, W, 0xffd23f);
  const hy = top + Math.max(0.9, L * 0.28);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.strut(x + sx * (L / 2 - 0.15), top + 0.2, z + sz * (W / 2 - 0.1), x, hy - 0.2, z, 0.04, 0x2a2d3a);
  b.box(x, hy, z, 0.4, 0.44, 0.34, 0xffd23f);
  b.box(x, hy, z + 0.18, 0.41, 0.2, 0.02, 0x1b1b22);
  b.torus(x, hy - 0.3, z, 0.15, 0.04, 0xc0c7d2, 4, 12, 0, 'z');
  b.ball(x + 0.17, hy + 0.28, z, 0.08, 0xff8a1f, 1, 1);
  return hy + 0.22;
}
