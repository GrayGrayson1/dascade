/**
 * RoomSession — the single owner of the Colyseus connection.
 *
 * - Exactly one Client instance and at most one joined Room at a time.
 * - Handles create/join/resume/leave, automatic reconnect, seat-token rejoin
 *   after refresh, clock sync, chat log, a message bus with "last payload"
 *   replay (so private messages that arrive before a component mounts are not lost),
 *   and a cheap versioned snapshot of room.state for React.
 *
 * React reads it through the hooks in ./hooks.ts. Phaser scenes may use
 * `session.room` directly (e.g. to read high-frequency state without React).
 */
import { Client, type Room } from '@colyseus/sdk';
import { create } from 'zustand';
import {
  CHAT,
  JoinErrorCode,
  LOBBY,
  RoomCloseCode,
  SYS,
  isValidRoomCode,
  normalizeRoomCode,
  type ActionErrorPayload,
  type BaseRoomView,
  type ChatMessage,
  type GameId,
  type RemovedPayload,
  type RoomLookup,
  type TimeSyncResponse,
  type ToastPayload,
  type WelcomePayload,
} from '@dascade/shared';
import { serverUrl } from './serverUrl.ts';
import { friendly, toFriendlyError, type FriendlyError } from './errors.ts';
import { useApp } from '../app/store.ts';
import { persistence } from '../persistence/index.ts';
import { sfx } from '../audio/audio.ts';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'lost';

/** Colyseus close codes (see @colyseus/shared-types CloseCode). */
const CLOSE_CONSENTED = 4000;
const CLOSE_SERVER_SHUTDOWN = 4001;

export interface SessionState {
  status: ConnectionStatus;
  room: Room | null;
  gameId: GameId | null;
  code: string | null;
  playerId: string | null;
  error: FriendlyError | null;
  removed: RemovedPayload | null;
  /** Round-trip latency estimate (ms). */
  pingMs: number | null;
  chat: ChatMessage[];
}

const initial: SessionState = {
  status: 'idle',
  room: null,
  gameId: null,
  code: null,
  playerId: null,
  error: null,
  removed: null,
  pingMs: null,
  chat: [],
};

export const useSessionStore = create<SessionState>(() => ({ ...initial }));

// ---------------------------------------------------------------------------
// Stored seat info (sessionStorage per tab: survives refresh, not new tabs)
// ---------------------------------------------------------------------------
interface StoredSeat {
  code: string;
  gameId: string;
  seatToken: string;
  reconnectionToken?: string;
  savedAt: number;
}

const SEAT_KEY = (code: string) => `dascade:seat:${code}`;

const SEAT_TTL_MS = 12 * 3600_000;

function saveSeat(seat: StoredSeat): void {
  try {
    sessionStorage.setItem(SEAT_KEY(seat.code), JSON.stringify(seat));
    // Remember seat tokens across tabs too (lets a closed tab rejoin its seat).
    localStorage.setItem(SEAT_KEY(seat.code), JSON.stringify({ ...seat, reconnectionToken: undefined }));
    pruneSeats(localStorage);
  } catch {
    /* ignore */
  }
}

/** Drop expired / unreadable seat entries so localStorage doesn't grow with every room ever joined. */
function pruneSeats(storage: Storage): void {
  const prefix = SEAT_KEY('');
  for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    try {
      const seat = JSON.parse(storage.getItem(key) ?? 'null') as StoredSeat | null;
      if (!seat || typeof seat.savedAt !== 'number' || Date.now() - seat.savedAt > SEAT_TTL_MS) storage.removeItem(key);
    } catch {
      storage.removeItem(key);
    }
  }
}

function loadSeat(code: string): StoredSeat | null {
  try {
    const raw = sessionStorage.getItem(SEAT_KEY(code)) ?? localStorage.getItem(SEAT_KEY(code));
    if (!raw) return null;
    const seat = JSON.parse(raw) as StoredSeat;
    if (!seat || typeof seat.seatToken !== 'string' || seat.code !== code) return null;
    if (Date.now() - seat.savedAt > SEAT_TTL_MS) return null;
    return seat;
  } catch {
    return null;
  }
}

