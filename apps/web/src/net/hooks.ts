/**
 * React bindings for the room session. Game UIs should use these hooks instead
 * of touching Colyseus directly.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { BaseRoomView, Phase, PlayerView } from '@dascade/shared';
import {
  getLastMessage,
  getStateSnapshot,
  serverNow,
  session,
  subscribeMessage,
  subscribeState,
  useSessionStore,
} from './session.ts';

/** Full JSON snapshot of the synchronized room state (re-renders on every patch). */
export function useRoomState<T extends BaseRoomView = BaseRoomView>(): T | null {
  return useSyncExternalStore(subscribeState, () => getStateSnapshot<T>(), () => null);
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

/**
 * Select a slice of room state; re-renders only when the selected value changes
 * (shallow compare by default). Prefer this for large/high-frequency states.
 */
export function useRoomSelector<T extends BaseRoomView, R>(selector: (state: T) => R, isEqual: (a: R, b: R) => boolean = shallowEqual): R | null {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const cache = useRef<{ has: boolean; value: R | null }>({ has: false, value: null });
  const getSnapshot = useCallback(() => {
    const state = getStateSnapshot<T>();
    const next = state ? selectorRef.current(state) : null;
    if (cache.current.has && (next === null ? cache.current.value === null : cache.current.value !== null && isEqual(cache.current.value as R, next as R))) {
      return cache.current.value;
    }
    cache.current = { has: true, value: next };
    return next;
  }, [isEqual]);
  return useSyncExternalStore(subscribeState, getSnapshot, () => null);
}

function playersEqual(a: Record<string, PlayerView> | undefined, b: Record<string, PlayerView> | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!b[k] || !shallowEqual(a[k], b[k])) return false;
  return true;
}

const BASE_KEYS = [
  'gameId',
  'code',
  'roomName',
  'phase',
  'phaseEndsAt',
  'hostId',
  'locked',
  'maxPlayers',
  'allowSpectators',
  'settingsJson',
  'settingsRev',
  'round',
  'statusText',
] as const satisfies ReadonlyArray<keyof BaseRoomView>;

function pickBase(s: BaseRoomView): BaseRoomView {
  const out = { players: s.players } as BaseRoomView;
  for (const k of BASE_KEYS) (out as unknown as Record<string, unknown>)[k] = s[k];
  return out;
}

function baseEqual(a: BaseRoomView, b: BaseRoomView): boolean {
  for (const k of BASE_KEYS) if (!Object.is(a[k], b[k])) return false;
  return playersEqual(a.players, b.players);
}

/**
 * Only the platform part of the room state (phase, host, lock, settings, players…). Unlike
 * useRoomState/useGame it does NOT re-render on game-specific patches (cars, cards, strokes),
 * and keeps object identity while nothing it covers changed. Prefer it in lobby/HUD chrome.
 */
export function useBaseRoom(): BaseRoomView | null {
  return useRoomSelector<BaseRoomView, BaseRoomView>(pickBase, baseEqual);
}

/** Subscribe to a server → client message type for the lifetime of the component. */
export function useRoomMessage<T = unknown>(type: string, handler: (payload: T) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribeMessage(type, (p) => ref.current(p as T)), [type]);
}

/**
 * The latest payload received for a message type (replays the last value on mount).
 * Ideal for private per-player state the server re-sends on change, e.g. hole cards.
 */
export function useLatestMessage<T = unknown>(type: string): T | undefined {
  const [value, setValue] = useState<T | undefined>(() => getLastMessage<T>(type));
  useEffect(() => {
    setValue(getLastMessage<T>(type));
    return subscribeMessage(type, (p) => setValue(p as T));
  }, [type]);
  return value;
}

/** Milliseconds until a server-epoch deadline, updated ~4×/s (or every frame with `smooth`). */
export function useCountdown(endsAt: number | null | undefined, smooth = false): number {
  const [remaining, setRemaining] = useState(() => (endsAt ? Math.max(0, endsAt - serverNow()) : 0));
  useEffect(() => {
    if (!endsAt) {
      setRemaining(0);
      return;
    }
    let raf = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => setRemaining(Math.max(0, endsAt - serverNow()));
    tick();
    if (smooth) {
      const loop = () => {
        tick();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    } else timer = setInterval(tick, 250);
    return () => {
      cancelAnimationFrame(raf);
      if (timer) clearInterval(timer);
    };
  }, [endsAt, smooth]);
  return remaining;
}

export interface GameContext<S extends BaseRoomView, Settings> {
  state: S;
  phase: Phase;
  settings: Settings;
  playerId: string | null;
  me: PlayerView | undefined;
  isHost: boolean;
  isSpectator: boolean;
  players: PlayerView[];
  /** Non-spectators in join order. */
  seated: PlayerView[];
  send: (type: string, payload?: unknown) => void;
  serverNow: () => number;
}

/**
 * Everything a game view needs. Returns null until the first state arrives.
 * `S` = your game's public state shape, `Settings` = your settings type.
 */
export function useGame<S extends BaseRoomView = BaseRoomView, Settings = Record<string, unknown>>(): GameContext<S, Settings> | null {
  const state = useRoomState<S>();
  const playerId = useSessionStore((s) => s.playerId);
  const settingsJson = state?.settingsJson;
  const settings = useMemo(() => {
    try {
      return JSON.parse(settingsJson ?? '{}') as Settings;
    } catch {
      return {} as Settings;
    }
  }, [settingsJson]);
  if (!state) return null;
  const players = Object.values(state.players ?? {}).sort((a, b) => a.joinOrder - b.joinOrder);
  const me = playerId ? state.players[playerId] : undefined;
  return {
    state,
    phase: state.phase,
    settings,
    playerId,
    me,
    isHost: Boolean(playerId && state.hostId === playerId),
    isSpectator: Boolean(me?.spectator),
    players,
    seated: players.filter((p) => !p.spectator),
    send: session.send,
    serverNow,
  };
}

/** Parsed settings only (cheap re-render profile). */
export function useSettings<Settings>(): Settings | null {
  const json = useRoomSelector((s) => s.settingsJson);
  return useMemo(() => {
    if (json === null) return null;
    try {
      return JSON.parse(json) as Settings;
    } catch {
      return null;
    }
  }, [json]);
}

export { serverNow, session };
