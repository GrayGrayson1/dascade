/**
 * Synchronized state shared by every DAScade Classics room.
 * Games extend it:  export const BricksState = ClassicsState.extend({ ... }, 'BricksState');
 * Nothing hidden lives here: seeds and input logs travel privately (classics:run).
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { BaseRoomState } from '../../schema/base.ts';

export const ClassicsStanding = schema(
  {
    name: t.string().default(''),
    color: t.string().default('#ffffff'),
    score: t.number().default(0),
    level: t.uint16().default(0),
    lives: t.uint8().default(0),
    stat: t.uint32().default(0),
    /** ClassicsStatus: idle | ready | playing | over | out */
    status: t.string().default('idle'),
    best: t.number().default(0),
    runs: t.uint16().default(0),
    rank: t.uint8().default(0),
    ticks: t.uint32().default(0),
  },
  'ClassicsStanding',
);
export type ClassicsStanding = SchemaType<typeof ClassicsStanding>;

export const ClassicsMeta = schema(
  {
    solo: t.boolean().default(false),
    mode: t.string().default(''),
    startAt: t.float64().default(0),
    endsAt: t.float64().default(0),
    matchNo: t.uint16().default(0),
    entrants: t.uint8().default(0),
    statLabel: t.string().default(''),
    board: t.string().default(''),
  },
  'ClassicsMeta',
);
export type ClassicsMeta = SchemaType<typeof ClassicsMeta>;

export const ClassicsState = BaseRoomState.extend(
  {
    standings: t.map(ClassicsStanding),
    classics: t.ref(ClassicsMeta),
  },
  'ClassicsState',
);
export type ClassicsState = SchemaType<typeof ClassicsState>;