function clearSeat(code: string): void {
  try {
    sessionStorage.removeItem(SEAT_KEY(code));
    localStorage.removeItem(SEAT_KEY(code));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Message bus with last-value cache
// ---------------------------------------------------------------------------
type Listener = (payload: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
const lastPayload = new Map<string, unknown>();
const stateListeners = new Set<() => void>();

export function subscribeMessage(type: string, listener: Listener): () => void {
  let set = listeners.get(type);
  if (!set) {
    set = new Set();
    listeners.set(type, set);
  }
  set.add(listener);
  return () => set.delete(listener);
}

export function getLastMessage<T>(type: string): T | undefined {
  return lastPayload.get(type) as T | undefined;
}

function emit(type: string, payload: unknown): void {
  lastPayload.set(type, payload);
  const set = listeners.get(type);
  if (set) for (const l of [...set]) l(payload);
  const any = listeners.get('*');
  if (any) for (const l of [...any]) l({ type, payload });
}

// ---------------------------------------------------------------------------
// State snapshot (lazy toJSON per patch version)
// ---------------------------------------------------------------------------
let stateVersion = 0;
let snapshotVersion = -1;
let snapshot: unknown = null;
/** False until the first full state arrives for the current room (avoids rendering an empty schema). */
let hasState = false;

export function subscribeState(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export function getStateSnapshot<T = BaseRoomView>(): T | null {
  const room = useSessionStore.getState().room;
  if (!room || !room.state || !hasState) return null;
  if (snapshotVersion !== stateVersion) {
    snapshot = (room.state as { toJSON(): unknown }).toJSON();
    snapshotVersion = stateVersion;
  }
  return snapshot as T;
}

function bumpState(): void {
  stateVersion++;
  for (const l of [...stateListeners]) l();
}

// ---------------------------------------------------------------------------
// Clock sync
// ---------------------------------------------------------------------------
let clockOffset = 0;
/** Recent {rtt, offset} samples; the offset of the lowest-RTT sample (least asymmetric) wins. */
let clockSamples: Array<{ rtt: number; offset: number }> = [];
let hasClockSample = false;
const CLOCK_WINDOW = 8;
let timeTimer: ReturnType<typeof setInterval> | null = null;
let timeKicks: Array<ReturnType<typeof setTimeout>> = [];

/** Estimated server epoch time (ms). */
export function serverNow(): number {
  return Date.now() + clockOffset;
}

function onTimeSync(res: TimeSyncResponse): void {
  const now = Date.now();
  const rtt = now - res.t0;
  if (!Number.isFinite(rtt) || rtt < 0 || rtt > 10_000 || !Number.isFinite(res.server)) return;
  useSessionStore.setState({ pingMs: Math.round(rtt) });
  // A sliding window (not an all-time minimum) so a changed network path or a local clock
  // adjustment (NTP, laptop sleep) is picked up within a few samples.
  clockSamples.push({ rtt, offset: res.server + rtt / 2 - now });
  if (clockSamples.length > CLOCK_WINDOW) clockSamples.shift();
  const best = clockSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
  clockOffset = best.offset;
  hasClockSample = true;
}

/** Coarse offset from the welcome message until the first round-trip sample arrives. */
function seedClock(serverTime: number): void {
  if (!hasClockSample && Number.isFinite(serverTime)) clockOffset = serverTime - Date.now();
}

function startClockSync(room: Room): void {
  stopClockSync();
  clockSamples = [];
  const ping = () => {
    if (useSessionStore.getState().room === room) room.send(SYS.time, { t0: Date.now() });
  };
  ping();
  timeKicks = [setTimeout(ping, 400), setTimeout(ping, 1200)];
  timeTimer = setInterval(ping, 8000);
}

function stopClockSync(): void {
  if (timeTimer) clearInterval(timeTimer);
  timeTimer = null;
  for (const t of timeKicks) clearTimeout(t);
  timeKicks = [];
}

// ---------------------------------------------------------------------------
// Client + lifecycle
// ---------------------------------------------------------------------------
let client: Client | null = null;
let leavingIntentionally = false;
let attachGeneration = 0;

function getClient(): Client {
  client ??= new Client(serverUrl());
  return client;
}

async function joinOptions(extra: Record<string, unknown> = {}) {
  const { profile } = useApp.getState();
  const accessToken = await persistence()
    .accessToken()
    .catch(() => undefined);
  return {
    name: profile.name || 'Player',
    avatar: profile.avatar,
    guestId: profile.guestId,
    ...(accessToken ? { accessToken } : {}),
    ...extra,
  };
}

function resetBus(): void {
  lastPayload.clear();
  stateVersion++;
  snapshot = null;
  hasState = false;
}

function attach(room: Room, gameId: GameId): void {
  const generation = ++attachGeneration;
  resetBus();
  leavingIntentionally = false;
  room.reconnection.minUptime = 1500;
  room.reconnection.maxRetries = 12;
  room.reconnection.maxDelay = 4000;

  useSessionStore.setState({
    ...initial,
    status: 'connected',
    room,
    gameId,
    code: room.roomId,
  });

  const alive = () => generation === attachGeneration;
  /** The server already told us why we're being removed (kicked / room closed). */
  let removalNotified = false;

  room.onMessage('*', (type: string | number, payload: unknown) => {
    if (!alive()) return;
    const t = String(type);
    switch (t) {
      case SYS.welcome: {
        const w = payload as WelcomePayload;
        useSessionStore.setState({ playerId: w.playerId });
        seedClock(w.serverNow);
        saveSeat({ code: w.code, gameId: w.gameId, seatToken: w.seatToken, reconnectionToken: room.reconnectionToken, savedAt: Date.now() });
        break;
      }
      case SYS.time:
        onTimeSync(payload as TimeSyncResponse);
        return;
      case SYS.toast: {
        const p = payload as ToastPayload;
        useApp.getState().toast(p.kind, p.text);
        break;
      }
      case SYS.error: {
        const p = payload as ActionErrorPayload;
        // Rate limits on high-frequency streams (drawing, racing input) are expected: no toast, no beep.
        const streamThrottle = p.code === 'rate_limited' && /:(draw|input|stroke|move)/.test(p.type ?? '');
        if (!streamThrottle) {
          // The store collapses identical toasts; only beep when a toast was actually shown.
          if (useApp.getState().toast('error', p.message) !== null) sfx('error');
        }
        break;
      }
      case SYS.removed:
        // Forget the seat right away: the socket close follows ~150ms later, and a reload or
        // navigation in between must not try to rejoin a closed room / a seat we were kicked from.
        removalNotified = true;
        clearSeat(room.roomId);
        useSessionStore.setState({ removed: payload as RemovedPayload });
        break;
      case CHAT.history:
        useSessionStore.setState({ chat: (payload as ChatMessage[]).slice(-120) });
        break;
      case CHAT.msg:
        useSessionStore.setState((s) => ({ chat: [...s.chat.slice(-119), payload as ChatMessage] }));
        break;
    }
    emit(t, payload);
  });

  room.onStateChange(() => {
    if (!alive()) return;
    hasState = true;
    bumpState();
  });

  room.onDrop(() => {
    if (!alive()) return;
    useSessionStore.setState({ status: 'reconnecting' });
  });

  room.onReconnect(() => {
    // An in-flight retry can still succeed after the player left or moved to another room:
    // leave properly instead of keeping a ghost connection on the old seat.
    if (!alive()) {
      void room.leave(true).catch(() => undefined);
      return;
    }
    useSessionStore.setState({ status: 'connected' });
    const seat = loadSeat(room.roomId);
    if (seat) saveSeat({ ...seat, reconnectionToken: room.reconnectionToken, savedAt: Date.now() });
    useApp.getState().toast('success', 'Reconnected!');
    startClockSync(room);
  });

  room.onLeave((code: number) => {
    if (!alive()) return;
    stopClockSync();
    const state = useSessionStore.getState();
    if (leavingIntentionally) return;
    if (code === RoomCloseCode.KICKED || code === RoomCloseCode.ROOM_CLOSED || state.removed || removalNotified) {
      clearSeat(room.roomId);
      useSessionStore.setState({
        status: 'idle',
        room: null,
        // If the notice was already shown and dismissed, don't resurrect it on the arcade floor.
        removed:
          state.removed ??
          (removalNotified
            ? null
            : {
                reason: code === RoomCloseCode.KICKED ? 'kicked' : 'room_closed',
                message: code === RoomCloseCode.KICKED ? 'The host removed you from the room.' : 'This room was closed.',
              }),
      });
      return;
    }
    if (code === CLOSE_CONSENTED) {
      // Consented close initiated by the server (e.g. seat reclaimed elsewhere).
      useSessionStore.setState({ status: 'idle', room: null, error: friendly('reconnect_failed', 'This seat was opened in another tab or window.') });
      return;
    }
    if (code === CLOSE_SERVER_SHUTDOWN) {
      useSessionStore.setState({ status: 'lost', room: null, error: friendly('server_restarted') });
      return;
    }
    useSessionStore.setState({ status: 'lost', room: null, error: friendly('reconnect_failed') });
  });

  room.onError((_code: number, message?: string) => {
    if (!alive()) return;
    if (message) useApp.getState().toast('error', message);
  });

  startClockSync(room);
  bumpState();
}

async function lookup(code: string): Promise<RoomLookup> {
  const res = await fetch(`${serverUrl()}/api/rooms/${encodeURIComponent(code)}`, { cache: 'no-store' });
  if (res.status === 429) throw { code: JoinErrorCode.RATE_LIMITED, message: 'Too many attempts — please wait a moment and try again.' };
  if (!res.ok) throw new Error(`Lookup failed: ${res.status}`);
  return (await res.json()) as RoomLookup;
}

async function leaveCurrent(): Promise<void> {
  const { room } = useSessionStore.getState();
  if (!room) return;
  leavingIntentionally = true;
  clearSeat(room.roomId);
  attachGeneration++;
  stopClockSync();
  // Drop the old room's cached private payloads/snapshot now, not only when the next room attaches
  // (a failed join would otherwise leave them replayable).
  resetBus();
  // While the SDK is auto-reconnecting the socket is dead: leave() would wait for every retry
  // (~35s) before resolving. Stop further retries and don't wait more than a moment.
  room.reconnection.maxRetries = 0;
  try {
    await Promise.race([room.leave(true), new Promise((resolve) => setTimeout(resolve, 1500))]);
  } catch {
    /* ignore */
  }
}

export const session = {
  get room(): Room | null {
    return useSessionStore.getState().room;
  },

  /** Look up a room code before joining (for routing to the right cabinet). */
  lookup,

  async createRoom(gameId: GameId, extra: { solo?: boolean; settings?: Record<string, unknown>; roomName?: string } = {}): Promise<string | null> {
    await leaveCurrent();
    useSessionStore.setState({ ...initial, status: 'connecting', gameId });
    try {
      const room = await getClient().create(gameId, await joinOptions(extra));
      attach(room, gameId);
      sfx('join');
      return room.roomId;
    } catch (err) {
      useSessionStore.setState({ status: 'idle', error: toFriendlyError(err) });
      return null;
    }
  },

  /** Join by code. Reuses a stored seat token for this code when present (rejoin). */
  async joinRoom(rawCode: string, extra: { spectator?: boolean } = {}): Promise<{ ok: true; gameId: GameId } | { ok: false; error: FriendlyError }> {
    const code = normalizeRoomCode(rawCode);
    if (!isValidRoomCode(code)) {
      const error = friendly('invalid_code');
      useSessionStore.setState({ error });
      return { ok: false, error };
    }
    const current = useSessionStore.getState();
    if (current.room && current.code === code && current.status === 'connected' && current.gameId) {
      return { ok: true, gameId: current.gameId };
    }
    await leaveCurrent();
    useSessionStore.setState({ ...initial, status: 'connecting', code });
    try {
      const info = await lookup(code);
      if (!info.exists || !info.gameId) throw { code: JoinErrorCode.NOT_FOUND };
      const seat = loadSeat(code);
      const room = await getClient().joinById(code, await joinOptions({ ...extra, ...(seat ? { seatToken: seat.seatToken } : {}) }));
      attach(room, info.gameId as GameId);
      sfx('join');
      return { ok: true, gameId: info.gameId as GameId };
    } catch (err) {
      const error = toFriendlyError(err);
      useSessionStore.setState({ status: 'idle', error, code });
      return { ok: false, error };
    }
  },

  /** After a page refresh: resume the Colyseus session, else reclaim the seat by token. */
  async resumeRoom(rawCode: string): Promise<boolean> {
    const code = normalizeRoomCode(rawCode);
    const seat = loadSeat(code);
    if (!seat) return false;
    const current = useSessionStore.getState();
    if (current.room && current.code === code) return true;
    useSessionStore.setState({ ...initial, status: 'connecting', code });
    if (seat.reconnectionToken) {
      try {
        const room = await getClient().reconnect(seat.reconnectionToken);
        attach(room, seat.gameId as GameId);
        return true;
      } catch {
        /* fall through to seat-token rejoin */
      }
    }
    const result = await session.joinRoom(code);
    return result.ok;
  },

  async leaveRoom(): Promise<void> {
    await leaveCurrent();
    sfx('back');
    useSessionStore.setState({ ...initial });
    resetBus();
    bumpState();
  },

  /** Clear an error/removed notice after the UI showed it. */
  clearNotices(): void {
    useSessionStore.setState({ error: null, removed: null });
  },

  send(type: string, payload?: unknown): void {
    const room = useSessionStore.getState().room;
    if (!room || useSessionStore.getState().status !== 'connected') return;
    room.send(type, payload ?? {});
  },

  // Convenience wrappers for shared lobby actions.
  lobby: {
    ready: (ready: boolean) => session.send(LOBBY.ready, { ready }),
    spectate: (spectator: boolean) => session.send(LOBBY.spectate, { spectator }),
    profile: (patch: { name?: string; avatar?: string }) => session.send(LOBBY.profile, patch),
    settings: (settings: Record<string, unknown>) => session.send(LOBBY.settings, { settings }),
    room: (patch: { roomName?: string; locked?: boolean; maxPlayers?: number; allowSpectators?: boolean }) => session.send(LOBBY.room, patch),
    kick: (playerId: string) => session.send(LOBBY.kick, { playerId }),
    transferHost: (playerId: string) => session.send(LOBBY.transferHost, { playerId }),
    start: () => session.send(LOBBY.start, {}),
    toLobby: () => session.send(LOBBY.toLobby, {}),
    close: () => session.send(LOBBY.close, {}),
    chat: (text: string) => session.send(CHAT.send, { text }),
  },
};

// Dev/test introspection (used by Playwright to read state without scraping).
declare global {
  interface Window {
    __DASCADE__?: { session: typeof session; getState: () => unknown; store: typeof useSessionStore };
  }
}
if (typeof window !== 'undefined') {
  window.__DASCADE__ = { session, getState: () => getStateSnapshot(), store: useSessionStore };
}
