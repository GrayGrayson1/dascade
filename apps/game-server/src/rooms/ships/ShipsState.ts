/**
 * DAS Ships synchronized state. PUBLIC information only: fleets live in the room's private
 * engine boards and travel to their own captain via `ships:private`. Shot results, sunk vessels
 * (whose squares are all hit already) and — once the game is over — the revealed fleets are public.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { BaseRoomState } from '../../schema/base.ts';

export const ShipsVessel = schema(
  {
    id: t.string().default(''),
    x: t.uint8().default(0),
    y: t.uint8().default(0),
    dir: t.string().default('h'),
  },
  'ShipsVessel',
);
export type ShipsVessel = SchemaType<typeof ShipsVessel>;

export const ShipsSide = schema(
  {
    playerId: t.string().default(''),
    name: t.string().default(''),
    ready: t.boolean().default(false),
    /** Shots received ('.' untouched · 'o' miss · 'x' hit · '#' sunk), row-major. */
    board: t.string().default(''),
    vesselsLeft: t.uint8().default(0),
    shots: t.uint16().default(0),
    hits: t.uint16().default(0),
    sunk: t.uint8().default(0),
    streak: t.uint8().default(0),
    bestStreak: t.uint8().default(0),
    timeouts: t.uint8().default(0),
    sunkVessels: t.array(ShipsVessel),
    revealed: t.array(ShipsVessel),
  },
  'ShipsSide',
);
export type ShipsSide = SchemaType<typeof ShipsSide>;

export const ShipsShot = schema(
  {
    x: t.uint8().default(0),
    y: t.uint8().default(0),
    result: t.string().default('miss'),
    vessel: t.string().default(''),
  },
  'ShipsShot',
);
export type ShipsShot = SchemaType<typeof ShipsShot>;

export const ShipsLogEntry = schema(
  {
    seq: t.uint32().default(0),
    text: t.string().default(''),
    kind: t.string().default('info'),
  },
  'ShipsLogEntry',
);
export type ShipsLogEntry = SchemaType<typeof ShipsLogEntry>;

export const ShipsState = BaseRoomState.extend(
  {
    stage: t.string().default(''),
    matchNo: t.uint32().default(0),
    gridSize: t.uint8().default(10),
    fleet: t.string().default('standard'),
    firing: t.string().default('classic'),
    spacing: t.string().default('touching'),
    sides: t.array(ShipsSide),
    turnId: t.string().default(''),
    turnSeq: t.uint32().default(0),
    turnNumber: t.uint32().default(0),
    shotsAllowed: t.uint8().default(0),
    deadline: t.float64().default(0),
    clockMs: t.uint32().default(0),
    lastShots: t.array(ShipsShot),
    lastShooterId: t.string().default(''),
    winnerId: t.string().default(''),
    endReason: t.string().default(''),
    log: t.array(ShipsLogEntry),
    rematch: t.array('string'),
  },
  'ShipsState',
);
export type ShipsState = SchemaType<typeof ShipsState>;
