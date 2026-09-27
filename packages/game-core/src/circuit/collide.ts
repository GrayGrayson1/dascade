/**
 * Car–car collisions: each car is a capsule (a segment along its heading with a
 * radius of half its width). Equal masses, positional separation split evenly, and
 * an impulse with restitution + a touch of spin for off-centre hits.
 */
import { closestSegSeg, dcos, dhypot, dsin, f32 } from './math.ts';
import type { CarSpec, CarState } from './car.ts';

export const COLLISION = {
  restitution: 0.42,
  /** Moment of inertia multiplier (higher = less spin from hits). */
  inertiaScale: 2.2,
  /** Tangential friction coefficient between bodies. */
  friction: 0.12,
} as const;

export interface CollisionResult {
  a: CarState;
  b: CarState;
  /** Closing speed along the contact normal (px/s). */
  impact: number;
  /** Contact point (for sparks). */
  x: number;
  y: number;
}

function capsule(state: CarState, spec: CarSpec): { px: number; py: number; qx: number; qy: number; r: number } {
  const r = spec.width / 2;
  const half = Math.max(0, spec.length / 2 - r);
  const fx = dcos(state.heading);
  const fy = dsin(state.heading);
  return { px: state.x - fx * half, py: state.y - fy * half, qx: state.x + fx * half, qy: state.y + fy * half, r };
}

/** Resolve a collision between two cars. Returns null when they don't touch. Pure. */
export function collideCars(a: CarState, sa: CarSpec, b: CarState, sb: CarSpec): CollisionResult | null {
  const reach = sa.length / 2 + sb.length / 2;
  const dx0 = b.x - a.x;
  const dy0 = b.y - a.y;
  if (dx0 * dx0 + dy0 * dy0 > reach * reach) return null;

  const ca = capsule(a, sa);
  const cb = capsule(b, sb);
  const [s, t] = closestSegSeg(ca.px, ca.py, ca.qx, ca.qy, cb.px, cb.py, cb.qx, cb.qy);
  const pax = ca.px + (ca.qx - ca.px) * s;
  const pay = ca.py + (ca.qy - ca.py) * s;
  const pbx = cb.px + (cb.qx - cb.px) * t;
  const pby = cb.py + (cb.qy - cb.py) * t;
  let nx = pbx - pax;
  let ny = pby - pay;
  let dist = dhypot(nx, ny);
  const radii = ca.r + cb.r;
  if (dist >= radii) return null;
  if (dist < 1e-6) {
    // Perfectly overlapping axes: push apart along the line between centres (or sideways).
    nx = dx0;
    ny = dy0;
    dist = dhypot(nx, ny);
    if (dist < 1e-6) {
      nx = -dsin(a.heading);
      ny = dcos(a.heading);
      dist = 1;
    }
    nx /= dist;
    ny /= dist;
    dist = 0;
  } else {
    nx /= dist;
    ny /= dist;
  }
  const pen = radii - dist;
  const cx = (pax + pbx) / 2;
  const cy = (pay + pby) / 2;

  // Positional correction (equal mass → split evenly, slightly over-corrected to avoid re-contact).
  const push = pen * 0.5 + 0.05;
  let ax = a.x - nx * push;
  let ay = a.y - ny * push;
  let bx = b.x + nx * push;
  let by = b.y + ny * push;

  // Velocities at the contact point including rotation (ω × r).
  const rax = cx - a.x;
  const ray = cy - a.y;
  const rbx = cx - b.x;
  const rby = cy - b.y;
  const vax = a.vx - a.angVel * ray;
  const vay = a.vy + a.angVel * rax;
  const vbx = b.vx - b.angVel * rby;
  const vby = b.vy + b.angVel * rbx;
  const rvx = vbx - vax;
  const rvy = vby - vay;
  const vn = rvx * nx + rvy * ny;

  let avx = a.vx;
  let avy = a.vy;
  let bvx = b.vx;
  let bvy = b.vy;
  let aw = a.angVel;
  let bw = b.angVel;
  let impact = 0;
  if (vn < 0) {
    impact = -vn;
    const ia = ((sa.length * sa.length + sa.width * sa.width) / 12) * COLLISION.inertiaScale;
    const ib = ((sb.length * sb.length + sb.width * sb.width) / 12) * COLLISION.inertiaScale;
    const raN = rax * ny - ray * nx;
    const rbN = rbx * ny - rby * nx;
    const denom = 2 + (raN * raN) / ia + (rbN * rbN) / ib;
    const j = (-(1 + COLLISION.restitution) * vn) / denom;
    avx -= nx * j;
    avy -= ny * j;
    bvx += nx * j;
    bvy += ny * j;
    aw -= (raN * j) / ia;
    bw += (rbN * j) / ib;

    // Friction along the tangent.
    const tx = -ny;
    const ty = nx;
    const vt = rvx * tx + rvy * ty;
    const jt = Math.max(-j * COLLISION.friction, Math.min(j * COLLISION.friction, -vt / 2));
    avx -= tx * jt;
    avy -= ty * jt;
    bvx += tx * jt;
    bvy += ty * jt;
  }
  ax = f32(ax);
  ay = f32(ay);
  bx = f32(bx);
  by = f32(by);
  return {
    a: { ...a, x: ax, y: ay, vx: f32(avx), vy: f32(avy), angVel: f32(aw) },
    b: { ...b, x: bx, y: by, vx: f32(bvx), vy: f32(bvy), angVel: f32(bw) },
    impact,
    x: cx,
    y: cy,
  };
}
