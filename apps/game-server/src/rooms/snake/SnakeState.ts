/**
 * Neon Snake synchronized state: the Classics kit standings/meta, a low-rate per-snake view
 * (score, length, lives) and the match meta. Bodies and items travel in the binary `snake:snap`.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { ClassicsState } from '../classics/schema.ts';

export const SnakeView = schema(
  {
    slot: t.uint8().default(0),
    name: t.string().default(''),
    color: t.string().default('#2de38f'),
    alive: t.boolean().default(true),
    score: t.uint32().default(0),
    length: t.uint16().default(0),
    kills: t.uint16().default(0),
    deaths: t.uint16().default(0),
    best: t.uint16().default(0),
    respawnAt: t.float64().default(0),
    place: t.uint8().default(0),
    active: t.boolean().default(true),
  },
  'SnakeView',
);
export type SnakeView = SchemaType<typeof SnakeView>;

export const SnakeMeta = schema(
  {
    status: t.string().default('idle'),
    mode: t.string().default('survival'),
    solo: t.boolean().default(false),
    cols: t.uint8().default(30),
    rows: t.uint8().default(22),
    wrap: t.boolean().default(false),
    stepMs: t.uint16().default(110),
    level: t.uint8().default(1),
    /** Server epoch ms when the round ends (0 = untimed / not running). */
    endsAt: t.float64().default(0),
    /** Server epoch ms when the snakes start moving. */
    startAt: t.float64().default(0),
    winnersJson: t.string().default('[]'),
    draw: t.boolean().default(false),
    matchId: t.uint16().default(0),
    paused: t.boolean().default(false),
  },
  'SnakeMeta',
);
export type SnakeMeta = SchemaType<typeof SnakeMeta>;

export const SnakeState = ClassicsState.extend(
  {
    snakes: t.map(SnakeView),
    match: t.ref(SnakeMeta),
  },
  'SnakeState',
);
export type SnakeState = SchemaType<typeof SnakeState>;
