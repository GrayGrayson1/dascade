/**
 * Jukebox persistence: `localStorage['dascade:v1:jukebox']`. Fail-safe both ways — a corrupt,
 * foreign or hostile value restores defaults; a throwing/disabled storage is ignored.
 */
import { TRACK_ID_RE } from '@dascade/shared/jukebox';
import type { RepeatMode } from './store.ts';

export const JUKEBOX_STORAGE_KEY = 'dascade:v1:jukebox';

export interface PersistedJukebox {
  currentId: string | null;
  position: number;
  wantPlaying: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  queue: string[];
  jukeboxMuted: boolean;
  roomOptOut: boolean;
  /** Room id the opt-out was made in: opting out is a per-room choice (it survives reconnects/reloads, not new rooms). */
  optOutRoom: string | null;
}

export const DEFAULT_PERSISTED: PersistedJukebox = {
  currentId: null,
  position: 0,
  wantPlaying: false,
  shuffle: false,
  repeat: 'all',
  queue: [],
  jukeboxMuted: false,
  roomOptOut: false,
  optOutRoom: null,
};

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const MAX_QUEUE = 200;
const isId = (v: unknown): v is string => typeof v === 'string' && TRACK_ID_RE.test(v);

/** Sanitizes anything into a PersistedJukebox (unknown/invalid fields → defaults). */
export function sanitizePersisted(raw: unknown): PersistedJukebox {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  return {
    currentId: isId(o.currentId) ? o.currentId : null,
    position: typeof o.position === 'number' && Number.isFinite(o.position) && o.position >= 0 ? Math.min(o.position, 24 * 3600) : 0,
    wantPlaying: bool(o.wantPlaying, DEFAULT_PERSISTED.wantPlaying),
    shuffle: bool(o.shuffle, DEFAULT_PERSISTED.shuffle),
    repeat: o.repeat === 'off' || o.repeat === 'all' || o.repeat === 'one' ? o.repeat : DEFAULT_PERSISTED.repeat,
    queue: Array.isArray(o.queue) ? o.queue.filter(isId).slice(0, MAX_QUEUE) : [],
    jukeboxMuted: bool(o.jukeboxMuted, DEFAULT_PERSISTED.jukeboxMuted),
    roomOptOut: bool(o.roomOptOut, DEFAULT_PERSISTED.roomOptOut),
    optOutRoom: typeof o.optOutRoom === 'string' && o.optOutRoom.length <= 64 ? o.optOutRoom : null,
  };
}

export function loadPersisted(storage: StorageLike | null): PersistedJukebox {
  try {
    const raw = storage?.getItem(JUKEBOX_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PERSISTED, queue: [] };
    return sanitizePersisted(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PERSISTED, queue: [] };
  }
}

export function savePersisted(storage: StorageLike | null, value: PersistedJukebox): void {
  try {
    storage?.setItem(JUKEBOX_STORAGE_KEY, JSON.stringify({ ...value, position: Math.round(value.position * 10) / 10 }));
  } catch {
    /* quota / disabled storage: persistence is a convenience, never a failure */
  }
}
