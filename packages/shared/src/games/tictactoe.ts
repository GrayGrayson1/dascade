/**
 * DAS Tic-Tac-Toe — shared contract (variants, settings, messages, payloads, public state).
 *
 * Thirteen variants of noughts and crosses on the DAS Boardroom kit (see ./boardroom.ts): side
 * 'first' moves first (X in most variants, Order in Order & Chaos, Odds in Numbers). The lobby
 * picks the variant; a game keeps it until it ends (rematches replay it). Nothing is hidden, so
 * the whole game lives in synchronized state; the server validates every move with the pure
 * engine in @dascade/game-core/tictactoe.
 *
 * Cells are numbered row by row from the top-left (0 = top-left). Boards made of several small
 * boards (Ultimate, Notakto) number them board by board: cell = board × 9 + local cell. The 3D
 * cube numbers layers top to bottom: cell = layer × 16 + row × 4 + column.
 */
import { z } from 'zod';
import { BOARD_SETTINGS_SHAPE, DEFAULT_BOARD_SETTINGS, boardMsg, type BoardRoomView, type BoardSide } from './boardroom.ts';

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export const TTT_VARIANTS = [
  'classic',
  'misere',
  'bigboard',
  'gomoku',
  'ultimate',
  'vanishing',
  'wild',
  'numbers',
  'gravity',
  'nesting',
  'notakto',
  'cube',
  'orderchaos',
] as const;
export type TttVariant = (typeof TTT_VARIANTS)[number];

export function isTttVariant(value: unknown): value is TttVariant {
  return typeof value === 'string' && (TTT_VARIANTS as readonly string[]).includes(value);
}

/** How the board is drawn and numbered. */
export type TttLayout = 'grid' | 'boards' | 'layers';

export type TttFamily = 'classic' | 'twist' | 'boards';

export const TTT_FAMILIES: ReadonlyArray<{ id: TttFamily; label: string }> = [
  { id: 'classic', label: 'Classics' },
  { id: 'twist', label: 'Twists' },
  { id: 'boards', label: 'Multi-board' },
];

export interface TttVariantInfo {
  id: TttVariant;
  title: string;
  /** One line for the variant picker. */
  tagline: string;
  family: TttFamily;
  /** Labels of the first and second side ("X" / "O", "Order" / "Chaos"…). */
  sides: readonly [string, string];
  /** Marks in a row that decide the game (Numbers: a full line). */
  inARow: number;
  layout: TttLayout;
  /** Columns and rows of one board; `count` boards (Ultimate 9, Notakto 3) or layers (cube 4). */
  cols: number;
  rows: number;
  count: number;
  /** Rules, short sentences for the lobby card and the in-game help. */
  rules: readonly string[];
}

const XO = ['X', 'O'] as const;

