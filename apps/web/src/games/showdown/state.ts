/**
 * DAS Survey Showdown client state: the parsed board, roles, settings and the private payloads.
 *
 * Roles come from the server: `presenterId` in synchronized state, plus the presenter-only sheet and
 * pass messages. The client never decides who presents — it only renders what it was sent. The
 * built-in answers live on the server (@dascade/game-core/showdown is never imported here).
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  SHOWDOWN_CARDS,
  SHOWDOWN_MSG,
  clockRemaining,
  parseBoard,
  resolveShowdownLook,
  type ShowdownBoardView,
  type ShowdownCard,
  type ShowdownMode,
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
import { playersEqual, serverNow, useGame, useLatestMessage, useRoomSelector, useSettings } from '../../net/hooks.ts';
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
  // By value: the 4 Hz hype patches would otherwise rebuild every roster on every stage.
  const players = useRoomSelector<ShowdownPublicState, ShowdownPublicState['players']>((s) => s.players, playersEqual);
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

/** The show's format: the board says during a show, the settings before it. */
export function useMode(settings: Pick<ShowdownSettings, 'mode'> | null | undefined): ShowdownMode {
  const board = useBoard();
  return board?.mode ?? settings?.mode ?? 'classic';
}

/** The holding card on the stage (null = none). */
export function useCard(): ShowdownCard | null {
  const card = useRoomSelector<ShowdownPublicState, string>((s) => s.card) ?? '';
  return (SHOWDOWN_CARDS as readonly string[]).includes(card) ? (card as ShowdownCard) : null;
}

/** A Reveal remaining sweep is running. */
export function useSweep(): boolean {
  return useRoomSelector<ShowdownPublicState, boolean>((s) => s.sweep) ?? false;
}

/** The loaded rounds are an event preset's practice boards (say "Rehearsal" everywhere). */
export function useRehearsal(): boolean {
  return useRoomSelector<ShowdownPublicState, boolean>((s) => s.rehearsal) ?? false;
}

export interface ClockView {
  /** The show has a round clock. */
  on: boolean;
  running: boolean;
  /** Ms left (negative = overtime), refreshed 4×/s while running. */
  left: number;
  max: number;
  /** The stage shows it. */
  stage: boolean;
}

/** The round clock (Presenter Showcase), counted down locally against the server's time. */
export function useClock(): ClockView {
  const endsAt = useRoomSelector<ShowdownPublicState, number>((s) => s.clockEndsAt) ?? 0;
  const paused = useRoomSelector<ShowdownPublicState, number>((s) => s.clockLeft) ?? 0;
  const max = useRoomSelector<ShowdownPublicState, number>((s) => s.clockMax) ?? 0;
  const stage = useRoomSelector<ShowdownPublicState, boolean>((s) => s.clockShow) ?? true;
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (!endsAt) return;
    setNow(serverNow());
    const t = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(t);
  }, [endsAt]);
  const left = clockRemaining({ clockEndsAt: endsAt, clockLeft: paused }, endsAt ? now : 0);
  return { on: max > 0, running: endsAt > 0, left, max, stage };
}

/** "9:59", and "+0:12" in overtime. */
export function formatClock(ms: number): string {
  const over = ms < 0;
  // Counting down shows the second still running (9:59.4 → "10:00" would lie); overtime counts up.
  const total = over ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${over ? '+' : ''}${m}:${String(s).padStart(2, '0')}`;
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
function subscribeSounds(fn: () => void): () => void {
  soundListeners.add(fn);
  return () => soundListeners.delete(fn);
}

// ---------------------------------------------------------------------------
// Theme music (Presenter Showcase): per device, on where show sounds are (presenter, big screens)
// ---------------------------------------------------------------------------

const MUSIC_KEY = 'dascade:showdown:music';
let musicMemory: 'on' | 'off' | null = null;

function readMusicPref(): 'on' | 'off' | null {
  try {
    const v = localStorage.getItem(MUSIC_KEY);
    return v === 'on' || v === 'off' ? v : musicMemory;
  } catch {
    return musicMemory;
  }
}

/** Whether this device plays the show's theme music under the opening, title cards and holding cards. */
export function useThemeMusicPref(): [boolean, (on: boolean) => void] {
  useSyncExternalStore(subscribeSounds, () => soundVersion);
  const pref = readMusicPref();
  const set = (next: boolean) => {
    musicMemory = next ? 'on' : 'off';
    try {
      localStorage.setItem(MUSIC_KEY, musicMemory);
    } catch {
      /* storage unavailable: the choice lasts until reload */
    }
    soundVersion++;
    for (const l of soundListeners) l();
  };
  return [pref !== 'off', set];
}

export function useShowSounds(role: ShowdownRole): [boolean, (on: boolean) => void] {
  useSyncExternalStore(subscribeSounds, () => soundVersion);
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
