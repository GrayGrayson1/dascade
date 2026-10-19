/**
 * Records — pure helpers (unit-tested in records.test.ts). A record is an album the listener puts on: the
 * shelf, the title-strip rack, shuffle, Next, Previous and auto-advance all play the record in effect. Each
 * device picks its own (persisted); without a pick, the record paired with the active theme plays, else
 * the main record. "All records" (ALL_RECORDS) is the listener's mix of everything. Nothing about records
 * reaches the server: Room DJ deals only in track ids, so a room can play a song from any record.
 */
import { ALL_RECORDS, MAIN_RECORD_ID, type JukeboxRecord, type JukeboxTrack } from '@dascade/shared/jukebox';

export { ALL_RECORDS, MAIN_RECORD_ID };

/** The record a track is on (manifests from before records: the main record). */
export function trackRecord(t: Pick<JukeboxTrack, 'record'>): string {
  return t.record ?? MAIN_RECORD_ID;
}

/**
 * The shelf: the manifest's records that have tracks, in shelf order, plus a stand-in for any record a
 * track names that the manifest doesn't list (a manifest from before records → one main record), so no
 * song is ever unreachable.
 */
export function recordsOf(tracks: readonly JukeboxTrack[], records: readonly JukeboxRecord[] | undefined): JukeboxRecord[] {
  const stats = new Map<string, { tracks: number; duration: number }>();
  for (const t of tracks) {
    const id = trackRecord(t);
    const s = stats.get(id) ?? { tracks: 0, duration: 0 };
    s.tracks++;
    s.duration += t.duration;
    stats.set(id, s);
  }
  const list = (records ?? []).filter((r) => stats.has(r.id)).sort((a, b) => a.order - b.order);
  for (const [id, s] of stats) {
    if (list.some((r) => r.id === id)) continue;
    const album = tracks.find((t) => trackRecord(t) === id && t.album)?.album;
    list.push({ id, title: album ?? (id === MAIN_RECORD_ID ? 'DASCADE Jukebox' : id), order: list.length, ...s });
  }
  return list.map((r) => ({ ...r, ...stats.get(r.id)! }));
}

/** The record listeners start on in a theme: the one paired with it, else the main record, else the first. */
export function themeRecord(records: readonly JukeboxRecord[], themeId: string | null | undefined): string {
  const paired = themeId ? records.find((r) => r.theme === themeId) : undefined;
  return (paired ?? records.find((r) => r.id === MAIN_RECORD_ID) ?? records[0])?.id ?? MAIN_RECORD_ID;
}

/**
 * The record in effect for a pick: the pick itself when it's on the shelf ("All records" needs two or more
 * records), else the theme's record. A pick of a record that's gone is kept in storage but doesn't apply.
 */
export function resolveRecord(pick: string | null, records: readonly JukeboxRecord[], themeId: string | null | undefined): string {
  if (pick === ALL_RECORDS && records.length > 1) return ALL_RECORDS;
  if (pick && pick !== ALL_RECORDS && records.some((r) => r.id === pick)) return pick;
  return themeRecord(records, themeId);
}

/** The tracks a scope plays, in catalogue order (the input's order is kept). */
export function scopeTracks<T extends Pick<JukeboxTrack, 'record'>>(tracks: readonly T[], scope: string): T[] {
  return scope === ALL_RECORDS ? [...tracks] : tracks.filter((t) => trackRecord(t) === scope);
}

/** Whether the record shelf is worth showing (one record = the jukebox as it always was). */
export function hasShelf(records: readonly JukeboxRecord[]): boolean {
  return records.length > 1;
}
