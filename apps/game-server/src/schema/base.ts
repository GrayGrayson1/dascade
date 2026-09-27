/**
 * Base synchronized state shared by every DASCADE room.
 * Game rooms extend it:  export const MyState = BaseRoomState.extend({ ... }, 'MyState');
 *
 * RULE: never put hidden information (hole cards, secret words, decks, RNG state)
 * in synchronized state. Send private data with BaseGameRoom.sendTo().
 */
import { schema, t, type SchemaType } from '@colyseus/schema';

export const PlayerState = schema(
  {
    id: t.string().default(''),
    name: t.string().default(''),
    color: t.string().default('#ffffff'),
    avatar: t.string().default('rocket'),
    isHost: t.boolean().default(false),
    ready: t.boolean().default(false),
    spectator: t.boolean().default(false),
    connected: t.boolean().default(true),
    /** Joined mid-match as a spectator but wants to play next round. */
    queued: t.boolean().default(false),
    joinOrder: t.uint32().default(0),
    score: t.number().default(0),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const BaseRoomState = schema(
  {
    gameId: t.string().default(''),
    code: t.string().default(''),
    roomName: t.string().default(''),
    phase: t.string().default('LOBBY'),
    phaseEndsAt: t.number().default(0),
    hostId: t.string().default(''),
    locked: t.boolean().default(false),
    maxPlayers: t.uint16().default(8),
    allowSpectators: t.boolean().default(true),
    settingsJson: t.string().default('{}'),
    settingsRev: t.uint32().default(0),
    players: t.map(PlayerState),
    round: t.uint16().default(0),
    statusText: t.string().default(''),
    /** JSON TournamentMatchInfo when this room plays a Tournament Center match ('' otherwise). */
    tournamentJson: t.string().default(''),
  },
  'BaseRoomState',
);
export type BaseRoomState = SchemaType<typeof BaseRoomState>;
