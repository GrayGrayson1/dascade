/**
 * Room DJ follow policy (pure, unit-tested): given the room's DJ state and the local element,
 * decide what the local player should do. Gentle by design — a seek only when drift exceeds
 * DJ_RESYNC_THRESHOLD (and never more often than DJ_SEEK_COOLDOWN_MS unless wildly off);
 * small drift is absorbed with a tiny playbackRate nudge.
 */
import { djPositionAt, type DjState } from '@dascade/shared/jukebox';

export const DJ_RESYNC_THRESHOLD = 0.75;
/** Below this drift nothing happens (rate 1). */
export const DJ_NUDGE_MIN = 0.12;
/** playbackRate offset used to absorb small drift (±4 % is inaudible for music). */
export const DJ_NUDGE_RATE = 0.04;
export const DJ_SEEK_COOLDOWN_MS = 3000;
/** Drift this large overrides the seek cooldown (e.g. the host seeked). */
export const DJ_HARD_DRIFT = 4;

export interface DjLocal {
  trackId: string | null;
  position: number;
  /** ms timestamp of our last resync seek (−Infinity when none). */
  lastSeekAt: number;
  /** ms, same clock as lastSeekAt. */
  now: number;
  /** playbackRate nudging is available. */
  canNudge: boolean;
}

export type DjSyncAction =
  | { kind: 'idle' }
  | { kind: 'missing'; trackId: string }
  | { kind: 'load'; trackId: string; position: number; play: boolean }
  | { kind: 'sync'; seekTo: number | null; rate: number; play: boolean };

export function planDjSync(state: DjState, serverNow: number, local: DjLocal, hasTrack: (id: string) => boolean): DjSyncAction {
  const cur = state.current;
  if (!cur) return { kind: 'idle' };
  if (!hasTrack(cur.trackId)) return { kind: 'missing', trackId: cur.trackId };
  const target = djPositionAt(state, serverNow);
  if (local.trackId !== cur.trackId) return { kind: 'load', trackId: cur.trackId, position: target, play: state.playing };
  const drift = local.position - target;
  const abs = Math.abs(drift);
  if (!state.playing) {
    return { kind: 'sync', seekTo: abs > DJ_RESYNC_THRESHOLD ? target : null, rate: 1, play: false };
  }
  if (abs > DJ_RESYNC_THRESHOLD) {
    const cooled = local.now - local.lastSeekAt >= DJ_SEEK_COOLDOWN_MS;
    if (cooled || abs > DJ_HARD_DRIFT) return { kind: 'sync', seekTo: target, rate: 1, play: true };
  }
  if (abs > DJ_NUDGE_MIN && local.canNudge) {
    // Ahead → slow down a touch; behind → speed up a touch.
    return { kind: 'sync', seekTo: null, rate: drift > 0 ? 1 - DJ_NUDGE_RATE : 1 + DJ_NUDGE_RATE, play: true };
  }
  return { kind: 'sync', seekTo: null, rate: 1, play: true };
}

/** Defensive shape check for a server `dj:state` payload (never trust the wire blindly). */
export function isDjState(v: unknown): v is DjState {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  if (typeof s.enabled !== 'boolean' || typeof s.playing !== 'boolean' || !num(s.version) || !num(s.position) || !num(s.anchorServerTime)) return false;
  if (!Array.isArray(s.queue)) return false;
  if (s.current !== null) {
    const c = s.current as Record<string, unknown> | undefined;
    if (!c || typeof c.trackId !== 'string' || !num(c.duration)) return false;
  }
  return true;
}
