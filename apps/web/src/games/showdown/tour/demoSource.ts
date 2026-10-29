/**
 * The Presenter Tour's show source: a pretend room the real stage reads (source.ts) — a board, a
 * clock, a holding card, the finale and a show feed of its own. Nothing here talks to a server: the
 * tour's timeline sets it beat by beat.
 *
 * The clock counts down like the room's (the stage counts against serverNow()), and freezes with the
 * tour: pausing the tour pauses a running demo clock too.
 */
import {
  SHOWDOWN_PICK_LAND_MS,
  type ShowdownBoardView,
  type ShowdownCard,
  type ShowdownFinale,
  type ShowdownScoreboard,
  type ShowdownSceneCard,
} from '@dascade/shared/games/showdown';
import type { PlayerView } from '@dascade/shared';
import { serverNow } from '../../../net/hooks.ts';
import type { AwardsView } from '../awards.ts';
import type { CinemaView } from '../cinema.ts';
import { createShowFeed } from '../fx.ts';
import type { ShowExtras, ShowSource, ShowState } from '../source.ts';

export interface DemoClock {
  /** Full time (ms); 0 = no clock. */
  max: number;
  /** Ms left when this was set (negative = overtime). */
  left: number;
  running: boolean;
  /** The stage shows it. */
  show: boolean;
}

/** What's up on the stage instead of the board: a holding card, a scene (Cinema, Awards) or the standings. */
export type DemoCard = ShowdownCard | ShowdownSceneCard | 'standings';

/** What a demo show looks like at one moment (the timeline's unit of state). */
export interface DemoShow {
  phase: 'LOBBY' | 'PLAYING' | 'RESULTS';
  board: ShowdownBoardView | null;
  finale: ShowdownFinale | null;
  card: DemoCard | null;
  sweep: boolean;
  clock: DemoClock;
  /** The guests who joined on a phone (the picker's spotlight grid), by name. */
  guests: readonly string[];
  /** The guest in the hot seat ('' = nobody). A new name is a new draw: the stage sweeps and lands on them. */
  hot: string;
  /** Guests whose turn counted this round. */
  done: readonly string[];
  /** The Join pop-up is over the board (it goes up as this is set). */
  join: boolean;
  /** The public scoreboard (the Standings card), null = scoring off. */
  scores: ShowdownScoreboard | null;
  /** The paced finale's step on the results screen (index into finaleSteps()). */
  finaleStep: number;
  /** The pretend video in the Cinema scene (null = none loaded). */
  cinema: CinemaView | null;
  /** The pretend awards ceremony (null = none). */
  awards: AwardsView | null;
}

export const NO_CLOCK: DemoClock = { max: 0, left: 0, running: false, show: true };

export const EMPTY_SHOW: DemoShow = {
  phase: 'LOBBY',
  board: null,
  finale: null,
  card: null,
  sweep: false,
  clock: NO_CLOCK,
  guests: [],
  hot: '',
  done: [],
  join: false,
  scores: null,
  finaleStep: 0,
  cinema: null,
  awards: null,
};

/** A demo guest's player id (stable by position, so the grid keeps its order). */
export const guestId = (i: number) => `demo-guest-${i}`;

function guestPlayers(guests: readonly string[]): Record<string, PlayerView> {
  const out: Record<string, PlayerView> = {};
  guests.forEach((name, i) => {
    const id = guestId(i);
    out[id] = {
      id,
      name,
      color: '',
      avatar: '',
      isHost: false,
      ready: true,
      spectator: false,
      connected: true,
      queued: false,
      joinOrder: i + 1,
      score: 0,
    };
  });
  return out;
}

export interface DemoSource extends ShowSource {
  /** The show as last set. */
  show(): DemoShow;
  /** Merges a change in (a board, a card, the clock…). */
  set(patch: Partial<DemoShow>): void;
  /** Replaces the whole show and clears the feed (jumping to a chapter). */
  reset(show: DemoShow): void;
  /** Ms left on the clock right now. */
  clockLeft(): number;
  /** Stops a running clock where it is (the tour paused or the tab was hidden)… */
  freeze(): void;
  /** …and lets it run on. */
  thaw(): void;
}

