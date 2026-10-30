/**
 * DAS Chess — shared contract (settings, messages, payloads, public state shape).
 * Built on the DAS Boardroom kit (`./boardroom.ts`): sides ('first' = White), clocks, offers, results.
 *
 * Variants: Standard (rated, played on chess.js) plus the eight lichess variants (casual and
 * tournament play, never rated), played on DASCADE's own variant engine in @dascade/game-core/chess.
 */
import { z } from 'zod';
import { BOARD_SETTINGS_SHAPE, DEFAULT_BOARD_SETTINGS, type BoardRoomView } from './boardroom.ts';

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export const CHESS_VARIANTS = [
  'standard',
  'chess960',
  'kingofthehill',
  'threecheck',
  'antichess',
  'atomic',
  'horde',
  'racingkings',
  'crazyhouse',
] as const;
export type ChessVariant = (typeof CHESS_VARIANTS)[number];

export function isChessVariant(value: unknown): value is ChessVariant {
  return typeof value === 'string' && (CHESS_VARIANTS as readonly string[]).includes(value);
}

export type ChessFamily = 'classic' | 'goals' | 'wild';

export const CHESS_FAMILIES: ReadonlyArray<{ id: ChessFamily; label: string }> = [
  { id: 'classic', label: 'Classic' },
  { id: 'goals', label: 'New goals' },
  { id: 'wild', label: 'Wild rules' },
];

export interface ChessVariantInfo {
  id: ChessVariant;
  title: string;
  /** One line for the picker. */
  tagline: string;
  family: ChessFamily;
  /** The rules in a few short lines (lobby card, countdown, rules modal). */
  rules: readonly string[];
}

export const CHESS_VARIANT_INFO: Record<ChessVariant, ChessVariantInfo> = {
  standard: {
    id: 'standard',
    title: 'Standard',
    tagline: 'Classic chess. The only rated variant.',
    family: 'classic',
    rules: [
      'Checkmate the enemy king to win.',
      'Stalemate, insufficient material, threefold repetition and the fifty-move rule are automatic draws.',
      'Rated games change your DASCADE chess rating.',
    ],
  },
  chess960: {
    id: 'chess960',
    title: 'Chess960',
    tagline: 'The back rank is shuffled every game.',
    family: 'classic',
    rules: [
      'The pieces behind the pawns start in one of 960 shuffled orders, mirrored for both sides. Bishops stand on opposite colours and the king starts between the rooks.',
      'A new order is drawn for every game.',
      'To castle, move your king onto the rook you want to castle with. King and rook end where normal castling puts them: g- and f-file on the king side, c- and d-file on the queen side.',
      'Everything else is normal chess: checkmate wins.',
    ],
  },
  kingofthehill: {
    id: 'kingofthehill',
    title: 'King of the Hill',
    tagline: 'Walk your king to the centre to win.',
    family: 'goals',
    rules: [
      'Normal chess, plus a second way to win: bring your king to one of the four centre squares (d4, e4, d5, e5).',
      'The king still can’t move into check.',
      'Checkmate also wins.',
    ],
  },
  threecheck: {
    id: 'threecheck',
    title: 'Three-Check',
    tagline: 'Give check three times to win.',
    family: 'goals',
    rules: [
      'Normal chess, plus a second way to win: give check three times.',
      'The checks each side has given are counted on the player cards.',
      'Checkmate also wins.',
    ],
  },
  racingkings: {
    id: 'racingkings',
    title: 'Racing Kings',
    tagline: 'Race your king to the 8th rank.',
    family: 'goals',
    rules: [
      'No pawns: both sides start side by side on the first two ranks. The first king to reach the 8th rank wins.',
      'Giving check is not allowed, so neither king can ever be in check.',
      'If White’s king gets there first, Black has one last move: reaching the 8th rank too makes the game a draw.',
      'There is no castling.',
    ],
  },
  antichess: {
    id: 'antichess',
    title: 'Antichess',
    tagline: 'Lose all your pieces to win.',
    family: 'wild',
    rules: [
      'Win by losing all your pieces, or by having no legal move.',
      'If you can capture, you must (you choose which capture).',
      'There is no check: the king is an ordinary piece that can be captured, and pawns may promote to a king.',
      'There is no castling.',
    ],
  },
  atomic: {
    id: 'atomic',
    title: 'Atomic',
    tagline: 'Every capture is an explosion.',
    family: 'wild',
    rules: [
      'A capture explodes: the capturing piece, the captured piece and every piece except pawns on the eight surrounding squares are removed.',
      'Blow up the enemy king, or checkmate it, to win. A move that would blow up your own king is illegal.',
      'Kings can’t capture. While the two kings touch, neither can be put in check.',
    ],
  },
  horde: {
    id: 'horde',
    title: 'Horde',
    tagline: '36 white pawns against a full army.',
    family: 'wild',
    rules: [
      'White has 36 pawns and no king; Black has the normal army.',
      'White wins by checkmating Black. Black wins by capturing every white piece.',
      'White pawns on the first rank may move two squares, like pawns on the second rank.',
      'Stalemate is a draw.',
    ],
  },
  crazyhouse: {
    id: 'crazyhouse',
    title: 'Crazyhouse',
    tagline: 'Captured pieces join your side.',
    family: 'wild',
    rules: [
      'A piece you capture changes colour and goes into your pocket.',
      'On your turn you may drop a pocket piece on any empty square instead of moving, even to give check or mate.',
      'Pawns can’t be dropped on the 1st or 8th rank. A promoted piece that is captured goes back to the pocket as a pawn.',
      'Checkmate wins.',
    ],
  },
};