export const TTT_VARIANT_INFO: Record<TttVariant, TttVariantInfo> = {
  classic: {
    id: 'classic',
    title: 'Classic',
    tagline: 'Three in a row on a 3×3 grid. The original.',
    family: 'classic',
    sides: XO,
    inARow: 3,
    layout: 'grid',
    cols: 3,
    rows: 3,
    count: 1,
    rules: [
      'X moves first. Take turns marking an empty square.',
      'Three of your marks in a row — across, down or diagonal — wins.',
      'A full board with no line is a draw.',
    ],
  },
  misere: {
    id: 'misere',
    title: 'Misère',
    tagline: 'Classic in reverse: whoever makes three in a row loses.',
    family: 'classic',
    sides: XO,
    inARow: 3,
    layout: 'grid',
    cols: 3,
    rows: 3,
    count: 1,
    rules: [
      'X moves first. Take turns marking an empty square.',
      'Complete three of your own marks in a row and you lose.',
      'A full board with no line is a draw.',
    ],
  },
  bigboard: {
    id: 'bigboard',
    title: 'Big Board',
    tagline: 'A 5×5 grid where you need four in a row.',
    family: 'classic',
    sides: XO,
    inARow: 4,
    layout: 'grid',
    cols: 5,
    rows: 5,
    count: 1,
    rules: [
      'X moves first. Take turns marking an empty square.',
      'Four of your marks in a row — across, down or diagonal — wins.',
      'A full board with no line is a draw.',
    ],
  },
  gomoku: {
    id: 'gomoku',
    title: 'Gomoku',
    tagline: 'Five in a row on a wide 15×15 board.',
    family: 'classic',
    sides: XO,
    inARow: 5,
    layout: 'grid',
    cols: 15,
    rows: 15,
    count: 1,
    rules: [
      'X moves first. Take turns marking an empty point.',
      'Five or more of your marks in an unbroken row wins.',
      'A full board with no line is a draw.',
    ],
  },
  ultimate: {
    id: 'ultimate',
    title: 'Ultimate',
    tagline: 'Nine boards in one. Your move picks where they play next.',
    family: 'boards',
    sides: XO,
    inARow: 3,
    layout: 'boards',
    cols: 3,
    rows: 3,
    count: 9,
    rules: [
      'Nine small boards make one big board. X moves first, anywhere.',
      'The square you pick sends your opponent to the matching small board.',
      'Sent to a board that is already won or full? Play on any open board.',
      'Win a small board with three in a row. Win three small boards in a row to win the game.',
      'A small board that fills up without a line belongs to nobody.',
    ],
  },
  vanishing: {
    id: 'vanishing',
    title: 'Vanishing',
    tagline: 'Only three marks each — your oldest one fades away.',
    family: 'twist',
    sides: XO,
    inARow: 3,
    layout: 'grid',
    cols: 3,
    rows: 3,
    count: 1,
    rules: [
      'Classic rules, but each player keeps at most three marks.',
      'Placing a fourth mark erases your oldest one (it glows before it goes).',
      'Three in a row wins. The same position three times is a draw.',
    ],
  },
  wild: {
    id: 'wild',
    title: 'Wild',
    tagline: 'Place an X or an O — whoever completes a line wins.',
    family: 'twist',
    sides: ['First', 'Second'],
    inARow: 3,
    layout: 'grid',
    cols: 3,
    rows: 3,
    count: 1,
    rules: [
      'On your turn, mark any empty square with your choice of X or O.',
      'Complete three of the same mark in a row — either mark — and you win.',
      'A full board with no line is a draw.',
    ],
  },
  numbers: {
    id: 'numbers',
    title: 'Numbers',
    tagline: 'Odds against evens: make a line that adds up to 15.',
    family: 'twist',
    sides: ['Odds', 'Evens'],
    inARow: 3,
    layout: 'grid',
    cols: 3,
    rows: 3,
    count: 1,
    rules: [
      'Odds play 1, 3, 5, 7, 9 and move first. Evens play 2, 4, 6, 8.',
      'Each number can be used once. Place one of yours on an empty square.',
      'Complete any full line that adds up to exactly 15 — with anyone’s numbers — to win.',
      'A full board with no 15 is a draw.',
    ],
  },
  gravity: {
    id: 'gravity',
    title: 'Four in a Row',
    tagline: 'Drop discs down the columns. Line up four to win.',
    family: 'twist',
    sides: ['Pink', 'Blue'],
    inARow: 4,
    layout: 'grid',
    cols: 7,
    rows: 6,
    count: 1,
    rules: [
      'Pick a column: your disc drops to the lowest empty slot.',
      'Four of your discs in a row — across, down or diagonal — wins.',
      'A full rack with no line is a draw.',
    ],
  },
  nesting: {
    id: 'nesting',
    title: 'Nesting',
    tagline: 'Big pieces swallow small ones. Pieces can move.',
    family: 'twist',
    sides: XO,
    inARow: 3,
    layout: 'grid',
    cols: 3,
    rows: 3,
    count: 1,
    rules: [
      'Each player has six pieces: two small, two medium and two large.',
      'On your turn, place a piece from your hand or move one of yours already on the board.',
      'A piece may cover any smaller piece — yours or your opponent’s.',
      'Three of your visible pieces in a row wins. Uncover your opponent’s line and they win.',
      'The same position three times is a draw.',
    ],
  },
  notakto: {
    id: 'notakto',
    title: 'Notakto',
    tagline: 'Three boards, everyone plays X. Do not finish the last line.',
    family: 'boards',
    sides: ['First', 'Second'],
    inARow: 3,
    layout: 'boards',
    cols: 3,
    rows: 3,
    count: 3,
    rules: [
      'Both players place X marks on any of the three boards.',
      'A board with three X in a row is dead — nobody plays there again.',
      'Whoever kills the last live board loses.',
    ],
  },
  cube: {
    id: 'cube',
    title: '3D Cube',
    tagline: 'Four layers of 4×4. Four in a row through the cube.',
    family: 'boards',
    sides: XO,
    inARow: 4,
    layout: 'layers',
    cols: 4,
    rows: 4,
    count: 4,
    rules: [
      'The cube is four stacked 4×4 layers. X moves first.',
      'Four in a row wins: within a layer, straight down through the layers, or diagonally across them.',
      'There are 76 winning lines. A full cube with none is a draw.',
    ],
  },
  orderchaos: {
    id: 'orderchaos',
    title: 'Order & Chaos',
    tagline: 'Order wants five in a row, Chaos wants to stop it.',
    family: 'twist',
    sides: ['Order', 'Chaos'],
    inARow: 5,
    layout: 'grid',
    cols: 6,
    rows: 6,
    count: 1,
    rules: [
      'Both players may place an X or an O on any empty square. Order moves first.',
      'Order wins as soon as five of the same mark line up in a row, whoever placed them.',
      'Chaos wins if the board fills up without such a line. There are no draws.',
    ],
  },
};

