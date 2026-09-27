/**
 * Pixel Paddle synchronized state: the Classics kit standings/meta plus low-rate match meta
 * (sides, scores, serve, winner). Ball and paddle motion travel in the binary `paddle:snap`.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { ClassicsState } from '../classics/schema.ts';

export const PaddleSide = schema(
  {
    playerId: t.string().default(''),
    name: t.string().default('House'),
    color: t.string().default('#22d3ee'),
    ai: t.boolean().default(true),
    score: t.uint8().default(0),
    hits: t.uint16().default(0),
  },
  'PaddleSide',
);
export type PaddleSide = SchemaType<typeof PaddleSide>;

export const PaddleMeta = schema(
  {
    status: t.string().default('idle'),
    target: t.uint8().default(7),
    winBy2: t.boolean().default(true),
    speed: t.string().default('classic'),
    aiLevel: t.string().default('pro'),
    server: t.uint8().default(0),
    winner: t.int8().default(-1),
    reason: t.string().default(''),
    rally: t.uint16().default(0),
    longestRally: t.uint16().default(0),
    pointsPlayed: t.uint16().default(0),
    matchId: t.uint16().default(0),
    /** Server epoch ms when play begins (solo READY lead-in / multiplayer countdown end). */
    startAt: t.float64().default(0),
    /** Solo game paused (the simulation is frozen). */
    paused: t.boolean().default(false),
  },
  'PaddleMeta',
);
export type PaddleMeta = SchemaType<typeof PaddleMeta>;

export const PaddleState = ClassicsState.extend(
  {
    left: t.ref(PaddleSide),
    right: t.ref(PaddleSide),
    match: t.ref(PaddleMeta),
  },
  'PaddleState',
);
export type PaddleState = SchemaType<typeof PaddleState>;
