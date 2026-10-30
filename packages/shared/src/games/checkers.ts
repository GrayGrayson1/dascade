/**
 * DAS Checkers — shared contract (variants, settings, messages, payloads, public state).
 *
 * Twelve draughts variants on the DAS Boardroom kit (see ./boardroom.ts): American checkers (the
 * default, the only rated one) plus the world's major federation rule sets on 8×8, 10×10 and 12×12
 * boards and three "twist" goals. Side 'first' plays the colour that moves first in the variant
 * (Dark in American, Giveaway and Pool; Light everywhere else). Nothing in checkers is hidden, so
 * the whole game lives in synchronized state; the server validates every move with the pure
 * engines in @dascade/game-core/checkers.
 *
 * Squares use standard PDN numbering for the board size: the top-left square is light, the dark
 * squares are numbered row by row from the top (Dark's side), 1–32 on 8×8, 1–50 on 10×10, 1–72 on
 * 12×12. Moves travel as a path of squares: [11, 15] for "11-15", [15, 22, 29] for the double jump
 * "15x22x29". The client may also send the unambiguous from→to shortcut of a multi-jump ([15, 29]);
 * the server resolves or rejects it.
 */
import { z } from 'zod';
import { BOARD_SETTINGS_SHAPE, DEFAULT_BOARD_SETTINGS, boardMsg, type BoardRoomView, type BoardSide } from './boardroom.ts';

/** A capture chain takes at most 12 pieces, so an American path has at most 13 squares. */
export const CHECKERS_MAX_PATH = 13;
/** Longest path any variant can send (a 12×12 board holds 30 pieces a side). */
export const CHECKERS_MAX_VARIANT_PATH = 31;
/** Highest square number of any variant (12×12). */
export const CHECKERS_MAX_SQUARE = 72;

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export const CHECKERS_VARIANTS = [
  'american',
  'giveaway',
  'russian',
  'pool',
  'brazilian',
  'italian',
  'spanish',
  'czech',
  'international',
  'antidraughts',
  'breakthrough',
  'canadian',
] as const;
export type CheckersVariant = (typeof CHECKERS_VARIANTS)[number];

export function isCheckersVariant(value: unknown): value is CheckersVariant {
  return typeof value === 'string' && (CHECKERS_VARIANTS as readonly string[]).includes(value);
}

export type CheckersFamily = 'classic' | 'big' | 'twist';

export const CHECKERS_FAMILIES: ReadonlyArray<{ id: CheckersFamily; label: string }> = [
  { id: 'classic', label: '8×8 classics' },
  { id: 'big', label: 'Big boards' },
  { id: 'twist', label: 'Twists' },
];

export interface CheckersVariantInfo {
  id: CheckersVariant;
  title: string;
  /** One line for the variant picker. */
  tagline: string;
  family: CheckersFamily;
  /** Board edge in squares (8, 10 or 12). */
  size: 8 | 10 | 12;
  /** Men per side at the start. */
  pieces: number;
  /** The colour that moves first (kit side 'first'). */
  first: CheckersColor;
  /** Short rule summary (lobby rules card, in-game help). */
  rules: readonly string[];
}

const LIGHT_FIRST = 'Light moves first.';
const DARK_FIRST = 'Dark moves first.';

