/**
 * DASjack 21 synchronized state. Public information only: the dealer's hole
 * card and the shoe order live exclusively inside the room's BlackjackRound/Shoe
 * and are never written here before the hole card is legally revealed.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { BaseRoomState } from '../../schema/base.ts';

export const BjHand = schema(
  {
    cards: t.array('string'),
    bet: t.number().default(0),
    doubled: t.boolean().default(false),
    split: t.boolean().default(false),
    status: t.string().default('waiting'),
    total: t.uint8().default(0),
    soft: t.boolean().default(false),
    label: t.string().default(''),
    result: t.string().default(''),
    net: t.number().default(0),
  },
  'BjHand',
);
export type BjHand = SchemaType<typeof BjHand>;

export const BjSeat = schema(
  {
    playerId: t.string().default(''),
    /** Display name (kept so a seat that is settled after its player left still reads well). */
    name: t.string().default(''),
    seat: t.uint8().default(0),
    balance: t.number().default(0),
    bet: t.number().default(0),
    lastBet: t.number().default(0),
    locked: t.boolean().default(false),
    sittingOut: t.boolean().default(false),
    inRound: t.boolean().default(false),
    hands: t.array(BjHand),
    activeHand: t.int8().default(-1),
    actions: t.array('string'),
    insurance: t.number().default(0),
    insuranceState: t.string().default(''),
    done: t.boolean().default(false),
    deadline: t.number().default(0),
    net: t.number().default(0),
    refills: t.uint16().default(0),
    bought: t.number().default(0),
    left: t.boolean().default(false),
    handsPlayed: t.uint32().default(0),
    handsWon: t.uint32().default(0),
    blackjacks: t.uint32().default(0),
    biggestWin: t.number().default(0),
    /** Bumps on every accepted decision (and each new round): actions carry it, so a repeat can't apply twice. */
    actionSeq: t.uint32().default(0),
  },
  'BjSeat',
);
export type BjSeat = SchemaType<typeof BjSeat>;

export const BjDealer = schema(
  {
    cards: t.array('string'),
    hasHole: t.boolean().default(false),
    revealed: t.boolean().default(false),
    total: t.uint8().default(0),
    soft: t.boolean().default(false),
    label: t.string().default(''),
    blackjack: t.boolean().default(false),
    bust: t.boolean().default(false),
    peeked: t.boolean().default(false),
  },
  'BjDealer',
);
export type BjDealer = SchemaType<typeof BjDealer>;

export const BlackjackState = BaseRoomState.extend(
  {
    stage: t.string().default('IDLE'),
    seats: t.map(BjSeat),
    dealer: t.ref(BjDealer),
    rulesJson: t.string().default('{}'),
    shoeSize: t.uint16().default(0),
    shoeRemaining: t.uint16().default(0),
    cutRemaining: t.uint16().default(0),
    discards: t.uint16().default(0),
    cutReached: t.boolean().default(false),
    shuffles: t.uint32().default(0),
    endRequested: t.boolean().default(false),
    /** "No more bets" was called: betting circles are frozen until the deal. */
    betsClosed: t.boolean().default(false),
  },
  'BlackjackState',
);
export type BlackjackState = SchemaType<typeof BlackjackState>;
