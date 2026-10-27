/**
 * Runs the Presenter Tour's timeline into a demo source: beat by beat, with the click of a clicking
 * beat landing CLICK_AT ms in, the stage's events fed to the demo feed (so Boo says his real lines),
 * and the show's real sounds when the viewer turns sound on — all local, nothing sent anywhere.
 *
 * Playing: the beats run on timers, which pause with the tour (and when the tab is hidden), and a
 * running demo clock freezes with them. Stills (reduced motion, effects off): nothing runs by
 * itself; each step lands one beat.
 *
 * The runner is imperative (one controller per tour, its timers cleared on unmount) so that a beat's
 * events are applied exactly once, whatever React re-renders.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { showTitle, type ShowdownLook } from '@dascade/shared/games/showdown';
import { lineForCue, lineForEvent } from '../look.ts';
import { cueSounds, eventSounds, playShowSound, type ShowdownSound } from '../sounds.ts';
import { themeMusic } from '../themeMusic.ts';
import { createDemoSource, type DemoShow, type DemoSource } from './demoSource.ts';
import { DEMO_CODE, DEMO_SETTINGS } from './script.ts';
import {
  CLICK_AT,
  beatStarts,
  beatsOf,
  clicks,
  frameAt,
  holdOf,
  preFrameAt,
  showAt,
  type TourBeat,
  type TourChapter,
  type TourFrame,
} from './timeline.ts';

export interface TourOptions {
  chapters: readonly TourChapter[];
  film: boolean;
  look: ShowdownLook;
  /** Play by itself (false: stills, one beat per step). */
  autoplay: boolean;
  /** Start at the first chapter's start, paused, for play() later (the film's intro runs first). */
  startPaused?: boolean;
  /** The pause before each chapter's first beat (the film shows its chapter cards there). */
  lead?: number;
  /** The show's sounds (local only). */
  sound: boolean;
  /** The theme music under the opening, the title cards and holding cards (never inside a live room). */
  music: boolean;
  startChapter?: number;
  /** The least a beat may hold (the film's narration), by beat key. */
  minHold?: (key: string) => number;
  /** A beat landed (the film's narration). */
  onLand?: (key: string, beat: TourBeat) => void;
  /** The last beat of the last chapter finished. */
  onEnd?: () => void;
}

export interface TourView {
  chapter: number;
  /** The beat on screen (-1: the chapter's start). */
  beat: number;
  /** 'pre' = a click on its way; 'post' = the beat has landed. */
  phase: 'pre' | 'post';
  playing: boolean;
  done: boolean;
  /** Changes on every landing (re-keys the press pulse). */
  landed: number;
}

export interface Tour extends TourView {
  source: DemoSource;
  frame: TourFrame;
  play(): void;
  pause(): void;
  toggle(): void;
  goChapter(index: number): void;
  /** One beat on (stills). */
  next(): void;
  /** One beat back. */
  prev(): void;
  restart(): void;
  /** Ms into the current chapter. */
  elapsed(): number;
}

/** A beat's key: chapter id and its index in the cut (the film's narration files are named by it). */
export const beatKey = (chapter: TourChapter, index: number) => `${chapter.id}:${index}`;

/** The pause before a chapter's first beat. */
const LEAD_MS = 700;
const lead = (opts: { current: TourOptions }) => opts.current.lead ?? LEAD_MS;

export function useTour(options: TourOptions): Tour {
  const opts = useRef(options);
  opts.current = options;
  const [view, setView] = useState<TourView>(() => ({
    chapter: clampChapter(options.startChapter ?? 0, options.chapters),
    beat: -1,
    phase: 'post',
    playing: false,
    done: false,
    landed: 0,
  }));
  const controller = useMemo(() => createController(opts, setView, view.chapter), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    controller.mount();
    return () => controller.unmount();
  }, [controller]);

  // Hidden tab: pause (the presenter comes back to where they left).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') controller.pause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [controller]);

  // Sound or music turned off: the theme music stops at once; on again, it comes back where it should.
  useEffect(() => controller.music(), [controller, options.sound, options.music, options.look]);

  const chapter = options.chapters[view.chapter]!;
  const frame = view.phase === 'pre' ? preFrameAt(chapter, view.beat, options.film) : frameAt(chapter, view.beat, options.film);
  return { ...view, source: controller.source, frame, ...controller.api };
}