export const CHECKERS_VARIANT_INFO: Record<CheckersVariant, CheckersVariantInfo> = {
  american: {
    id: 'american',
    title: 'American',
    tagline: 'Classic checkers. Kings step one square; any capture will do.',
    family: 'classic',
    size: 8,
    pieces: 12,
    first: 'dark',
    rules: [
      `${DARK_FIRST} Men move one square diagonally forward; kings move one square in any diagonal direction.`,
      'Captures are mandatory — you choose which one. A multi-jump must be finished with the same piece.',
      'Men capture forward only. A man reaching the far row is crowned and the move ends there.',
      'Win by taking every enemy piece or leaving your opponent without a legal move.',
      'Automatic draws: the same position three times, or 40 moves each without a capture or a man move.',
    ],
  },
  giveaway: {
    id: 'giveaway',
    title: 'Giveaway',
    tagline: 'American rules, upside down: lose every piece to win.',
    family: 'twist',
    size: 8,
    pieces: 12,
    first: 'dark',
    rules: [
      `${DARK_FIRST} Pieces move and capture exactly as in American checkers — captures are still mandatory.`,
      'You WIN when you have no pieces left, or none of your pieces can move.',
      'Force your opponent to take your pieces; dodge their offers.',
      'Automatic draws: the same position three times, or 40 moves each without a capture or a man move.',
    ],
  },
  russian: {
    id: 'russian',
    title: 'Russian',
    tagline: 'Shashki: flying kings, men capture backwards, free choice.',
    family: 'classic',
    size: 8,
    pieces: 12,
    first: 'light',
    rules: [
      `${LIGHT_FIRST} Men move one square forward but capture forwards and backwards.`,
      'Kings fly: they move and capture along a whole diagonal and land on any free square beyond the captured piece.',
      'Captures are mandatory and you may choose any of them, but a capture must be completed — a king must land where it can keep capturing.',
      'A man reaching the far row mid-capture is crowned at once and keeps capturing as a king.',
      'Jumped pieces stay on the board until the move ends and can’t be jumped twice.',
      'Draws: threefold repetition, 15 king moves each without a capture or man move, three or more kings against a lone king that isn’t caught in 15 moves, 2 pieces or fewer against a lone king after 5 moves, and long king endings (30 / 60 moves).',
    ],
  },
  pool: {
    id: 'pool',
    title: 'Pool',
    tagline: 'American pool checkers: flying kings, backward captures, your choice.',
    family: 'classic',
    size: 8,
    pieces: 12,
    first: 'dark',
    rules: [
      `${DARK_FIRST} Men move one square forward but capture forwards and backwards.`,
      'Kings fly: they move and capture along a whole diagonal and land on any free square beyond the captured piece.',
      'Captures are mandatory and you may choose any of them, but a capture must be completed.',
      'No promotion mid-capture: a man passing the far row keeps capturing as a man and is crowned only if it ends there.',
      'Jumped pieces stay on the board until the move ends and can’t be jumped twice.',
      'Draws: threefold repetition, 15 king moves each without a capture or man move, three or more kings against a lone king that isn’t caught in 15 moves, 2 pieces or fewer against a lone king after 5 moves, and long king endings (30 / 60 moves).',
    ],
  },
  brazilian: {
    id: 'brazilian',
    title: 'Brazilian',
    tagline: 'International rules on 8×8: you must take the most pieces.',
    family: 'classic',
    size: 8,
    pieces: 12,
    first: 'light',
    rules: [
      `${LIGHT_FIRST} Men move one square forward but capture forwards and backwards.`,
      'Kings fly: they move and capture along a whole diagonal and land on any free square beyond the captured piece.',
      'Maximum capture: you must play the sequence that takes the most pieces (kings and men count the same).',
      'A man is crowned only if it ends its move on the far row — passing through mid-capture doesn’t count.',
      'Jumped pieces stay on the board until the move ends and can’t be jumped twice.',
      'Draws: threefold repetition, 15 king moves each without a capture or man move, three or more kings against a lone king that isn’t caught in 15 moves, 2 pieces or fewer against a lone king after 5 moves, and long king endings (30 / 60 moves).',
    ],
  },
  italian: {
    id: 'italian',
    title: 'Italian',
    tagline: 'Dama: men can’t take kings; the strongest capture is forced.',
    family: 'classic',
    size: 8,
    pieces: 12,
    first: 'light',
    rules: [
      `${LIGHT_FIRST} Men move and capture forward only; kings move one square in any diagonal direction.`,
      'Men can never capture a king.',
      'Captures are mandatory, chosen in this order: take the most pieces; then capture with a king rather than a man; then take the most kings; then take a king as early as possible.',
      'A man reaching the far row is crowned and the move ends there.',
      'Automatic draws: the same position three times, or 40 moves each without a capture or a man move.',
      'Played on the international board orientation — a mirror image of the traditional Italian board, so every line plays the same.',
    ],
  },
  spanish: {
    id: 'spanish',
    title: 'Spanish',
    tagline: 'Damas: flying kings, forward-only men, most pieces then most kings.',
    family: 'classic',
    size: 8,
    pieces: 12,
    first: 'light',
    rules: [
      `${LIGHT_FIRST} Men move and capture forward only.`,
      'Kings fly: they move and capture along a whole diagonal and land on any free square beyond the captured piece.',
      'Captures are mandatory: take the most pieces; if that ties, take the most kings.',
      'A man reaching the far row is crowned and the move ends there.',
      'Jumped pieces stay on the board until the move ends and can’t be jumped twice.',
      'Draws: threefold repetition, 20 moves each without a capture or a man move, or three or more kings against a lone king that isn’t caught in 13 moves.',
      'Played on the international board orientation — a mirror image of the traditional Spanish board, so every line plays the same.',
    ],
  },
  czech: {
    id: 'czech',
    title: 'Czech',
    tagline: 'Česká dáma: flying kings, and a king must do the capturing.',
    family: 'classic',
    size: 8,
    pieces: 12,
    first: 'light',
    rules: [
      `${LIGHT_FIRST} Men move and capture forward only.`,
      'Kings fly: they move and capture along a whole diagonal and land on any free square beyond the captured piece.',
      'Captures are mandatory. If a king can capture, a king must capture; otherwise choose any capture. A capture must be completed.',
      'A man reaching the far row is crowned and the move ends there.',
      'Jumped pieces stay on the board until the move ends and can’t be jumped twice.',
      'Automatic draws: the same position three times, or 40 moves each without a capture or a man move.',
    ],
  },
  international: {
    id: 'international',
    title: 'International',
    tagline: 'The world championship game: 10×10, flying kings, maximum capture.',
    family: 'big',
    size: 10,
    pieces: 20,
    first: 'light',
    rules: [
      `${LIGHT_FIRST} 20 men each on a 10×10 board. Men move one square forward but capture forwards and backwards.`,
      'Kings fly: they move and capture along a whole diagonal and land on any free square beyond the captured piece.',
      'Maximum capture: you must play the sequence that takes the most pieces (kings and men count the same).',
      'A man is crowned only if it ends its move on the far row — passing through mid-capture doesn’t count.',
      'Jumped pieces stay on the board until the move ends and can’t be jumped twice.',
      'Draws (FMJD): threefold repetition, 25 king moves each without a capture or man move, 3 pieces with a king against a lone king after 16 moves, and 2 pieces or fewer with a king against a lone king after 5 moves.',
    ],
  },
  antidraughts: {
    id: 'antidraughts',
    title: 'Antidraughts',
    tagline: 'International draughts where losing every piece wins.',
    family: 'twist',
    size: 10,
    pieces: 20,
    first: 'light',
    rules: [
      `${LIGHT_FIRST} Pieces move and capture exactly as in International draughts — maximum capture included.`,
      'You WIN when you have no pieces left, or none of your pieces can move.',
      'The only automatic draw is threefold repetition.',
    ],
  },
  breakthrough: {
    id: 'breakthrough',
    title: 'Breakthrough',
    tagline: 'International draughts: the first king wins the game.',
    family: 'twist',
    size: 10,
    pieces: 20,
    first: 'light',
    rules: [
      `${LIGHT_FIRST} Pieces move and capture exactly as in International draughts — maximum capture included.`,
      'The first player to crown a king wins at once (a man must end its move on the far row).',
      'You also win if your opponent has no pieces or no legal move.',
    ],
  },
  canadian: {
    id: 'canadian',
    title: 'Canadian',
    tagline: 'International rules on a huge 12×12 board, 30 men a side.',
    family: 'big',
    size: 12,
    pieces: 30,
    first: 'light',
    rules: [
      `${LIGHT_FIRST} 30 men each on a 12×12 board. Men move one square forward but capture forwards and backwards.`,
      'Kings fly: they move and capture along a whole diagonal and land on any free square beyond the captured piece.',
      'Maximum capture: you must play the sequence that takes the most pieces (kings and men count the same).',
      'A man is crowned only if it ends its move on the far row — passing through mid-capture doesn’t count.',
      'Draws (FMJD): threefold repetition, 25 king moves each without a capture or man move, 3 pieces with a king against a lone king after 16 moves, and 2 pieces or fewer with a king against a lone king after 5 moves.',
    ],
  },
};

