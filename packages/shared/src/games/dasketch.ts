/**
 * DASketch — shared contract (settings, messages, payloads, public state).
 * Imported by the pure engine (@dascade/game-core/dasketch), the server room and the client.
 *
 * Drawing model: the artist streams small, validated *events* against a fixed logical
 * canvas (SKETCH_CANVAS). The server keeps the resolved operation log (brush/eraser strokes,
 * shapes, fills and clears; undo pops the last op) and relays events to everyone else.
 * Late joiners and reconnecting players receive the full log and replay it locally.
 */
import { z } from 'zod';
import type { BaseRoomView } from '../protocol.ts';
import { cleanText, containsProfanity, normalizeForCompare } from '../text.ts';

// ---------------------------------------------------------------------------
// Canvas + drawing limits
// ---------------------------------------------------------------------------

/** Fixed logical canvas every client replays onto (4:3). Coordinates are integers. */
export const SKETCH_CANVAS = { width: 1200, height: 900 } as const;
/** Strokes and shapes may run this far past the edge (they are clipped when rendered). */
export const SKETCH_MARGIN = 64;
/** Paper colour: the eraser paints with it and `clear` resets to it. */
export const SKETCH_PAPER = '#ffffff';

export const SKETCH_LIMITS = {
  /** Draw events per network message. */
  eventsPerMessage: 24,
  /** Points (x,y pairs) per network message. */
  pointsPerMessage: 600,
  /** Points in one brush/eraser stroke. */
  pointsPerStroke: 5000,
  /** Ops created per turn (strokes, shapes, fills, undos, clears). */
  opsPerTurn: 2500,
  /** Points accepted per turn (bounds memory + late-join snapshot size). */
  pointsPerTurn: 60_000,
  /**
   * Flood fills per turn (undo does not refund them). Every fill costs each viewer a
   * full-canvas pixel readback, so this bounds how long a hostile artist can stall clients.
   */
  fillsPerTurn: 150,
  minSize: 1,
  maxSize: 64,
} as const;

export const SKETCH_TOOLS = ['brush', 'eraser', 'fill', 'line', 'rect', 'ellipse'] as const;
export type SketchTool = (typeof SKETCH_TOOLS)[number];
export type SketchOpTool = SketchTool | 'clear';

export const SKETCH_BRUSH_SIZES = [4, 9, 16, 26, 42] as const;

export interface SketchSwatch {
  color: string;
  name: string;
}

/** Drawing palette (two rows of ten). Names are used as accessible labels. */
export const SKETCH_PALETTE: readonly SketchSwatch[] = [
  { color: '#16121f', name: 'Ink black' },
  { color: '#5d5873', name: 'Graphite' },
  { color: '#ff4fd8', name: 'Hot pink' },
  { color: '#ff3b5c', name: 'Red' },
  { color: '#ff8a3d', name: 'Orange' },
  { color: '#ffd23f', name: 'Yellow' },
  { color: '#2de38f', name: 'Green' },
  { color: '#22d3ee', name: 'Cyan' },
  { color: '#3b82f6', name: 'Blue' },
  { color: '#8b5cf6', name: 'Purple' },
  { color: '#ffffff', name: 'White' },
  { color: '#c9c5d8', name: 'Silver' },
  { color: '#ffb3ec', name: 'Bubblegum' },
  { color: '#8a4b24', name: 'Brown' },
  { color: '#f6c9a0', name: 'Peach' },
  { color: '#fff1a1', name: 'Butter' },
  { color: '#11834f', name: 'Forest' },
  { color: '#0e7490', name: 'Teal' },
  { color: '#1e3a8a', name: 'Navy' },
  { color: '#4c1d95', name: 'Grape' },
];

// ---------------------------------------------------------------------------
// Word categories + custom words
// ---------------------------------------------------------------------------

export const SKETCH_CATEGORY_IDS = ['animals', 'food', 'objects', 'office', 'places', 'actions', 'arcade', 'nature'] as const;
export type SketchCategoryId = (typeof SKETCH_CATEGORY_IDS)[number];

export const SKETCH_CATEGORY_LABELS: Record<SketchCategoryId, string> = {
  animals: 'Animals',
  food: 'Food & Drink',
  objects: 'Everyday Objects',
  office: 'Office & Tech',
  places: 'Places',
  actions: 'Actions & Sports',
  arcade: 'Arcade & Games',
  nature: 'Nature & Weather',
};

