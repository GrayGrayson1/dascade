/**
 * The rack per record (pure; unit-tested in rack.test.ts): every record's songs carry their own selection
 * codes — A1, A2 … in the record's catalogue order — and in the "All records" mix the codes run across the
 * whole catalogue (the main record first, so A1 stays the jukebox's first song).
 */
import type { JukeboxTrack } from '@dascade/shared';
import { ALL_RECORDS, trackRecord } from '../audio/jukebox/records.ts';
import { selectionCode } from './strips.ts';

/** Track id → its selection code in `scope` (tracks outside a record scope get their own record's code). */
export function rackCodes(catalogue: readonly JukeboxTrack[], scope: string): Map<string, string> {
  if (scope === ALL_RECORDS) return new Map(catalogue.map((t, i) => [t.id, selectionCode(i)]));
  const seen = new Map<string, number>();
  const codes = new Map<string, string>();
  for (const t of catalogue) {
    const record = trackRecord(t);
    const i = seen.get(record) ?? 0;
    seen.set(record, i + 1);
    codes.set(t.id, selectionCode(i));
  }
  return codes;
}
