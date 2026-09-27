/**
 * DAS Boardroom kit — synchronized state shared by two-player board games.
 * Shapes mirror `BoardRoomView` in @dascade/shared/games/boardroom. Extend it:
 *   export const ChessState = BoardRoomState.extend({ fen: t.string().default('') }, 'ChessState');
 * Nothing here is hidden information: games with secrets (e.g. ships) keep them out of state.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { BaseRoomState } from '../../schema/base.ts';

export const BoardSeat = schema(
  {
    side: t.string().default('first'),
    playerId: t.string().default(''),
    name: t.string().default(''),
    avatar: t.string().default('rocket'),
    color: t.string().default('#ffffff'),
    rating: t.uint16().default(0),
    ratingGames: t.uint32().default(0),
    provisional: t.boolean().default(true),
    ratingDelta: t.int16().default(0),
    awayDeadline: t.float64().default(0),
  },
  'BoardSeat',
);
export type BoardSeat = SchemaType<typeof BoardSeat>;

export const BoardClockState = schema(
  {
    enabled: t.boolean().default(false),
    baseMs: t.float64().default(0),
    incrementMs: t.float64().default(0),
    firstMs: t.float64().default(0),
    secondMs: t.float64().default(0),
    running: t.string().default(''),
    turnStartedAt: t.float64().default(0),
    flagged: t.string().default(''),
  },
  'BoardClockState',
);
export type BoardClockState = SchemaType<typeof BoardClockState>;

export const BoardOffersState = schema(
  {
    drawBy: t.string().default(''),
    undoBy: t.string().default(''),
    undoPlies: t.uint8().default(0),
    rematch: t.array('string'),
  },
  'BoardOffersState',
);
export type BoardOffersState = SchemaType<typeof BoardOffersState>;

export const BoardResultState = schema(
  {
    over: t.boolean().default(false),
    winner: t.string().default(''),
    reason: t.string().default(''),
    text: t.string().default(''),
  },
  'BoardResultState',
);
export type BoardResultState = SchemaType<typeof BoardResultState>;

export const BoardRoomState = BaseRoomState.extend(
  {
    seats: t.array(BoardSeat),
    turn: t.string().default('first'),
    ply: t.uint32().default(0),
    clock: t.ref(BoardClockState),
    offers: t.ref(BoardOffersState),
    result: t.ref(BoardResultState),
    rated: t.boolean().default(false),
    undoAllowed: t.boolean().default(false),
    drawOffersAllowed: t.boolean().default(true),
    gameNumber: t.uint16().default(0),
    turnSince: t.float64().default(0),
    idleClaimAt: t.float64().default(0),
    idleForfeitAt: t.float64().default(0),
  },
  'BoardRoomState',
);
export type BoardRoomState = SchemaType<typeof BoardRoomState>;
