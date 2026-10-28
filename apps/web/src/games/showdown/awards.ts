/**
 * The Awards desk (Production Desk, Awards A). The presenter fills in award categories during the
 * quiz — a name and, if they like, a photo for 1st, 2nd and 3rd — and after it plays a ceremony in
 * the stage window: the title, then each category's podium revealed 3rd → 2nd → 1st with the
 * drumroll and the applause, fireworks over the last winner, then Thanks for playing.
 *
 * Nothing here reaches the server: photos are shrunk in this browser (at most 640 px, re-encoded,
 * which drops their EXIF and location data) and kept with the names in this browser's IndexedDB, so
 * a console reload keeps them. Never the black box, the exports, the tests or a log. The room only
 * learns that the Awards scene is up (the `awards` card: phones and big screens say "Awards on
 * stage"), and the drumroll and applause cues.
 */
import { useSyncExternalStore } from 'react';
import type { ShowdownScoreRow } from '@dascade/shared/games/showdown';

export const AWARD_NAME_MAX = 40;
export const AWARD_TITLE_MAX = 40;
export const AWARD_CATEGORIES_MAX = 6;
/** Longest side of a stored photo (CSS shows it far smaller on the stage). */
export const AWARD_PHOTO_PX = 640;

/** 1st, 2nd, 3rd. */
export type AwardPlace = 1 | 2 | 3;

export interface AwardEntry {
  name: string;
  /** The photo's key in this browser's store ('' = none). */
  photo: string;
}

export interface AwardCategory {
  id: string;
  title: string;
  /** [1st, 2nd, 3rd]. */
  places: [AwardEntry, AwardEntry, AwardEntry];
  /** Filled from the finale's podium (Trivia Champions). */
  finale?: boolean;
}

export type AwardStep =
  { kind: 'title' } | { kind: 'category'; cat: number } | { kind: 'place'; cat: number; place: AwardPlace } | { kind: 'thanks' };

export interface AwardsView {
  categories: readonly AwardCategory[];
  /** Photo key → object URL in this page. */
  photos: Readonly<Record<string, string>>;
  /** The ceremony's step on the stage (index into awardSteps(); -1 = not started). */
  at: number;
  /** A drumroll is rolling: the next place comes up when it ends. */
  rolling: boolean;
  /** Loaded from this browser's store. */
  ready: boolean;
}

const empty = (): AwardEntry => ({ name: '', photo: '' });
let nextId = 1;
const newId = () => `cat-${Date.now().toString(36)}-${nextId++}`;

export function defaultCategories(): AwardCategory[] {
  return [
    { id: 'costume', title: 'Best Costume', places: [empty(), empty(), empty()] },
    { id: 'background', title: 'Best Background', places: [empty(), empty(), empty()] },
    { id: 'trivia', title: 'Trivia Champions', places: [empty(), empty(), empty()], finale: true },
  ];
}

/** A name as the stage shows it: trimmed, single-spaced, capped. */
export function cleanAwardText(text: string, max = AWARD_NAME_MAX): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

const named = (e: AwardEntry) => e.name.trim() !== '';

/**
 * The ceremony, step by step: the title; then each category that has a winner, its title and then
 * its places 3rd → 2nd → 1st (only the ones filled in); then Thanks for playing.
 */
export function awardSteps(categories: readonly AwardCategory[]): AwardStep[] {
  const steps: AwardStep[] = [{ kind: 'title' }];
  categories.forEach((c, cat) => {
    if (!c.places.some(named)) return;
    steps.push({ kind: 'category', cat });
    for (const place of [3, 2, 1] as const) if (named(c.places[place - 1])) steps.push({ kind: 'place', cat, place });
  });
  steps.push({ kind: 'thanks' });
  return steps;
}

/** The places of a category already revealed at step `at`. */
export function revealedPlaces(steps: readonly AwardStep[], at: number, cat: number): Set<AwardPlace> {
  const out = new Set<AwardPlace>();
  for (let i = 0; i <= at && i < steps.length; i++) {
    const s = steps[i]!;
    if (s.kind === 'place' && s.cat === cat) out.add(s.place);
  }
  return out;
}

