/**
 * DAS Reversi — shared contract (variants, settings, messages, payloads, public state).
 *
 * Ten variants of the disc-flipping game on the DAS Boardroom kit (see ./boardroom.ts): side
 * 'first' is Black and moves first, 'second' is White. The lobby picks the variant; a game keeps
 * it until it ends (rematches replay it). Nothing is hidden, so the whole game lives in synchronized
 * state; the server validates every move with the pure engine in @dascade/game-core/reversi and
 * decides the random setups (Blockers' squares, Random Start's opening) with its own RNG.
 *
 * Cells are numbered row by row from the top-left (0 = a1). Columns are lettered a, b, c… left to
 * right and rows numbered 1, 2, 3… top to bottom, as on a printed Reversi diagram.
 */
import { z } from 'zod';
import { BOARD_SETTINGS_SHAPE, DEFAULT_BOARD_SETTINGS, boardMsg, type BoardRoomView, type BoardSide } from './boardroom.ts';

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export const REVERSI_VARIANTS = [
  'classic',
  'original',
  'parallel',
  'mini',
  'grand',
  'octagon',
  'torus',
  'anti',
  'blockers',
  'random',
] as const;
export type ReversiVariant = (typeof REVERSI_VARIANTS)[number];

export function isReversiVariant(value: unknown): value is ReversiVariant {
  return typeof value === 'string' && (REVERSI_VARIANTS as readonly string[]).includes(value);
}

export function reversiVariantOf(settings: { variant?: unknown } | null | undefined): ReversiVariant {
  return isReversiVariant(settings?.variant) ? settings.variant : 'classic';
}

/** Only Classic changes DASCADE ratings (in rated rooms and tournaments). */
export function isRatedReversiVariant(variant: ReversiVariant): boolean {
  return variant === 'classic';
}

export type ReversiFamily = 'classic' | 'boards' | 'twist';

export const REVERSI_FAMILIES: ReadonlyArray<{ id: ReversiFamily; label: string }> = [
  { id: 'classic', label: 'Classics' },
  { id: 'boards', label: 'Boards' },
  { id: 'twist', label: 'Twists' },
];

/**
 * The first position: 'diagonal' = the usual crosswise centre, 'parallel' = each colour side by
 * side, 'empty' = no discs (the first four go on the centre squares), 'random' = a few random
 * opening moves played from the diagonal start.
 */
export type ReversiStart = 'diagonal' | 'parallel' | 'empty' | 'random';

/** Squares out of play: 'corners' = three at each corner (Octagon), 'random' = Blockers' four. */
export type ReversiHoles = 'none' | 'corners' | 'random';

export interface ReversiVariantInfo {
  id: ReversiVariant;
  title: string;
  /** One line for the variant picker. */
  tagline: string;
  family: ReversiFamily;
  /** Board edge (squares per side). */
  size: number;
  start: ReversiStart;
  holes: ReversiHoles;
  /** Lines wrap around the edges (a torus). */
  wrap: boolean;
  /** 'most' discs wins, or 'fewest' (Anti). */
  goal: 'most' | 'fewest';
  /** Discs each player may place (0 = as many as the board takes). */
  supply: number;
  /** Rules, short sentences for the lobby card and the in-game help. */
  rules: readonly string[];
  /** One strategy tip. */
  tip: string;
}

const MOVE_RULES = [
  'Black moves first. Place a disc so a line of your opponent’s discs — across, down or diagonal — is trapped between it and one of yours.',
  'Every trapped disc flips to your colour. A move must flip at least one disc.',
] as const;
const PASS_RULE = 'No move? Your turn is skipped. When neither player can move, the most discs wins.';
const CORNER_TIP = 'Corners can never be flipped — they are worth fighting for, and the squares next to them are risky.';

