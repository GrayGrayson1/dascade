/**
 * DASphalt GP — the track authoring format. A track is pure data; `buildTrack` (track.ts) turns it
 * into the sampled geometry the simulation, the bots and the renderer share.
 *
 * Conventions
 *  - World units: 1 unit ≈ 1 m. A kart is ~2 units long and ~1.4 wide; top speeds are ~26–32 u/s.
 *  - The ground plane is (x, y); `z` is height. Travel direction = the order of `points`.
 *  - Lateral offset `d`: positive = LEFT of the direction of travel (the normal (-ty, tx)).
 *  - Positions along the lap are fractions of the centreline length (`Frac`, 0 ≤ f < 1), measured
 *    from points[0] (the start/finish line). The builder converts them to arc length.
 *  - Renderer mapping to three.js (right-handed, Y up): three(x, y, z) = (x, z, -y).
 */
import type { KartTrackId } from '@dascade/shared/games/kart';

/** Position along the lap as a fraction of the centreline length, [0, 1). */
export type Frac = number;

/** A centreline control point: [x, y, z (height, default 0), halfWidth (default track.halfWidth)]. */
export type ControlPoint = readonly [x: number, y: number, z?: number, halfWidth?: number];

export type EdgeKind = 'wall' | 'drop';
export type Side = 'left' | 'right' | 'both';

/** Overrides the default edge between two lap fractions (wraps if to < from). */
export interface EdgeSpan {
  from: Frac;
  to: Frac;
  side: Side;
  kind: EdgeKind;
}

/** The shoulder's material: how off-road looks and how much it slows you. */
export type OffroadKind = 'grass' | 'sand' | 'snow' | 'dirt' | 'gravel' | 'metal';

export type ZoneKind =
  /** Low grip (slides; grip stat helps). */
  | 'ice'
  /** Slow like off-road, but on the road (puddles, sand drifts). */
  | 'mud'
  /** Pushes karts sideways at `push` u/s (positive = to the left). */
  | 'conveyor';

/** A surface patch on or beside the road between two lap fractions and two lateral offsets. */
export interface SurfaceZone {
  from: Frac;
  to: Frac;
  /** Lateral band [d0, d1] (d0 < d1). */
  d0: number;
  d1: number;
  kind: ZoneKind;
  /** Conveyor speed (u/s, + = left). */
  push?: number;
}

/** A boost pad (chevrons): driving over it gives a short boost. */
export interface BoostPad {
  at: Frac;
  d: number;
  /** Along-track length (default 4). */
  length?: number;
  /** Across-track width (default 3). */
  width?: number;
}

/** A ramp: crossing it at speed launches the kart. Pressing drift at the lip is a trick (landing boost). */
export interface Ramp {
  at: Frac;
  /** Lateral centre (default 0) and width (default the full road). */
  d?: number;
  width?: number;
  /** Vertical launch speed at full speed (u/s); scaled by speed. Typical 6–11. */
  launch: number;
}

/** A stretch of the main road with no ground (a chasm/gap). Must be jumped; falling in respawns you. */
export interface Gap {
  from: Frac;
  to: Frac;
}

/** A row of item cubes across the road. */
export interface ItemRow {
  at: Frac;
  /** Cubes in the row (2–6). */
  count: number;
  /** Lateral spread as a fraction of the road width (default 0.7). */
  spread?: number;
}

export type HazardKind =
  /** A round bumper that knocks karts away (no spin-out). Static. */
  | 'bumper'
  /** A block that slams down periodically; being under it when it lands is a spin-out. */
  | 'stomper'
  /** Swings/slides across the road (crane crate, sweeper arm): hit = spin-out. */
  | 'sweeper'
  /** Rolls along the track against traffic then respawns (snowball, barrel): hit = spin-out. */
  | 'roller'
  /** A laser gate across the road that switches on and off: hit while on = spin-out. */
  | 'laser';

/** A moving/static hazard. Its motion is a pure function of the race tick (identical on server and client). */
export interface HazardDef {
  kind: HazardKind;
  at: Frac;
  /** Lateral centre. */
  d: number;
  /** Collision radius (bumper/stomper/sweeper/roller) or half-width for a laser (default by kind). */
  radius?: number;
  /** Cycle length in seconds. */
  period: number;
  /** Cycle phase offset 0..1. */
  phase?: number;
  /** Travel: lateral swing amplitude (sweeper), along-track run length in units (roller). */
  amp?: number;
}

/**
 * An alternate route that leaves the main road at `from` and rejoins at `to` (from < to, no wrap).
 * `points` are the interior control points; the builder joins them smoothly to the main centreline.
 * While on a branch, race progress maps linearly onto the main road's [from, to] span, so a real
 * shortcut is shorter to drive but can never skip a checkpoint (no gate is placed inside a branch span).
 */
export interface BranchDef {
  from: Frac;
  to: Frac;
  points: readonly ControlPoint[];
  halfWidth?: number;
  /** 'road' = a real alternate route; 'dirt' = an off-road cut (slow unless boosting). */
  surface: 'road' | 'dirt';
}

/** Render-only scenery anchor (a big bespoke model: the track's landmarks). */
export interface Landmark {
  /** Renderer model id (see apps/web/src/games/kart/render/landmarks). */
  kind: string;
  at: Frac;
  /** Lateral offset of its centre (+ = left). Keep clear of the road and shoulder. */
  d: number;
  scale?: number;
  /** Yaw relative to the track tangent (radians). */
  yaw?: number;
  /** Height offset. */
  z?: number;
}

/** Visual world style (sky, ground, props, palettes). Implemented by the renderer. */
export type BiomeId = 'city' | 'desert' | 'harbor' | 'snow' | 'carnival' | 'factory' | 'sky' | 'cyber';

export interface KartTrackDef {
  id: KartTrackId;
  biome: BiomeId;
  /** Closed ring of control points (no self-intersections). points[0] is on the start line. */
  points: readonly ControlPoint[];
  /** Default road half-width (6–12). */
  halfWidth: number;
  /** Off-road margin beyond the road edge before the edge (wall face or drop). 0 = edge at the road. */
  shoulder: number;
  offroad: OffroadKind;
  /** Default edge beyond the shoulder. */
  edge: EdgeKind;
  edges?: readonly EdgeSpan[];
  zones?: readonly SurfaceZone[];
  boostPads?: readonly BoostPad[];
  ramps?: readonly Ramp[];
  gaps?: readonly Gap[];
  itemRows?: readonly ItemRow[];
  hazards?: readonly HazardDef[];
  branches?: readonly BranchDef[];
  landmarks?: readonly Landmark[];
  /** Checkpoint gates including the start line (default: one per ~80 units). */
  checkpoints?: number;
  /** Seed for deterministic scenery scatter (renderer). */
  decorSeed: number;
  /** A strong lap for a skilled driver (ms): medals/par and the bot pace sanity check. */
  parLapMs: number;
}
