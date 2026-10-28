/**
 * Cinema (Production Desk: Video A + Scenes A). The presenter loads their own video files in the
 * console, and the chosen one plays in a themed frame inside the stage window: the window Teams is
 * already sharing, so a cartoon break needs no re-share (the one moment the console could end up on
 * the share). Every other screen (phones, big-screen links) shows the "Cartoon break" card instead.
 *
 * Nothing leaves this browser: a file becomes an object URL (nothing uploads), and no clip, file name
 * or frame choice ever goes to the server, the black box, an export or a log. Only the frame choice is
 * remembered on this device.
 *
 * The scene is plain DOM in the stage window — a layer over the stage, like the hold card — not part
 * of the React stage: it keeps playing when the console loses its room for a moment (the portal
 * unmounts then, and holdStageWindow leaves a playing video uncovered), and the frame never
 * re-renders while the video plays, so Teams spends its bandwidth on the picture. The console drives
 * it through this store; the stage window only shows it.
 *
 * Sound (one audio pipeline): the video joins the mixer (mixer.routeMedia → the master bus), so the
 * device's master volume and mute win; where the browser refuses, element.volume follows the master
 * level instead. The show pauses the jukebox while Cinema is up (showAudio.ts).
 */
import { useSyncExternalStore } from 'react';
import { useApp } from '../../app/store.ts';
import { mixer } from '../../audio/mixer.ts';
import { mediaFallbackVolume } from '../../audio/mixPolicy.ts';
import { SHOW_FONTS } from './display.ts';
import { LOOK_COPY } from './look.ts';
import { onStageWindowChange, stageWindowState } from './stageWindow.ts';

export type CinemaFrame = 'tv' | 'cinema' | 'portrait';

export const CINEMA_FRAMES: ReadonlyArray<{ id: CinemaFrame; title: string; blurb: string }> = [
  { id: 'tv', title: 'Retro TV', blurb: 'A wooden 1950s set: suits an old 4:3 cartoon.' },
  { id: 'cinema', title: 'Haunted cinema', blurb: 'Red curtains and a marquee of bulbs.' },
  { id: 'portrait', title: 'Gilded portrait', blurb: 'A haunted-mansion picture frame with a brass plaque.' },
];

/** Enough for one clip per break, and a spare or two. */
export const CINEMA_MAX_CLIPS = 6;

export interface CinemaClip {
  id: string;
  /** The file's name (shown in the console only). */
  name: string;
  url: string;
}

export interface CinemaView {
  clips: readonly CinemaClip[];
  /** The clip that plays ('' = none loaded). */
  clipId: string;
  frame: CinemaFrame;
  /** The Cinema scene is on the stage. */
  onStage: boolean;
  /** A stage window is open to play in. */
  window: boolean;
  playing: boolean;
  ended: boolean;
  /** Seconds. */
  time: number;
  duration: number;
  /** The browser wouldn't start it with sound: the stage window needs one click first. */
  blocked: boolean;
  /** This file can't be played here. */
  failed: boolean;
}

const FRAME_KEY = 'dascade:showdown:cinema-frame';

function readFrame(): CinemaFrame {
  try {
    const v = localStorage.getItem(FRAME_KEY);
    return CINEMA_FRAMES.some((f) => f.id === v) ? (v as CinemaFrame) : 'tv';
  } catch {
    return 'tv';
  }
}

let view: CinemaView = {
  clips: [],
  clipId: '',
  frame: readFrame(),
  onStage: false,
  window: false,
  playing: false,
  ended: false,
  time: 0,
  duration: 0,
  blocked: false,
  failed: false,
};
const listeners = new Set<() => void>();
let nextId = 1;

function set(patch: Partial<CinemaView>): void {
  view = { ...view, ...patch };
  for (const l of [...listeners]) l();
}

export function cinemaView(): CinemaView {
  return view;
}

export function useCinema(): CinemaView {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => view,
    () => view,
  );
}

const clipOf = (id: string) => view.clips.find((c) => c.id === id) ?? null;

/** A video file this browser might play (the type, or the name when the type is missing). */
export function isVideoFile(file: { type: string; name: string }): boolean {
  return file.type.startsWith('video/') || (!file.type && /\.(mp4|m4v|webm|mov|ogv)$/i.test(file.name));
}

