/**
 * DAS Chess — shared contract (settings, messages, payloads, public state shape).
 * Built on the DAS Boardroom kit (`./boardroom.ts`): sides ('first' = White), clocks, offers, results.
 */
import { z } from 'zod';
import { BOARD_SETTINGS_SHAPE, DEFAULT_BOARD_SETTINGS, type BoardRoomView } from './boardroom.ts';

export const ChessSettingsSchema = z.object({ ...BOARD_SETTINGS_SHAPE });
export type ChessSettings = z.infer<typeof ChessSettingsSchema>;

export const DEFAULT_CHESS_SETTINGS: ChessSettings = {
  ...DEFAULT_BOARD_SETTINGS,
  timeControl: { baseMinutes: 10, incrementSeconds: 5 },
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

export const ChessMoveSchema = z.object({
  from: SquareSchema,
  to: SquareSchema,
  /** Required for promotions, rejected otherwise. */
  promotion: z.enum(['q', 'r', 'b', 'n']).optional(),
  /** The public `ply` the client moved at; stale or duplicate moves are refused. */
  ply: z.number().int().min(0).max(100_000),
});
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
  check: boolean;
  mate: boolean;
  /** Mover's remaining clock after the move (ms, increment included; 0 when untimed). */
  clockMs: number;
}

export interface ChessPublicState extends BoardRoomView {
  /** Current position (FEN). The server's chess.js instance is the source of truth. */
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
