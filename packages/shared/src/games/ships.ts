/**
 * DAS Ships — shared contract (settings, fleet content, messages, payloads, public state shape).
 *
 * An ORIGINAL hidden-fleet duel set on DASCADE's neon sea. Two captains secretly deploy a fleet,
 * then trade shots across the grid. The server owns every fleet: placements never enter the
 * synchronized state (each captain receives only their own fleet via `ships:private`), and only
 * public shot results are ever broadcast. Both fleets are revealed once the game is over.
 */
import { z } from 'zod';
import type { BaseRoomView } from '../protocol.ts';

// ---------------------------------------------------------------------------
// Fleet content (original DASCADE vessel classes)
// ---------------------------------------------------------------------------

export const VESSEL_IDS = ['arcology', 'tidebreaker', 'thunderhead', 'lanternfish', 'riptide', 'glowdart', 'wisp'] as const;
export type VesselId = (typeof VESSEL_IDS)[number];

export interface VesselClass {
  id: VesselId;
  name: string;
  /** Hull length in grid squares. */
  length: number;
  /** Short flavour line for the fleet dock / rules. */
  blurb: string;
}

/** The neon-sea vessel classes. Every fleet uses each class at most once. */
export const VESSELS: Record<VesselId, VesselClass> = {
  arcology: { id: 'arcology', name: 'Arcology', length: 5, blurb: 'A floating neon city — slow, vast and proud.' },
  tidebreaker: { id: 'tidebreaker', name: 'Tidebreaker', length: 4, blurb: 'Armoured ram-hull that splits storm swells.' },
  thunderhead: { id: 'thunderhead', name: 'Thunderhead', length: 4, blurb: 'Stormcloud gunship with a crackling mast.' },
  lanternfish: { id: 'lanternfish', name: 'Lanternfish', length: 3, blurb: 'Deep-runner with a lure-light prow.' },
  riptide: { id: 'riptide', name: 'Riptide', length: 3, blurb: 'Twin-jet interceptor that skims the surface.' },
  glowdart: { id: 'glowdart', name: 'Glowdart', length: 2, blurb: 'A quick scout skiff trailing sparks.' },
  wisp: { id: 'wisp', name: 'Wisp', length: 2, blurb: 'Silent courier drone on a hydrofoil.' },
};

export const SHIPS_FLEET_IDS = ['skirmish', 'standard', 'armada'] as const;
export type ShipsFleetId = (typeof SHIPS_FLEET_IDS)[number];

export interface ShipsFleetPreset {
  id: ShipsFleetId;
  name: string;
  /** Vessels in the order they appear in the dock (longest first). */
  vessels: readonly VesselId[];
  /** Smallest grid this fleet may be played on. */
  minGrid: ShipsGridSize;
  blurb: string;
}

export const SHIPS_FLEETS: Record<ShipsFleetId, ShipsFleetPreset> = {
  skirmish: {
    id: 'skirmish',
    name: 'Skirmish',
    vessels: ['tidebreaker', 'lanternfish', 'riptide', 'glowdart'],
    minGrid: 8,
    blurb: 'Four vessels · 12 squares — a quick duel.',
  },
  standard: {
    id: 'standard',
    name: 'Neon Fleet',
    vessels: ['arcology', 'tidebreaker', 'lanternfish', 'riptide', 'glowdart'],
    minGrid: 8,
    blurb: 'Five vessels · 17 squares — the classic duel length.',
  },
  armada: {
    id: 'armada',
    name: 'Armada',
    vessels: ['arcology', 'tidebreaker', 'thunderhead', 'lanternfish', 'riptide', 'glowdart', 'wisp'],
    minGrid: 10,
    blurb: 'Seven vessels · 23 squares — a long naval war.',
  },
};

export const SHIPS_GRID_SIZES = [8, 10, 12] as const;
export type ShipsGridSize = (typeof SHIPS_GRID_SIZES)[number];
export const SHIPS_MAX_GRID = 12;
/** Largest fleet (and therefore the largest salvo). */
export const SHIPS_MAX_VESSELS = 7;

export function fleetCells(fleet: ShipsFleetId): number {
  return SHIPS_FLEETS[fleet].vessels.reduce((sum, id) => sum + VESSELS[id].length, 0);
}

/** Column letters for coordinates ("A".."L"). */
export const SHIPS_COLUMNS = 'ABCDEFGHIJKL';