/** A demo source with this room code (shown on the stage's join hints). */
export function createDemoSource(code: string, initial: DemoShow = EMPTY_SHOW): DemoSource {
  const feed = createShowFeed();
  const listeners = new Set<() => void>();
  let show = initial;
  let frozen = false;
  /** When a running clock reaches 0 (serverNow() ms), or its frozen ms left. */
  let endsAt = 0;
  let left = 0;
  /** The picker's draw: its number and when it was made (serverNow() ms). */
  let drawNo = 0;
  let pickAt = 0;
  /** When the Join pop-up went up (serverNow() ms; 0 = down). */
  let joinAt = 0;
  let extras: ShowExtras = {};
  let state: ShowState = build();

  function arm(clock: DemoClock): void {
    endsAt = clock.running && !frozen ? serverNow() + clock.left : 0;
    left = clock.left;
  }

  /** A new name in the hot seat is a new draw; the Join pop-up times itself from when it went up. */
  function stamp(prev: DemoShow | null, next: DemoShow): void {
    if (next.hot && next.hot !== prev?.hot) {
      drawNo += 1;
      pickAt = serverNow();
    } else if (!next.hot) pickAt = 0;
    if (next.join && !prev?.join) joinAt = serverNow();
    else if (!next.join) joinAt = 0;
    extras = { ...(next.cinema ? { cinema: next.cinema } : {}), ...(next.awards ? { awards: next.awards } : {}) };
  }

  function build(): ShowState {
    const players = guestPlayers(show.guests);
    const idOf = (name: string) => guestId(show.guests.indexOf(name));
    const done: Record<string, boolean> = {};
    for (const name of show.done) if (show.guests.includes(name)) done[idOf(name)] = true;
    const seats: Record<string, boolean> = {};
    for (const id of Object.keys(players)) seats[id] = true;
    const hotSeat = show.hot && show.guests.includes(show.hot) ? idOf(show.hot) : '';
    return {
      phase: show.phase,
      code,
      boardJson: show.board ? JSON.stringify(show.board) : '',
      finaleJson: show.finale ? JSON.stringify(show.finale) : '',
      card: show.card ?? '',
      sweep: show.sweep,
      rehearsal: false,
      clockEndsAt: endsAt,
      clockLeft: endsAt ? 0 : left,
      clockMax: show.clock.max,
      clockShow: show.clock.show,
      hype0: 0,
      hype1: 0,
      teams: {},
      players,
      event: '',
      drawNo,
      hotSeat,
      pickAt: hotSeat ? pickAt : 0,
      landAt: hotSeat && pickAt ? pickAt + SHOWDOWN_PICK_LAND_MS : 0,
      poolSize: Math.max(0, show.guests.length - show.done.length - (hotSeat && !done[hotSeat] ? 1 : 0)),
      done,
      seats,
      joinAt,
      scoreJson: show.scores ? JSON.stringify(show.scores) : '',
      finaleStep: show.finaleStep,
    };
  }

  function emit(): void {
    state = build();
    for (const l of [...listeners]) l();
  }

  function remaining(): number {
    return endsAt ? endsAt - serverNow() : left;
  }

  arm(show.clock);
  stamp(null, show);
  state = build();

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get: () => state,
    feed,
    extras: () => extras,
    show: () => show,
    set(patch) {
      const prev = show;
      show = { ...show, ...patch };
      if (patch.clock) arm(patch.clock);
      stamp(prev, show);
      emit();
    },
    reset(next) {
      show = next;
      arm(next.clock);
      // A chapter that starts with someone in the hot seat starts after their spotlight landed.
      stamp(null, next);
      if (next.hot) pickAt = serverNow() - SHOWDOWN_PICK_LAND_MS - 60_000;
      feed.reset();
      emit();
    },
    clockLeft: remaining,
    freeze() {
      if (frozen) return;
      frozen = true;
      if (!endsAt) return;
      left = remaining();
      endsAt = 0;
      emit();
    },
    thaw() {
      if (!frozen) return;
      frozen = false;
      if (!show.clock.running) return;
      endsAt = serverNow() + left;
      emit();
    },
  };
}