function clampChapter(index: number, chapters: readonly TourChapter[]): number {
  return Math.max(0, Math.min(chapters.length - 1, Math.floor(index) || 0));
}

function createController(opts: { current: TourOptions }, setView: (fn: (v: TourView) => TourView) => void, first: number) {
  const source = createDemoSource(DEMO_CODE);
  let ch = first;
  let i = -1;
  let phase: 'pre' | 'post' = 'post';
  let playing = false;
  let done = false;
  let landed = 0;
  let mounted = false;
  /** The pending step and when it's due (performance.now()), or what was left of it when paused. */
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: (() => void) | null = null;
  let due = 0;
  let left = 0;
  /** A step's timer is running it, and when that step was due. */
  let stepping = false;
  let stepDue = 0;
  let beatAt = 0;
  let pausedAt = 0;
  let cueId = 0;
  const soundTimers = new Set<ReturnType<typeof setTimeout>>();
  let musicTimer: ReturnType<typeof setTimeout> | null = null;

  const chapters = () => opts.current.chapters;
  const beats = (c = ch) => beatsOf(chapters()[c]!, opts.current.film);

  function publish(): void {
    setView((v) => ({ ...v, chapter: ch, beat: i, phase, playing, done, landed }));
  }

  function clear(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  }

  /**
   * The next step, `ms` after this one. A step scheduled by a step counts from when that step was
   * due, not from when its timer happened to fire, so timer lateness never adds up over a chapter.
   */
  function schedule(ms: number, fn: () => void): void {
    clear();
    pending = fn;
    const now = performance.now();
    due = (stepping ? stepDue : now) + Math.max(0, ms);
    left = Math.max(0, due - now);
    if (playing) timer = setTimeout(run, left);
  }

  function run(): void {
    const fn = pending;
    timer = null;
    pending = null;
    stepping = true;
    stepDue = due;
    try {
      fn?.();
    } finally {
      stepping = false;
    }
  }

  function sound(name: ShowdownSound, delay = 0): void {
    if (!opts.current.sound) return;
    const look = opts.current.look;
    if (delay <= 0) return playShowSound(name, look);
    const t = setTimeout(() => {
      soundTimers.delete(t);
      playShowSound(name, look);
    }, delay);
    soundTimers.add(t);
  }

  /** The theme music, as the room plays it: under the opening, a title card or a holding card. */
  function music(): void {
    if (musicTimer) clearTimeout(musicTimer);
    musicTimer = null;
    const { music: allowed, sound: on, look } = opts.current;
    if (!allowed) return;
    const show = source.show();
    const stage = show.board?.stage ?? null;
    const wanted =
      on &&
      playing &&
      ((show.phase === 'PLAYING' && (show.card !== null || stage === 'intro' || stage === 'title')) ||
        (show.phase !== 'PLAYING' && show.card !== null));
    if (!wanted) return themeMusic.stop();
    musicTimer = setTimeout(() => themeMusic.play(look), stage === 'intro' && show.card === null ? 4200 : 0);
  }

  /** Puts a beat's changes on the demo stage: the show, its events (lines, moments, sounds), cues. */
  function apply(beat: TourBeat, before: DemoShow): void {
    const { look } = opts.current;
    if (beat.show) source.set(beat.show);
    const after = source.show();
    const feed = source.feed;
    for (const e of beat.events ?? []) {
      feed.event(e);
      feed.say(lineForEvent(e, { look, board: after.board, teamNames: ['', ''], mode: 'showcase', show: showTitle(DEMO_SETTINGS) }));
      for (const [name, delay] of eventSounds(e, 'showcase')) sound(name, delay);
    }
    if (beat.cue) {
      cueId++;
      feed.cue(beat.cue, cueId);
      feed.say(lineForCue(beat.cue, cueId, look));
      for (const [name, delay] of cueSounds(beat.cue)) sound(name, delay);
    }
    if (beat.sound) sound(beat.sound);
    if (after.card && after.card !== before.card) sound('cardIn');
    if (after.finale && !before.finale) sound('finale', 250);
    music();
  }

  /** Jumps to a beat without playing anything (the show as it stands after it). */
  function seek(c: number, index: number): void {
    clear();
    ch = c;
    i = Math.max(-1, Math.min(index, beats(c).length - 1));
    phase = 'post';
    done = false;
    source.reset(showAt(chapters()[c]!, i, opts.current.film));
    if (!playing) source.freeze();
    beatAt = performance.now();
    music();
    publish();
  }

  /** Starts beat `index` of the current chapter (a click first, if it clicks). */
  function begin(index: number, still = false): void {
    i = index;
    beatAt = performance.now();
    const beat = beats()[i]!;
    if (clicks(beat) && !still) {
      phase = 'pre';
      publish();
      schedule(CLICK_AT, land);
    } else land();
  }

  function land(): void {
    const chapter = chapters()[ch]!;
    const beat = beats()[i]!;
    const before = source.show();
    phase = 'post';
    landed++;
    apply(beat, before);
    const key = `${chapter.id}:${i}`;
    opts.current.onLand?.(key, beat);
    publish();
    const hold = Math.max(holdOf(beat, opts.current.film), opts.current.minHold?.(key) ?? 0);
    schedule(Math.max(300, hold - (clicks(beat) ? CLICK_AT : 0)), advance);
  }

  /** On to the next beat, the next chapter, or the end. */
  function advance(): void {
    if (i + 1 < beats().length) return begin(i + 1);
    if (ch + 1 < chapters().length) {
      seek(ch + 1, -1);
      return schedule(lead(opts), () => begin(0));
    }
    done = true;
    playing = false;
    clear();
    source.freeze();
    music();
    publish();
    opts.current.onEnd?.();
  }

  function play(): void {
    if (playing) return;
    if (done) {
      done = false;
      seek(0, -1);
    }
    playing = true;
    source.thaw();
    if (pausedAt) beatAt += performance.now() - pausedAt;
    pausedAt = 0;
    if (pending) {
      due = performance.now() + left;
      timer = setTimeout(run, left);
    } else if (i < 0) schedule(lead(opts), () => begin(0));
    else schedule(0, advance);
    music();
    publish();
  }

  function pause(): void {
    if (!playing) return;
    playing = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
      left = Math.max(0, due - performance.now());
    }
    pausedAt = performance.now();
    source.freeze();
    music();
    publish();
  }

  const api = {
    play,
    pause,
    toggle: () => (playing ? pause() : play()),
    goChapter(index: number) {
      const c = clampChapter(index, chapters());
      seek(c, -1);
      if (playing) schedule(lead(opts), () => begin(0));
      else begin(0, true);
    },
    next() {
      if (phase === 'pre') return run();
      if (i + 1 < beats().length) return begin(i + 1, !playing);
      if (ch + 1 < chapters().length) return api.goChapter(ch + 1);
    },
    prev() {
      if (i > 0) return seek(ch, i - 1);
      if (ch > 0) return seek(ch - 1, beats(ch - 1).length - 1);
      seek(0, -1);
    },
    restart() {
      api.goChapter(ch);
    },
    elapsed() {
      const start = beatStarts(chapters()[ch]!, opts.current.film)[i] ?? 0;
      if (i < 0) return 0;
      const now = playing ? performance.now() : pausedAt || performance.now();
      return start + Math.max(0, now - beatAt);
    },
  };

  return {
    source,
    api,
    music,
    pause,
    mount() {
      mounted = true;
      seek(ch, -1);
      if (opts.current.autoplay) play();
      else if (!opts.current.startPaused) begin(0, true);
    },
    unmount() {
      if (!mounted) return;
      mounted = false;
      clear();
      playing = false;
      for (const t of soundTimers) clearTimeout(t);
      soundTimers.clear();
      if (musicTimer) clearTimeout(musicTimer);
      if (opts.current.music) themeMusic.stop();
    },
  };
}
