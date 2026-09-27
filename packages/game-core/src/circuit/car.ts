/**
 * Arcade car model. `stepCar` is pure and deterministic: the same state, input,
 * spec and track always produce the same next state. It runs on the server (the
 * authoritative simulation) and on the client (prediction + replay).
 *
 * Model summary
 *  - Engine thrust acts along the heading; rolling/coast drag acts along the velocity.
 *  - Steering sets a target yaw rate (speed-sensitive, slight understeer at speed).
 *  - Grip rotates the velocity toward the heading, limited by a lateral-acceleration
 *    budget (tyre limit / speed). Exceeding it (overspeed in a corner, or holding
 *    drift) makes the car slide; sliding scrubs speed.
 *  - Holding drift trades a little grip for a lot of rotation and less scrub, and
 *    charges the boost meter. Boost raises top speed and thrust while it drains.
 *  - Surfaces come from the lateral offset to the centerline: road, rumble strip and
 *    run-off (slower, less grip). Soft barriers bound the corridor.
 *  - The resulting state is quantized (float32 / fixed point) so it is exactly the
 *    value that travels in snapshots, which keeps client replay bit-identical.
 */
import type { CarInput, ChassisId } from '@dascade/shared/games/circuit';
import { clamp, datan2, dcos, dhypot, dsin, f32, wrapAngle } from './math.ts';
import { projectOnTrack, type Track } from './track.ts';

export interface CarSpec {
  id: ChassisId;
  label: string;
  blurb: string;
  maxSpeed: number;
  accel: number;
  brake: number;
  reverseMax: number;
  turnRate: number;
  grip: number;
  length: number;
  width: number;
  /** 1..5 bars for the customizer. */
  stats: { speed: number; accel: number; handling: number };
}

export const CHASSIS: Record<ChassisId, CarSpec> = {
  volt: {
    id: 'volt',
    label: 'Volt',
    blurb: 'Balanced wedge with a big rear wing.',
    maxSpeed: 640,
    accel: 560,
    brake: 1050,
    reverseMax: 230,
    turnRate: 3.0,
    grip: 1760,
    length: 46,
    width: 24,
    stats: { speed: 4, accel: 4, handling: 4 },
  },
  brick: {
    id: 'brick',
    label: 'Brick',
    blurb: 'Boxy street van. Punchy and planted.',
    maxSpeed: 618,
    accel: 610,
    brake: 1100,
    reverseMax: 240,
    turnRate: 2.95,
    grip: 1840,
    length: 48,
    width: 27,
    stats: { speed: 3, accel: 5, handling: 4 },
  },
  comet: {
    id: 'comet',
    label: 'Comet',
    blurb: 'Long-nose cruiser. Highest top speed.',
    maxSpeed: 668,
    accel: 520,
    brake: 1020,
    reverseMax: 220,
    turnRate: 2.85,
    grip: 1720,
    length: 50,
    width: 24,
    stats: { speed: 5, accel: 3, handling: 3 },
  },
  pixel: {
    id: 'pixel',
    label: 'Pixel',
    blurb: 'Micro hatch. Darts through hairpins.',
    maxSpeed: 622,
    accel: 580,
    brake: 1100,
    reverseMax: 240,
    turnRate: 3.35,
    grip: 1820,
    length: 40,
    width: 23,
    stats: { speed: 3, accel: 4, handling: 5 },
  },
};

export const Surface = { Road: 0, Rumble: 1, Offroad: 2 } as const;
export type Surface = (typeof Surface)[keyof typeof Surface];

const SURFACE_SPEED = [1, 0.96, 0.58];
const SURFACE_ACCEL = [1, 0.97, 0.62];
const SURFACE_GRIP = [1, 0.9, 0.62];

export const PHYS = {
  roll: 22,
  coast: 170,
  reverseAccel: 380,
  steerResponse: 13,
  lowSpeedGripRate: 11,
  understeer: 0.15,
  steerFullSpeed: 150,
  driftMinSpeed: 140,
  driftRampTicks: 9,
  driftGrip: 1.02,
  driftTurn: 1.12,
  driftSwing: 14,
  driftMaxYaw: 6.5,
  maxSlip: 0.8,
  scrub: 1.1,
  driftScrub: 0.2,
  slideThreshold: 0.13,
  boostTop: 1.32,
  boostAccel: 430,
  boostDrain: 0.42,
  boostStartMin: 0.06,
  boostRegen: 0.02,
  driftCharge: 0.1,
  driftChargeSlip: 0.22,
  offroadBleed: 1.9,
  wallRestitution: 0.3,
  startBoost: 0.35,
} as const;