export const SKETCH_WORD_MAX = 32;
export const SKETCH_CUSTOM_MAX = 400;

/**
 * Cleans one custom word: strips control chars, keeps letters, digits, spaces, hyphens
 * and apostrophes, collapses whitespace and lowercases. Returns '' when unusable
 * (fewer than 2 letters/digits, no letter, or too long).
 */
export function sanitizeSketchWord(raw: unknown): string {
  let word = cleanText(raw, SKETCH_WORD_MAX * 2).toLowerCase();
  word = word.replace(/[’‘`]/gu, "'").replace(/[^\p{L}\p{N}\s'-]+/gu, ' ');
  word = word.replace(/\s+/gu, ' ').replace(/^[\s'-]+|[\s'-]+$/gu, '').trim();
  const alnum = word.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  if (alnum < 2 || !/\p{L}/u.test(word) || Array.from(word).length > SKETCH_WORD_MAX) return '';
  return word;
}

/**
 * Comparison key for words and guesses: case/diacritic-insensitive, ignores spaces and
 * punctuation, and folds compatibility forms (full-width IME letters, ligatures) so
 * "ｃａｔ" is the same guess as "cat".
 */
export function sketchWordKey(text: string): string {
  return normalizeForCompare(text.normalize('NFKC')).replace(/\s+/gu, '');
}

export interface CustomWordReport {
  words: string[];
  /** Entries that could not be used (too short, symbols only, too long). */
  invalid: number;
  duplicates: number;
  /** Entries dropped by the profanity filter. */
  filtered: number;
  /** Entries beyond SKETCH_CUSTOM_MAX. */
  overflow: number;
}

/** Sanitizes, de-duplicates, optionally profanity-filters and caps a custom word list. */
export function cleanCustomWords(input: readonly unknown[], filterProfanity: boolean): CustomWordReport {
  const seen = new Set<string>();
  const words: string[] = [];
  let invalid = 0;
  let duplicates = 0;
  let filtered = 0;
  let overflow = 0;
  for (const raw of input) {
    const word = sanitizeSketchWord(raw);
    if (!word) {
      if (cleanText(raw, 200)) invalid++;
      continue;
    }
    const key = sketchWordKey(word);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    if (filterProfanity && containsProfanity(word)) {
      filtered++;
      continue;
    }
    if (words.length >= SKETCH_CUSTOM_MAX) {
      overflow++;
      continue;
    }
    seen.add(key);
    words.push(word);
  }
  return { words, invalid, duplicates, filtered, overflow };
}

/** Splits a bulk paste into raw entries: newlines, commas, semicolons and tabs all separate words. */
export function splitWordList(text: string): string[] {
  return text
    .split(/[\r\n,;\t]+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const SKETCH_HINT_MODES = ['off', 'slow', 'normal', 'fast'] as const;
export type SketchHintMode = (typeof SKETCH_HINT_MODES)[number];

export const DasketchSettingsSchema = z.object({
  /** Every seated player draws once per round. */
  rounds: z.number().int().min(1).max(10),
  /** Seconds the artist has to draw. */
  drawSeconds: z.number().int().min(30).max(240),
  /** Words offered to the artist. */
  choiceCount: z.number().int().min(1).max(5),
  /** How quickly letters are revealed while drawing. */
  hints: z.enum(SKETCH_HINT_MODES),
  /** Tell guessers privately when they are one or two letters off. */
  closeGuesses: z.boolean(),
  /** Built-in categories in the word pool. */
  categories: z
    .array(z.enum(SKETCH_CATEGORY_IDS))
    .max(SKETCH_CATEGORY_IDS.length)
    .refine((list) => new Set(list).size === list.length, 'Categories must be unique'),
  /** Draw only from the host's custom words. */
  customOnly: z.boolean(),
  /** Leave custom words that trip the profanity filter out of the pool. */
  filterProfanity: z.boolean(),
});
export type DasketchSettings = z.infer<typeof DasketchSettingsSchema>;

export const DEFAULT_DASKETCH_SETTINGS: DasketchSettings = {
  rounds: 3,
  drawSeconds: 80,
  choiceCount: 3,
  hints: 'normal',
  closeGuesses: true,
  categories: [...SKETCH_CATEGORY_IDS],
  customOnly: false,
  filterProfanity: true,
};

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const DASKETCH_MSG = {
  /** client → server: artist picks a word {index}. */
  choose: 'dasketch:choose',
  /** client → server: artist draw events {turn, events}. */
  draw: 'dasketch:draw',
  /** client → server: request a full canvas snapshot. */
  sync: 'dasketch:sync',
  /**
   * client → server (host, lobby): replace the custom word list {words}.
   * server → host only: the stored list + cleaning report (SketchWordsPrivate).
   * Custom words never enter public state, so players cannot read the candidates.
   */
  words: 'dasketch:words',
  /** server → one client: private role/word/choices (SketchPrivate). */
  private: 'dasketch:private',
  /** server → one client (or all at turn start): full canvas snapshot (SketchCanvasSnapshot). */
  canvas: 'dasketch:canvas',
  /** server → everyone except the artist: relayed draw events (SketchStrokeRelay). */
  stroke: 'dasketch:stroke',
  /** server → all: public game events for sound + animation (SketchGameEvent). */
  event: 'dasketch:event',
} as const;

const coord = z.number().int().min(-SKETCH_MARGIN).max(Math.max(SKETCH_CANVAS.width, SKETCH_CANVAS.height) + SKETCH_MARGIN);
const evenPoints = (max: number) =>
  z
    .array(coord)
    .min(2)
    .max(max * 2)
    .refine((pts) => pts.length % 2 === 0, 'Points come in x,y pairs');
export const SketchColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/u);
const sizeSchema = z.number().int().min(SKETCH_LIMITS.minSize).max(SKETCH_LIMITS.maxSize);

export const SketchEventSchema = z.discriminatedUnion('k', [
  /** Begin a freehand stroke (the stroke stays open for `pts`). */
  z.object({ k: z.literal('stroke'), tool: z.enum(['brush', 'eraser']), color: SketchColorSchema, size: sizeSchema, pts: evenPoints(SKETCH_LIMITS.pointsPerMessage) }),
  /** Append points to the open stroke. */
  z.object({ k: z.literal('pts'), pts: evenPoints(SKETCH_LIMITS.pointsPerMessage) }),
  /** A complete straight line / rectangle / ellipse from corner to corner. */
  z.object({
    k: z.literal('shape'),
    tool: z.enum(['line', 'rect', 'ellipse']),
    color: SketchColorSchema,
    size: sizeSchema,
    pts: z.array(coord).length(4),
  }),
  /** Flood fill at a point. */
  z.object({ k: z.literal('fill'), color: SketchColorSchema, pts: z.array(coord).length(2) }),
  z.object({ k: z.literal('undo') }),
  z.object({ k: z.literal('clear') }),
]);
export type SketchEvent = z.infer<typeof SketchEventSchema>;

/**
 * Cheap pre-check (before any per-point validation) that a draw payload stays within
 * SKETCH_LIMITS.pointsPerMessage in total, so oversized messages from anyone are refused
 * without parsing tens of thousands of numbers.
 */
function drawPayloadWithinBudget(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return true;
  const events = (raw as { events?: unknown }).events;
  if (!Array.isArray(events) || events.length > SKETCH_LIMITS.eventsPerMessage) return true;
  let numbers = 0;
  for (const ev of events) {
    const pts = typeof ev === 'object' && ev !== null ? (ev as { pts?: unknown }).pts : undefined;
    if (Array.isArray(pts)) numbers += pts.length;
  }
  return numbers <= SKETCH_LIMITS.pointsPerMessage * 2;
}

export const SketchDrawSchema = z.preprocess(
  (raw) => (drawPayloadWithinBudget(raw) ? raw : null),
  z.object({
    turn: z.number().int().min(0).max(1_000_000),
    events: z.array(SketchEventSchema).min(1).max(SKETCH_LIMITS.eventsPerMessage),
  }),
);
export type SketchDrawPayload = z.infer<typeof SketchDrawSchema>;

export const SketchChooseSchema = z.object({ index: z.number().int().min(0).max(4) });
export const SketchWordsSchema = z.object({ words: z.array(z.string().max(64)).max(SKETCH_CUSTOM_MAX * 2) });
export const SketchSyncSchema = z.object({}).optional();

// ---------------------------------------------------------------------------
// Server → client payloads
// ---------------------------------------------------------------------------

/** One resolved canvas operation. `clear` ops have no points; `fill` has one point and size 0. */
export interface SketchOp {
  id: number;
  tool: SketchOpTool;
  color: string;
  size: number;
  points: number[];
}

export interface SketchBoardSnapshot {
  ops: SketchOp[];
  /** True while the last op is a freehand stroke still accepting points. */
  open: boolean;
  /** Counters used for per-turn limits (so a reconnecting artist validates identically). */
  created: number;
  points: number;
  /** Flood fills applied this turn (never decremented). */
  fills: number;
  nextId: number;
}

export interface SketchCanvasSnapshot extends SketchBoardSnapshot {
  turn: number;
  /** Relay sequence number already included in this snapshot. */
  seq: number;
}

export interface SketchStrokeRelay {
  turn: number;
  /** Increments by one per relayed message within a turn (gap ⇒ request a sync). */
  seq: number;
  events: SketchEvent[];
}

export interface SketchChoice {
  word: string;
  category: SketchCategoryId | 'custom';
}

export type SketchRole = 'artist' | 'guesser' | 'spectator';

/** Host-only copy of the custom word list. */
export interface SketchWordsPrivate {
  /** Sanitized, de-duplicated words as stored (the profanity filter is applied when the pool is built). */
  words: string[];
  /** How the last submission was cleaned. */
  report: Omit<CustomWordReport, 'words'>;
}

/** Private per-player view (re-sent on join/reconnect and whenever it changes). */
export interface SketchPrivate {
  turn: number;
  role: SketchRole;
  /** Word choices (artist, while choosing). */
  choices: SketchChoice[] | null;
  /** The secret word — only for the artist and players who guessed it. */
  word: string | null;
  /** This player guessed the word this turn. */
  guessed: boolean;
}

export type SketchRevealReason = 'time' | 'all' | 'artist_left' | 'empty';

export type SketchGameEvent =
  | { type: 'round'; round: number; totalRounds: number }
  | { type: 'turn'; turn: number; artistId: string }
  | { type: 'drawing'; turn: number; artistId: string }
  | { type: 'hint'; turn: number; hint: string }
  | { type: 'correct'; turn: number; playerId: string; points: number; rank: number; artistPoints: number }
  | { type: 'reveal'; turn: number; word: string; reason: SketchRevealReason };

// ---------------------------------------------------------------------------
// Public state (state.toJSON())
// ---------------------------------------------------------------------------

export type SketchStage = 'idle' | 'choosing' | 'drawing' | 'reveal' | 'final';

export interface SketchPlayerView {
  guessed: boolean;
  /** 1 = first to guess this turn (0 = not guessed). */
  rank: number;
  /** Points gained this turn (guessers and the artist). */
  turnPoints: number;
  /** Milliseconds from the start of drawing to the correct guess. */
  guessMs: number;
}

export interface SketchTurnRecord {
  turn: number;
  round: number;
  artistId: string;
  artistName: string;
  word: string;
  guessers: number;
  eligible: number;
  reason: SketchRevealReason;
}

export type SketchAwardId = 'fastest' | 'artist' | 'sharp';

export interface SketchAward {
  id: SketchAwardId;
  playerId: string;
  name: string;
  /** Human-readable stat, e.g. "2.4s" or "7 guessers". */
  value: string;
}

export interface DasketchPublicState extends BaseRoomView {
  stage: SketchStage;
  artistId: string;
  /** Global turn counter (1-based). */
  turn: number;
  turnInRound: number;
  turnsInRound: number;
  totalRounds: number;
  /** Masked word: '_' = hidden letter, ' ' = word gap, other characters as-is. Empty until drawing. */
  hint: string;
  /** The word, revealed publicly only after the turn ends. */
  word: string;
  revealReason: SketchRevealReason | '';
  /** Server epoch ms when drawing started. */
  turnStartedAt: number;
  drawMs: number;
  /** Points the artist gained this turn. */
  artistPoints: number;
  guessedCount: number;
  /** Players who could guess when drawing began. */
  eligibleCount: number;
  sketch: Record<string, SketchPlayerView>;
  /** JSON SketchTurnRecord[] of finished turns. */
  historyJson: string;
  /** JSON SketchAward[] (set at RESULTS). */
  awardsJson: string;
  /** Usable custom words (after the profanity filter). The words themselves stay private to the host. */
  customCount: number;
  /** Custom words currently excluded by the profanity filter. */
  customFiltered: number;
}

/** Word pattern helpers shared by server + client. */
export function isHintLetter(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}
