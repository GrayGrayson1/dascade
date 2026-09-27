/**
 * Thin client-side helpers over `@dascade/game-core/kart` (track outlines, flags → render bits,
 * forward speed). Keeping them here keeps the rest of the client independent of core internals.
 */
import type { KartTrackId } from '@dascade/shared/games/kart';
import { KartFlag, driftStage, getKartTrack, itemIdOf, type KartState, type KartTrack, type SnapKart } from '@dascade/game-core/kart';
import { KF } from './render/types.ts';
import type { Polyline } from './hud/minimap.ts';

const outlines = new Map<KartTrackId, { main: Polyline; branches: Polyline[] }>();

/** Centreline + branch polylines for minimaps (cached per track). */
export function trackPolylines(id: KartTrackId): { main: Polyline; branches: Polyline[] } | null {
  const hit = outlines.get(id);
  if (hit) return hit;
  let track: KartTrack;
  try {
    track = getKartTrack(id);
  } catch {
    return null;
  }
  const out = {
    main: { xs: track.xs, ys: track.ys, count: track.n, closed: true },
    branches: track.branches.map((b) => ({ xs: b.xs, ys: b.ys, count: b.n, closed: false })),
  };
  outlines.set(id, out);
  return out;
}

/** Forward speed (u/s, negative when reversing). Render-side only (plain Math is fine here). */
export function forwardSpeed(s: KartState): number {
  return s.vx * Math.cos(s.heading) + s.vy * Math.sin(s.heading);
}

/** Render flag bits (`KF`) from a kart state + snapshot flags (`KartFlag`). */
export function renderFlags(s: KartState, snapFlags: number): number {
  let f = 0;
  if (s.driftDir !== 0) f |= KF.drifting;
  if (s.driftDir === 1) f |= KF.driftLeft;
  if (s.boostTicks > 0 || snapFlags & KartFlag.boosting) f |= KF.boosting;
  if (!s.grounded) f |= KF.airborne;
  if (!s.grounded && !s.rampAir && s.fallTicks <= 0) f |= KF.hop;
  if (s.spinTicks > 0) f |= KF.spinning;
  if (s.shieldTicks > 0) f |= KF.shield;
  if (s.warpTicks > 0) f |= KF.warp;
  if (s.magnetTicks > 0) f |= KF.magnet;
  if (snapFlags & KartFlag.offroad) f |= KF.offroad;
  if (s.fallTicks > 0) f |= KF.respawning | KF.lifted;
  if (snapFlags & KartFlag.ghost) f |= KF.ghost;
  if (snapFlags & KartFlag.finished) f |= KF.finished;
  if (s.trailing) f |= KF.trailing;
  if (s.immuneTicks > 0) f |= KF.immune;
  if (s.slickTicks > 0 || snapFlags & KartFlag.slick) f |= KF.slick;
  return f;
}

/** Render flag bits (`KF`) for another kart, from its broadcast display record. */
export function displayFlags(k: SnapKart): number {
  const b = k.flags;
  let f = 0;
  if (k.driftDir !== 0 || b & KartFlag.drifting) f |= KF.drifting;
  if (k.driftDir === 1) f |= KF.driftLeft;
  if (b & KartFlag.boosting) f |= KF.boosting;
  if (b & KartFlag.air) f |= KF.airborne;
  if (b & KartFlag.spinning) f |= KF.spinning;
  if (b & KartFlag.shielded) f |= KF.shield;
  if (b & KartFlag.warping) f |= KF.warp;
  if (b & KartFlag.magnet) f |= KF.magnet;
  if (b & KartFlag.offroad) f |= KF.offroad;
  if (b & KartFlag.falling) f |= KF.respawning | KF.lifted;
  if (b & KartFlag.ghost) f |= KF.ghost;
  if (b & KartFlag.finished) f |= KF.finished;
  if (b & KartFlag.immune) f |= KF.immune;
  if (b & KartFlag.slick) f |= KF.slick;
  if (k.trailing) f |= KF.trailing;
  return f;
}

export { driftStage, itemIdOf };
