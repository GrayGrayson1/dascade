/**
 * DASphalt GP renderer — public types (no three.js here, so the client lane can import them freely).
 *
 * Coordinates are always TRACK space (x, y ground plane, z height; heading in radians where
 * 0 = +x and positive turns toward +y, i.e. counter-clockwise seen from above). The renderer
 * converts to three.js itself: three(x, y, z) = (x, z, -y).
 */
import type { KartBodyId, KartItemId, KartRacerId } from '@dascade/shared/games/kart';

export type KartQuality = 'low' | 'medium' | 'high';
export type KartFxLevel = 'off' | 'low' | 'high';

export interface KartRendererOptions {
  quality: KartQuality;
  reducedMotion: boolean;
  fx: KartFxLevel;
  /** Auto-lower quality when frame times stay poor (default true). */
  autoQuality?: boolean;
  /** Max name tags drawn at once (default 8). */
  maxNameTags?: number;
}

export interface KartRosterEntry {
  /** Grid slot (= kart index in snapshots). */
  slot: number;
  racer: KartRacerId;
  body: KartBodyId;
  /** #rrggbb */
  paint: string;
  name: string;
  /** The local player's kart (no name tag, always full detail). */
  local: boolean;
}

/** Bit flags for `KartPose.flags` (combine with |). */
export const KF = {
  drifting: 1 << 0,
  /** Drift direction: set = drifting LEFT, clear = right (only meaningful with `drifting`). */
  driftLeft: 1 << 1,
  boosting: 1 << 2,
  airborne: 1 << 3,
  spinning: 1 << 4,
  shield: 1 << 5,
  warp: 1 << 6,
  magnet: 1 << 7,
  /** Hop (drift start). */
  hop: 1 << 8,
  offroad: 1 << 9,
  respawning: 1 << 10,
  /** Draw translucent (time-trial ghost / intangible). */
  ghost: 1 << 11,
  finished: 1 << 12,
  /** Aiming the item backwards (driver looks back). */
  aimBack: 1 << 13,
  /** Holding the item trailed behind the kart. */
  trailing: 1 << 14,
  /** Brief immunity after a hit (kart blinks). */
  immune: 1 << 15,
  /** Surface is ice / a fizz puddle (tyre sheen particles). */
  slick: 1 << 16,
  /** Being lifted back onto the track after a fall. */
  lifted: 1 << 17,
} as const;

export interface KartPose {
  slot: number;
  /** False = not in this race / retired (hidden). */
  active: boolean;
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Forward speed (u/s, negative when reversing). */
  speed: number;
  /** -1..1, positive = steering left. */
  steer: number;
  /** Combination of `KF` bits. */
  flags: number;
  /** 0 none, 1 cyan, 2 gold, 3 magenta (the mini-turbo charge stage). */
  driftStage: number;
  /** Item in hand (shown as a trailed model / held item); null = none. */
  item: KartItemId | null;
  /** Uses left of the item in hand (trios show 1–3 orbiting items). */
  itemCount: number;
  /** 1-based race position (name tags show it); 0 = unknown. */
  position: number;
  /**
   * Magnet tether target slot (the kart being tugged toward). Optional: when KF.magnet is set and
   * this is missing or -1, the renderer tethers to the nearest kart ahead (within 160 u, ±40°).
   */
  magnetTarget?: number;
}

export type KartEntityKind = 'puck' | 'seeker' | 'mine' | 'fizz' | 'turbo' | 'pulse' | 'warp';

export interface KartEntityPose {
  /** Stable id while the entity lives (used for pooling/interpolation). */
  id: number;
  kind: KartEntityKind;
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Age in seconds (used for spawn/despawn animation). */
  age: number;
}

export interface KartBoxState {
  /** Index into `track.itemBoxes`. */
  index: number;
  /** False while respawning (hidden, pops back in when true again). */
  visible: boolean;
}

export type KartCameraMode =
  /** Chase camera behind `targetSlot` (the default). */
  | 'chase'
  /** Countdown flyover over the grid, ending behind `targetSlot`. `introT` 0..1 drives it. */
  | 'intro'
  /** Slow orbit around `targetSlot` (after finishing / podium). */
  | 'orbit'
  /** Spectator: follow `targetSlot` from a higher, looser chase. */
  | 'spectate';

export interface KartView {
  /** Per-kart poses (any order; indexed by `slot`). Reuse the array/objects between frames. */
  karts: readonly KartPose[];
  /** Projectiles and traps. */
  entities: readonly KartEntityPose[];
  /** Item-box visibility (omit to show every box). */
  boxes?: readonly KartBoxState[];
  /** Race tick (60 Hz, fractional allowed) — drives hazards so they match the simulation. */
  tick: number;
  /** Slot the camera follows (the local kart, or the spectated kart). */
  targetSlot: number;
  camera: KartCameraMode;
  /** 0..1 progress through the intro flyover (camera = 'intro'). */
  introT?: number;
  /** Start lights: -1 hidden, 0..3 lit reds, 4 = green (GO). */
  lights?: number;
  /** Frame delta in seconds (clamped internally to ≤ 0.1). */
  dt: number;
  /** Optional time-trial ghost pose (drawn translucent). */
  ghost?: KartPose | null;
}

/** One-shot effects the client triggers from events. */
export type KartFxKind =
  | 'hit' // item hit burst + spin stars
  | 'blocked' // shield pop
  | 'wall' // wall sparks
  | 'land' // landing dust
  | 'splash' // fall into water/void
  | 'boost' // mini-turbo / pad burst
  | 'pulse' // pulse wave ring
  | 'pickup' // item cube shatter
  | 'confetti' // finish
  | 'trick'; // ramp trick flash

export interface KartFxAt {
  x: number;
  y: number;
  z: number;
  /** Optional slot the effect belongs to (follows the kart for a moment). */
  slot?: number;
  /** Optional drift stage / colour hint. */
  stage?: number;
}

export interface KartRenderStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  quality: KartQuality;
  pixelRatio: number;
}
