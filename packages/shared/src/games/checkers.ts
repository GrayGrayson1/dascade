/**
 * DAS Checkers — shared contract (settings, messages, payloads, public state).
 *
 * Standard American/English checkers on the DAS Boardroom kit (see ./boardroom.ts):
 * side 'first' plays Dark (moves first), side 'second' plays Light. Nothing in checkers is
 * hidden, so the whole game lives in synchronized state; the server validates every move
 * with the pure engine in @dascade/game-core/checkers.
 *
 * Moves travel as a path of squares in standard 1–32 numbering: [11, 15] for "11-15",
 * [15, 22, 29] for the double jump "15x22x29". The client may also send the unambiguous
 * from→to shortcut of a multi-jump ([15, 29]); the server resolves or rejects it.
 */
import { z } from 'zod';
import { BOARD_SETTINGS_SHAPE, DEFAULT_BOARD_SETTINGS, boardMsg, type BoardRoomView, type BoardSide } from './boardroom.ts';

/** A capture chain takes at most 12 pieces, so a path has at most 13 squares. */
export const CHECKERS_MAX_PATH = 13;

export const CheckersSettingsSchema = z.object({ ...BOARD_SETTINGS_SHAPE });
export type CheckersSettings = z.infer<typeof CheckersSettingsSchema>;

export const DEFAULT_CHECKERS_SETTINGS: CheckersSettings = {
  ...DEFAULT_BOARD_SETTINGS,
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
    path: z.array(z.number().int().min(1).max(32)).min(2).max(CHECKERS_MAX_PATH),
    /** The ply the client saw when it chose the move (stale or duplicate submissions are ignored). */
    ply: z.number().int().min(0).max(100_000),
  })
  .strict();
export type CheckersMovePayload = z.infer<typeof CheckersMoveSchema>;

/** Colour played by each kit side. */
export type CheckersColor = 'dark' | 'light';
export function checkersColorOf(side: BoardSide): CheckersColor {
  return side === 'first' ? 'dark' : 'light';
}
export function checkersSideOf(color: CheckersColor): BoardSide {
  return color === 'dark' ? 'first' : 'second';
}
export const CHECKERS_COLOR_LABEL: Record<CheckersColor, string> = { dark: 'Dark', light: 'Light' };

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
  /** 32 characters (index = square − 1): '.' empty, d/D dark man/king, l/L light man/king. */
  board: string;
  history: CheckersHistoryEntry[];
  /** Squares of the last move's path ([] before the first move). */
  lastPath: number[];
  /** Squares captured by the last move. */
  lastCaptures: number[];
  /** Consecutive plies without a capture or a man move (draw at 80). */
  quietPlies: number;
  /** Occurrences of the current position (draw at 3). */
  repetitions: number;
}