export const REVERSI_VARIANT_INFO: Record<ReversiVariant, ReversiVariantInfo> = {
  classic: {
    id: 'classic',
    title: 'Classic',
    tagline: 'Outflank and flip on the 8×8 board. Most discs wins.',
    family: 'classic',
    size: 8,
    start: 'diagonal',
    holes: 'none',
    wrap: false,
    goal: 'most',
    supply: 0,
    rules: [...MOVE_RULES, PASS_RULE],
    tip: CORNER_TIP,
  },
  original: {
    id: 'original',
    title: 'Original',
    tagline: 'The 1880s rules: an empty board, a free opening and 32 discs each.',
    family: 'classic',
    size: 8,
    start: 'empty',
    holes: 'none',
    wrap: false,
    goal: 'most',
    supply: 32,
    rules: [
      'The board starts empty. The first four discs — two each, Black first — go on the four centre squares in any arrangement, and flip nothing.',
      'From then on, classic rules: trap a line of your opponent’s discs and flip them. A move must flip at least one disc.',
      'Each player has 32 discs. Run out and you can’t move any more — your opponent plays on alone.',
      PASS_RULE,
    ],
    tip: 'Choose your opening shape: a crosswise centre plays like the classic game, a side-by-side one changes everything.',
  },
  parallel: {
    id: 'parallel',
    title: 'Parallel Start',
    tagline: 'Classic rules from the side-by-side opening.',
    family: 'classic',
    size: 8,
    start: 'parallel',
    holes: 'none',
    wrap: false,
    goal: 'most',
    supply: 0,
    rules: [
      'Classic rules from a different first position: each colour starts with two discs side by side instead of crosswise.',
      ...MOVE_RULES.slice(1),
      PASS_RULE,
    ],
    tip: CORNER_TIP,
  },
  mini: {
    id: 'mini',
    title: 'Mini 6×6',
    tagline: 'A quick game on a 6×6 board.',
    family: 'boards',
    size: 6,
    start: 'diagonal',
    holes: 'none',
    wrap: false,
    goal: 'most',
    supply: 0,
    rules: ['Classic rules on a small 6×6 board — 36 squares, a game in a few minutes.', ...MOVE_RULES, PASS_RULE],
    tip: 'With perfect play White wins the 6×6 game — Black has to make the most of every mistake.',
  },
  grand: {
    id: 'grand',
    title: 'Grand 10×10',
    tagline: 'A long game on a 10×10 board.',
    family: 'boards',
    size: 10,
    start: 'diagonal',
    holes: 'none',
    wrap: false,
    goal: 'most',
    supply: 0,
    rules: ['Classic rules on a big 10×10 board — 100 squares and a long middle game.', ...MOVE_RULES, PASS_RULE],
    tip: CORNER_TIP,
  },
  octagon: {
    id: 'octagon',
    title: 'Octagon',
    tagline: 'The corners are cut off — there are no safe corners to grab.',
    family: 'boards',
    size: 8,
    start: 'diagonal',
    holes: 'corners',
    wrap: false,
    goal: 'most',
    supply: 0,
    rules: [
      'The board is an octagon: three squares at each corner are out of play.',
      'Discs can’t trap across a missing square — a line ends there.',
      ...MOVE_RULES,
      PASS_RULE,
    ],
    tip: 'Without corners, the edges are where discs become hard to flip.',
  },
  torus: {
    id: 'torus',
    title: 'Wraparound',
    tagline: 'The edges wrap around: no corners, no edges, nowhere to hide.',
    family: 'boards',
    size: 8,
    start: 'diagonal',
    holes: 'none',
    wrap: true,
    goal: 'most',
    supply: 0,
    rules: [
      'Lines wrap around the board: a line leaving one edge comes back in on the opposite edge.',
      'So there are no corners and no edges — every disc can be flipped.',
      ...MOVE_RULES,
      PASS_RULE,
    ],
    tip: 'Count the lines that wrap past the edge before you move — threats come from both sides.',
  },
  anti: {
    id: 'anti',
    title: 'Anti',
    tagline: 'Fewest discs wins. Flip as little as you can.',
    family: 'twist',
    size: 8,
    start: 'diagonal',
    holes: 'none',
    wrap: false,
    goal: 'fewest',
    supply: 0,
    rules: [...MOVE_RULES, 'No move? Your turn is skipped.', 'The goal is reversed: when neither player can move, the FEWEST discs wins.'],
    tip: 'Corners are traps here — a disc there can never be flipped away.',
  },
  blockers: {
    id: 'blockers',
    title: 'Blockers',
    tagline: 'Four squares are blocked at random each game.',
    family: 'twist',
    size: 8,
    start: 'diagonal',
    holes: 'random',
    wrap: false,
    goal: 'most',
    supply: 0,
    rules: [
      'Four squares are blocked when the game starts — two random squares and their mirror images across the centre.',
      'Nobody can play on a blocked square, and lines can’t pass through one.',
      ...MOVE_RULES,
      PASS_RULE,
    ],
    tip: 'A square next to a block is almost as safe as a corner.',
  },
  random: {
    id: 'random',
    title: 'Random Start',
    tagline: 'Begins from a random, already-played opening.',
    family: 'twist',
    size: 8,
    start: 'random',
    holes: 'none',
    wrap: false,
    goal: 'most',
    supply: 0,
    rules: [
      'The game begins from a random opening: four moves, two each, are played for you.',
      'Then Black moves and classic rules apply: trap a line of your opponent’s discs to flip them.',
      PASS_RULE,
    ],
    tip: 'No book openings here — read the position fresh every game.',
  },
};

