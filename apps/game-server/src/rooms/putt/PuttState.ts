/**
 * DAS Putt synchronized state. Golf has no hidden information; everything a late joiner
 * needs is here. Ball motion itself travels as `putt:shot` paths (animated by clients);
 * lies/strokes are published when a ball comes to rest so the scoreboard never spoils a roll.
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { BaseRoomState } from '../../schema/base.ts';

export const Golfer = schema(
  {
    name: t.string().default(''),
    color: t.string().default('#ffffff'),
    order: t.uint8().default(0),
    x: t.float32().default(0),
    y: t.float32().default(0),
    strokes: t.uint8().default(0),
    holed: t.boolean().default(false),
    pickedUp: t.boolean().default(false),
    retired: t.boolean().default(false),
    moving: t.boolean().default(false),
    deadline: t.float64().default(0),
    card: t.array('uint8'),
    total: t.uint16().default(0),
    parPlayed: t.uint16().default(0),
    holesInOne: t.uint8().default(0),
    lastSeq: t.uint32().default(0),
  },
  'Golfer',
);
export type Golfer = SchemaType<typeof Golfer>;

export const PuttState = BaseRoomState.extend(
  {
    golfers: t.map(Golfer),
    mode: t.string().default('turns'),
    route: t.array('uint8'),
    holeIndex: t.uint8().default(0),
    holeStatus: t.string().default('idle'),
    holeStartedAt: t.float64().default(0),
    introEndsAt: t.float64().default(0),
    turnId: t.string().default(''),
    shotSeq: t.uint32().default(0),
    regulation: t.uint8().default(9),
    maxOverPar: t.uint8().default(4),
    shotClock: t.uint8().default(30),
    solo: t.boolean().default(false),
    tournament: t.boolean().default(false),
    playoffIds: t.array('string'),
    winners: t.array('string'),
  },
  'PuttState',
);
export type PuttState = SchemaType<typeof PuttState>;