/** Total cells of a variant's board (all small boards / layers). */
export function tttCellCount(variant: TttVariant): number {
  const v = TTT_VARIANT_INFO[variant];
  return v.cols * v.rows * v.count;
}

/** The biggest board (Gomoku, 15×15). */
export const TTT_MAX_CELLS = 225;

/** Nesting piece sizes (1 small, 2 medium, 3 large) and pieces of each size per player. */
export const TTT_SIZES = [1, 2, 3] as const;
export type TttSize = (typeof TTT_SIZES)[number];
export const TTT_PIECES_PER_SIZE = 2;
export const TTT_SIZE_LABEL: Record<TttSize, string> = { 1: 'Small', 2: 'Medium', 3: 'Large' };

/** Numbers: the first side plays the odd numbers, the second the even ones. */
export const TTT_NUMBERS: Record<BoardSide, readonly number[]> = { first: [1, 3, 5, 7, 9], second: [2, 4, 6, 8] };
export const TTT_NUMBER_TARGET = 15;

/** Vanishing: marks each player keeps on the board. */
export const TTT_VANISH_KEEP = 3;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const TicTacToeSettingsSchema = z.object({
  ...BOARD_SETTINGS_SHAPE,
  variant: z.enum(TTT_VARIANTS),
});
export type TicTacToeSettings = z.infer<typeof TicTacToeSettingsSchema>;

export const DEFAULT_TICTACTOE_SETTINGS: TicTacToeSettings = {
  ...DEFAULT_BOARD_SETTINGS,
  timeControl: { baseMinutes: 0, incrementSeconds: 0 },
  variant: 'classic',
};

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const TTT_MSG = {
  /** client → server: TttMovePayload — play a move. */
  move: 'tictactoe:move',
  /** server → everyone: TttMoveEvent (animation + sound cue). */
  moved: 'tictactoe:moved',
  resign: boardMsg('tictactoe', 'resign'),
  draw: boardMsg('tictactoe', 'draw'),
  undo: boardMsg('tictactoe', 'undo'),
  rematch: boardMsg('tictactoe', 'rematch'),
  event: boardMsg('tictactoe', 'event'),
} as const;

export const TTT_MARKS = ['x', 'o'] as const;
export type TttMark = (typeof TTT_MARKS)[number];

