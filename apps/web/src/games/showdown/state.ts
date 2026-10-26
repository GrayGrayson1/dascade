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
  type ShowdownAuditView,
  type ShowdownCrewPrivate,
  type ShowdownPermission,
  type ShowdownPreflightData,
  type ShowdownSeatState,
  isSoundStation,
} from '@dascade/shared/games/showdown';
import { playersEqual, serverNow, useGame, useLatestMessage, useRoomSelector, useSettings } from '../../net/hooks.ts';
import { useShowSelector } from './source.ts';
import { useSessionStore } from '../../net/session.ts';
import { useApp } from '../../app/store.ts';
import { seasonClock } from '../../themes/seasonalController.ts';

export function useShowdownGame() {
  return useGame<ShowdownPublicState, ShowdownSettings>();
}

// The stage's hooks (board, finale, card, clock, sweep…) read the room through useShowSelector, so a
// demo source (the Presenter Tour, source.ts) can drive the same stage without a room.

/** The room's phase, as the stage sees it. */
export function useShowPhase(): string {
  return useShowSelector((s) => s.phase) ?? 'LOBBY';
}

/** The room code, as the stage sees it ('' outside a room). */
export function useShowCode(): string {
  return useShowSelector((s) => s.code) ?? '';
}

/** The parsed public board (null outside a show). Re-parses only when the JSON changes. */
export function useBoard(): ShowdownBoardView | null {
  const json = useShowSelector((s) => s.boardJson);
  return useMemo(() => parseBoard(json), [json]);
}

export function useFinale(): ShowdownFinale | null {
  const json = useShowSelector((s) => s.finaleJson);
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
  const role: ShowdownRole =
    playerId && presenterId === playerId ? 'presenter' : localScreen ? 'screen' : spectator ? 'spectator' : 'audience';
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
  const teams = useShowSelector((s) => s.teams);
  // By value: the 4 Hz hype patches would otherwise rebuild every roster on every stage.
  const players = useShowSelector((s) => s.players, playersEqual);
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
  const h0 = useShowSelector((s) => s.hype0) ?? 0;
  const h1 = useShowSelector((s) => s.hype1) ?? 0;
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
  const card = useShowSelector((s) => s.card) ?? '';
  return (SHOWDOWN_CARDS as readonly string[]).includes(card) ? (card as ShowdownCard) : null;
}

/** A Reveal remaining sweep is running. */
export function useSweep(): boolean {
  return useShowSelector((s) => s.sweep) ?? false;
}

