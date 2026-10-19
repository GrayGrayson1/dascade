import { describe, expect, it } from 'vitest';
import type { JukeboxRecord } from '@dascade/shared/jukebox';
import { ALL_RECORDS, hasShelf, recordsOf, resolveRecord, scopeTracks, themeRecord, trackRecord } from './records.ts';
import { RECORDS_MANIFEST, track } from './testHarness.ts';

const shelf = RECORDS_MANIFEST.records!;
const one: JukeboxRecord[] = [shelf[0]!];

describe('records', () => {
  it('a track without a record is on the main record', () => {
    expect(trackRecord(track('x', 0))).toBe('main');
    expect(trackRecord({ record: 'halloween' })).toBe('halloween');
  });

  it('the shelf: manifest records with tracks, in order, with live counts; unknown records get a stand-in', () => {
    const tracks = [...RECORDS_MANIFEST.tracks, { ...track('z', 9), record: 'mystery', album: 'Mystery Tape' }];
    const records = recordsOf(tracks, [{ ...shelf[1]!, order: 0 }, { ...shelf[0]!, order: 1 }, { id: 'empty', title: 'Empty', order: 2, tracks: 4, duration: 1 }]);
    expect(records.map((r) => [r.id, r.title, r.tracks])).toEqual([
      ['halloween', 'Halloween', 3],
      ['main', 'Cyber Nightpulse', 3],
      ['mystery', 'Mystery Tape', 1],
    ]);
    expect(recordsOf([], shelf)).toEqual([]);
  });

  it('theme default: the paired record, else the main record, else the first', () => {
    expect(themeRecord(shelf, 'halloween-night')).toBe('halloween');
    expect(themeRecord(shelf, 'delta-neon')).toBe('main');
    expect(themeRecord(shelf, null)).toBe('main');
    expect(themeRecord([shelf[1]!], 'delta-neon')).toBe('halloween');
    expect(themeRecord([], 'x')).toBe('main');
  });

  it('resolveRecord: a pick on the shelf wins; "all" needs two records; anything else follows the theme', () => {
    expect(resolveRecord('halloween', shelf, 'delta-neon')).toBe('halloween');
    expect(resolveRecord('main', shelf, 'halloween-night')).toBe('main');
    expect(resolveRecord(ALL_RECORDS, shelf, null)).toBe(ALL_RECORDS);
    expect(resolveRecord(ALL_RECORDS, one, null)).toBe('main');
    expect(resolveRecord('gone', shelf, 'halloween-night')).toBe('halloween');
    expect(resolveRecord(null, shelf, 'halloween-night')).toBe('halloween');
  });

  it('scopeTracks keeps catalogue order; the mix is everything', () => {
    expect(scopeTracks(RECORDS_MANIFEST.tracks, 'halloween').map((t) => t.id)).toEqual(['h1', 'h2', 'h3']);
    expect(scopeTracks(RECORDS_MANIFEST.tracks, ALL_RECORDS)).toHaveLength(6);
    expect(scopeTracks(RECORDS_MANIFEST.tracks, 'nope')).toEqual([]);
  });

  it('the shelf shows only with two or more records', () => {
    expect(hasShelf(shelf)).toBe(true);
    expect(hasShelf(one)).toBe(false);
  });
});
