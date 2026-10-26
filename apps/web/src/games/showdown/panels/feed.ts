/**
 * What the panels remember on this device while the room runs, whether or not a panel is on screen:
 *
 * - Crew links minted for you (`ShowdownCrewPrivate.fresh`): the server keeps only their hashes and
 *   sends a secret exactly once, so it's saved the moment it arrives (rememberCrewLink, per room, 24 h)
 *   — even if the lobby's crew section or the console's Crew tab isn't showing at that moment.
 * - The draw history (the room's `pick` / `pickEnd` events), for the Picker tab.
 *
 * Subscribed once when the showdown client loads (Lobby.tsx imports the panels).
 */
import { useSyncExternalStore } from 'react';
import { SHOWDOWN_MSG, type ShowdownCrewPrivate, type ShowdownEvent } from '@dascade/shared/games/showdown';
import { subscribeMessage, useSessionStore } from '../../../net/session.ts';
import { serverNow } from '../../../net/hooks.ts';
import { rememberCrewLink, storedCrewLinks, type StoredCrewLink } from '../access.ts';
import { foldDraw, type DrawLine } from './picker.ts';

const listeners = new Set<() => void>();
let version = 0;
const bump = () => {
  version++;
  for (const l of [...listeners]) l();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The last link minted for this device in this session (to announce "ready — Copy it"). */
let lastFresh: (StoredCrewLink & { at: number }) | null = null;
let draws: { code: string; list: DrawLine[] } = { code: '', list: [] };

function onCrew(payload: unknown): void {
  const fresh = (payload as ShowdownCrewPrivate | null)?.fresh;
  const code = useSessionStore.getState().code;
  if (!fresh || !code) return;
  // Same link again (a re-sent view): nothing new to keep.
  if (lastFresh?.id === fresh.id && lastFresh.link === fresh.link) return;
  const link: StoredCrewLink = { id: fresh.id, role: fresh.role, name: fresh.name, link: fresh.link };
  rememberCrewLink(code, link);
  lastFresh = { ...link, at: Date.now() };
  bump();
}

function onEvent(payload: unknown): void {
  const ev = payload as ShowdownEvent | null;
  if (!ev || (ev.type !== 'pick' && ev.type !== 'pickEnd')) return;
  const code = useSessionStore.getState().code ?? '';
  const base = draws.code === code ? draws.list : [];
  const list =
    ev.type === 'pick'
      ? foldDraw(base, { type: 'pick', drawNo: ev.drawNo, name: ev.name, reroll: ev.reroll }, serverNow())
      : foldDraw(base, { type: 'pickEnd', drawNo: ev.drawNo, how: ev.how }, serverNow());
  draws = { code, list };
  bump();
}

const unsubscribe = [subscribeMessage(SHOWDOWN_MSG.crew, onCrew), subscribeMessage(SHOWDOWN_MSG.event, onEvent)];
if (import.meta.hot) import.meta.hot.dispose(() => unsubscribe.forEach((u) => u()));

/** Crew links this device minted for the room (re-read whenever a new one arrives). */
export function useStoredCrewLinks(code: string): StoredCrewLink[] {
  const v = useSyncExternalStore(subscribe, () => version);
  // Storage is the record (it survives reloads); `v` re-reads it after each new link.
  void v;
  return code ? storedCrewLinks(code) : [];
}

/** The newest link minted on this device this session (null = none yet). */
export function useLastFreshLink(): (StoredCrewLink & { at: number }) | null {
  useSyncExternalStore(subscribe, () => version);
  return lastFresh;
}

const NO_DRAWS: DrawLine[] = [];

/** This room's draws seen on this device, newest first. */
export function useDrawHistory(code: string): DrawLine[] {
  useSyncExternalStore(subscribe, () => version);
  return draws.code === code ? draws.list : NO_DRAWS;
}
