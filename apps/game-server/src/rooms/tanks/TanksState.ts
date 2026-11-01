/**
 * DAS Tanks synchronized state. Everything here is public (artillery has no hidden
 * information): the terrain heightmap (base64, rewritten once per shot), this battle's tanks,
 * the match fleet (credits, inventories, scores), wind and the stage. Shots themselves travel
 * as `tanks:shot` scripts for animation.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { ITEM_IDS, WEAPON_IDS } from '@dascade/shared/games/tanks';
import { BaseRoomState } from '../../schema/base.ts';

/** One int8 counter per weapon (-1 = unlimited, for the shell). */
export const FleetAmmo = schema(Object.fromEntries(WEAPON_IDS.map((id) => [id, t.int8().default(id === 'shell' ? -1 : 0)])), 'TanksAmmo');
export type FleetAmmo = SchemaType<typeof FleetAmmo> & Record<string, number>;

/** One int8 counter per item. */
export const FleetItems = schema(Object.fromEntries(ITEM_IDS.map((id) => [id, t.int8().default(0)])), 'TanksItems');
export type FleetItems = SchemaType<typeof FleetItems> & Record<string, number>;

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
    shield: t.int16().default(0),
    shieldMax: t.int16().default(0),
    shieldKind: t.string().default(''),
    buried: t.uint16().default(0),
    locked: t.boolean().default(false),
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

export const Fleet = schema(
  {
    id: t.string().default(''),
    name: t.string().default(''),
    color: t.string().default('#ff8a3d'),
    team: t.int8().default(-1),
    cpu: t.boolean().default(false),
    persona: t.string().default(''),
    credits: t.int32().default(0),
    score: t.int32().default(0),
    wins: t.uint8().default(0),
    kills: t.uint16().default(0),
    damage: t.uint32().default(0),
    ammo: t.ref(FleetAmmo),
    items: t.ref(FleetItems),
    ready: t.boolean().default(false),
    basket: t.string().default(''),
    earned: t.int32().default(0),
    earnBase: t.int32().default(0),
    earnDamage: t.int32().default(0),
    earnKills: t.int32().default(0),
    earnSurvive: t.int32().default(0),
    earnWin: t.int32().default(0),
    earnPenalty: t.int32().default(0),
    battleScore: t.int32().default(0),
    place: t.uint8().default(0),
    gone: t.boolean().default(false),
  },
  'TanksFleet',
);
export type Fleet = SchemaType<typeof Fleet>;

export const BattleMeta = schema(
  {
    stage: t.string().default('idle'),
    battleSerial: t.uint16().default(0),
    terrain: t.string().default(''),
    terrainRev: t.uint16().default(0),
    width: t.uint16().default(1600),
    height: t.uint16().default(900),
    theme: t.string().default('dusk'),
    style: t.string().default('hills'),
    walls: t.string().default('open'),
    gravity: t.string().default('normal'),
    economy: t.string().default('shop'),
    wind: t.int8().default(0),
    turnId: t.uint16().default(0),
    activeId: t.string().default(''),
    turnEndsAt: t.float64().default(0),
    stageEndsAt: t.float64().default(0),
    resolveEndsAt: t.float64().default(0),
    shotSeq: t.uint16().default(0),
    mode: t.string().default('ffa'),
    turnMode: t.string().default('turns'),
    maxRounds: t.uint8().default(12),
    friendlyFire: t.boolean().default(false),
    battleNo: t.uint8().default(0),
    battles: t.uint8().default(1),
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
    fleet: t.map(Fleet),
    battle: t.ref(BattleMeta),
    crew: t.map(Crew),
  },
  'TanksState',
);
export type TanksState = SchemaType<typeof TanksState>;