/** The fireworks: from the last winner's reveal on. */
export function fireworksAt(steps: readonly AwardStep[], at: number): boolean {
  let last = -1;
  steps.forEach((s, i) => {
    if (s.kind === 'place') last = i;
  });
  return last >= 0 && at >= last;
}

/** The finale's podium as Trivia Champions' places (ties share the place: names joined). */
export function placesFromPodium(podium: readonly ShowdownScoreRow[]): [string, string, string] {
  const at = (rank: number) =>
    cleanAwardText(
      podium
        .filter((p) => p.rank === rank)
        .map((p) => p.name)
        .join(' & '),
    );
  return [at(1), at(2), at(3)];
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

let view: AwardsView = { categories: defaultCategories(), photos: {}, at: -1, rolling: false, ready: false };
const listeners = new Set<() => void>();

function set(patch: Partial<AwardsView>): void {
  view = { ...view, ...patch };
  for (const l of [...listeners]) l();
}

export function awardsView(): AwardsView {
  return view;
}

export function useAwards(): AwardsView {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      void load();
      return () => listeners.delete(fn);
    },
    () => view,
    () => view,
  );
}

function setCategories(categories: AwardCategory[]): void {
  set({ categories });
  void save();
}

function patchCategory(id: string, fn: (c: AwardCategory) => AwardCategory): void {
  setCategories(view.categories.map((c) => (c.id === id ? fn(c) : c)));
}

export function renameCategory(id: string, title: string): void {
  patchCategory(id, (c) => ({ ...c, title: title.slice(0, AWARD_TITLE_MAX) }));
}

export function setAwardName(id: string, place: AwardPlace, name: string): void {
  patchCategory(id, (c) => {
    const places = [...c.places] as AwardCategory['places'];
    places[place - 1] = { ...places[place - 1], name: name.slice(0, AWARD_NAME_MAX) };
    return { ...c, places };
  });
}

export function addCategory(): void {
  if (view.categories.length >= AWARD_CATEGORIES_MAX) return;
  setCategories([...view.categories, { id: newId(), title: 'New award', places: [empty(), empty(), empty()] }]);
}

export function removeCategory(id: string): void {
  const cat = view.categories.find((c) => c.id === id);
  setCategories(view.categories.filter((c) => c.id !== id));
  for (const p of cat?.places ?? []) if (p.photo) void dropPhoto(p.photo);
}

/** Fills a category's names from the finale's podium (the photos stay). */
export function fillFromPodium(id: string, podium: readonly ShowdownScoreRow[]): void {
  const names = placesFromPodium(podium);
  patchCategory(id, (c) => ({ ...c, places: c.places.map((p, i) => ({ ...p, name: names[i] ?? '' })) as AwardCategory['places'] }));
}

/** Sets a place's photo from an image (pasted, dropped or picked): shrunk and re-encoded here first. */
export async function setAwardPhoto(id: string, place: AwardPlace, image: Blob): Promise<void> {
  const small = await shrinkPhoto(image);
  const key = `photo-${Date.now().toString(36)}-${nextId++}`;
  await idbPut(key, small);
  const url = URL.createObjectURL(small);
  set({ photos: { ...view.photos, [key]: url } });
  let old = '';
  patchCategory(id, (c) => {
    const places = [...c.places] as AwardCategory['places'];
    old = places[place - 1].photo;
    places[place - 1] = { ...places[place - 1], photo: key };
    return { ...c, places };
  });
  if (old) void dropPhoto(old);
}

export function clearAwardPhoto(id: string, place: AwardPlace): void {
  let old = '';
  patchCategory(id, (c) => {
    const places = [...c.places] as AwardCategory['places'];
    old = places[place - 1].photo;
    places[place - 1] = { ...places[place - 1], photo: '' };
    return { ...c, places };
  });
  if (old) void dropPhoto(old);
}