/** The loaded rounds are an event preset's practice boards (say "Rehearsal" everywhere). */
export function useRehearsal(): boolean {
  return useShowSelector((s) => s.rehearsal) ?? false;
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
  const endsAt = useShowSelector((s) => s.clockEndsAt) ?? 0;
  const paused = useShowSelector((s) => s.clockLeft) ?? 0;
  const max = useShowSelector((s) => s.clockMax) ?? 0;
  const stage = useShowSelector((s) => s.clockShow) ?? true;
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

// ---------------------------------------------------------------------------
// Event rooms: the picker, crew, audit, sound station and preflight
// (contract: "Picker", "Crew", "Audit", "Sound station" and "Preflight" in @dascade/shared/games/showdown)
// ---------------------------------------------------------------------------

/** The event preset that made this an event room ('' = an ordinary room). Stage-safe (reads the show source). */
export function useEvent(): string {
  return useShowSelector((s) => s.event) ?? '';
}

export interface PickerView {
  /** Draws so far this show: send it with every picker act. */
  drawNo: number;
  /** The hot seat ('' = nobody) and their name. */
  hotSeat: string;
  hotName: string;
  /** When the draw was made / when the stage lands on it (server epoch ms, 0 = no draw). */
  pickAt: number;
  landAt: number;
  poolSize: number;
  /** playerIds whose turn counted this round. */
  done: Record<string, boolean>;
}

/** The picker's public state. Stage-safe (reads the show source, so the tour can drive it). */
export function usePicker(): PickerView {
  const drawNo = useShowSelector((s) => s.drawNo) ?? 0;
  const hotSeat = useShowSelector((s) => s.hotSeat) ?? '';
  const hotName = useShowSelector((s) => (s.hotSeat ? (s.players?.[s.hotSeat]?.name ?? '') : '')) ?? '';
  const pickAt = useShowSelector((s) => s.pickAt) ?? 0;
  const landAt = useShowSelector((s) => s.landAt) ?? 0;
  const poolSize = useShowSelector((s) => s.poolSize) ?? 0;
  const done = useShowSelector((s) => s.done) ?? EMPTY_FLAGS;
  return { drawNo, hotSeat, hotName, pickAt, landAt, poolSize, done };
}

const EMPTY_FLAGS: Record<string, boolean> = {};

export interface GridSeat {
  id: string;
  name: string;
  state: ShowdownSeatState;
}

/**
 * The stage's spotlight grid: every seat in `seats` (participants who aren't hidden), in join order,
 * labelled pool / hot / done / away. Nothing here says who chose Skip me (a skipping seat shows as
 * 'pool' like everyone else — only the pool count knows). Stage-safe.
 */
export function useSeatGrid(): GridSeat[] {
  const seats = useShowSelector((s) => s.seats) ?? EMPTY_FLAGS;
  const players = useShowSelector((s) => s.players, playersEqual);
  const hot = useShowSelector((s) => s.hotSeat) ?? '';
  const done = useShowSelector((s) => s.done) ?? EMPTY_FLAGS;
  return useMemo(() => {
    const out: GridSeat[] = [];
    for (const id of Object.keys(seats)) {
      const p = players?.[id];
      if (!p) continue;
      const state: ShowdownSeatState = id === hot ? 'hot' : done[id] ? 'done' : p.connected ? 'pool' : 'away';
      out.push({ id, name: p.name, state });
    }
    out.sort((a, b) => (players?.[a.id]?.joinOrder ?? 0) - (players?.[b.id]?.joinOrder ?? 0));
    return out;
  }, [seats, players, hot, done]);
}

/** Your crew view (null: no crew role and not presenting, or not sent yet). */
export function useCrew(): ShowdownCrewPrivate | null {
  return useLatestMessage<ShowdownCrewPrivate | null>(SHOWDOWN_MSG.crew) ?? null;
}

/** Whether you may do this right now (the server checks again; this only shapes the screen). */
export function useCan(perm: ShowdownPermission): boolean {
  const crew = useCrew();
  return Boolean(crew?.perms.includes(perm));
}

/** The latest audit entries (crew with audit.read only). */
export function useAudit(): ShowdownAuditView | null {
  return useLatestMessage<ShowdownAuditView>(SHOWDOWN_MSG.audit) ?? null;
}

/** The last preflight answer from the server (ask with showdownApi.preflight()). */
export function usePreflightData(): ShowdownPreflightData | null {
  return useLatestMessage<ShowdownPreflightData>(SHOWDOWN_MSG.preflight) ?? null;
}

export interface StationView {
  /** This is an event room: exactly one device plays the show's sound. */
  event: boolean;
  /** The station's playerId ('' = the presenter's console). */
  station: string;
  /** The device that actually plays (the presenter's id when station is ''). */
  holderId: string;
  holderName: string;
  /** Server epoch ms of the station's last heartbeat (0 = none). */
  seenAt: number;
  /** This connection is the station. */
  mine: boolean;
  /** Per-device audio status (SHOWDOWN_AUDIO_READY | SHOWDOWN_AUDIO_SILENT). */
  audio: Record<string, number>;
}

/** The sound station (AUD-02). Outside event rooms every device keeps today's behaviour (mine = true). */
export function useStation(): StationView {
  const playerId = useSessionStore((s) => s.playerId);
  const event = useRoomSelector<ShowdownPublicState, string>((s) => s.event ?? '') ?? '';
  const station = useRoomSelector<ShowdownPublicState, string>((s) => s.soundStation ?? '') ?? '';
  const presenterId = useRoomSelector<ShowdownPublicState, string>((s) => s.presenterId) ?? '';
  const seenAt = useRoomSelector<ShowdownPublicState, number>((s) => s.soundSeenAt ?? 0) ?? 0;
  const audio = useRoomSelector<ShowdownPublicState, Record<string, number>>((s) => s.audio ?? EMPTY_AUDIO) ?? EMPTY_AUDIO;
  const holderId = station || presenterId;
  const holderName = useRoomSelector<ShowdownPublicState, string>((s) => (holderId ? (s.players?.[holderId]?.name ?? '') : '')) ?? '';
  const mine = event ? isSoundStation({ event, soundStation: station, presenterId }, playerId) : true;
  return { event: Boolean(event), station, holderId, holderName, seenAt, mine, audio };
}

const EMPTY_AUDIO: Record<string, number> = {};