export interface CarState {
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  angVel: number;
  /** Boost meter 0..1 (multiple of 1/4096). */
  boost: number;
  /** Boost latch: true while a boost burst is running. */
  boostOn: boolean;
  /** Ticks the drift button has been held at speed (0 = not drifting). */
  drift: number;
  /** Centerline segment hint for projection. */
  seg: number;
}

export interface StepInfo {
  s: number;
  d: number;
  surface: Surface;
  speed: number;
  forwardSpeed: number;
  /** Angle between velocity and heading (radians, signed). */
  slip: number;
  drifting: boolean;
  sliding: boolean;
  boosting: boolean;
  /** Normal speed into the barrier this step (0 = no contact). */
  wallImpact: number;
  /** cos(angle between heading and the track direction). */
  headingDot: number;
  /** Velocity component along the track direction (px/s). */
  velDot: number;
}

export interface StepOptions {
  dt: number;
  /** Frozen on the grid (countdown). */
  locked?: boolean;
  /** Boost enabled by the room settings. */
  boostEnabled?: boolean;
}

export const BOOST_Q = 4096;
export const MAX_DRIFT_TICKS = 600;

export function quantizeBoost(v: number): number {
  return Math.round(clamp(v, 0, 1) * BOOST_Q) / BOOST_Q;
}

export function createCar(x: number, y: number, heading: number, track: Track, boost: number = PHYS.startBoost): CarState {
  const proj = projectOnTrack(track, x, y);
  return {
    x: f32(x),
    y: f32(y),
    heading: f32(wrapAngle(heading)),
    vx: 0,
    vy: 0,
    angVel: 0,
    boost: quantizeBoost(boost),
    boostOn: false,
    drift: 0,
    seg: proj.seg,
  };
}

function surfaceFor(track: Track, d: number): Surface {
  const ad = Math.abs(d);
  if (ad <= track.halfWidth - track.rumble) return Surface.Road;
  if (ad <= track.halfWidth) return Surface.Rumble;
  return Surface.Offroad;
}