/** Adds the chosen files (videos only, up to CINEMA_MAX_CLIPS in all). Returns how many were added. */
export function addClips(files: Iterable<File>): number {
  const room = CINEMA_MAX_CLIPS - view.clips.length;
  const added: CinemaClip[] = [];
  for (const file of files) {
    if (added.length >= room) break;
    if (!isVideoFile(file)) continue;
    added.push({ id: `clip-${nextId++}`, name: file.name.slice(0, 120), url: URL.createObjectURL(file) });
  }
  if (!added.length) return 0;
  const clips = [...view.clips, ...added];
  set({ clips });
  if (!view.clipId) selectClip(added[0]!.id);
  return added.length;
}

export function removeClip(id: string): void {
  const clip = clipOf(id);
  if (!clip) return;
  const clips = view.clips.filter((c) => c.id !== id);
  set({ clips });
  if (view.clipId === id) selectClip(clips[0]?.id ?? '');
  URL.revokeObjectURL(clip.url);
}

/** Chooses the clip that plays next (loaded, stopped at its start). */
export function selectClip(id: string): void {
  set({ clipId: clipOf(id) ? id : '', playing: false, ended: false, time: 0, duration: 0, failed: false });
  const l = layer;
  if (!l) return;
  load(l);
  sync(l);
}

export function setFrame(frame: CinemaFrame): void {
  set({ frame });
  try {
    localStorage.setItem(FRAME_KEY, frame);
  } catch {
    /* storage unavailable: the choice lasts for this page */
  }
  if (layer) layer.root.dataset.frame = frame;
}

// ---------------------------------------------------------------------------
// The layer in the stage window
// ---------------------------------------------------------------------------

interface Layer {
  doc: Document;
  root: HTMLElement;
  video: HTMLVideoElement;
  marquee: HTMLElement;
  plaque: HTMLElement;
}

let layer: Layer | null = null;
let look = 'halloween';

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, parent: Element): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  parent.appendChild(node);
  return node;
}

/** The scene's DOM: a still frame (it never re-renders while the video plays) around the video. */
function build(doc: Document): Layer {
  const root = doc.createElement('div');
  root.className = 'sd-cinema';
  root.hidden = true;
  root.dataset.part = 'showdown-cinema';
  root.dataset.frame = view.frame;
  root.dataset.look = look;
  root.setAttribute('role', 'img');
  for (const [name, value] of Object.entries(SHOW_FONTS)) root.style.setProperty(name, value);
  const curtain = el(doc, 'div', 'sd-cinema__curtain', root);
  curtain.setAttribute('aria-hidden', 'true');
  el(doc, 'i', '', curtain);
  el(doc, 'i', '', curtain);
  const marquee = el(doc, 'p', 'sd-cinema__marquee', root);
  const frame = el(doc, 'div', 'sd-cinema__set', root);
  el(doc, 'span', 'sd-cinema__drape sd-cinema__drape--l', frame);
  el(doc, 'span', 'sd-cinema__drape sd-cinema__drape--r', frame);
  const glass = el(doc, 'div', 'sd-cinema__glass', frame);
  const video = el(doc, 'video', 'sd-cinema__video', glass);
  video.playsInline = true;
  video.preload = 'auto';
  video.disablePictureInPicture = true;
  const side = el(doc, 'div', 'sd-cinema__side', frame);
  side.setAttribute('aria-hidden', 'true');
  el(doc, 'i', 'sd-cinema__knob', side);
  el(doc, 'i', 'sd-cinema__knob', side);
  el(doc, 'i', 'sd-cinema__grille', side);
  const plaque = el(doc, 'p', 'sd-cinema__plaque', frame);
  wire(video, root);
  doc.body.appendChild(root);
  return { doc, root, video, marquee, plaque };
}

function wire(video: HTMLVideoElement, root: HTMLElement): void {
  const mine = () => layer?.video === video;
  const playing = (on: boolean) => {
    root.dataset.playing = String(on);
    if (mine()) set({ playing: on });
  };
  video.addEventListener('play', () => {
    playing(true);
    if (mine()) set({ ended: false, blocked: false });
  });
  video.addEventListener('pause', () => playing(false));
  video.addEventListener('ended', () => {
    playing(false);
    if (mine()) set({ ended: true });
  });
  video.addEventListener('timeupdate', () => {
    if (mine()) set({ time: video.currentTime });
  });
  const duration = () => {
    if (mine() && Number.isFinite(video.duration)) set({ duration: video.duration });
  };
  video.addEventListener('loadedmetadata', duration);
  video.addEventListener('durationchange', duration);
  video.addEventListener('error', () => {
    if (mine() && video.getAttribute('src')) set({ failed: true, playing: false });
  });
}

