/**
 * DASphalt GP synchronized state (matches `KartPublicState` in `@dascade/shared/games/kart`).
 * Only low-rate meta lives here: lobby looks, this race's entrants and standings, race meta and
 * Grand Prix points. Kart motion, projectiles and item boxes travel in the binary `kart:snap`.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { BaseRoomState } from '../../schema/base.ts';

export const KartLook = schema(
  {
    racer: t.string().default('nova'),
    body: t.string().default('buggy'),
    paint: t.string().default('#f97316'),
  },
  'KartLook',
);
export type KartLook = SchemaType<typeof KartLook>;

export const KartRacer = schema(
  {
    slot: t.uint8().default(0),
    name: t.string().default(''),
    bot: t.boolean().default(false),
    racer: t.string().default('nova'),
    body: t.string().default('buggy'),
    paint: t.string().default('#f97316'),
    lap: t.uint8().default(0),
    position: t.uint8().default(0),
    distance: t.int32().default(0),
    lapStartMs: t.uint32().default(0),
    lastLapMs: t.uint32().default(0),
    bestLapMs: t.uint32().default(0),
    finished: t.boolean().default(false),
    finishMs: t.uint32().default(0),
    finishOrder: t.uint8().default(0),
    dnf: t.boolean().default(false),
    active: t.boolean().default(true),
  },
  'KartRacer',
);
export type KartRacer = SchemaType<typeof KartRacer>;

export const KartRaceMeta = schema(
  {
    status: t.string().default('idle'),
    mode: t.string().default('race'),
    trackId: t.string().default('pixel-plaza'),
    cup: t.string().default('joystick'),
    round: t.uint8().default(0),
    rounds: t.uint8().default(0),
    laps: t.uint8().default(3),
    items: t.boolean().default(true),
    goAt: t.float64().default(0),
    finishDeadline: t.float64().default(0),
    fastestLapMs: t.uint32().default(0),
    fastestLapBy: t.string().default(''),
    entrants: t.uint8().default(0),
    solo: t.boolean().default(false),
    raceId: t.uint16().default(0),
  },
  'KartRaceMeta',
);
export type KartRaceMeta = SchemaType<typeof KartRaceMeta>;

export const KartGpEntry = schema(
  {
    name: t.string().default(''),
    bot: t.boolean().default(false),
    racer: t.string().default('nova'),
    paint: t.string().default('#f97316'),
    points: t.uint16().default(0),
    places: t.array('uint8'),
  },
  'KartGpEntry',
);
export type KartGpEntry = SchemaType<typeof KartGpEntry>;

export const KartState = BaseRoomState.extend(
  {
    looks: t.map(KartLook),
    racers: t.map(KartRacer),
    race: t.ref(KartRaceMeta),
    gp: t.map(KartGpEntry),
  },
  'KartState',
);
export type KartState = SchemaType<typeof KartState>;
