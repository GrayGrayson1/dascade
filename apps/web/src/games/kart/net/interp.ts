/**
 * Pure netcode helpers (no DOM, no network): the snapshot clock filter and the per-kart
 * interpolation buffer used for every kart we don't predict.
 *
 * Clock: each snapshot is stamped with the server tick. `arrival − tick·tickMs` is the local time
 * the tick "happened" plus one-way delay; its windowed minimum tracks the fastest path, and the
 * spread above it is jitter. Remote karts are drawn `delay` ms in the past, where `delay` adapts
 * to the snapshot interval and jitter (≈100 ms on a good link).
 */

export const CLOCK_WINDOW = 90;

export class SnapshotClock {
  private readonly samples: number[] = [];
  offset = 0;
  jitter = 0;
  delay = 100;
  interval = 50;
  private lastArrival = 0;
  ready = false;

  constructor(
    readonly tickMs: number,
    private readonly minDelay = 60,
    private readonly maxDelay = 320,
  ) {}

  reset(): void {
    this.samples.length = 0;
    this.ready = false;
    this.lastArrival = 0;
  }

  /** Feed one snapshot arrival. */
  observe(tick: number, arrivalMs: number): void {
    const sample = arrivalMs - tick * this.tickMs;
    this.samples.push(sample);
    if (this.samples.length > CLOCK_WINDOW) this.samples.shift();
    let min = Infinity;
    for (const s of this.samples) if (s < min) min = s;
    this.offset = min;
    this.jitter = Math.max(this.jitter * 0.97, sample - min);
    if (this.lastArrival) this.interval += (Math.min(250, arrivalMs - this.lastArrival) - this.interval) * 0.1;
    this.lastArrival = arrivalMs;
    const target = Math.max(this.minDelay, Math.min(this.maxDelay, this.interval * 1.5 + this.jitter + 10));
    this.delay = this.ready ? this.delay + (target - this.delay) * 0.08 : target;
    this.ready = true;
  }

  /** The (fractional) server tick to render remote karts at, at local time `now`. */
  renderTick(now: number): number {
    return (now - this.offset - this.delay) / this.tickMs;
  }

  /** Best estimate of the server's current tick (no interpolation delay). */
  liveTick(now: number): number {
    return (now - this.offset) / this.tickMs;
  }

  /** ms since the last snapshot. */
  sinceLast(now: number): number {
    return this.lastArrival ? now - this.lastArrival : Infinity;
  }
}

/** A kart pose as interpolated for rendering. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  /** Heading (radians). */
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface Timed<T> {
  tick: number;
  pose: Pose;
  data: T;
}

export function wrapPi(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  else if (r < -Math.PI) r += Math.PI * 2;
  return r;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapPi(b - a) * t;
}

/**
 * Cubic Hermite position interpolation using the snapshot velocities as tangents: smooth through
 * curves, no overshoot on straights. Height is linear (jumps are ballistic and short).
 */
export function hermite(a: Pose, b: Pose, t: number, dtSec: number, out: Pose): Pose {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  out.x = h00 * a.x + h10 * a.vx * dtSec + h01 * b.x + h11 * b.vx * dtSec;
  out.y = h00 * a.y + h10 * a.vy * dtSec + h01 * b.y + h11 * b.vy * dtSec;
  out.z = a.z + (b.z - a.z) * t;
  out.yaw = lerpAngle(a.yaw, b.yaw, t);
  out.vx = a.vx + (b.vx - a.vx) * t;
  out.vy = a.vy + (b.vy - a.vy) * t;
  out.vz = a.vz + (b.vz - a.vz) * t;
  return out;
}

export const MAX_EXTRAPOLATE_TICKS = 8;
/** A remote kart jumping further than this between snapshots (respawn, warp) is not blended. */
export const TELEPORT_DIST = 40;

/**
 * Per-kart sample ring. `sample()` returns the pose at a fractional tick: interpolated between
 * neighbours, extrapolated for at most 8 ticks when packets are late, then held.
 * `data` (flags, item…) comes from the nearer sample (discrete values are never blended).
 */
