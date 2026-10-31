/**
 * DAS Reversi synchronized state: the Boardroom kit state (seats, clock, offers, result) plus the
 * variant's board, the last move and the move list. Mirrors `ReversiPublicState` in
 * @dascade/shared/games/reversi. Reversi has no hidden information.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { BoardRoomState } from '../boardroom/index.ts';

export const ReversiHistoryItem = schema(
  {
    notation: t.string().default(''),
  },
  'ReversiHistoryItem',
);
export type ReversiHistoryItem = SchemaType<typeof ReversiHistoryItem>;

export const ReversiState = BoardRoomState.extend(
  {
    variant: t.string().default('classic'),
    size: t.uint8().default(8),
    board: t.string().default(''),
    lastCell: t.int16().default(-1),
    lastFlips: t.array('uint8'),
    lastPassed: t.string().default(''),
    supply: t.array('uint8'),
    history: t.array(ReversiHistoryItem),
  },
  'ReversiState',
);
export type ReversiState = SchemaType<typeof ReversiState>;
