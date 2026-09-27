/**
 * Asteroid Run synchronized state: the Classics kit standings/meta plus low-rate pilot and run
 * meta (lives, shields, wave). Ships, rocks, bullets and drops travel in `asteroids:snap`.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { ClassicsState } from '../classics/schema.ts';

export const PilotView = schema(
  {
    slot: t.uint8().default(0),
    name: t.string().default(''),
    color: t.string().default('#c4b5fd'),
    score: t.uint32().default(0),
    lives: t.uint8().default(0),
    shield: t.uint8().default(100),
    kills: t.uint16().default(0),
    out: t.boolean().default(false),
    active: t.boolean().default(true),
  },
  'PilotView',
);
export type PilotView = SchemaType<typeof PilotView>;

export const RunMeta = schema(
  {
    status: t.string().default('idle'),
    wave: t.uint16().default(0),
    teamScore: t.uint32().default(0),
    difficulty: t.string().default('pilot'),
    coop: t.boolean().default(false),
    matchId: t.uint16().default(0),
    startAt: t.float64().default(0),
    paused: t.boolean().default(false),
  },
  'RunMeta',
);
export type RunMeta = SchemaType<typeof RunMeta>;

export const AsteroidsState = ClassicsState.extend(
  {
    pilots: t.map(PilotView),
    run: t.ref(RunMeta),
  },
  'AsteroidsState',
);
export type AsteroidsState = SchemaType<typeof AsteroidsState>;
