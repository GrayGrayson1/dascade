/**
 * Autopilot: a deterministic scripted driver that produces CarInputs from a car
 * state. Used by the load-test bots, tests (a lap must be completable on every
 * track) and visual QA. It looks ahead along the centerline, steers at a target
 * point, brakes for upcoming curvature and fires boost on straights.
 */
import type { CarInput } from '@dascade/shared/games/circuit';
import type { CarSpec, CarState } from './car.ts';
import { clamp, datan2, dcos, dhypot, dsin, wrapAngle } from './math.ts';
import { pointAt, projectOnTrack, segAt, type Track } from './track.ts';

export interface BotOptions {
  /** 0.6 (cautious) … 1.0 (on the limit). Scales the cornering speed target. */
  skill?: number;
  /** Preferred lateral offset from the centerline (px, + = normal side). */
  lane?: number;
  /** Allow drifting through tight corners. */
  drift?: boolean;
}

export interface BotMemory {
  stuckTicks: number;
  reverseTicks: number;
}

export function createBotMemory(): BotMemory {
  return { stuckTicks: 0, reverseTicks: 0 };
}

export function autopilot(state: CarState, spec: CarSpec, track: Track, memory: BotMemory, opts: BotOptions = {}): CarInput {
  const skill = clamp(opts.skill ?? 0.85, 0.4, 1.05);
  const proj = projectOnTrack(track, state.x, state.y, state.seg);
  const speed = dhypot(state.vx, state.vy);
  const fx = dcos(state.heading);
  const fy = dsin(state.heading);
  const facing = fx * proj.tx + fy * proj.ty;

  // Recovery: stuck against a barrier or another car → reverse out, swinging the nose toward the track.
  const trackAngle = datan2(proj.ty, proj.tx);
  if (memory.reverseTicks > 0) {
    memory.reverseTicks--;
    const want = wrapAngle(trackAngle - state.heading);
    // Reversing inverts steering, so steer against the error to rotate the nose toward the track.
    return { throttle: 0, brake: 1, steer: -Math.sign(want || 1), drift: false, boost: false };
  }
  if (speed < 25) memory.stuckTicks++;
  else memory.stuckTicks = Math.max(0, memory.stuckTicks - 2);
  if (memory.stuckTicks > 75) {
    memory.stuckTicks = 0;
    memory.reverseTicks = 40;
  }

  const lane = clamp(opts.lane ?? 0, -track.halfWidth * 0.6, track.halfWidth * 0.6);
  const look = 70 + speed * 0.32;
  const target = pointAt(track, proj.s + look);
  const tx = target.x - target.ty * lane;
  const ty = target.y + target.tx * lane;
  let desired = datan2(ty - state.y, tx - state.x);
  if (facing < -0.2) desired = datan2(proj.ty, proj.tx); // turn around toward the track direction
  const err = wrapAngle(desired - state.heading);
  const steer = clamp(err * 2.6 - state.angVel * 0.12, -1, 1);

  // Speed target from the tightest curvature within braking distance.
  const brakeDist = (speed * speed) / (2 * spec.brake * 0.7) + 90;
  const i0 = segAt(track, proj.s);
  const steps = Math.ceil(brakeDist / track.spacing);
  let maxK = 0;
  for (let k = 0; k < steps; k += 2) {
    const kk = Math.abs(track.curvature[(i0 + k) % track.n]!);
    if (kk > maxK) maxK = kk;
  }
  const grip = spec.grip * 0.86 * skill;
  const safe = maxK > 1e-5 ? Math.min(spec.maxSpeed * 1.3, Math.sqrt(grip / maxK)) : spec.maxSpeed * 1.3;
  const tooFast = speed > safe * 1.04;
  // Only lift for a big heading error at speed; when slow, drive through the turn (you can't steer standing still).
  const throttle = tooFast || (Math.abs(err) > 1.2 && speed > 240) ? 0 : Math.abs(err) > 1.2 ? 0.7 : 1;
  const brake = speed > safe * 1.12 ? 1 : 0;
  const straight = maxK < 0.0009 && Math.abs(err) < 0.15;
  const boost = straight && state.boost > 0.45 && speed > spec.maxSpeed * 0.7;
  const drift = Boolean(opts.drift) && maxK > 0.003 && speed > 330 && Math.abs(err) > 0.12;
  return { throttle, brake, steer, drift, boost };
}