export class InterpBuffer<T> {
  readonly items: Array<Timed<T>> = [];
  extrapolated = 0;

  constructor(
    private readonly tickSec: number,
    private readonly cap = 40,
  ) {}

  push(tick: number, pose: Pose, data: T): void {
    const last = this.items[this.items.length - 1];
    if (last && tick <= last.tick) return;
    this.items.push({ tick, pose, data });
    if (this.items.length > this.cap) this.items.splice(0, this.items.length - this.cap);
  }

  get latest(): Timed<T> | undefined {
    return this.items[this.items.length - 1];
  }

  clear(): void {
    this.items.length = 0;
  }

  /** Writes the pose at `rt` into `out` and returns the governing sample's data (or null if empty). */
  sample(rt: number, out: Pose): T | null {
    const buf = this.items;
    if (!buf.length) return null;
    const last = buf[buf.length - 1]!;
    if (rt >= last.tick) {
      const aheadTicks = Math.min(rt - last.tick, MAX_EXTRAPOLATE_TICKS);
      if (rt - last.tick > 0.5) this.extrapolated++;
      const s = last.pose;
      const ahead = aheadTicks * this.tickSec;
      out.x = s.x + s.vx * ahead;
      out.y = s.y + s.vy * ahead;
      out.z = s.z;
      out.yaw = s.yaw;
      out.vx = s.vx;
      out.vy = s.vy;
      out.vz = s.vz;
      return last.data;
    }
    // One sample only (just after a reset) and the render time is before it: hold that sample.
    let i = Math.max(0, buf.length - 2);
    while (i > 0 && buf[i]!.tick > rt) i--;
    const a = buf[i]!;
    const b = buf[i + 1] ?? a;
    if (rt <= a.tick || b === a) {
      Object.assign(out, a.pose);
      return a.data;
    }
    const span = b.tick - a.tick;
    const t = (rt - a.tick) / span;
    const dx = b.pose.x - a.pose.x;
    const dy = b.pose.y - a.pose.y;
    if (dx * dx + dy * dy > TELEPORT_DIST * TELEPORT_DIST) {
      // Respawn / warp: don't sweep through the scenery.
      Object.assign(out, t < 0.5 ? a.pose : b.pose);
      return t < 0.5 ? a.data : b.data;
    }
    hermite(a.pose, b.pose, t, span * this.tickSec, out);
    return t < 0.5 ? a.data : b.data;
  }
}

/**
 * Visual error offset for the predicted kart: when a reconciliation moves the kart, the
 * difference is added here and decays over ~150 ms, so corrections never snap harshly.
 * Large errors (respawn, teleport) snap immediately.
 */
export class ErrorSmoother {
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;

  constructor(
    private readonly snapDist = 12,
    private readonly rate = 12,
  ) {}

  add(dx: number, dy: number, dz: number, dyaw: number): boolean {
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!Number.isFinite(d) || !Number.isFinite(dyaw) || d > this.snapDist || Math.abs(dyaw) > 1.4) {
      this.reset();
      return false;
    }
    this.x += dx;
    this.y += dy;
    this.z += dz;
    this.yaw = wrapPi(this.yaw + dyaw);
    return true;
  }

  /** A deliberate visual heading glide (e.g. a wall redirect), up to ~100°. */
  addYaw(dyaw: number): void {
    if (!Number.isFinite(dyaw)) return;
    this.yaw = Math.max(-1.8, Math.min(1.8, wrapPi(this.yaw + dyaw)));
  }

  decay(frameMs: number): void {
    const k = Math.exp(-(Math.max(0, frameMs) / 1000) * this.rate);
    this.x *= k;
    this.y *= k;
    this.z *= k;
    this.yaw *= k;
    if (Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z) < 1e-4) this.x = this.y = this.z = 0;
    if (Math.abs(this.yaw) < 1e-5) this.yaw = 0;
  }

  reset(): void {
    this.x = this.y = this.z = this.yaw = 0;
  }
}
