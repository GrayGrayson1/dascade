/**
 * The Presenter Tour's show source: a pretend room the real stage reads (source.ts) — a board, a
 * clock, a holding card, the finale and a show feed of its own. Nothing here talks to a server: the
 * tour's timeline sets it beat by beat.
 *
 * The clock counts down like the room's (the stage counts against serverNow()), and freezes with the
 * tour: pausing the tour pauses a running demo clock too.
 */
import type { ShowdownBoardView, ShowdownCard, ShowdownFinale } from '@dascade/shared/games/showdown';
import { serverNow } from '../../../net/hooks.ts';
import { createShowFeed } from '../fx.ts';
import type { ShowSource, ShowState } from '../source.ts';

export interface DemoClock {
  /** Full time (ms); 0 = no clock. */
  max: number;
  /** Ms left when this was set (negative = overtime). */
  left: number;
  running: boolean;
  /** The stage shows it. */
  show: boolean;
}

/** What a demo show looks like at one moment (the timeline's unit of state). */
export interface DemoShow {
  phase: 'LOBBY' | 'PLAYING' | 'RESULTS';
  board: ShowdownBoardView | null;
  finale: ShowdownFinale | null;
  card: ShowdownCard | null;
  sweep: boolean;
  clock: DemoClock;
}

export const NO_CLOCK: DemoClock = { max: 0, left: 0, running: false, show: true };

export const EMPTY_SHOW: DemoShow = { phase: 'LOBBY', board: null, finale: null, card: null, sweep: false, clock: NO_CLOCK };

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
  let state: ShowState = build();

  function arm(clock: DemoClock): void {
    endsAt = clock.running && !frozen ? serverNow() + clock.left : 0;
    left = clock.left;
  }

  function build(): ShowState {
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
      players: {},
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
  state = build();

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get: () => state,
    feed,
    show: () => show,
    set(patch) {
      show = { ...show, ...patch };
      if (patch.clock) arm(patch.clock);
      emit();
    },
    reset(next) {
      show = next;
      arm(next.clock);
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
