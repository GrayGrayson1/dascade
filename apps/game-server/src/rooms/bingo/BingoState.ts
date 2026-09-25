/**
 * DAS Bingo synchronized state. Cards are hidden information: they never appear here
 * until a verified winner's card is revealed in `winners`.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { BaseRoomState } from '../../schema/base.ts';

export const BingoPlayer = schema(
  {
    id: t.string().default(''),
    wins: t.uint8().default(0),
    falseClaims: t.uint16().default(0),
    /** Server epoch ms until which this player can't claim (false-claim penalty). */
    lockedUntil: t.number().default(0),
    /** Squares still needed for the closest pattern (-1 = hidden / no card). */
    need: t.int16().default(-1),
    hasCard: t.boolean().default(false),
  },
  'BingoPlayer',
);
export type BingoPlayer = SchemaType<typeof BingoPlayer>;

export const BingoWinner = schema(
  {
    playerId: t.string().default(''),
    name: t.string().default(''),
    color: t.string().default('#ffffff'),
    avatar: t.string().default('rocket'),
    round: t.uint8().default(0),
    callCount: t.uint16().default(0),
    patternName: t.string().default(''),
    mask: t.string().default(''),
    cells: t.array('int16'),
    serial: t.uint16().default(0),
    deal: t.uint8().default(0),
    prize: t.string().default(''),
    at: t.number().default(0),
  },
  'BingoWinner',
);
export type BingoWinner = SchemaType<typeof BingoWinner>;

export const BingoState = BaseRoomState.extend(
  {
    matchId: t.string().default(''),
    mode: t.string().default('numbers'),
    size: t.uint8().default(5),
    free: t.boolean().default(true),
    poolSize: t.uint16().default(75),
    totalRounds: t.uint8().default(1),
    /** JSON BingoPlanRound[]: resolved masks for every round of the match. */
    planJson: t.string().default('[]'),
    /** idle | calling | claiming | closed */
    roundStatus: t.string().default('idle'),
    calls: t.array('int16'),
    lastCallAt: t.number().default(0),
    nextCallAt: t.number().default(0),
    callerMode: t.string().default('auto'),
    manualPick: t.boolean().default(false),
    callIntervalMs: t.number().default(6000),
    paused: t.boolean().default(false),
    canUndo: t.boolean().default(false),
    claimWindowEndsAt: t.number().default(0),
    deal: t.uint8().default(0),
    winners: t.array(BingoWinner),
    bingo: t.map(BingoPlayer),
    /** The card seed, revealed once the match is over. */
    seed: t.string().default(''),
    /** The host set a fixed card seed (the value itself stays private until results). */
    customSeed: t.boolean().default(false),
    showProgress: t.boolean().default(true),
    autoMark: t.boolean().default(true),
  },
  'BingoState',
);
export type BingoState = SchemaType<typeof BingoState>;
