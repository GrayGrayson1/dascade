/**
 * DAS Putt — shared contract (server + client).
 *
 * Networking model (see apps/game-server/src/rooms/putt and apps/web/src/games/putt):
 *  - Clients only send a stroke INTENT (`putt:stroke`: quantized angle + power + the hole-clock
 *    moment they released). The server simulates the whole roll with the deterministic engine in
 *    `@dascade/game-core/putt`, applies penalties / stroke limits, and broadcasts the result path
 *    (`putt:shot`) that every client animates in sync on the shared server clock.
 *  - Low-rate match state (hole, turn, lies, strokes, scorecards) lives in the Colyseus schema. The
 *    outcome of a roll (lie, holed, penalty) is published when the ball comes to rest, so the
 *    scoreboard never spoils a putt that is still rolling on screen.
 *  - Golf has no hidden information: nothing is private, so there is no `putt:private` channel.
 */
import { z } from 'zod';
import type { BaseRoomView } from '../protocol.ts';
import type { RateSpec } from '../rateLimit.ts';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const PUTT_MODES = ['turns', 'ghost'] as const;
export type PuttMode = (typeof PUTT_MODES)[number];

/** Which holes a match plays: all nine, the gentle opening three, the wild closing three, or one hole. */
export const PUTT_COURSES = ['full', 'front', 'back', 'single'] as const;
export type PuttCourse = (typeof PUTT_COURSES)[number];

export const PUTT_HOLE_COUNT = 9;
export const PUTT_SHOT_CLOCKS = [20, 30, 45, 60] as const;

export const PuttSettingsSchema = z.object({
  /** 'turns' = classic stroke play, one putt at a time · 'ghost' = party mode, everyone putts at once (balls never collide). */
  mode: z.enum(PUTT_MODES),
  course: z.enum(PUTT_COURSES),
  /** 1-based hole used when `course === 'single'` (practice a hole). */
  hole: z.number().int().min(1).max(PUTT_HOLE_COUNT),
  /** Seconds a player has to putt once their turn starts (never disabled in multiplayer, so nobody stalls the room). */
  shotClock: z.number().int().min(10).max(90),
  /** Stroke limit per hole = par + maxOverPar. Reaching it picks the ball up with that score. */
  maxOverPar: z.number().int().min(2).max(6),
});
export type PuttSettings = z.infer<typeof PuttSettingsSchema>;

export const DEFAULT_PUTT_SETTINGS: PuttSettings = {
  mode: 'turns',
  course: 'full',
  hole: 1,
  shotClock: 30,
  maxOverPar: 4,
};

/** The fixed match format for Tournament Center matches (lobby settings never change it). */
export const PUTT_TOURNAMENT_SETTINGS: PuttSettings = {
  mode: 'turns',
  course: 'full',
  hole: 1,
  shotClock: 45,
  maxOverPar: 4,
};

/** Holes (1-based) played for a course selection. */
export function puttRoute(settings: Pick<PuttSettings, 'course' | 'hole'>): number[] {
  switch (settings.course) {
    case 'front':
      return [1, 2, 3];
    case 'back':
      return [7, 8, 9];
    case 'single':
      return [Math.min(PUTT_HOLE_COUNT, Math.max(1, Math.round(settings.hole)))];
    default:
      return [1, 2, 3, 4, 5, 6, 7, 8, 9];
  }
}

/** Sudden-death playoff holes for a tied Tournament Center match (then the match is reported drawn). */
export const PUTT_PLAYOFF_HOLES = [9, 6, 1] as const;

// ---------------------------------------------------------------------------
// Stroke intents
// ---------------------------------------------------------------------------

/** Angles travel as integer hundredths of a degree: 0 = +x (east), 9000 = +y (south, screen down). */
export const PUTT_ANGLE_UNITS = 36_000;
/** Power travels as an integer per-mille. Below the minimum the client cancels the stroke. */
export const PUTT_POWER_MIN = 15;
export const PUTT_POWER_MAX = 1000;
/**
 * The ball leaves the club this long after the release (server clock), so every client can start
 * the roll in sync and moving obstacles are exactly where the shooter saw them, offset by a constant.
 */
