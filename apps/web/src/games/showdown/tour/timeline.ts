/**
 * The Presenter Tour's timeline, as data: chapters of timed beats. A beat is a pure description of
 * one moment — what changes on the demo stage (a board, the clock, a card), the board events to play
 * (so the real stage animates and Boo says his real lines), where the cursor goes on the mock
 * console, a line in the meeting chat and the caption that explains it.
 *
 * Nothing here touches React, the DOM or a timer: the player (TourPlayer.tsx) runs the timeline, and
 * `frameAt` / `showAt` say what the screen looks like at any beat (used to jump between chapters,
 * to step through stills under reduced motion, and by the tests).
 *
 * The film cut ("Boo's Backstage Tour") is the same timeline played slower, with Boo's narration and
 * a few film-only beats for his jokes.
 */
import type { ShowdownCue, ShowdownEvent } from '@dascade/shared/games/showdown';
import type { HostMood } from '../look.ts';
import type { ShowdownSound } from '../sounds.ts';
import { EMPTY_SHOW, type DemoShow } from './demoSource.ts';

/** What the left panel shows. */
export type TourScreen = 'diagram' | 'lobby' | 'share' | 'console' | 'results';

export type LobbyTab = 'setup' | 'settings';

/** The console's inline two-step panel for the show's one irreversible action (End show / Finish show). */
export type TourDialog = 'finish' | 'end';

/** The console drawer's tab under the stage preview. */
export type DrawerTabId = 'picker' | 'sound' | 'cards' | 'fix';

/** Boo's bits in the film: each is a little animation of the narrator (tour.css). */
export type BooAct = 'float' | 'point' | 'cover' | 'faint' | 'jump' | 'spin' | 'watch' | 'drums' | 'wave' | 'shrug' | 'listen';

export interface ConsoleBeat {
  screen?: TourScreen;
  /** The lobby's tab (the presets are under Settings, the stage window and cards under Your setup). */
  tab?: LobbyTab;
  /** The control the cursor goes to (a `data-tour` name on the mock), '' = the cursor rests. */
  point?: string;
  /** The cursor clicks it: the beat's changes land as the click does (CLICK_AT ms in). */
  click?: boolean;
  /** The shortcut key that does the same, shown as a keycap by the cursor. */
  key?: string;
  /** Zoom the console towards the control (1 = the whole console). */
  zoom?: number;
  /** The End show / Finish show panel on the console (null closes it). */
  dialog?: TourDialog | null;
  /** The console drawer's open tab (it stays until a beat changes it). */
  drawer?: DrawerTabId;
  /** The special answer is armed, waiting for Take special (stays until a beat changes it). */
  armed?: boolean;
  /** The click is a press-and-hold: the control's ring fills (Restart, End show). */
  held?: boolean;
}

export interface ChatLine {
  who: string;
  text: string;
}

export interface TourBeat {
  /** How long this beat holds before the next one (ms). */
  hold: number;
  /** The film's hold (default: hold × FILM_PACE). */
  filmHold?: number;
  /** Only in the film ('film'), or only in the tour ('tour'). */
  cut?: 'film' | 'tour';
  /**
   * What the beat teaches, as one short sentence. `[[Name]]` is a control's name exactly as the
   * console says it (tested), `{{X}}` a key, `*Name*` something in the meeting app, `**text**` bold.
   */
  caption?: string;
  /** Changes on the demo stage. */
  show?: Partial<DemoShow>;
  /** Board events: the stage's moments, Boo's lines and the show's sounds. */
  events?: ShowdownEvent[];
  cue?: ShowdownCue;
  /** A sound on its own (Test sound's ding). */
  sound?: ShowdownSound;
  console?: ConsoleBeat;
  chat?: ChatLine;
  /** The stage window is open (the right panel shows the stage). */
  stage?: boolean;
  /** The event preset is loaded (the lobby mock shows it). */
  preset?: boolean;
  /** The step of the chapter's illustration (the big-picture diagram, the share dialog). */
  step?: number;
  /** A toast on the mock console ('' clears it). */
  toast?: string;
  /** The console's undo toast after a reversible action ('' clears it). */
  undo?: string;
  /** Boo, the narrator: his line, his bit and his mood. */
  boo?: { say?: string; act?: BooAct; mood?: HostMood };
}

