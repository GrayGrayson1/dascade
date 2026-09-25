/**
 * DASino synchronized state. Everything here is public by design: balances,
 * who sits where, every bet on the felt, results and the big-win ticker.
 * Outcomes are only written once the server has decided them.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { BaseRoomState } from '../../schema/base.ts';

export const DasinoSeat = schema(
  {
    id: t.string().default(''),
    balance: t.number().default(0),
    inPlay: t.number().default(0),
    credited: t.number().default(0),
    refills: t.uint32().default(0),
    table: t.string().default('floor'),
    wagered: t.number().default(0),
    returned: t.number().default(0),
    biggestWin: t.number().default(0),
    spins: t.uint32().default(0),
  },
  'DasinoSeat',
);
export type DasinoSeat = SchemaType<typeof DasinoSeat>;

export const RouletteBetEntry = schema(
  {
    playerId: t.string().default(''),
    spot: t.string().default(''),
    amount: t.number().default(0),
  },
  'DasinoRouletteBet',
);
export type RouletteBetEntry = SchemaType<typeof RouletteBetEntry>;

export const RoundPayout = schema(
  {
    playerId: t.string().default(''),
    staked: t.number().default(0),
    returned: t.number().default(0),
  },
  'DasinoRoundPayout',
);
export type RoundPayout = SchemaType<typeof RoundPayout>;

export const RouletteTable = schema(
  {
    phase: t.string().default('IDLE'),
    round: t.uint32().default(0),
    endsAt: t.number().default(0),
    result: t.int8().default(-1),
    spinStartAt: t.number().default(0),
    spinMs: t.uint32().default(0),
    spinSeed: t.uint16().default(0),
    bets: t.array(RouletteBetEntry),
    history: t.array('uint8'),
    payouts: t.array(RoundPayout),
  },
  'DasinoRoulette',
);
export type RouletteTable = SchemaType<typeof RouletteTable>;

export const DiceBetEntry = schema(
  {
    playerId: t.string().default(''),
    pick: t.string().default('higher'),
    amount: t.number().default(0),
  },
  'DasinoDiceBet',
);
export type DiceBetEntry = SchemaType<typeof DiceBetEntry>;

export const DiceHistoryEntry = schema(
  {
    round: t.uint32().default(0),
    point: t.uint8().default(0),
    a: t.uint8().default(0),
    b: t.uint8().default(0),
    outcome: t.string().default('same'),
  },
  'DasinoDiceHistory',
);
export type DiceHistoryEntry = SchemaType<typeof DiceHistoryEntry>;

export const DiceTable = schema(
  {
    phase: t.string().default('IDLE'),
    round: t.uint32().default(0),
    endsAt: t.number().default(0),
    pointA: t.uint8().default(0),
    pointB: t.uint8().default(0),
    rollA: t.uint8().default(0),
    rollB: t.uint8().default(0),
    rollStartAt: t.number().default(0),
    rollMs: t.uint32().default(0),
    bets: t.array(DiceBetEntry),
    history: t.array(DiceHistoryEntry),
    payouts: t.array(RoundPayout),
  },
  'DasinoDice',
);
export type DiceTable = SchemaType<typeof DiceTable>;

export const TickerEntry = schema(
  {
    id: t.string().default(''),
    playerId: t.string().default(''),
    name: t.string().default(''),
    game: t.string().default('roulette'),
    amount: t.number().default(0),
    multiple: t.number().default(0),
    label: t.string().default(''),
    at: t.number().default(0),
  },
  'DasinoTicker',
);
export type TickerEntry = SchemaType<typeof TickerEntry>;

export const ResultEntry = schema(
  {
    playerId: t.string().default(''),
    name: t.string().default(''),
    avatar: t.string().default('rocket'),
    color: t.string().default('#ffffff'),
    placement: t.uint16().default(0),
    net: t.number().default(0),
    balance: t.number().default(0),
    wagered: t.number().default(0),
    biggestWin: t.number().default(0),
    refills: t.uint32().default(0),
  },
  'DasinoResult',
);
export type ResultEntry = SchemaType<typeof ResultEntry>;

export const DasinoState = BaseRoomState.extend(
  {
    seats: t.map(DasinoSeat),
    roulette: t.ref(RouletteTable),
    dice: t.ref(DiceTable),
    ticker: t.array(TickerEntry),
    results: t.array(ResultEntry),
  },
  'DasinoState',
);
export type DasinoState = SchemaType<typeof DasinoState>;
