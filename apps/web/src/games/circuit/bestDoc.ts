import type { CircuitBestDoc, CircuitTrackId } from '@dascade/shared/games/circuit';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * Validates a stored personal best (localStorage / Supabase doc) for `trackId`. Anything malformed —
 * edited storage, a doc from an older build, another track's record — reads as "no personal best"
 * instead of breaking live split deltas mid-race.
 */
export function parseBestDoc(raw: unknown, trackId: CircuitTrackId): CircuitBestDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<Record<keyof CircuitBestDoc, unknown>>;
  if (d.trackId !== trackId || !finite(d.lapMs) || d.lapMs === 0) return null;
  const splits = Array.isArray(d.splits) ? d.splits.map((s) => (finite(s) ? s : 0)) : [];
  const doc: CircuitBestDoc = { trackId, lapMs: d.lapMs, splits, savedAt: finite(d.savedAt) ? d.savedAt : 0 };
  if (finite(d.raceMs) && d.raceMs > 0) doc.raceMs = d.raceMs;
  if (finite(d.laps)) doc.laps = d.laps;
  return doc;
}