/** Puts the chosen clip in the video (stopped at its start). */
function load(l: Layer): void {
  const clip = clipOf(view.clipId);
  l.video.pause();
  if (!clip) {
    l.video.removeAttribute('src');
    l.video.load();
    return;
  }
  if (l.video.getAttribute('src') !== clip.url) {
    l.video.src = clip.url;
    l.video.load();
  } else l.video.currentTime = 0;
}

/** The layer in the stage window's current page (built there on first use, rebuilt after a reload). */
function ensureLayer(): Layer | null {
  const doc = stageWindowState().container?.ownerDocument ?? null;
  if (!doc) return null;
  if (layer && layer.doc === doc && layer.root.isConnected) return layer;
  layer = build(doc);
  load(layer);
  applyVolume(layer.video);
  sync(layer);
  return layer;
}

function applyVolume(video: HTMLVideoElement): void {
  if (mixer.isRouted(video)) {
    video.volume = 1;
    video.muted = false;
    return;
  }
  const s = useApp.getState().settings;
  const v = mediaFallbackVolume({ muted: s.muted, masterVolume: s.masterVolume });
  video.volume = v;
  video.muted = v === 0;
}

/**
 * The layer is up while the scene is and a clip is loaded. Without one (a console reloaded mid-scene)
 * the stage shows the cartoon-break card under it instead of an empty frame.
 */
function sync(l: Layer): void {
  if (view.onStage && clipOf(view.clipId)) show(l);
  else {
    l.video.pause();
    l.root.hidden = true;
  }
}

/** Up, with the curtain opening on it (CSS keeps it still with reduced motion or effects off). */
function show(l: Layer): void {
  const copy = (look === 'showtime' ? LOOK_COPY.showtime : LOOK_COPY.halloween).showcase;
  l.root.dataset.look = look;
  l.marquee.textContent = `Now showing · ${copy.cinemaTitle}`;
  l.plaque.textContent = copy.cinemaKicker;
  l.root.setAttribute('aria-label', `Now showing: ${copy.cinemaTitle}`);
  if (!l.root.hidden) return;
  l.root.hidden = false;
  l.root.removeAttribute('data-wipe');
  void l.root.offsetWidth;
  l.root.dataset.wipe = 'open';
}

/**
 * The Cinema scene goes up or comes down (the presenter's stage window follows the room's card).
 * Coming down pauses the video where it is.
 */
export function cinemaScene(on: boolean, showLook: string): void {
  look = showLook;
  if (on !== view.onStage) set({ onStage: on });
  const l = on ? ensureLayer() : layer;
  if (l) sync(l);
}

/**
 * Play (call it inside the click: it also starts the audio graph). From the start once it has ended.
 * A browser that won't start sound in a window nobody has clicked yet says so (`blocked`): the next
 * click anywhere in the stage window starts it.
 */
export async function cinemaPlay(): Promise<void> {
  const l = ensureLayer();
  if (!l || !clipOf(view.clipId)) return;
  const route = () => {
    mixer.routeMedia(l.video);
    applyVolume(l.video);
  };
  mixer.ensureContext();
  const resumed = mixer.resume().catch(() => false);
  route();
  void resumed.then(route);
  if (l.video.ended || view.ended) l.video.currentTime = 0;
  try {
    await l.video.play();
    set({ blocked: false, failed: false });
  } catch (err) {
    const name = (err as DOMException | null)?.name;
    if (name === 'NotAllowedError') {
      set({ blocked: true });
      l.doc.addEventListener('pointerdown', () => void (view.blocked && view.onStage ? cinemaPlay() : undefined), { once: true });
    } else if (name !== 'AbortError') set({ failed: true });
  }
}

export function cinemaPause(): void {
  layer?.video.pause();
}

/** Back to the clip's first frame (stopped). */
export function cinemaRestart(): void {
  const l = layer;
  if (!l) return;
  l.video.pause();
  l.video.currentTime = 0;
  set({ time: 0, ended: false });
}

// The stage window comes and goes: the layer lives in its page, so it goes with it.
onStageWindowChange(() => {
  const open = Boolean(stageWindowState().container);
  if (open !== view.window) set({ window: open });
  if (!open && layer) {
    layer.video.pause();
    layer = null;
    set({ playing: false });
  } else if (open && view.onStage) ensureLayer();
});

// Without the audio graph the video's own volume follows the master volume and mute.
useApp.subscribe((s, prev) => {
  if (layer && (s.settings.muted !== prev.settings.muted || s.settings.masterVolume !== prev.settings.masterVolume))
    applyVolume(layer.video);
});

/** "1:04" for the console (minutes:seconds). */
export function clipTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
