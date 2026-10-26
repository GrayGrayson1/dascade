/**
 * Where the stage reads the show from. Normally that's the room: every stage hook (useBoard,
 * useClock, useCard…, the show feed) reads the synchronized state through useRoomSelector, exactly
 * as before. Inside a <ShowSourceProvider> they read a demo source instead — the Presenter Tour
 * drives the real stage that way, with a scripted timeline and no server, no room and no message.
 *
 * A demo source has its own state and its own show feed, so a tour opened in the middle of a live
 * show (from the console) never touches that show's board, feed or sounds.
 */
import { createContext, createElement, useCallback, useContext, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { ShowdownPublicState } from '@dascade/shared/games/showdown';
import { useRoomSelector } from '../../net/hooks.ts';
import type { ShowFeedStore } from './fx.ts';

/** The slice of the room state the stage reads. */
export type ShowState = Pick<
  ShowdownPublicState,
  | 'phase'
  | 'code'
  | 'boardJson'
  | 'finaleJson'
  | 'card'
  | 'sweep'
  | 'rehearsal'
  | 'clockEndsAt'
  | 'clockLeft'
  | 'clockMax'
  | 'clockShow'
  | 'hype0'
  | 'hype1'
  | 'teams'
  | 'players'
  // The picker (Presenter Showcase): the spotlight grid and the hot seat.
  | 'event'
  | 'drawNo'
  | 'hotSeat'
  | 'pickAt'
  | 'landAt'
  | 'poolSize'
  | 'done'
  | 'seats'
>;

export interface ShowSource {
  /** Stable functions (they're handed to useSyncExternalStore as they are). */
  subscribe: (listener: () => void) => () => void;
  get: () => ShowState;
  feed: ShowFeedStore;
}

const ShowSourceContext = createContext<ShowSource | null>(null);

export function ShowSourceProvider({ source, children }: { source: ShowSource; children?: ReactNode }) {
  return createElement(ShowSourceContext.Provider, { value: source }, children);
}

/** The demo source around this component (null: the room). */
export function useShowSource(): ShowSource | null {
  return useContext(ShowSourceContext);
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

const IDLE = () => null;
const NO_SOURCE = () => () => {};

/**
 * useRoomSelector for the stage: the room's state, or the demo source's when a provider is around.
 * Without a provider this is useRoomSelector itself; with one, the room hook selects nothing (it
 * stays null and never re-renders) and the value comes from the source.
 */
export function useShowSelector<R>(selector: (state: ShowdownPublicState) => R, isEqual?: (a: R, b: R) => boolean): R | null {
  const source = useContext(ShowSourceContext);
  const fromRoom = useRoomSelector<ShowdownPublicState, R | null>(
    source ? IDLE : selector,
    isEqual as ((a: R | null, b: R | null) => boolean) | undefined,
  );
  const fromSource = useSourceSelector(source, selector, isEqual ?? shallowEqual);
  return source ? fromSource : fromRoom;
}

function useSourceSelector<R>(
  source: ShowSource | null,
  selector: (state: ShowdownPublicState) => R,
  isEqual: (a: R, b: R) => boolean,
): R | null {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const cache = useRef<{ has: boolean; value: R | null }>({ has: false, value: null });
  const getSnapshot = useCallback(() => {
    if (!source) return null;
    const next = selectorRef.current(source.get() as ShowdownPublicState);
    const prev = cache.current;
    if (prev.has && (next === null ? prev.value === null : prev.value !== null && isEqual(prev.value as R, next))) return prev.value;
    cache.current = { has: true, value: next };
    return next;
  }, [source, isEqual]);
  // The server snapshot is the source too: a demo needs no room, so it renders the same anywhere.
  return useSyncExternalStore(source ? source.subscribe : NO_SOURCE, getSnapshot, getSnapshot);
}