export interface TourChapter {
  id: string;
  title: string;
  /** Boo's title card for the chapter in the film. */
  film?: string;
  /** The show at the chapter's start (so every chapter can be played on its own). */
  setup: DemoShow;
  /** The panels at the chapter's start. */
  screen: TourScreen;
  stage: boolean;
  preset: boolean;
  beats: TourBeat[];
}

/** The film's pace against the tour's (a beat can set its own filmHold); its chapter cards and intro add the breathing room. */
export const FILM_PACE = 1;
/** A clicking beat's changes land this long after it starts (the cursor's glide and the press). */
export const CLICK_AT = 640;

/** The beats of a chapter in this cut. */
export function beatsOf(chapter: TourChapter, film: boolean): TourBeat[] {
  return chapter.beats.filter((b) => (film ? b.cut !== 'tour' : b.cut !== 'film'));
}

export function holdOf(beat: TourBeat, film: boolean): number {
  return film ? (beat.filmHold ?? Math.round(beat.hold * FILM_PACE)) : beat.hold;
}

export function chapterLength(chapter: TourChapter, film: boolean): number {
  return beatsOf(chapter, film).reduce((ms, b) => ms + holdOf(b, film), 0);
}

export function tourLength(chapters: readonly TourChapter[], film: boolean): number {
  return chapters.reduce((ms, c) => ms + chapterLength(c, film), 0);
}

/** When each beat starts within its chapter (ms). */
export function beatStarts(chapter: TourChapter, film: boolean): number[] {
  let at = 0;
  return beatsOf(chapter, film).map((b) => {
    const start = at;
    at += holdOf(b, film);
    return start;
  });
}

/** The demo show once beats 0…index have landed (index -1 = the chapter's setup). */
export function showAt(chapter: TourChapter, index: number, film: boolean): DemoShow {
  let show: DemoShow = { ...EMPTY_SHOW, ...chapter.setup };
  for (const beat of beatsOf(chapter, film).slice(0, index + 1)) if (beat.show) show = { ...show, ...beat.show };
  return show;
}

/** Everything around the stage at one beat. */
export interface TourFrame {
  caption: string;
  screen: TourScreen;
  tab: LobbyTab;
  /** Cursor target ('' = resting). */
  point: string;
  /** This beat clicks (with its key, if it has one). */
  click: boolean;
  key: string;
  zoom: number;
  dialog: TourDialog | null;
  drawer: DrawerTabId;
  armed: boolean;
  /** This beat's click is a press-and-hold. */
  held: boolean;
  chat: ChatLine[];
  stage: boolean;
  preset: boolean;
  step: number;
  toast: string;
  undo: string;
  boo: { say: string; act: BooAct; mood: HostMood };
}

