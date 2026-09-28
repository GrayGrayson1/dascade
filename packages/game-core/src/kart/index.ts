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
 * Each file's header documents its part of the API; docs/KART.md is the engineer's guide (layout,
 * networking model, room flow, adding tracks/items/racers, testing).
 */
import type { KartTrackId } from '@dascade/shared/games/kart';
import { buildTrack, type KartTrack } from './track.ts';
import type { KartTrackDef } from './trackdef.ts';
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

/**
 * Process-wide cache of built tracks, shared even if this module is instantiated twice (e.g. two
 * bundles or import paths in one process): a track is built once per def, never rebuilt.
 */
const CACHE_KEY = '__dascadeKartTracks';
type TrackCache = Map<KartTrackId, { def: KartTrackDef; track: KartTrack }>;
const built: TrackCache = ((globalThis as Record<string, unknown>)[CACHE_KEY] as TrackCache | undefined) ?? new Map();
(globalThis as Record<string, unknown>)[CACHE_KEY] = built;

/** Built track for an id (cached process-wide; throws KartTrackError for an invalid def). */
export function getKartTrack(id: KartTrackId): KartTrack {
  const def = KART_TRACK_DEFS[id];
  if (!def) throw new Error(`unknown kart track ${id}`);
  const hit = built.get(id);
  if (hit && hit.def === def) return hit.track;
  const track = buildTrack(def);
  built.set(id, { def, track });
  return track;
}
