/**
 * Shared multiplayer protocol: lifecycle phases, base message names, payload
 * schemas and error codes used by every DASCADE room.
 *
 * Naming convention for message types: "<namespace>:<action>".
 *   sys:*    platform plumbing (welcome, time sync, toasts, errors)
 *   lobby:*  shared lobby/host controls handled by BaseGameRoom
 *   chat:*   shared room chat (games may intercept, e.g. DASketch guesses)
 *   <gameId>:* game-specific messages (defined in packages/shared/src/games/<gameId>.ts)
 */
import { z } from 'zod';
import { config as zodConfig } from 'zod/v4/core';
import { AVATARS } from './avatars.ts';

// Browsers run DASCADE under a strict CSP without 'unsafe-eval'. Zod's JIT probes `new Function`
// when the first object schema is built, which the browser reports as a CSP violation on every
// page. Browsers don't need the JIT (validation there is rare), so skip it; the server keeps it.
if (typeof (globalThis as { document?: unknown }).document !== 'undefined') zodConfig({ jitless: true });

export const PHASES = ['LOBBY', 'COUNTDOWN', 'PLAYING', 'INTERMISSION', 'RESULTS', 'ENDED'] as const;
export type Phase = (typeof PHASES)[number];

export const LIMITS = {
  nickname: 20,
  roomName: 32,
  chat: 200,
  chatHistory: 60,
} as const;

/** Seconds a dropped client may reconnect with its Colyseus session before being marked away. */
export const RECONNECT_GRACE_SECONDS = 45;
/** Milliseconds a disconnected host keeps host powers before they migrate. */
export const HOST_MIGRATION_DELAY_MS = 10_000;
/** Pre-game countdown. */
export const DEFAULT_COUNTDOWN_MS = 3_000;

// ---------------------------------------------------------------------------
// Message names
// ---------------------------------------------------------------------------

export const SYS = {
  /** server → client: identity + seat token after join / reconnect. */
  welcome: 'sys:welcome',
  /** client → server {t0}; server → client {t0, server}. */
  time: 'sys:time',
  /** server → client: transient notification. */
  toast: 'sys:toast',
  /** server → client: an action was rejected. */
  error: 'sys:error',
  /** server → client: sent just before the server removes this client. */
  removed: 'sys:removed',
} as const;

export const LOBBY = {
  ready: 'lobby:ready',
  spectate: 'lobby:spectate',
  profile: 'lobby:profile',
  settings: 'lobby:settings',
  room: 'lobby:room',
  kick: 'lobby:kick',
  transferHost: 'lobby:transferHost',
  start: 'lobby:start',
  toLobby: 'lobby:toLobby',
  close: 'lobby:close',
} as const;

export const CHAT = {
  send: 'chat:send',
  msg: 'chat:msg',
  history: 'chat:history',
} as const;

// ---------------------------------------------------------------------------
// Join / create options
// ---------------------------------------------------------------------------

/**
 * Schemas are built through PURE-annotated thunks so bundlers can drop them (and zod with them)
 * from client chunks that only need the constants/catalog — e.g. the arcade landing page.
 */
const lazy = <T>(build: () => T): T => build();

export const AvatarSchema = /* @__PURE__ */ lazy(() => z.enum(AVATARS));

export const JoinOptionsSchema = /* @__PURE__ */ lazy(() =>
  z.object({
    name: z.string().max(64),
    avatar: AvatarSchema.optional(),
    /** Secret returned in sys:welcome; lets a player reclaim their seat after a long disconnect/refresh. */
    seatToken: z.string().max(64).optional(),
    /** Stable, non-secret local guest identity (used only for stats/persistence correlation). */
    guestId: z.string().max(64).optional(),
    spectator: z.boolean().optional(),
    /** Supabase access token when the user has a persistent account (optional). */
    accessToken: z.string().max(4096).optional(),
  }),
);
export type JoinOptions = z.infer<typeof JoinOptionsSchema>;

export const CreateOptionsSchema = /* @__PURE__ */ lazy(() =>
  JoinOptionsSchema.extend({
    roomName: z.string().max(64).optional(),
    maxPlayers: z.number().int().min(1).max(100).optional(),
    /** Partial game settings; merged over defaults and validated by the room. */
    settings: z.record(z.string(), z.unknown()).optional(),
    /** Private solo room (auto-locked, no lobby wait). */
    solo: z.boolean().optional(),
  }),
);
export type CreateOptions = z.infer<typeof CreateOptionsSchema>;

// ---------------------------------------------------------------------------
// Base client → server payloads
// ---------------------------------------------------------------------------

