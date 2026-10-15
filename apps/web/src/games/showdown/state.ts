/**
 * DAS Survey Showdown client state: the parsed board, roles, settings and the private payloads.
 *
 * Roles come from the server: `presenterId` in synchronized state, plus the presenter-only sheet and
 * pass messages. The client never decides who presents — it only renders what it was sent. The
 * built-in answers live on the server (@dascade/game-core/showdown is never imported here).
 */
import { useMemo, useSyncExternalStore } from 'react';
import {
  SHOWDOWN_MSG,
  parseBoard,
  resolveShowdownLook,
  type ShowdownBoardView,
  type ShowdownContentPrivate,
  type ShowdownFinale,
  type ShowdownLook,
  type ShowdownMe,
  type ShowdownPublicState,
  type ShowdownSettings,
  type ShowdownSheet,
  type TeamIndex,
  type TeamSlot,
} from '@dascade/shared/games/showdown';
import { useGame, useLatestMessage, useRoomSelector, useSettings } from '../../net/hooks.ts';
import { useSessionStore } from '../../net/session.ts';
import { useApp } from '../../app/store.ts';
import { seasonClock } from '../../themes/seasonalController.ts';

export function useShowdownGame() {
  return useGame<ShowdownPublicState, ShowdownSettings>();
}

/** The parsed public board (null outside a show). Re-parses only when the JSON changes. */
export function useBoard(): ShowdownBoardView | null {
  const json = useRoomSelector<ShowdownPublicState, string>((s) => s.boardJson);
  return useMemo(() => parseBoard(json), [json]);
}

export function useFinale(): ShowdownFinale | null {
  const json = useRoomSelector<ShowdownPublicState, string>((s) => s.finaleJson);
  return useMemo(() => {
    if (!json) return null;
    try {
      return JSON.parse(json) as ShowdownFinale;
    } catch {
      return null;
    }
  }, [json]);
}

export function useShowdownSettings(): ShowdownSettings | null {
  return useSettings<ShowdownSettings>();
}

export type ShowdownRole = 'presenter' | 'screen' | 'audience' | 'spectator';

export interface RoleInfo {
  role: ShowdownRole;
  playerId: string | null;
  presenterId: string;
  /** Your team (null: presenter, screen, spectator or not assigned yet). */
  team: TeamIndex | null;
}

/**
 * Who this connection is in the show. `localScreen` = this device chose big-screen mode (the server
 * also lists it in `screens`, but the local choice applies at once).
 */
export function useRole(localScreen: boolean): RoleInfo {
  const playerId = useSessionStore((s) => s.playerId);
  const presenterId = useRoomSelector<ShowdownPublicState, string>((s) => s.presenterId) ?? '';
  const spectator = useRoomSelector<ShowdownPublicState, boolean>((s) => Boolean(playerId && s.players[playerId]?.spectator)) ?? false;
  const team = useRoomSelector<ShowdownPublicState, number | null>((s) => (playerId ? (s.teams?.[playerId] ?? null) : null));
  const role: ShowdownRole = playerId && presenterId === playerId ? 'presenter' : localScreen ? 'screen' : spectator ? 'spectator' : 'audience';
  return { role, playerId, presenterId, team: team === 0 || team === 1 ? team : null };
}

/** The presenter's answer sheet (null for everyone else — the server never sends it to them). */
export function useSheet(): ShowdownSheet | null {
  return useLatestMessage<ShowdownSheet | null>(SHOWDOWN_MSG.sheet) ?? null;
}

export function usePass(): string | null {
  return useLatestMessage<{ pass: string } | null>(SHOWDOWN_MSG.pass)?.pass ?? null;
}

export function useCustomContent(): ShowdownContentPrivate | null {
  return useLatestMessage<ShowdownContentPrivate | null>(SHOWDOWN_MSG.content) ?? null;
}

export function useMe(): ShowdownMe | null {
  return useLatestMessage<ShowdownMe>(SHOWDOWN_MSG.me) ?? null;
}

/** Team rosters (names), from the synchronized team map. */
export function useRosters(): [string[], string[]] {
  const teams = useRoomSelector<ShowdownPublicState, Record<string, number>>((s) => s.teams);
  const players = useRoomSelector<ShowdownPublicState, ShowdownPublicState['players']>((s) => s.players);
  return useMemo(() => {
    const out: [string[], string[]] = [[], []];
    const ordered = Object.entries(teams ?? {}).sort(([a], [b]) => (players?.[a]?.joinOrder ?? 0) - (players?.[b]?.joinOrder ?? 0));
    for (const [id, team] of ordered) {
      const name = players?.[id]?.name;
      if (name && (team === 0 || team === 1)) out[team].push(name);
    }
    return out;
  }, [teams, players]);
}

export function useHype(): [number, number] {
  const h0 = useRoomSelector<ShowdownPublicState, number>((s) => s.hype0) ?? 0;
  const h1 = useRoomSelector<ShowdownPublicState, number>((s) => s.hype1) ?? 0;
  return [h0, h1];
}

/** The show's look for this viewer: the presenter's choice, 'auto' = Halloween in October. */
export function useLook(settings: Pick<ShowdownSettings, 'look'> | null | undefined): ShowdownLook {
  return resolveShowdownLook(settings?.look ?? 'auto', seasonClock());
}

export interface MotionPrefs {
  /** Large motion allowed (not reduced motion, effects not off). */
  motion: boolean;
  fx: 'high' | 'low' | 'off';
  reduced: boolean;
  /** Particle budget. */
  particles: number;
}

export function useMotion(): MotionPrefs {
  const reduced = useApp((s) => s.settings.reducedMotion);
  const fx = useApp((s) => s.settings.fx);
  return { motion: !reduced && fx !== 'off', fx, reduced, particles: reduced || fx === 'off' ? 0 : fx === 'low' ? 18 : 60 };
}

export const teamClass = (team: TeamSlot) => (team === 0 ? 'delta' : team === 1 ? 'sierra' : 'none');

// ---------------------------------------------------------------------------
// Device preferences (per browser; presentation only)
// ---------------------------------------------------------------------------

const SOUND_KEY = 'dascade:showdown:sounds';
const soundListeners = new Set<() => void>();
let soundVersion = 0;
/** The choice made in this tab (used when storage is unavailable). */
let memoryPref: 'on' | 'off' | null = null;

function readSoundPref(): 'on' | 'off' | null {
  try {
    const v = localStorage.getItem(SOUND_KEY);
    return v === 'on' || v === 'off' ? v : memoryPref;
  } catch {
    return memoryPref;
  }
}

/**
 * Whether this device plays the show's sounds (clangs, buzzers, applause). Big screens and the
 * presenter console default to on; audience phones default to off so a room full of phones doesn't
 * echo the stage (their own taps still click). Local mute/volume always win on top of this.
 */
export function useShowSounds(role: ShowdownRole): [boolean, (on: boolean) => void] {
  useSyncExternalStore(
    (fn) => {
      soundListeners.add(fn);
      return () => soundListeners.delete(fn);
    },
    () => soundVersion,
  );
  const pref = readSoundPref();
  const on = pref === null ? role === 'presenter' || role === 'screen' : pref === 'on';
  const set = (next: boolean) => {
    memoryPref = next ? 'on' : 'off';
    try {
      localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
    } catch {
      /* storage unavailable: the choice lasts until reload */
    }
    soundVersion++;
    for (const l of soundListeners) l();
  };
  return [on, set];
}