export const PUTT_LAUNCH_DELAY_MS = 150;
/** How far in the past (ms) a client's reported release moment may be before it is ignored. */
export const PUTT_RELEASE_WINDOW_MS = 400;

export const PuttStrokeSchema = z.object({
  angle: z.number().int().min(0).max(PUTT_ANGLE_UNITS - 1),
  power: z.number().int().min(PUTT_POWER_MIN).max(PUTT_POWER_MAX),
  /** Server epoch ms of the release as the client saw it (lag compensation; clamped server-side). */
  at: z.number().finite().min(0).max(1e14).optional(),
});
export type PuttStroke = z.infer<typeof PuttStrokeSchema>;

/** Live aim of the active player (relayed to everyone else, throttled). */
export const PuttAimSchema = z.object({
  angle: z.number().int().min(0).max(PUTT_ANGLE_UNITS - 1),
  power: z.number().int().min(0).max(PUTT_POWER_MAX),
});
export type PuttAim = z.infer<typeof PuttAimSchema>;

export const PUTT_STROKE_RATE: RateSpec = { burst: 4, perSecond: 2 };
export const PUTT_AIM_RATE: RateSpec = { burst: 20, perSecond: 15 };

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const PUTT_MSG = {
  /** client → server: PuttStroke (PLAYING, your ball at rest, your turn in turn mode). */
  stroke: 'putt:stroke',
  /** client → server: PuttAim (silent, throttled) · server → others: PuttAimRelay. */
  aim: 'putt:aim',
  /** client → server: pick your ball up (take the stroke limit for this hole). */
  pickup: 'putt:pickup',
  /** client → server (host, RESULTS): play the same course again right away. */
  rematch: 'putt:rematch',
  /** server → all: PuttShotView — the simulated roll to animate. */
  shot: 'putt:shot',
  /** server → all: PuttEvent (hole outs, penalties, timeouts, hole/turn changes). */
  event: 'putt:event',
  /** server → one (join/reconnect): PuttShotView[] still rolling, so a late client can pick up the animation. */
  replay: 'putt:replay',
} as const;

export interface PuttAimRelay {
  playerId: string;
  angle: number;
  power: number;
}

/** Ball-path event kinds (see PuttShotView.events). */
export const PUTT_PATH_EVENTS = ['wall', 'post', 'bumper', 'blade', 'portal', 'sand', 'lip', 'cup', 'water', 'oob'] as const;
export type PuttPathEventKind = (typeof PUTT_PATH_EVENTS)[number];

/**
 * One event along a roll: [tick, kindIndex, x×10, y×10, strength].
 * `tick` is the 120 Hz simulation tick, `kindIndex` indexes PUTT_PATH_EVENTS, `strength` is the
 * impact speed (walls / posts / bumpers / blades) or the object index (bumper, portal).
 */
export type PuttPathEvent = [number, number, number, number, number];

export type PuttShotResult = 'rest' | 'cup' | 'water' | 'oob';

export interface PuttShotView {
  /** Room-wide shot sequence number. */
  seq: number;
  playerId: string;
  /** Index into the match route (0-based) and the 1-based hole number. */
  holeIndex: number;
  hole: number;
  angle: number;
  power: number;
  from: [number, number];
  /** Server epoch ms when the ball starts rolling. */
  startedAt: number;
  /** Hole-clock ms (moving obstacles) at the first simulated tick. */
  obstacleMs: number;
  /** Positions every PUTT_PATH_SAMPLE ticks, in 0.1 units, delta-encoded: [x0, y0, dx1, dy1, …]. */
  path: number[];
  events: PuttPathEvent[];
  /** Simulated length (ticks at 120 Hz). */
  ticks: number;
  durationMs: number;
  result: PuttShotResult;
  /** Where the ball rests afterwards (the previous lie after a penalty; the cup when holed). */
  lie: [number, number];
  /** Strokes on this hole after this shot (includes any penalty stroke). */
  strokes: number;
  penalty: number;
  holed: boolean;
  /** Hit the stroke limit and was picked up. */
  pickedUp: boolean;
}

