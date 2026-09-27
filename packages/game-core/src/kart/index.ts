/**
 * @dascade/game-core/kart — the pure, deterministic engine of DASphalt GP.
 *
 *  - Tracks: `KartTrackDef` (data, trackdef.ts) → `buildTrack` → `KartTrack` (sampled geometry the
 *    sim, bots and renderer share). `getKartTrack(id)` builds and caches. `groundAt`, `hazardPose`.
 *  - Physics: `stepKart` (pure; server + client prediction), `racerSpec` (stats → physics).
 *  - `KartSim`: the authoritative 60 Hz race (credit-bank inputs, items, bumps, progress/anti-cheat,
 *    bots) with `encodeSnapshot()` (broadcast display records) and `encodeOwn(slot)` (exact state
 *    for that racer's predictor).
 *  - `decodeKartSnapshot` / `decodeKartOwn`, `KartPredictor`, ghosts, `KartBot`.
 * See .scratch/kart/API.md and docs/KART.md.
 */
import type { KartTrackId } from '@dascade/shared/games/kart';
import { buildTrack, type KartTrack } from './track.ts';
import { KART_TRACK_DEFS } from './tracks/index.ts';

export * from './trackdef.ts';
export * from './track.ts';
export * from './spec.ts';
export * from './kart.ts';
export * from './itemcodes.ts';
export * from './items.ts';
export * from './progress.ts';
export * from './collide.ts';
export * from './sim.ts';
export * from './snapshot.ts';
export * from './predictor.ts';
export * from './ghost.ts';
export * from './bot.ts';
export { KART_TRACK_DEFS, KART_PLACEHOLDER_TRACKS } from './tracks/index.ts';
export { f32, qheading, headingIndex, HEADING_Q } from './math.ts';

const built = new Map<KartTrackId, KartTrack>();

/** Built track for an id (cached; throws KartTrackError for an invalid def). */
export function getKartTrack(id: KartTrackId): KartTrack {
  let t = built.get(id);
  if (!t) {
    const def = KART_TRACK_DEFS[id];
    if (!def) throw new Error(`unknown kart track ${id}`);
    t = buildTrack(def);
    built.set(id, t);
  }
  return t;
}
