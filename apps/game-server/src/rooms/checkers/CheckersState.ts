/**
 * DAS Checkers synchronized state: the Boardroom kit state (seats, clock, offers, result) plus
 * the board, the move list and the draw-rule counters. Checkers has no hidden information.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { INITIAL_BOARD } from '@dascade/game-core/checkers';
import { BoardRoomState } from '../boardroom/index.ts';

export const CheckersHistoryItem = schema(
  {
    notation: t.string().default(''),
    captures: t.uint8().default(0),
    crowned: t.boolean().default(false),
  },
  'CheckersHistoryItem',
);
export type CheckersHistoryItem = SchemaType<typeof CheckersHistoryItem>;

export const CheckersState = BoardRoomState.extend(
  {
    board: t.string().default(INITIAL_BOARD),
    history: t.array(CheckersHistoryItem),
    lastPath: t.array('uint8'),
    lastCaptures: t.array('uint8'),
    quietPlies: t.uint8().default(0),
    repetitions: t.uint8().default(1),
  },
  'CheckersState',
);
export type CheckersState = SchemaType<typeof CheckersState>;
