/**
 * DAS Hold'em synchronized state. PUBLIC information only: hole cards and the
 * undealt deck live in the room's engine state and travel via private messages.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { BaseRoomState } from '../../schema/base.ts';

export const HoldemSeat = schema(
  {
    index: t.uint8().default(0),
    playerId: t.string().default(''),
    name: t.string().default(''),
    stack: t.number().default(0),
    bet: t.number().default(0),
    committed: t.number().default(0),
    inHand: t.boolean().default(false),
    folded: t.boolean().default(false),
    allIn: t.boolean().default(false),
    sittingOut: t.boolean().default(false),
    sitOutReason: t.string().default(''),
    hasCards: t.boolean().default(false),
    lastAction: t.string().default(''),
    lastAmount: t.number().default(0),
    shownCards: t.array('string'),
    handLabel: t.string().default(''),
    won: t.number().default(0),
    buyIns: t.number().default(0),
    rebuys: t.uint16().default(0),
    busted: t.boolean().default(false),
    waiting: t.boolean().default(false),
    left: t.boolean().default(false),
  },
  'HoldemSeat',
);
export type HoldemSeat = SchemaType<typeof HoldemSeat>;

export const HoldemPot = schema(
  {
    amount: t.number().default(0),
    eligible: t.array('uint8'),
  },
  'HoldemPot',
);
export type HoldemPot = SchemaType<typeof HoldemPot>;

export const HoldemWinner = schema(
  {
    seat: t.int8().default(-1),
    playerId: t.string().default(''),
    name: t.string().default(''),
    potIndex: t.uint8().default(0),
    amount: t.number().default(0),
    description: t.string().default(''),
    bestCards: t.array('string'),
  },
  'HoldemWinner',
);
export type HoldemWinner = SchemaType<typeof HoldemWinner>;

export const HoldemLegal = schema(
  {
    seat: t.int8().default(-1),
    canCheck: t.boolean().default(false),
    canCall: t.boolean().default(false),
    callAmount: t.number().default(0),
    canRaise: t.boolean().default(false),
    isBet: t.boolean().default(false),
    minRaiseTo: t.number().default(0),
    maxRaiseTo: t.number().default(0),
  },
  'HoldemLegal',
);
export type HoldemLegal = SchemaType<typeof HoldemLegal>;

export const HoldemLogEntry = schema(
  {
    hand: t.uint32().default(0),
    text: t.string().default(''),
    kind: t.string().default('info'),
  },
  'HoldemLogEntry',
);
export type HoldemLogEntry = SchemaType<typeof HoldemLogEntry>;

export const HoldemStanding = schema(
  {
    playerId: t.string().default(''),
    name: t.string().default(''),
    stack: t.number().default(0),
    buyIns: t.number().default(0),
    net: t.number().default(0),
    rank: t.uint8().default(0),
    handsWon: t.uint16().default(0),
    bestPot: t.number().default(0),
  },
  'HoldemStanding',
);
export type HoldemStanding = SchemaType<typeof HoldemStanding>;

export const HoldemState = BaseRoomState.extend(
  {
    tableSize: t.uint8().default(8),
    seats: t.array(HoldemSeat),
    board: t.array('string'),
    pots: t.array(HoldemPot),
    street: t.string().default('idle'),
    handNumber: t.uint32().default(0),
    button: t.int8().default(-1),
    sbSeat: t.int8().default(-1),
    bbSeat: t.int8().default(-1),
    toActSeat: t.int8().default(-1),
    actionDeadline: t.number().default(0),
    actionMs: t.number().default(0),
    actionSeq: t.uint32().default(0),
    currentBet: t.number().default(0),
    minRaiseTo: t.number().default(0),
    smallBlind: t.number().default(0),
    bigBlind: t.number().default(0),
    blindLevel: t.uint16().default(0),
    handsToNextLevel: t.uint16().default(0),
    legal: t.ref(HoldemLegal),
    winners: t.array(HoldemWinner),
    log: t.array(HoldemLogEntry),
    runout: t.boolean().default(false),
    tableMessage: t.string().default(''),
    /** The host asked to end the game: it ends once the hand in progress is finished. */
    endRequested: t.boolean().default(false),
    standings: t.array(HoldemStanding),
  },
  'HoldemState',
);
export type HoldemState = SchemaType<typeof HoldemState>;