/** Squares on the variant's board (the board string length). */
export function reversiCellCount(variant: ReversiVariant): number {
  const size = REVERSI_VARIANT_INFO[variant].size;
  return size * size;
}

/** The biggest board (Grand, 10×10). */
export const REVERSI_MAX_CELLS = 100;
/** Squares Blockers blocks. */
export const REVERSI_BLOCKERS = 4;
/** Opening moves Random Start plays for the players. */
export const REVERSI_RANDOM_PLIES = 4;

/** Board string characters. */
export const REVERSI_CELL = { empty: '.', black: 'b', white: 'w', hole: '#' } as const;

/** Black is the first side, White the second. */
export const REVERSI_SIDE_LABEL: Record<BoardSide, string> = { first: 'Black', second: 'White' };
export const REVERSI_SIDE_LABELS = ['Black', 'White'] as const;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const ReversiSettingsSchema = z.object({
  ...BOARD_SETTINGS_SHAPE,
  variant: z.enum(REVERSI_VARIANTS).default('classic'),
});
export type ReversiSettings = z.infer<typeof ReversiSettingsSchema>;

export const DEFAULT_REVERSI_SETTINGS: ReversiSettings = {
  ...DEFAULT_BOARD_SETTINGS,
  timeControl: { baseMinutes: 10, incrementSeconds: 0 },
  variant: 'classic',
};

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const REVERSI_MSG = {
  /** client → server: ReversiMovePayload — place a disc. */
  move: 'reversi:move',
  /** server → everyone: ReversiMoveEvent (flip animation + sound cue). */
  moved: 'reversi:moved',
  resign: boardMsg('reversi', 'resign'),
  draw: boardMsg('reversi', 'draw'),
  undo: boardMsg('reversi', 'undo'),
  rematch: boardMsg('reversi', 'rematch'),
  event: boardMsg('reversi', 'event'),
} as const;

/** A move: the square to place a disc on. Passes are automatic (the server plays them). */
export const ReversiMoveSchema = z
  .object({
    cell: z
      .number()
      .int()
      .min(0)
      .max(REVERSI_MAX_CELLS - 1),
    /** The ply the client saw when it chose the move (stale or duplicate submissions are ignored). */
    ply: z.number().int().min(0).max(100_000),
  })
  .strict();
export type ReversiMovePayload = z.infer<typeof ReversiMoveSchema>;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** End reasons of the rules (the kit adds resign, timeout, agreement…). */
export const REVERSI_REASONS = {
  /** Neither player can move: the disc count decides (most, or fewest in Anti). */
  discs: 'discs',
  /** Draw: neither player can move and the counts are equal. */
  tie: 'tie',
} as const;

// ---------------------------------------------------------------------------
// Public state
// ---------------------------------------------------------------------------

export interface ReversiMoveEvent {
  /** Ply number after the move (and the automatic pass, if one followed). */
  ply: number;
  side: BoardSide;
  notation: string;
  cell: number;
  /** Discs that flipped, nearest first along each line. */
  flips: number[];
  /** The side whose turn was skipped right after this move ('' = none). */
  passed: BoardSide | '';
}

export interface ReversiHistoryEntry {
  /** "d3", or "pass" for a skipped turn. */
  notation: string;
}

export interface ReversiPublicState extends BoardRoomView {
  variant: ReversiVariant;
  /** Board edge (6, 8 or 10). */
  size: number;
  /** size² characters, row by row from the top-left: '.' empty, 'b' Black, 'w' White, '#' out of play. */
  board: string;
  /** The last disc placed (-1 = none yet). */
  lastCell: number;
  /** Discs flipped by the last move. */
  lastFlips: number[];
  /** The side whose turn was skipped after the last move ('' = none). */
  lastPassed: string;
  /** Original: discs left to place, [Black, White] ([] in the other variants). */
  supply: number[];
  history: ReversiHistoryEntry[];
}