export const TimeSyncRequestSchema = /* @__PURE__ */ lazy(() => z.object({ t0: z.number() }));
export const ReadySchema = /* @__PURE__ */ lazy(() => z.object({ ready: z.boolean() }));
export const SpectateSchema = /* @__PURE__ */ lazy(() => z.object({ spectator: z.boolean() }));
export const ProfileSchema = /* @__PURE__ */ lazy(() =>
  z.object({
    name: z.string().max(64).optional(),
    avatar: AvatarSchema.optional(),
  }),
);
export const SettingsUpdateSchema = /* @__PURE__ */ lazy(() => z.object({ settings: z.record(z.string(), z.unknown()) }));
export const RoomUpdateSchema = /* @__PURE__ */ lazy(() =>
  z.object({
    roomName: z.string().max(64).optional(),
    locked: z.boolean().optional(),
    maxPlayers: z.number().int().min(1).max(100).optional(),
    allowSpectators: z.boolean().optional(),
  }),
);
export const TargetPlayerSchema = /* @__PURE__ */ lazy(() => z.object({ playerId: z.string().min(1).max(64) }));
export const StartSchema = /* @__PURE__ */ lazy(() => z.object({ force: z.boolean().optional() }).optional());
export const EmptySchema = /* @__PURE__ */ lazy(() => z.object({}).optional());
export const ChatSendSchema = /* @__PURE__ */ lazy(() => z.object({ text: z.string().min(1).max(500) }));

// ---------------------------------------------------------------------------
// Server → client payloads
// ---------------------------------------------------------------------------

export interface WelcomePayload {
  playerId: string;
  seatToken: string;
  code: string;
  gameId: string;
  serverNow: number;
  /** True when this join re-attached to an existing seat. */
  rejoined: boolean;
}

export interface TimeSyncResponse {
  t0: number;
  server: number;
}

export type ToastKind = 'info' | 'success' | 'warning' | 'error';
export interface ToastPayload {
  kind: ToastKind;
  text: string;
}

export interface ActionErrorPayload {
  /** The message type that was rejected (if applicable). */
  type?: string;
  code: ActionErrorCode;
  message: string;
}

export type ActionErrorCode =
  | 'invalid_payload'
  | 'rate_limited'
  | 'not_host'
  | 'wrong_phase'
  | 'not_allowed'
  | 'not_your_turn'
  | 'insufficient_chips'
  | 'server_error';

export interface RemovedPayload {
  reason: 'kicked' | 'room_closed' | 'idle';
  message: string;
}

export type ChatKind = 'chat' | 'system' | 'guess' | 'close' | 'correct';
export interface ChatMessage {
  id: string;
  playerId: string | null;
  name: string;
  text: string;
  ts: number;
  kind: ChatKind;
  /** Optional color for the name label. */
  color?: string;
}

// ---------------------------------------------------------------------------
// Error / close codes
// ---------------------------------------------------------------------------

/**
 * Codes thrown (as ServerError) when a join is rejected.
 * 44xx codes are raised inside the room (onJoin, delivered over the socket).
 * Errors raised during HTTP matchmaking (static onAuth) must be valid HTTP statuses, hence 429.
 */
export const JoinErrorCode = {
  ROOM_LOCKED: 4401,
  ROOM_FULL: 4402,
  KICKED: 4403,
  NOT_FOUND: 4404,
  MATCH_ENDED: 4405,
  INVALID_OPTIONS: 4406,
  RATE_LIMITED: 429,
} as const;
export type JoinErrorCode = (typeof JoinErrorCode)[keyof typeof JoinErrorCode];

export const RoomCloseCode = {
  KICKED: 4403,
  ROOM_CLOSED: 4410,
} as const;

// ---------------------------------------------------------------------------
// Public (synchronized) state shapes as seen by clients (after `state.toJSON()`).
// Game states extend BaseRoomView with their own fields.
// ---------------------------------------------------------------------------

export interface PlayerView {
  id: string;
  name: string;
  color: string;
  avatar: string;
  isHost: boolean;
  ready: boolean;
  spectator: boolean;
  connected: boolean;
  /** Joined mid-match as a spectator; will be seated next round. */
  queued: boolean;
  joinOrder: number;
  score: number;
}

export interface BaseRoomView {
  gameId: string;
  code: string;
  roomName: string;
  phase: Phase;
  /** Server epoch ms when the current phase/timer ends (0 = no timer). */
  phaseEndsAt: number;
  hostId: string;
  locked: boolean;
  maxPlayers: number;
  allowSpectators: boolean;
  /** JSON of the validated game settings. */
  settingsJson: string;
  settingsRev: number;
  players: Record<string, PlayerView>;
  round: number;
  statusText: string;
}

/** Room info returned by GET /api/rooms/:code (used before joining). */
export interface RoomLookup {
  exists: boolean;
  code: string;
  gameId?: string;
  roomName?: string;
  phase?: Phase;
  players?: number;
  maxPlayers?: number;
  locked?: boolean;
  full?: boolean;
  allowSpectators?: boolean;
}

/** Matchmaking metadata the server keeps on each room listing. */
export interface RoomMetadata {
  gameId: string;
  roomName: string;
  phase: Phase;
  players: number;
  maxPlayers: number;
  locked: boolean;
  allowSpectators: boolean;
  solo: boolean;
}
