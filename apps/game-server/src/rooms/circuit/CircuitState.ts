/**
 * DASh Circuit synchronized state. Only low-rate race meta lives here (car looks,
 * laps, standings, best laps, finish order). Car motion travels in the binary
 * `circuit:snap` broadcast so schema patches stay tiny even with 20 racers.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { BaseRoomState } from '../../schema/base.ts';

export const CarLook = schema(
  {
    chassis: t.string().default('volt'),
    primary: t.string().default('#22d3ee'),
    secondary: t.string().default('#f97316'),
    decal: t.string().default('stripes'),
    wheels: t.string().default('spoke'),
    number: t.uint8().default(7),
    nameplate: t.string().default('RACER'),
  },
  'CarLook',
);
export type CarLook = SchemaType<typeof CarLook>;

export const Racer = schema(
  {
    slot: t.uint8().default(0),
    name: t.string().default(''),
    lap: t.uint8().default(0),
    gate: t.uint8().default(0),
    position: t.uint8().default(0),
    distance: t.int32().default(0),
    lapStartMs: t.uint32().default(0),
    lastLapMs: t.uint32().default(0),
    bestLapMs: t.uint32().default(0),
    finished: t.boolean().default(false),
    finishMs: t.uint32().default(0),
    finishOrder: t.uint8().default(0),
    dnf: t.boolean().default(false),
    wrongWay: t.boolean().default(false),
    active: t.boolean().default(true),
  },
  'Racer',
);
export type Racer = SchemaType<typeof Racer>;

export const RaceMeta = schema(
  {
    status: t.string().default('idle'),
    trackId: t.string().default('neon-loop'),
    laps: t.uint8().default(3),
    goAt: t.number().default(0),
    finishDeadline: t.number().default(0),
    fastestLapMs: t.uint32().default(0),
    fastestLapBy: t.string().default(''),
    entrants: t.uint8().default(0),
    solo: t.boolean().default(false),
    raceId: t.uint16().default(0),
  },
  'RaceMeta',
);
export type RaceMeta = SchemaType<typeof RaceMeta>;

export const CircuitState = BaseRoomState.extend(
  {
    cars: t.map(CarLook),
    racers: t.map(Racer),
    race: t.ref(RaceMeta),
  },
  'CircuitState',
);
export type CircuitState = SchemaType<typeof CircuitState>;
