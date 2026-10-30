/**
 * DAS Tic-Tac-Toe synchronized state: the Boardroom kit state (seats, clock, offers, result) plus
 * the variant's board, the move list and the draw-rule counter. Mirrors `TicTacToePublicState`
 * in @dascade/shared/games/tictactoe. Tic-tac-toe has no hidden information.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { BoardRoomState } from '../boardroom/index.ts';

export const TttHistoryItem = schema(
  {
    notation: t.string().default(''),
  },
  'TttHistoryItem',
);
export type TttHistoryItem = SchemaType<typeof TttHistoryItem>;

export const TicTacToeState = BoardRoomState.extend(
  {
    variant: t.string().default('classic'),
    cells: t.array('string'),
    boards: t.string().default(''),
    active: t.int8().default(-1),
    winLine: t.array('uint8'),
    lastCell: t.int16().default(-1),
    lastFrom: t.int16().default(-1),
    lastRemoved: t.int16().default(-1),
    fading: t.array('int16'),
    hands: t.array('uint8'),
    history: t.array(TttHistoryItem),
    repetitions: t.uint8().default(1),
  },
  'TicTacToeState',
);
export type TicTacToeState = SchemaType<typeof TicTacToeState>;