export function frameAt(chapter: TourChapter, index: number, film: boolean): TourFrame {
  const frame: TourFrame = {
    caption: '',
    screen: chapter.screen,
    tab: 'setup',
    point: '',
    click: false,
    key: '',
    zoom: 1,
    dialog: null,
    drawer: 'picker',
    armed: false,
    held: false,
    chat: [],
    stage: chapter.stage,
    preset: chapter.preset,
    step: 0,
    toast: '',
    undo: '',
    boo: { say: '', act: 'float', mood: 'idle' },
  };
  const beats = beatsOf(chapter, film).slice(0, index + 1);
  beats.forEach((b, i) => {
    const current = i === beats.length - 1;
    if (b.caption !== undefined) frame.caption = b.caption;
    const c = b.console;
    if (c?.screen) frame.screen = c.screen;
    if (c?.tab) frame.tab = c.tab;
    if (c?.point !== undefined) frame.point = c.point;
    if (c?.zoom !== undefined) frame.zoom = c.zoom;
    if (c?.dialog !== undefined) frame.dialog = c.dialog;
    if (c?.drawer !== undefined) frame.drawer = c.drawer;
    if (c?.armed !== undefined) frame.armed = c.armed;
    // A new screen starts with the cursor resting and the camera back out, unless the beat says.
    if (c?.screen && c.point === undefined) frame.point = '';
    if (c?.screen && c.zoom === undefined) frame.zoom = 1;
    if (b.chat) frame.chat = [...frame.chat, b.chat];
    if (b.stage !== undefined) frame.stage = b.stage;
    if (b.preset !== undefined) frame.preset = b.preset;
    if (b.step !== undefined) frame.step = b.step;
    if (b.toast !== undefined) frame.toast = b.toast;
    if (b.undo !== undefined) frame.undo = b.undo;
    // Boo's line lasts for its beat; his mood and bit carry on until the next one changes them.
    frame.boo = {
      say: current ? (b.boo?.say ?? '') : '',
      act: b.boo?.act ?? (b.boo ? 'float' : frame.boo.act),
      mood: b.boo?.mood ?? (b.boo ? 'idle' : frame.boo.mood),
    };
    if (current) {
      frame.click = Boolean(c?.click);
      frame.held = Boolean(c?.click && c.held);
      frame.key = c?.key ?? '';
    }
  });
  return frame;
}

/**
 * A clicking beat, before its click lands: the cursor is on its way to the control and the caption
 * and chat line are already up; everything else (the stage, the screen, a dialog, Boo's reaction)
 * still shows the previous beat.
 */
export function preFrameAt(chapter: TourChapter, index: number, film: boolean): TourFrame {
  const before = frameAt(chapter, index - 1, film);
  const now = frameAt(chapter, index, film);
  const c = beatsOf(chapter, film)[index]?.console;
  return {
    ...before,
    caption: now.caption,
    chat: now.chat,
    boo: { ...before.boo, say: '' },
    point: c?.point !== undefined ? now.point : before.point,
    zoom: c?.point !== undefined && c.zoom !== undefined ? now.zoom : before.zoom,
    click: false,
    held: false,
    key: now.key,
  };
}

/** Whether a beat waits for its click (its changes land CLICK_AT ms in). */
export function clicks(beat: TourBeat | undefined): boolean {
  return Boolean(beat?.console?.click);
}

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

export type CaptionPart =
  | { kind: 'text'; text: string }
  | { kind: 'button'; text: string }
  | { kind: 'key'; text: string }
  | { kind: 'app'; text: string }
  | { kind: 'bold'; text: string };

const CAPTION_RE = /\[\[(.+?)\]\]|\{\{(.+?)\}\}|\*\*(.+?)\*\*|\*(.+?)\*/g;

/** Splits a caption into plain text, control names, keys, meeting-app names and bold text. */
export function parseCaption(caption: string): CaptionPart[] {
  const parts: CaptionPart[] = [];
  let last = 0;
  for (const m of caption.matchAll(CAPTION_RE)) {
    if (m.index > last) parts.push({ kind: 'text', text: caption.slice(last, m.index) });
    if (m[1] !== undefined) parts.push({ kind: 'button', text: m[1] });
    else if (m[2] !== undefined) parts.push({ kind: 'key', text: m[2] });
    else if (m[3] !== undefined) parts.push({ kind: 'bold', text: m[3] });
    else parts.push({ kind: 'app', text: m[4]! });
    last = m.index + m[0].length;
  }
  if (last < caption.length) parts.push({ kind: 'text', text: caption.slice(last) });
  return parts;
}

/** The caption as plain words (the live region, the chapter list). */
export function captionText(caption: string): string {
  return parseCaption(caption)
    .map((p) => p.text)
    .join('');
}
