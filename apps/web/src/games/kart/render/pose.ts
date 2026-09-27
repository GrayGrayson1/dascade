/**
 * Adapters from the core engine's records to renderer poses (pure; no three.js). The client lane
 * uses `poseFromSnap` for interpolated remote karts and `poseFromState` for the predicted local kart.
 */
import {
  KartFlag,
  SURF_DIRT,
  SURF_ICE,
  SURF_MUD,
  SURF_OFFROAD,
  driftStage,
  itemIdOf,
  type KartState,
  type KartStepInfo,
  type SnapEntity,
  type SnapKart,
} from '@dascade/game-core/kart';
import type { KartInput } from '@dascade/shared/games/kart';
import { KF, type KartEntityPose, type KartPose } from './types.ts';

export function emptyPose(slot: number): KartPose {
  return { slot, active: false, x: 0, y: 0, z: 0, heading: 0, speed: 0, steer: 0, flags: 0, driftStage: 0, item: null, itemCount: 0, position: 0 };
}

/** Snapshot display record → pose (writes into `out`). `yawRate` stands in for steering. */
export function poseFromSnap(out: KartPose, s: SnapKart, extra?: { aimBack?: boolean; position?: number; hop?: boolean }): KartPose {
  const f = s.flags;
  let k = 0;
  if (f & KartFlag.drifting) k |= KF.drifting;
  if (s.driftDir > 0) k |= KF.driftLeft;
  if (f & KartFlag.boosting) k |= KF.boosting;
  if (f & KartFlag.air) k |= KF.airborne;
  if (f & KartFlag.spinning) k |= KF.spinning;
  if (f & KartFlag.shielded) k |= KF.shield;
  if (f & KartFlag.warping) k |= KF.warp;
  if (f & KartFlag.magnet) k |= KF.magnet;
  if (f & KartFlag.offroad) k |= KF.offroad;
  if (f & KartFlag.falling) k |= KF.respawning;
  if (f & KartFlag.ghost) k |= KF.ghost;
  if (f & KartFlag.finished) k |= KF.finished;
  if (f & KartFlag.immune) k |= KF.immune;
  if (f & KartFlag.slick) k |= KF.slick;
  if (s.trailing) k |= KF.trailing;
  if (extra?.aimBack) k |= KF.aimBack;
  if (extra?.hop) k |= KF.hop;
  const c = Math.cos(s.heading);
  const sn = Math.sin(s.heading);
  out.slot = s.slot;
  out.active = true;
  out.x = s.x;
  out.y = s.y;
  out.z = s.z;
  out.heading = s.heading;
  out.speed = s.vx * c + s.vy * sn;
  out.steer = Math.max(-1, Math.min(1, s.yawRate / 2.2));
  out.flags = k;
  out.driftStage = s.driftStage;
  out.item = s.item;
  out.itemCount = s.itemUses;
  out.position = extra?.position ?? out.position;
  return out;
}

/** Exact engine state (local prediction / offline harness) → pose. */
export function poseFromState(out: KartPose, slot: number, st: KartState, info: KartStepInfo | null, input: KartInput | null, finished = false, position = 0): KartPose {
  let k = 0;
  if (st.driftDir !== 0) k |= KF.drifting;
  if (st.driftDir > 0) k |= KF.driftLeft;
  if (st.boostTicks > 0) k |= KF.boosting;
  if (!st.grounded) k |= KF.airborne;
  if (!st.grounded && !st.rampAir && st.airTicks > 0 && st.airTicks < 20 && st.fallTicks <= 0) k |= KF.hop;
  if (st.spinTicks > 0) k |= KF.spinning;
  if (st.shieldTicks > 0) k |= KF.shield;
  if (st.warpTicks > 0) k |= KF.warp;
  if (st.magnetTicks > 0) k |= KF.magnet;
  if (info && (info.surface === SURF_OFFROAD || info.surface === SURF_DIRT || info.surface === SURF_MUD)) k |= KF.offroad;
  if (st.fallTicks > 0) k |= KF.respawning;
  if (st.immuneTicks > 0) k |= KF.immune;
  if (st.slickTicks > 0 || (info && info.surface === SURF_ICE)) k |= KF.slick;
  if (st.trailing) k |= KF.trailing;
  if (input?.back && st.item) k |= KF.aimBack;
  if (finished) k |= KF.finished;
  const c = Math.cos(st.heading);
  const sn = Math.sin(st.heading);
  out.slot = slot;
  out.active = true;
  out.x = st.x;
  out.y = st.y;
  out.z = st.z;
  out.heading = st.heading;
  out.speed = st.vx * c + st.vy * sn;
  out.steer = input ? input.steer : 0;
  out.flags = k;
  out.driftStage = driftStage(st);
  out.item = itemIdOf(st);
  out.itemCount = st.itemUses;
  out.position = position;
  return out;
}

/** Snapshot entity → entity pose. */
export function entityFromSnap(out: KartEntityPose, e: SnapEntity, tickRate = 60): KartEntityPose {
  out.id = e.id;
  out.kind = e.kind === 'puddle' ? 'fizz' : e.kind;
  out.x = e.x;
  out.y = e.y;
  out.z = e.z;
  out.heading = e.heading;
  out.age = e.age / tickRate;
  return out;
}
