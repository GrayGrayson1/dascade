/**
 * DAS Tanks synchronized state. Everything here is public (artillery has no hidden
 * information): the terrain heightmap (base64, rewritten once per shot), tanks, wind
 * and the turn. Shots themselves travel as `tanks:shot` scripts for animation.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { BaseRoomState } from '../../schema/base.ts';

export const TankAmmo = schema(
  {
    shell: t.int8().default(-1),
    heavy: t.int8().default(0),
    cluster: t.int8().default(0),
    airburst: t.int8().default(0),
    driller: t.int8().default(0),
    dirt: t.int8().default(0),
  },
  'TankAmmo',
);
export type TankAmmo = SchemaType<typeof TankAmmo>;

export const Tank = schema(
  {
    id: t.string().default(''),
    slot: t.uint8().default(0),
    name: t.string().default(''),
    color: t.string().default('#ff8a3d'),
    team: t.int8().default(-1),
    x: t.float64().default(0),
    y: t.float64().default(0),
    hp: t.int16().default(100),
    maxHp: t.int16().default(100),
    alive: t.boolean().default(true),
    angle: t.uint8().default(45),
    power: t.uint8().default(60),
    weapon: t.string().default('shell'),
    fuel: t.float32().default(0),
    maxFuel: t.float32().default(0),
    ammo: t.ref(TankAmmo),
    place: t.uint8().default(0),
    kills: t.uint8().default(0),
    damage: t.uint16().default(0),
    shots: t.uint16().default(0),
    hits: t.uint16().default(0),
    gone: t.boolean().default(false),
    cpu: t.boolean().default(false),
  },
  'TanksTank',
);
export type Tank = SchemaType<typeof Tank>;

export const BattleMeta = schema(
  {
    stage: t.string().default('idle'),
    terrain: t.string().default(''),
    terrainRev: t.uint16().default(0),
    width: t.uint16().default(1600),
    height: t.uint16().default(900),
    theme: t.string().default('dusk'),
    style: t.string().default('hills'),
    wind: t.int8().default(0),
    turnId: t.uint16().default(0),
    activeId: t.string().default(''),
    turnEndsAt: t.float64().default(0),
    resolveEndsAt: t.float64().default(0),
    shotSeq: t.uint16().default(0),
    mode: t.string().default('ffa'),
    maxRounds: t.uint8().default(15),
    friendlyFire: t.boolean().default(false),
    winnerTeam: t.int8().default(-1),
    winners: t.string().default(''),
    reason: t.string().default(''),
    /** Comma-separated ids of the next few tanks to play. */
    queue: t.string().default(''),
  },
  'TanksBattle',
);
export type BattleMeta = SchemaType<typeof BattleMeta>;

export const Crew = schema({ team: t.int8().default(-1) }, 'TanksCrew');
export type Crew = SchemaType<typeof Crew>;

export const TanksState = BaseRoomState.extend(
  {
    tanks: t.map(Tank),
    battle: t.ref(BattleMeta),
    crew: t.map(Crew),
  },
  'TanksState',
);
export type TanksState = SchemaType<typeof TanksState>;
