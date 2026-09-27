/**
 * Where the player is, for theme environments ("calm down inside games"). Derived from the route;
 * inside a room the RoomScreen reports lobby vs game (the host must not import the network layer —
 * that would pull the Colyseus SDK into the landing bundle).
 */
import { useSyncExternalStore } from 'react';
import { useLocation } from 'react-router';
import type { ThemePlace } from './types.ts';

export function placeFromPath(pathname: string): ThemePlace {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/') return 'floor';
  if (p.startsWith('/cabinet/')) return 'cabinet';
  if (p === '/tournaments' || p.startsWith('/tournaments/') || p === '/play/tournament') return 'tournament';
  if (p.startsWith('/play/')) return 'entry';
  if (p.startsWith('/room/') || p.startsWith('/r/')) return 'lobby';
  return 'other';
}

let roomPlace: 'lobby' | 'game' | null = null;
const listeners = new Set<() => void>();

/** RoomScreen reports the room's phase ('lobby' until the match starts). null when it unmounts. */
export function reportRoomPlace(place: 'lobby' | 'game' | null): void {
  if (roomPlace === place) return;
  roomPlace = place;
  for (const l of [...listeners]) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function resolvePlace(pathname: string, room: 'lobby' | 'game' | null): ThemePlace {
  const base = placeFromPath(pathname);
  return base === 'lobby' && room ? room : base;
}

/** Current place (route + reported room phase). Must be rendered inside the router. */
export function useThemePlace(): ThemePlace {
  const { pathname } = useLocation();
  const room = useSyncExternalStore(
    subscribe,
    () => roomPlace,
    () => roomPlace,
  );
  return resolvePlace(pathname, room);
}
