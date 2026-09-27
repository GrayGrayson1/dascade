/**
 * Local documents for DASphalt GP (saved through `persistence()`, so they work with or without
 * Supabase): the lobby look, time-trial personal bests and the personal-best ghost. Everything
 * read back from storage is validated — edited storage or an old build's doc reads as "none".
 */
import {
  KART_GHOST_MAX_BYTES,
  KART_LOOK_DOC,
  KART_TRACK_IDS,
  KartLookSchema,
  kartBestKey,
  kartGhostKey,
  type KartLook,
  type KartTrackId,
} from '@dascade/shared/games/kart';
import { persistence } from '../../persistence/index.ts';

export async function loadLook(): Promise<KartLook | null> {
  try {
    const raw = await persistence().loadDoc<unknown>(KART_LOOK_DOC);
    const parsed = KartLookSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveLook(look: KartLook): void {
  void persistence()
    .saveDoc(KART_LOOK_DOC, look)
    .catch(() => undefined);
}

/** Time-trial personal best for one track (per lap count: a 3-lap time isn't comparable to 1 lap). */
export interface KartBestDoc {
  v: 1;
  trackId: KartTrackId;
  /** Best race time by lap count ("1".."5" → ms). */
  race: Record<string, number>;
  /** Best single lap (any race length). */
  lapMs: number;
  savedAt: number;
}

const finitePos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 3_600_000;

export function parseBest(raw: unknown, trackId: KartTrackId): KartBestDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (d.v !== 1 || d.trackId !== trackId) return null;
  const race: Record<string, number> = {};
  if (d.race && typeof d.race === 'object') {
    for (const [k, v] of Object.entries(d.race as Record<string, unknown>)) if (/^[1-5]$/.test(k) && finitePos(v)) race[k] = v;
  }
  const lapMs = finitePos(d.lapMs) ? d.lapMs : 0;
  if (!lapMs && !Object.keys(race).length) return null;
  return { v: 1, trackId, race, lapMs, savedAt: typeof d.savedAt === 'number' && Number.isFinite(d.savedAt) ? d.savedAt : 0 };
}

export async function loadBest(trackId: KartTrackId): Promise<KartBestDoc | null> {
  try {
    return parseBest(await persistence().loadDoc<unknown>(kartBestKey(trackId)), trackId);
  } catch {
    return null;
  }
}

/**
 * Merge a finished time trial into the stored best. Returns what improved (for the results badge).
 */
export function mergeBest(
  prev: KartBestDoc | null,
  trackId: KartTrackId,
  laps: number,
  raceMs: number,
  bestLapMs: number,
  now = Date.now(),
): { doc: KartBestDoc; racePb: boolean; lapPb: boolean } {
  const doc: KartBestDoc = prev ? { ...prev, race: { ...prev.race } } : { v: 1, trackId, race: {}, lapMs: 0, savedAt: now };
  const key = String(laps);
  const racePb = finitePos(raceMs) && (!doc.race[key] || raceMs < doc.race[key]!);
  const lapPb = finitePos(bestLapMs) && (!doc.lapMs || bestLapMs < doc.lapMs);
  if (racePb) doc.race[key] = raceMs;
  if (lapPb) doc.lapMs = bestLapMs;
  if (racePb || lapPb) doc.savedAt = now;
  return { doc, racePb, lapPb };
}

export function saveBest(doc: KartBestDoc): Promise<void> {
  return persistence()
    .saveDoc(kartBestKey(doc.trackId), doc)
    .catch(() => undefined);
}

/**
 * The stored ghost: the core's bounded, quantized trace (`data`) plus who drove it.
 * `data` is opaque here; the core's decoder validates it again before use.
 */
export interface KartGhostDoc {
  v: 1;
  trackId: KartTrackId;
  laps: number;
  raceMs: number;
  racer: string;
  body: string;
  paint: string;
  data: string;
}

export function parseGhostDoc(raw: unknown, trackId: KartTrackId): KartGhostDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (d.v !== 1 || d.trackId !== trackId || typeof d.data !== 'string') return null;
  if (!finitePos(d.raceMs) || typeof d.laps !== 'number' || !Number.isInteger(d.laps) || d.laps < 1 || d.laps > 5) return null;
  if (d.data.length === 0 || d.data.length > KART_GHOST_MAX_BYTES) return null;
  if (typeof d.racer !== 'string' || typeof d.body !== 'string' || typeof d.paint !== 'string') return null;
  const look = KartLookSchema.safeParse({ racer: d.racer, body: d.body, paint: d.paint });
  if (!look.success) return null;
  const doc: KartGhostDoc = { v: 1, trackId, laps: d.laps, raceMs: d.raceMs, racer: d.racer, body: d.body, paint: d.paint, data: d.data };
  return ghostDocBytes(doc) <= KART_GHOST_MAX_BYTES ? doc : null;
}

export function ghostDocBytes(doc: KartGhostDoc): number {
  return new TextEncoder().encode(JSON.stringify(doc)).length;
}

export async function loadGhost(trackId: KartTrackId): Promise<KartGhostDoc | null> {
  try {
    return parseGhostDoc(await persistence().loadDoc<unknown>(kartGhostKey(trackId)), trackId);
  } catch {
    return null;
  }
}

/** Saves only if the doc fits the size cap (never write something we'd refuse to read). */
export async function saveGhost(doc: KartGhostDoc): Promise<boolean> {
  if (ghostDocBytes(doc) > KART_GHOST_MAX_BYTES) return false;
  try {
    await persistence().saveDoc(kartGhostKey(doc.trackId), doc);
    return true;
  } catch {
    return false;
  }
}

export function isTrackId(v: unknown): v is KartTrackId {
  return typeof v === 'string' && (KART_TRACK_IDS as readonly string[]).includes(v);
}