/**
 * A move. Every variant sends `cell` (the target). Gravity accepts any cell of the column. Wild and
 * Order & Chaos add `mark`, Numbers adds `num`, Nesting adds `size` (a piece from the hand) or
 * `from` (a piece already on the board).
 */
export const TttMoveSchema = z
  .object({
    cell: z
      .number()
      .int()
      .min(0)
      .max(TTT_MAX_CELLS - 1),
    mark: z.enum(TTT_MARKS).optional(),
    num: z.number().int().min(1).max(9).optional(),
    size: z.number().int().min(1).max(3).optional(),
    from: z
      .number()
      .int()
      .min(0)
      .max(TTT_MAX_CELLS - 1)
      .optional(),
    /** The ply the client saw when it chose the move (stale or duplicate submissions are ignored). */
    ply: z.number().int().min(0).max(100_000),
  })
  .strict();
export type TttMovePayload = z.infer<typeof TttMoveSchema>;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** End reasons of the rules (the kit adds resign, timeout, agreement…). */
export const TTT_REASONS = {
  /** The mover completed a winning line. */
  line: 'line',
  /** Misère: the mover completed a line and loses. */
  misere: 'misere',
  /** Numbers: the mover completed a line adding up to 15. */
  sum: 'sum',
  /** Nesting: the mover uncovered the opponent's line. */
  uncovered: 'uncovered',
  /** Ultimate: three small boards in a row. */
  boards: 'boards',
  /** Notakto: the mover killed the last live board. */
  lastBoard: 'last_board',
  /** Order & Chaos: the board filled up with no five in a row. */
  chaos: 'chaos',
  /** Draw: the board is full (or no legal move is left). */
  full: 'full',
  /** Draw: the same position for the third time (Vanishing, Nesting). */
  repetition: 'repetition',
  /** Draw: the move limit of the endless variants. */
  moveLimit: 'move_limit',
} as const;

/** Plies after which Vanishing and Nesting end in a draw. */
export const TTT_MOVE_LIMIT = 150;

// ---------------------------------------------------------------------------
// Public state
// ---------------------------------------------------------------------------

export interface TttMoveEvent {
  /** Ply number after the move. */
  ply: number;
  side: BoardSide;
  notation: string;
  /** Where the mark (or piece) landed. */
  cell: number;
  /** Nesting: where the piece came from (-1 = from the hand). */
  from: number;
  /** Vanishing: the mark that faded (-1 = none). */
  removed: number;
  /** Ultimate / Notakto: the small board decided by this move (-1 = none). */
  board: number;
  /** The game-deciding line, if this move ended the game with one. */
  line: number[];
}

export interface TttHistoryEntry {
  notation: string;
}

export interface TicTacToePublicState extends BoardRoomView {
  variant: TttVariant;
  /**
   * One token per cell: '' empty, 'x' / 'o' marks, '1'–'9' (Numbers), and for Nesting the stack
   * from bottom to top, two characters per piece: owner then size ('x1o3' = O's large over X's small).
   */
  cells: string[];
  /**
   * Ultimate: one character per small board — '.' open, 'x' / 'o' won, '=' full without a line.
   * Notakto: '.' live, '#' dead. '' for the other variants.
   */
  boards: string;
  /** Ultimate: the small board the side to move must play in (-1 = any open board). */
  active: number;
  /**
   * Cells of the deciding line(s) once the game is over by a line. Ultimate lists the three small
   * boards (0–8) of the winning line instead.
   */
  winLine: number[];
  /** Cells of the last move: where it landed, where a Nesting piece left, the mark that faded (-1 = none). */
  lastCell: number;
  lastFrom: number;
  lastRemoved: number;
  /** Vanishing: [first, second] — the cell whose mark fades on that side's next move (-1 = none yet). */
  fading: number[];
  /** Nesting: pieces left in hand, [first small, medium, large, second small, medium, large]. */
  hands: number[];
  history: TttHistoryEntry[];
  /** Occurrences of the current position (Vanishing and Nesting draw at 3). */
  repetitions: number;
}