/** Variant of a settings object (unknown or missing → American). */
export function checkersVariantOf(settings: { variant?: unknown } | null | undefined): CheckersVariant {
  return isCheckersVariant(settings?.variant) ? settings.variant : 'american';
}

/** Squares on the variant's board (the board string length). */
export function checkersSquareCount(variant: CheckersVariant): number {
  const size = CHECKERS_VARIANT_INFO[variant].size;
  return (size * size) / 2;
}

/** Only American checkers changes DASCADE ratings. */
export function isRatedCheckersVariant(variant: CheckersVariant): boolean {
  return variant === 'american';
}

export const CheckersSettingsSchema = z.object({ ...BOARD_SETTINGS_SHAPE, variant: z.enum(CHECKERS_VARIANTS).default('american') });
export type CheckersSettings = z.infer<typeof CheckersSettingsSchema>;

export const DEFAULT_CHECKERS_SETTINGS: CheckersSettings = {
  ...DEFAULT_BOARD_SETTINGS,
  variant: 'american',
};

export const CHECKERS_MSG = {
  /** client → server: { path, ply } — play a move. */
  move: 'checkers:move',
  /** server → everyone: CheckersMoveEvent (animation + sound cue). */
  moved: 'checkers:moved',
  resign: boardMsg('checkers', 'resign'),
  draw: boardMsg('checkers', 'draw'),
  undo: boardMsg('checkers', 'undo'),
  rematch: boardMsg('checkers', 'rematch'),
  event: boardMsg('checkers', 'event'),
} as const;