/** Everything back to the three empty categories (the photos are deleted from this browser). */
export function resetAwards(): void {
  for (const c of view.categories) for (const p of c.places) if (p.photo) void dropPhoto(p.photo);
  set({ at: -1, rolling: false });
  setCategories(defaultCategories());
}

async function dropPhoto(key: string): Promise<void> {
  const url = view.photos[key];
  if (url) {
    URL.revokeObjectURL(url);
    const photos = { ...view.photos };
    delete photos[key];
    set({ photos });
  }
  await idbDelete(key).catch(() => undefined);
}

// ---- The ceremony (the console drives it; the stage reads `at`) ----

export function setAwardsStep(at: number): void {
  set({ at, rolling: false });
  try {
    sessionStorage.setItem(STEP_KEY, String(at));
  } catch {
    /* storage unavailable */
  }
}

export function setAwardsRolling(rolling: boolean): void {
  set({ rolling });
}

// ---------------------------------------------------------------------------
// Photos: shrunk and re-encoded in this browser
// ---------------------------------------------------------------------------

/**
 * Shrinks an image to at most AWARD_PHOTO_PX on its longest side and re-encodes it as JPEG: the pixels
 * only, so EXIF (camera, time, location) never comes along. Rejects what isn't an image.
 */
export async function shrinkPhoto(image: Blob): Promise<Blob> {
  if (!image.type.startsWith('image/')) throw new Error('Not an image');
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, AWARD_PHOTO_PX / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('No canvas');
    g.drawImage(bitmap, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No JPEG'))), 'image/jpeg', 0.86),
    );
  } finally {
    bitmap.close();
  }
}

// ---------------------------------------------------------------------------
// This browser's store (IndexedDB): the categories and the photos
// ---------------------------------------------------------------------------

const DB_NAME = 'dascade-showdown-awards';
const STORE = 'kv';
const LIST_KEY = 'categories';
const STEP_KEY = 'dascade:showdown:awards-step';

let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('No IndexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = run(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

const idbGet = <T>(key: string) => tx<T | undefined>('readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
const idbPut = (key: string, value: unknown) => tx('readwrite', (s) => s.put(value, key));
const idbDelete = (key: string) => tx('readwrite', (s) => s.delete(key));

let loading: Promise<void> | null = null;

/** Loads this browser's awards once (the categories, then their photos as object URLs). */
function load(): Promise<void> {
  loading ??= (async () => {
    try {
      const saved = await idbGet<AwardCategory[]>(LIST_KEY);
      const categories = Array.isArray(saved) && saved.length ? saved.slice(0, AWARD_CATEGORIES_MAX).map(sanitize) : view.categories;
      const photos: Record<string, string> = {};
      for (const c of categories)
        for (const p of c.places) {
          if (!p.photo) continue;
          const blob = await idbGet<Blob>(p.photo).catch(() => undefined);
          if (blob instanceof Blob) photos[p.photo] = URL.createObjectURL(blob);
        }
      let at = -1;
      try {
        at = Number(sessionStorage.getItem(STEP_KEY) ?? -1);
      } catch {
        /* storage unavailable */
      }
      set({ categories, photos, at: Number.isInteger(at) ? at : -1, ready: true });
    } catch {
      set({ ready: true });
    }
  })();
  return loading;
}

function sanitize(c: AwardCategory): AwardCategory {
  const entry = (e: AwardEntry | undefined): AwardEntry => ({
    name: typeof e?.name === 'string' ? e.name.slice(0, AWARD_NAME_MAX) : '',
    photo: typeof e?.photo === 'string' ? e.photo : '',
  });
  return {
    id: typeof c.id === 'string' ? c.id : newId(),
    title: typeof c.title === 'string' ? c.title.slice(0, AWARD_TITLE_MAX) : 'Award',
    places: [entry(c.places?.[0]), entry(c.places?.[1]), entry(c.places?.[2])],
    ...(c.finale ? { finale: true } : {}),
  };
}

async function save(): Promise<void> {
  await idbPut(LIST_KEY, view.categories).catch(() => undefined);
}