/** Human coordinate label, e.g. (1, 6) → "B7". */
export function coordLabel(x: number, y: number): string {
  return `${SHIPS_COLUMNS[x] ?? '?'}${y + 1}`;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const SHIPS_FIRING_MODES = ['classic', 'streak', 'salvo'] as const;
export type ShipsFiringMode = (typeof SHIPS_FIRING_MODES)[number];

export const SHIPS_FIRING_LABELS: Record<ShipsFiringMode, { name: string; blurb: string }> = {
  classic: { name: 'Classic', blurb: 'One shot per turn, strictly alternating.' },
  streak: { name: 'Hot streak', blurb: 'Hit something and you fire again.' },
  salvo: { name: 'Salvo', blurb: 'Fire one shot per vessel you still have afloat.' },
};

/** 'touching' = vessels may sit side by side; 'apart' = no two vessels may touch, even diagonally. */
export const SHIPS_SPACING = ['touching', 'apart'] as const;
export type ShipsSpacing = (typeof SHIPS_SPACING)[number];

/** What happens when the turn clock runs out: fire at random untargeted squares, or lose the turn. */
export const SHIPS_TIMEOUT_RULES = ['autofire', 'skip'] as const;
export type ShipsTimeoutRule = (typeof SHIPS_TIMEOUT_RULES)[number];

export const SHIPS_TURN_SECONDS = [0, 15, 20, 30, 45, 60, 90] as const;
export const SHIPS_PLACEMENT_SECONDS = [60, 90, 120, 180, 300] as const;
/** Consecutive turn timeouts after which a captain forfeits the game. */
export const SHIPS_TIMEOUT_STRIKES = 3;
/** In tournament matches an untimed game still gets this turn clock so brackets can't stall. */
export const SHIPS_TOURNAMENT_TURN_SECONDS = 60;
/**
 * Untimed casual games have no visible turn clock, but a captain who doesn't fire for this long
 * auto-fires at random (a timeout strike), so an idle opponent can never stall the room:
 * SHIPS_TIMEOUT_STRIKES idle turns in a row forfeit the game.
 */
export const SHIPS_UNTIMED_IDLE_SECONDS = 300;
/** Public battle-log entries kept in state. */
export const SHIPS_LOG_LIMIT = 60;

export const ShipsSettingsSchema = z
  .object({
    gridSize: z.union([z.literal(8), z.literal(10), z.literal(12)]),
    fleet: z.enum(SHIPS_FLEET_IDS),
    spacing: z.enum(SHIPS_SPACING),
    firing: z.enum(SHIPS_FIRING_MODES),
    /** Seconds per turn (0 = untimed). */
    turnSeconds: z
      .number()
      .int()
      .min(0)
      .max(120)
      .refine((v) => v === 0 || v >= 10, { message: 'Turn timer must be off or at least 10 seconds' }),
    onTimeout: z.enum(SHIPS_TIMEOUT_RULES),
    /** Seconds both captains get to deploy their fleets (unplaced vessels are deployed automatically). */
    placementSeconds: z.number().int().min(30).max(300),
  })
  .refine((s) => s.gridSize >= SHIPS_FLEETS[s.fleet].minGrid, {
    message: 'That fleet needs a bigger grid',
    path: ['fleet'],
  });
export type ShipsSettings = z.infer<typeof ShipsSettingsSchema>;

export const DEFAULT_SHIPS_SETTINGS: ShipsSettings = {
  gridSize: 10,
  fleet: 'standard',
  spacing: 'touching',
  firing: 'classic',
  turnSeconds: 45,
  onTimeout: 'autofire',
  placementSeconds: 120,
};

// ---------------------------------------------------------------------------
// Messages & payloads
// ---------------------------------------------------------------------------

export const SHIPS_MSG = {
  /** client → server: save a (partial) draft layout, or lock in a complete one with ready: true. */
  layout: 'ships:layout',
  /** client → server: fire at one square (classic/streak) or a whole salvo. */
  fire: 'ships:fire',
  /** client → server: concede the game. */
  resign: 'ships:resign',
  /** client → server (RESULTS): ask for / withdraw a rematch with the same settings. */
  rematch: 'ships:rematch',
  /** server → one captain: your own fleet (never sent to anybody else). */
  private: 'ships:private',
  /** server → everyone: public animation / sound cues. State stays the source of truth. */
  event: 'ships:event',
} as const;

export const SHIPS_DIRS = ['h', 'v'] as const;
export type ShipsDir = (typeof SHIPS_DIRS)[number];

const Coord = z
  .number()
  .int()
  .min(0)
  .max(SHIPS_MAX_GRID - 1);

export const ShipsPlacementSchema = z.object({
  id: z.enum(VESSEL_IDS),
  /** Bow square (leftmost for 'h', topmost for 'v'). */
  x: Coord,
  y: Coord,
  dir: z.enum(SHIPS_DIRS),
});
export type ShipsPlacement = z.infer<typeof ShipsPlacementSchema>;

export const ShipsLayoutSchema = z.object({
  vessels: z.array(ShipsPlacementSchema).max(SHIPS_MAX_VESSELS),
  ready: z.boolean(),
});
export type ShipsLayoutPayload = z.infer<typeof ShipsLayoutSchema>;

export const ShipsCellSchema = z.object({ x: Coord, y: Coord });
export type ShipsCell = z.infer<typeof ShipsCellSchema>;

export const ShipsFireSchema = z.object({
  cells: z.array(ShipsCellSchema).min(1).max(SHIPS_MAX_VESSELS),
  /** The public turnSeq the client aimed on; stale shots are refused. */
  seq: z.number().int().min(0).max(0xffffffff),
});
export type ShipsFirePayload = z.infer<typeof ShipsFireSchema>;

export const ShipsRematchSchema = z.object({ want: z.boolean() });
export const ShipsEmptySchema = z.object({}).optional();

/** Private payload: only ever sent to the fleet's own captain. */
export interface ShipsPrivatePayload {
  /** Which match this layout belongs to (stale payloads from an earlier game are ignored). */
  matchNo: number;
  playerId: string;
  /** Your placed vessels (draft during deployment, locked once ready). */
  vessels: ShipsPlacement[];
  ready: boolean;
}

export type ShipsShotResult = 'miss' | 'hit' | 'sunk';

export interface ShipsShotView {
  x: number;
  y: number;
  result: ShipsShotResult;
  /** Only set when result === 'sunk' (the vessel's cells are then all hit and public); '' in state otherwise. */
  vessel?: VesselId | '';
}

export type ShipsEndReason = '' | 'fleet_destroyed' | 'resign' | 'forfeit' | 'timeout' | 'abandoned';

export type ShipsEvent =
  | { type: 'ready'; playerId: string; ready: boolean }
  | { type: 'battle'; firstId: string; auto: string[] }
  | {
      type: 'shot';
      seq: number;
      shooterId: string;
      targetId: string;
      shots: ShipsShotView[];
      /** Fired by the server because the turn clock ran out. */
      auto: boolean;
    }
  | { type: 'skip'; playerId: string }
  | { type: 'over'; winnerId: string; loserId: string; reason: ShipsEndReason };

// ---------------------------------------------------------------------------
// Public (synchronized) state as seen by clients (state.toJSON()).
// ---------------------------------------------------------------------------

export type ShipsStage = '' | 'placement' | 'battle' | 'over';

export interface ShipsVesselView {
  id: VesselId;
  x: number;
  y: number;
  dir: ShipsDir;
}

/** One captain's side of the duel. Everything here is public. */
export interface ShipsSideView {
  playerId: string;
  name: string;
  /** Fleet locked in (deployment). */
  ready: boolean;
  /**
   * Shots received on this captain's waters, row-major (index = y * gridSize + x):
   * '.' untouched · 'o' miss · 'x' hit · '#' hit on a vessel that has since sunk.
   */
  board: string;
  vesselsLeft: number;
  /** Shots this captain has fired / how many hit. */
  shots: number;
  hits: number;
  /** Enemy vessels this captain has sunk. */
  sunk: number;
  streak: number;
  bestStreak: number;
  /** Consecutive turn timeouts (SHIPS_TIMEOUT_STRIKES forfeits). */
  timeouts: number;
  /** This captain's vessels that have been sunk (all their squares are already hit). */
  sunkVessels: ShipsVesselView[];
  /** The whole fleet — filled in only once the game is over. */
  revealed: ShipsVesselView[];
}

export interface ShipsLogView {
  seq: number;
  text: string;
  kind: 'info' | 'miss' | 'hit' | 'sunk' | 'turn' | 'end';
}

export interface ShipsPublicState extends BaseRoomView {
  stage: ShipsStage;
  matchNo: number;
  gridSize: number;
  fleet: ShipsFleetId;
  firing: ShipsFiringMode;
  spacing: ShipsSpacing;
  sides: ShipsSideView[];
  /** Captain whose turn it is ('' outside the battle). */
  turnId: string;
  /** Increments every turn (and every streak shot). */
  turnSeq: number;
  turnNumber: number;
  /** Shots the captain to act must fire this turn. */
  shotsAllowed: number;
  /** Server epoch ms when the deployment clock / turn clock runs out (0 = untimed). */
  deadline: number;
  /** Total length of the current clock (for progress rings). */
  clockMs: number;
  /** The most recent volley (highlighted on both boards). */
  lastShots: ShipsShotView[];
  lastShooterId: string;
  winnerId: string;
  endReason: ShipsEndReason;
  log: ShipsLogView[];
  /** Captains asking for a rematch (RESULTS). */
  rematch: string[];
}