/** The variants played on the variant engine (everything but Standard) are never rated. */
export function isRatedChessVariant(variant: ChessVariant): boolean {
  return variant === 'standard';
}

export const ChessSettingsSchema = z.object({ ...BOARD_SETTINGS_SHAPE, variant: z.enum(CHESS_VARIANTS).default('standard') });
export type ChessSettings = z.infer<typeof ChessSettingsSchema>;

export const DEFAULT_CHESS_SETTINGS: ChessSettings = {
  ...DEFAULT_BOARD_SETTINGS,
  timeControl: { baseMinutes: 10, incrementSeconds: 5 },
  variant: 'standard',
};

export const CHESS_MSG = {
  /** client → server: play a move. */
  move: 'chess:move',
  /** Kit messages (see boardroom.ts): chess:resign, chess:draw, chess:undo, chess:rematch, chess:boardEvent. */
  resign: 'chess:resign',
  draw: 'chess:draw',
  undo: 'chess:undo',
  rematch: 'chess:rematch',
  event: 'chess:boardEvent',
} as const;

const SquareSchema = z.string().regex(/^[a-h][1-8]$/);

/**
 * A move: `from` → `to`, or (Crazyhouse) a `drop` of a pocket piece on `to`. Exactly one of `from`
 * and `drop` is present. Castling: move the king two squares or onto its own rook (Chess960: onto
 * the rook). The engine decides legality — a king promotion only exists in Antichess, a drop only
 * in Crazyhouse.
 */
export const ChessMoveSchema = z
  .object({
    from: SquareSchema.optional(),
    to: SquareSchema,
    /** Required for promotions, rejected otherwise ('k': Antichess only). */
    promotion: z.enum(['q', 'r', 'b', 'n', 'k']).optional(),
    /** Crazyhouse: the pocket piece dropped on `to`. */
    drop: z.enum(['p', 'n', 'b', 'r', 'q']).optional(),
    /** The public `ply` the client moved at; stale or duplicate moves are refused. */
    ply: z.number().int().min(0).max(100_000),
  })
  .strict()
  .refine((m) => (m.from === undefined) !== (m.drop === undefined), { message: 'Give either from or drop.' })
  .refine((m) => m.drop === undefined || m.promotion === undefined, { message: 'A drop has no promotion.' });
export type ChessMovePayload = z.infer<typeof ChessMoveSchema>;

export type ChessColor = 'w' | 'b';

export interface ChessMoveView {
  san: string;
  uci: string;
  from: string;
  to: string;
  color: ChessColor;
  piece: string;
  /** Captured piece type ('' if none). */
  captured: string;
  promotion: string;
  /** '' | 'k' | 'q'. */
  castle: string;
  enPassant: boolean;
  /** Crazyhouse: the piece type dropped ('' for a normal move). */
  drop: string;
  /** Atomic: squares cleared by the explosion of a capture, space-separated ('' if none). */
  exploded: string;
  check: boolean;
  mate: boolean;
  /** Mover's remaining clock after the move (ms, increment included; 0 when untimed). */
  clockMs: number;
}

export interface ChessPublicState extends BoardRoomView {
  /** The variant of the current game (follows the lobby setting until the game starts). */
  variant: string;
  /**
   * Current position (FEN; variant FENs carry Crazyhouse pockets "[…]" and Three-Check counts
   * "3+3"). The server's engine is the source of truth.
   */
  fen: string;
  startFen: string;
  moves: ChessMoveView[];
  inCheck: boolean;
  /** King square of the side in check ('' if none). */
  checkSquare: string;
  /** How often the current position has occurred (3 = threefold → automatic draw). */
  repetition: number;
  /** Half-moves since the last capture or pawn move (100 → automatic draw). */
  halfmoveClock: number;
  /** Final PGN (published when the game ends; clients can build a live one with @dascade/game-core/chess). */
  pgn: string;
  /** Server epoch ms when the current game went live (0 before). */
  startedAt: number;
}