export const CheckersMoveSchema = z
  .object({
    /** Squares of the move (the room checks them against the variant's board). */
    path: z.array(z.number().int().min(1).max(CHECKERS_MAX_SQUARE)).min(2).max(CHECKERS_MAX_VARIANT_PATH),
    /** The ply the client saw when it chose the move (stale or duplicate submissions are ignored). */
    ply: z.number().int().min(0).max(100_000),
  })
  .strict();
export type CheckersMovePayload = z.infer<typeof CheckersMoveSchema>;

/** Colour played by each kit side: side 'first' plays the variant's first-moving colour. */
export type CheckersColor = 'dark' | 'light';
export function checkersColorOf(side: BoardSide, variant: CheckersVariant = 'american'): CheckersColor {
  const first = CHECKERS_VARIANT_INFO[variant].first;
  return side === 'first' ? first : first === 'dark' ? 'light' : 'dark';
}
export function checkersSideOf(color: CheckersColor, variant: CheckersVariant = 'american'): BoardSide {
  return color === CHECKERS_VARIANT_INFO[variant].first ? 'first' : 'second';
}
export const CHECKERS_COLOR_LABEL: Record<CheckersColor, string> = { dark: 'Dark', light: 'Light' };
/** Side labels in kit order (first, second) for a variant, e.g. ['Light', 'Dark']. */
export function checkersSideLabels(variant: CheckersVariant): readonly [string, string] {
  return [CHECKERS_COLOR_LABEL[checkersColorOf('first', variant)], CHECKERS_COLOR_LABEL[checkersColorOf('second', variant)]];
}

export interface CheckersMoveEvent {
  /** Ply number after the move (1-based count of completed turns). */
  ply: number;
  side: BoardSide;
  notation: string;
  path: number[];
  captures: number[];
  crowned: boolean;
}

/** One entry of the synchronized move list. */
export interface CheckersHistoryEntry {
  /** Standard numeric notation: "11-15", "15x22", "15x22x29". */
  notation: string;
  /** Pieces captured by this move. */
  captures: number;
  crowned: boolean;
}

export interface CheckersPublicState extends BoardRoomView {
  /** The variant being played (follows the lobby setting until the game starts). */
  variant: CheckersVariant;
  /** One character per square (index = square − 1): '.' empty, d/D dark man/king, l/L light man/king. */
  board: string;
  history: CheckersHistoryEntry[];
  /** Squares of the last move's path ([] before the first move). */
  lastPath: number[];
  /** Squares captured by the last move. */
  lastCaptures: number[];
  /** Consecutive plies without a capture or a man move (the variant's move-limit draw). */
  quietPlies: number;
  /** Plies since the material last changed (capture or crowning) — the endgame draw rules count these. */
  endgamePlies: number;
  /** Occurrences of the current position (draw at 3). */
  repetitions: number;
}
