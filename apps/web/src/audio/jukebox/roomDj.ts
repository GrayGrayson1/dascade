/**
 * Room DJ client bridge: connects the jukebox engine to the current room's `dj:state` messages
 * and sends `dj:*` commands through the single session module.
 *
 * Coupling is minimal and lazy: the audio code never imports the session module (and with it the
 * Colyseus SDK). Instead net/session.ts registers a port here when it loads (registerDjSession),
 * so the landing page stays free of the networking SDK. The follow policy itself lives in the engine
 * (core.ts → djSync.ts); this file only moves messages. A DJ failure never affects the room.
 */
import { DJ, type DjState } from '@dascade/shared/jukebox';
import type { DjTransport, JukeboxEngine } from './core.ts';
import { isDjState } from './djSync.ts';

/** The slice of net/session.ts the bridge uses (injectable for tests). */
export interface DjSessionPort {
  /** Current room identity (any stable object/id), or null outside rooms. */
  currentRoom(): unknown;
  subscribeRoom(cb: () => void): () => void;
  subscribeMessage(type: string, cb: (payload: unknown) => void): () => void;
  getLastMessage(type: string): unknown;
  send(type: string, payload: unknown): void;
  playerId(): string | null;
  hostId(): string | null;
  /** Local player is a spectator (optional; defaults to seated). */
  isSpectator?(): boolean;
  roomKey?(): string | null;
  serverNow(): number;
}

type EngineHooks = Pick<JukeboxEngine, 'attachRoom' | 'receiveRoomState'>;

/** Wires an engine to a session port. Returns an unsubscribe (tests; the app never tears down). */
export function connectRoomDj(engine: EngineHooks, port: DjSessionPort): () => void {
  let room: unknown = null;
  const transport: DjTransport = {
    send: (type, payload) => {
      try {
        port.send(type, payload);
      } catch {
        /* a DJ command must never break anything */
      }
    },
    playerId: () => port.playerId(),
    hostId: () => port.hostId(),
    isSpectator: () => port.isSpectator?.() ?? false,
    roomKey: () => port.roomKey?.() ?? null,
    serverNow: () => port.serverNow(),
  };

  // Both run inside the session's message/store callbacks: a jukebox fault must never propagate
  // into the room's message dispatch (the game keeps working; the music just doesn't follow).
  const guard = (fn: () => void) => {
    try {
      fn();
    } catch (err) {
      console.warn('[DASCADE] room DJ bridge failed; the room is unaffected', err);
    }
  };

  const deliver = (payload: unknown) =>
    guard(() => {
      if (!room || !isDjState(payload)) return;
      engine.receiveRoomState(payload as DjState);
    });

  const onRoom = () =>
    guard(() => {
      const next = port.currentRoom() ?? null;
      if (next === room) return;
      room = next;
      // New room (or none): forget the old room's state and version counter first.
      engine.receiveRoomState(null);
      engine.attachRoom(room ? transport : null);
      if (room) deliver(port.getLastMessage(DJ.state));
    });

  const offRoom = port.subscribeRoom(onRoom);
  const offMsg = port.subscribeMessage(DJ.state, deliver);
  onRoom();
  return () => {
    offRoom();
    offMsg();
    if (room) {
      room = null;
      engine.receiveRoomState(null);
      engine.attachRoom(null);
    }
  };
}

// The session module registers its port when it first loads (net/session.ts), which happens only
// once the player heads for a room. Until then no DJ wiring exists, so the arcade floor never pulls
// in the Colyseus SDK just for the jukebox.
let pendingEngine: EngineHooks | null = null;
let sessionPort: DjSessionPort | null = null;
let disconnect: (() => void) | null = null;

function reconnect(): void {
  disconnect?.();
  disconnect = null;
  if (!pendingEngine || !sessionPort) return;
  try {
    disconnect = connectRoomDj(pendingEngine, sessionPort);
  } catch {
    /* no room DJ: the personal jukebox keeps working */
  }
}

/** Engine side: called once at boot. Connects as soon as the session module has registered. */
export function installRoomDj(engine: EngineHooks): void {
  if (engine === pendingEngine) return;
  pendingEngine = engine;
  reconnect();
}

/**
 * Session side: net/session.ts calls this at module load with its port. Idempotent for the same
 * port; a NEW port (the session module re-evaluated, e.g. dev HMR) replaces the old wiring instead of
 * leaving two bridges delivering to one engine.
 */
export function registerDjSession(port: DjSessionPort): void {
  if (port === sessionPort) return;
  sessionPort = port;
  reconnect();
}
