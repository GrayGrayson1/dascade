/**
 * Semantic validation of hole definitions (on top of the Zod shape check): the tee, cup and
 * portal exits must sit on clear turf, polygons must be simple and non-degenerate, and nothing
 * may be placed inside a wall or a moving obstacle's sweep.
 */
import { HoleDefSchema, type HoleDef } from './types.ts';
import { PHYS, compileHole, inMoverSweep, surfaceAt } from './physics.ts';
import { ringArea, segDist2 } from './math.ts';

function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function isSimple(pts: ReadonlyArray<readonly [number, number]>): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = pts[j]!;
      const d = pts[(j + 1) % n]!;
      if (segmentsCross(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1])) return false;
    }
  }
  return true;
}

/** Clearance (distance from a point to the nearest collider surface), negative when inside. */
export function clearance(def: HoleDef, x: number, y: number): number {
  const h = compileHole(def);
  let best = Infinity;
  for (const s of h.segs) best = Math.min(best, Math.sqrt(segDist2(x, y, s.ax, s.ay, s.bx, s.by)) - (s.r - PHYS.ballR));
  for (const c of h.circs) best = Math.min(best, Math.sqrt((x - c.x) * (x - c.x) + (y - c.y) * (y - c.y)) - (c.r - PHYS.ballR));
  return best;
}

/** Returns a list of human-readable problems (empty = valid). */
export function validateHole(def: HoleDef): string[] {
  const issues: string[] = [];
  const shape = HoleDefSchema.safeParse(def);
  if (!shape.success) {
    for (const i of shape.error.issues) issues.push(`${i.path.join('.')}: ${i.message}`);
    return issues;
  }
  const h = compileHole(def);
  const polys = [...def.turf, ...(def.water ?? []), ...(def.sand ?? []), ...(def.slopes ?? []).map((s) => s.poly)];
  for (const p of polys) {
    const ring = p.flat();
    if (Math.abs(ringArea(ring)) < 100) issues.push('degenerate polygon');
    if (!isSimple(p)) issues.push(`self-intersecting polygon starting at ${p[0]!.join(',')}`);
  }
  const R = PHYS.ballR;
  const needClear = (label: string, x: number, y: number, min: number) => {
    const s = surfaceAt(h, x, y);
    if (s !== 'turf') issues.push(`${label} is on ${s}`);
    const c = clearance(def, x, y);
    if (c < min) issues.push(`${label} is only ${c.toFixed(1)} from a collider (needs ${min})`);
  };
  needClear('tee', def.tee[0], def.tee[1], R + 4);
  needClear('cup', def.cup[0], def.cup[1], PHYS.cupR + R);
  if (inMoverSweep(h, def.tee[0], def.tee[1])) issues.push('tee is inside a moving obstacle sweep');
  if (inMoverSweep(h, def.cup[0], def.cup[1])) issues.push('cup is inside a moving obstacle sweep');
  (def.portals ?? []).forEach((p, i) => {
    needClear(`portal ${i} exit`, p.to[0], p.to[1], R + 2);
    const s = surfaceAt(h, p.from[0], p.from[1]);
    if (s !== 'turf') issues.push(`portal ${i} entry is on ${s}`);
    const l = Math.sqrt(p.exit[0] * p.exit[0] + p.exit[1] * p.exit[1]);
    if (Math.abs(l - 1) > 1e-6) issues.push(`portal ${i} exit direction is not a unit vector`);
    const dc = Math.sqrt((p.from[0] - def.cup[0]) ** 2 + (p.from[1] - def.cup[1]) ** 2);
    if (dc < PHYS.cupR + PHYS.portalR + R) issues.push(`portal ${i} entry overlaps the cup`);
  });
  for (const m of def.movers ?? []) {
    if (m.kind === 'sweeper') {
      const tx = m.b[0] - m.a[0];
      const ty = m.b[1] - m.a[1];
      const l = Math.sqrt(tx * tx + ty * ty);
      if (l < 10) issues.push('sweeper travel is too short');
      const al = Math.sqrt(m.axis[0] * m.axis[0] + m.axis[1] * m.axis[1]);
      if (Math.abs(al - 1) > 1e-6) issues.push('sweeper axis is not a unit vector');
    }
  }
  for (const s of def.slopes ?? []) {
    const mag = Math.sqrt(s.accel[0] * s.accel[0] + s.accel[1] * s.accel[1]);
    if (mag === 0) issues.push('slope without acceleration');
  }
  return issues;
}
