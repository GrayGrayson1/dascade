/** Pure helpers for the jukebox UI (unit-tested in format.test.ts). */
import type { JukeboxTrack } from '@dascade/shared';

/** 0 → "0:00", 83.4 → "1:23", 3725 → "1:02:05". Non-finite / negative → "0:00". */
export function formatTime(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Screen-reader friendly duration: "1 minute 23 seconds". */
export function spokenTime(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const m = Math.floor(s / 60);
  const r = s % 60;
  const parts: string[] = [];
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (r || !m) parts.push(`${r} second${r === 1 ? '' : 's'}`);
  return parts.join(' ');
}

export type LibrarySort = 'order' | 'title' | 'duration';

const collator = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { sensitivity: 'base', numeric: true }) : null;
const cmp = (a: string, b: string) => (collator ? collator.compare(a, b) : a.localeCompare(b));

/** Case/diacritic-insensitive match on title, artist, album and file name. */
export function matchesQuery(track: JukeboxTrack, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const hay = normalize([track.title, track.artist ?? '', track.album ?? '', track.file].join(' '));
  return q.split(/\s+/).every((word) => hay.includes(word));
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** Filtered + sorted copy (stable: ties fall back to manifest order). */
export function sortTracks(tracks: readonly JukeboxTrack[], sort: LibrarySort, query = ''): JukeboxTrack[] {
  const list = tracks.filter((t) => matchesQuery(t, query));
  const byOrder = (a: JukeboxTrack, b: JukeboxTrack) => a.order - b.order || cmp(a.title, b.title);
  if (sort === 'title') return list.sort((a, b) => cmp(a.title, b.title) || byOrder(a, b));
  if (sort === 'duration') return list.sort((a, b) => a.duration - b.duration || byOrder(a, b));
  return list.sort(byOrder);
}

/** Deterministic 32-bit FNV-1a hash (generated cover art, stable per track id). */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * 8×8 mirrored pixel "sigil" for a track without artwork: returns the lit cells (x, y, tone 0|1|2).
 * Left half is random from the hash, mirrored to the right — reads as an emblem, never as noise.
 */
export function coverCells(id: string): Array<{ x: number; y: number; tone: 0 | 1 | 2 }> {
  let h = hash32(id);
  const next = () => {
    // xorshift32 seeded from the hash (deterministic, no Math.random)
    h ^= h << 13;
    h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    return h;
  };
  const cells: Array<{ x: number; y: number; tone: 0 | 1 | 2 }> = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 4; x++) {
      const r = next() % 100;
      if (r < 46) {
        const tone = (r % 3) as 0 | 1 | 2;
        cells.push({ x, y, tone }, { x: 7 - x, y, tone });
      }
    }
  }
  return cells;
}

/** "2 of 3 votes" style threshold text. */
export function voteText(votes: number, needed: number): string {
  const v = Math.max(0, Math.floor(votes));
  const n = Math.max(1, Math.floor(needed));
  return `${Math.min(v, n)} of ${n} vote${n === 1 ? '' : 's'} to skip`;
}