export const PUTT_TICK_HZ = 120;
export const PUTT_PATH_SAMPLE = 2;

export type PuttEvent =
  | { kind: 'hole-start'; holeIndex: number; hole: number; playoff: boolean }
  | { kind: 'turn'; playerId: string }
  | { kind: 'holed'; playerId: string; hole: number; strokes: number; par: number; label: string }
  | { kind: 'penalty'; playerId: string; reason: 'water' | 'oob'; strokes: number }
  | { kind: 'timeout'; playerId: string; strokes: number }
  | { kind: 'pickup'; playerId: string; strokes: number; reason: 'limit' | 'conceded' | 'timeouts' | 'away' }
  | { kind: 'hole-end'; holeIndex: number; hole: number }
  | { kind: 'playoff'; hole: number; playerIds: string[] };

// ---------------------------------------------------------------------------
// Public (synchronized) state shapes, as seen by clients after toJSON()
// ---------------------------------------------------------------------------

export type PuttHoleStatus = 'idle' | 'intro' | 'play' | 'done';

export interface GolferView {
  name: string;
  color: string;
  /** Play order this hole (0 = first). */
  order: number;
  /** Ball lie (world units) — updated when the ball comes to rest. */
  x: number;
  y: number;
  /** Strokes on the current hole (including penalties). */
  strokes: number;
  holed: boolean;
  pickedUp: boolean;
  /** Left the match for good (their card is closed). */
  retired: boolean;
  /** A roll is being animated. */
  moving: boolean;
  /** Server epoch ms when this golfer's shot clock runs out (0 = not on the clock). */
  deadline: number;
  /** Per-route-hole scores (0 = not finished yet). */
  card: number[];
  /** Sum of finished holes. */
  total: number;
  /** Sum of par over finished holes (total - parPlayed = to par). */
  parPlayed: number;
  holesInOne: number;
  lastSeq: number;
}

export interface PuttPublicState extends BaseRoomView {
  golfers: Record<string, GolferView>;
  mode: PuttMode;
  /** Holes (1-based) of this match in order (playoff holes are appended). */
  route: number[];
  holeIndex: number;
  holeStatus: PuttHoleStatus;
  /** Server epoch ms of the hole clock's zero (moving obstacles). */
  holeStartedAt: number;
  /** Server epoch ms when the hole intro ends and putting opens. */
  introEndsAt: number;
  /** Whose turn it is in turn mode ('' otherwise). */
  turnId: string;
  shotSeq: number;
  /** Number of regulation holes (playoff holes come after). */
  regulation: number;
  /** Stroke limit over par for this match. */
  maxOverPar: number;
  shotClock: number;
  solo: boolean;
  tournament: boolean;
  /** Ids in a sudden-death playoff (empty otherwise). */
  playoffIds: string[];
  /** Player ids that won (set on the RESULTS screen). */
  winners: string[];
}

// ---------------------------------------------------------------------------
// Presentation helpers (shared so server chat/system lines and the client agree)
// ---------------------------------------------------------------------------

/** Golf name of a hole score relative to par. */
export function puttScoreLabel(strokes: number, par: number): string {
  if (strokes <= 0) return '—';
  if (strokes === 1) return 'Hole in one!';
  const d = strokes - par;
  if (d <= -3) return 'Albatross';
  if (d === -2) return 'Eagle';
  if (d === -1) return 'Birdie';
  if (d === 0) return 'Par';
  if (d === 1) return 'Bogey';
  if (d === 2) return 'Double bogey';
  if (d === 3) return 'Triple bogey';
  return `+${d}`;
}

/** "E", "+3", "-2" (uses a real minus sign). */
export function formatToPar(diff: number): string {
  if (diff === 0) return 'E';
  return diff > 0 ? `+${diff}` : `−${Math.abs(diff)}`;
}

/** Local-storage document key for solo personal bests. */
export const PUTT_BEST_DOC = 'putt-best';
export interface PuttBestDoc {
  /** Best full-course total. */
  full?: number;
  /** Best score per hole number (1-based key). */
  holes: Record<string, number>;
  savedAt: number;
}