/** Advance one car by one fixed step. Pure: returns a new state. */
export function stepCar(prev: CarState, input: CarInput, spec: CarSpec, track: Track, opts: StepOptions): { state: CarState; info: StepInfo } {
  const dt = opts.dt;
  const here = projectOnTrack(track, prev.x, prev.y, prev.seg);

  if (opts.locked) {
    const state: CarState = { ...prev, vx: 0, vy: 0, angVel: 0, drift: 0, boostOn: false, seg: here.seg };
    return {
      state,
      info: {
        s: here.s,
        d: here.d,
        surface: surfaceFor(track, here.d),
        speed: 0,
        forwardSpeed: 0,
        slip: 0,
        drifting: false,
        sliding: false,
        boosting: false,
        wallImpact: 0,
        headingDot: dcos(prev.heading) * here.tx + dsin(prev.heading) * here.ty,
        velDot: 0,
      },
    };
  }

  const throttle = clamp(input.throttle, 0, 1);
  const brake = clamp(input.brake, 0, 1);
  const steer = clamp(input.steer, -1, 1);
  const surface = surfaceFor(track, here.d);

  let { x, y, heading, vx, vy, angVel, boost } = prev;
  let fx = dcos(heading);
  let fy = dsin(heading);
  let speed = dhypot(vx, vy);
  const vf = vx * fx + vy * fy;

  // --- Boost -----------------------------------------------------------------
  let boostOn = false;
  if (opts.boostEnabled !== false && input.boost && boost > 0) {
    boostOn = prev.boostOn || boost >= PHYS.boostStartMin;
  }
  if (boostOn) boost = Math.max(0, boost - PHYS.boostDrain * dt);

  // --- Drift state ----------------------------------------------------------
  const driftHeld = input.drift && speed > PHYS.driftMinSpeed;
  const drift = driftHeld ? Math.min(MAX_DRIFT_TICKS, prev.drift + 1) : 0;
  const driftK = clamp(drift / PHYS.driftRampTicks, 0, 1);

  // --- Longitudinal ------------------------------------------------------------
  const top = spec.maxSpeed * SURFACE_SPEED[surface]! * (boostOn ? PHYS.boostTop : 1);
  let thrust = 0;
  if (throttle > 0) {
    if (vf < -20) thrust += spec.brake * throttle;
    else thrust += spec.accel * SURFACE_ACCEL[surface]! * throttle * Math.max(0, 1 - Math.max(0, vf) / top);
  }
  if (boostOn) thrust += PHYS.boostAccel * Math.max(0, 1 - Math.max(0, vf) / top);
  if (brake > 0) {
    if (vf > 20) thrust -= spec.brake * brake;
    else if (vf > -spec.reverseMax) thrust -= Math.min(PHYS.reverseAccel * brake, (vf + spec.reverseMax) / dt);
  }
  vx += fx * thrust * dt;
  vy += fy * thrust * dt;

  speed = dhypot(vx, vy);
  if (speed > 0) {
    const coasting = throttle === 0 && brake === 0 && !boostOn;
    let decel = PHYS.roll + (coasting ? PHYS.coast : 0);
    // Over the surface's top speed (run-off, end of boost): bleed toward it.
    if (speed > top) decel += (speed - top) * PHYS.offroadBleed;
    const next = Math.max(0, speed - decel * dt);
    vx *= next / speed;
    vy *= next / speed;
    speed = next;
  }

  // --- Steering -------------------------------------------------------------
  const fwd = vx * fx + vy * fy;
  const authority = clamp(speed / PHYS.steerFullSpeed, 0, 1) * (1 - PHYS.understeer * clamp(speed / spec.maxSpeed, 0, 1.4));
  let slip = 0;
  if (driftK > 0 && fwd > 0 && speed > 4) {
    // --- Drift (kinematic, controllable) -------------------------------------
    // Steering sets the path curvature (bounded by the tyres) and how far the tail
    // hangs out; the body swings toward that slide angle. Counter-steer flicks it back.
    const velAngle = datan2(vy, vx);
    const budget = (spec.grip * SURFACE_GRIP[surface]! * PHYS.driftGrip) / Math.max(speed, 1);
    const turn = clamp(steer * spec.turnRate * authority * PHYS.driftTurn, -budget, budget);
    const newVel = velAngle + turn * dt;
    const targetSlip = steer * (0.3 + 0.38 * Math.abs(steer)) * driftK;
    const desired = wrapAngle(newVel + targetSlip);
    const swing = clamp(wrapAngle(desired - heading) * PHYS.driftSwing, -PHYS.driftMaxYaw, PHYS.driftMaxYaw);
    angVel += (swing - angVel) * Math.min(1, PHYS.steerResponse * 1.4 * dt);
    heading = wrapAngle(heading + angVel * dt);
    fx = dcos(heading);
    fy = dsin(heading);
    slip = wrapAngle(newVel - heading);
    const scrubbed = speed * (1 - Math.min(0.5, Math.abs(slip) * PHYS.driftScrub * dt));
    vx = dcos(newVel) * scrubbed;
    vy = dsin(newVel) * scrubbed;
    speed = scrubbed;
  } else if (speed > 4) {
    const dir = fwd < -5 ? -1 : 1;
    const targetYaw = steer * spec.turnRate * authority * dir;
    angVel += (targetYaw - angVel) * Math.min(1, PHYS.steerResponse * dt);
    heading = wrapAngle(heading + angVel * dt);
    fx = dcos(heading);
    fy = dsin(heading);

    // --- Grip: rotate velocity toward the heading ------------------------------
    const velAngle = datan2(vy, vx);
    const reversing = vx * fx + vy * fy < 0 && speed < spec.reverseMax * 1.5 && Math.abs(wrapAngle(velAngle - heading)) > Math.PI / 2;
    const target = reversing ? wrapAngle(heading + Math.PI) : heading;
    slip = wrapAngle(velAngle - target);
    const lateralBudget = spec.grip * SURFACE_GRIP[surface]!;
    const gripRate = Math.min(PHYS.lowSpeedGripRate, lateralBudget / speed);
    const maxRot = gripRate * dt;
    const rot = clamp(-slip, -maxRot, maxRot);
    const newAngle = velAngle + rot;
    const scrubbed = speed * (1 - Math.min(0.5, Math.abs(slip) * PHYS.scrub * dt));
    // Spin protection: never let the body swing past the maximum slip angle.
    const residual = wrapAngle(newAngle - target);
    if (Math.abs(residual) > PHYS.maxSlip) {
      const cappedTarget = wrapAngle(newAngle - Math.sign(residual) * PHYS.maxSlip);
      heading = wrapAngle(heading + wrapAngle(cappedTarget - target));
      angVel = angVel * 0.6 + (rot / dt) * 0.4;
      fx = dcos(heading);
      fy = dsin(heading);
    }
    vx = dcos(newAngle) * scrubbed;
    vy = dsin(newAngle) * scrubbed;
    speed = scrubbed;
    slip = wrapAngle(newAngle - (reversing ? wrapAngle(heading + Math.PI) : heading));
  } else if (speed > 0) {
    // Crawling: velocity simply follows the nose (or tail); allow a gentle pivot.
    angVel += (steer * spec.turnRate * authority * (fwd < -1 ? -1 : 1) - angVel) * Math.min(1, PHYS.steerResponse * dt);
    heading = wrapAngle(heading + angVel * dt);
    fx = dcos(heading);
    fy = dsin(heading);
    const along = vx * fx + vy * fy >= 0 ? 1 : -1;
    vx = fx * speed * along;
    vy = fy * speed * along;
  }

  // --- Integrate ------------------------------------------------------------
  x += vx * dt;
  y += vy * dt;

  // --- Barriers ---------------------------------------------------------------
  let proj = projectOnTrack(track, x, y, here.seg);
  const nx = -proj.ty;
  const ny = proj.tx;
  const halfL = spec.length / 2;
  const halfW = spec.width / 2;
  const extent = halfL * Math.abs(fx * nx + fy * ny) + halfW * Math.abs(-fy * nx + fx * ny);
  const excess = Math.abs(proj.d) + extent - track.wall;
  let wallImpact = 0;
  if (excess > 0) {
    const side = proj.d >= 0 ? 1 : -1;
    const ox = nx * side;
    const oy = ny * side;
    x -= ox * excess;
    y -= oy * excess;
    const vn = vx * ox + vy * oy;
    if (vn > 0) {
      wallImpact = vn;
      vx -= ox * vn * (1 + PHYS.wallRestitution);
      vy -= oy * vn * (1 + PHYS.wallRestitution);
      const vt = vx * proj.tx + vy * proj.ty;
      const friction = Math.min(0.35, vn / 1400);
      vx -= proj.tx * vt * friction;
      vy -= proj.ty * vt * friction;
      // Glancing blows swing the nose toward the wall direction.
      const along = fx * proj.tx + fy * proj.ty >= 0 ? datan2(proj.ty, proj.tx) : datan2(-proj.ty, -proj.tx);
      angVel += wrapAngle(along - heading) * Math.min(1, vn / 500) * 5;
      speed = dhypot(vx, vy);
    }
    proj = projectOnTrack(track, x, y, proj.seg);
  }

  // --- Boost charge / regen ------------------------------------------------
  const sliding = Math.abs(slip) > PHYS.slideThreshold && speed > 150;
  const drifting = driftK >= 0.5 && Math.abs(slip) > 0.1;
  if (opts.boostEnabled !== false && !boostOn) {
    let gain = PHYS.boostRegen;
    const newSurface = surfaceFor(track, proj.d);
    if (driftK >= 0.5 && Math.abs(slip) > 0.18 && speed > 220 && newSurface !== Surface.Offroad) {
      gain += PHYS.driftCharge + PHYS.driftChargeSlip * Math.min(1, Math.abs(slip) / 0.7);
    }
    boost = Math.min(1, boost + gain * dt);
  }

  const state: CarState = {
    x: f32(x),
    y: f32(y),
    heading: f32(wrapAngle(heading)),
    vx: f32(vx),
    vy: f32(vy),
    angVel: f32(angVel),
    boost: quantizeBoost(boost),
    boostOn: boostOn && boost > 0,
    drift,
    seg: proj.seg,
  };
  const hx = dcos(state.heading);
  const hy = dsin(state.heading);
  return {
    state,
    info: {
      s: proj.s,
      d: proj.d,
      surface: surfaceFor(track, proj.d),
      speed,
      forwardSpeed: vx * hx + vy * hy,
      slip,
      drifting,
      sliding,
      boosting: boostOn,
      wallImpact,
      headingDot: hx * proj.tx + hy * proj.ty,
      velDot: vx * proj.tx + vy * proj.ty,
    },
  };
}

/** Speed in "km/h" for the HUD (1 px ≈ 7.5 cm → 640 px/s ≈ 173 km/h). */
export function displaySpeed(pxPerSecond: number): number {
  return Math.round(Math.abs(pxPerSecond) * 0.27);
}
