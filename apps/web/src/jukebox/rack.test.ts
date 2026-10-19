import { describe, expect, it } from 'vitest';
import { RECORDS_MANIFEST } from '../audio/jukebox/testHarness.ts';
import { rackCodes } from './rack.ts';

describe('rack codes per record', () => {
  it("each record's songs are A1, A2 …; the mix numbers the whole catalogue", () => {
    const tracks = RECORDS_MANIFEST.tracks;
    expect(Object.fromEntries(rackCodes(tracks, 'main'))).toEqual({ a: 'A1', b: 'A2', c: 'A3', h1: 'A1', h2: 'A2', h3: 'A3' });
    expect(Object.fromEntries(rackCodes(tracks, 'all'))).toEqual({ a: 'A1', b: 'A2', c: 'A3', h1: 'A4', h2: 'A5', h3: 'A6' });
  });

  it('ten songs on a record fill pages A and B', () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ ...RECORDS_MANIFEST.tracks[3]!, id: `s${i}`, order: i }));
    expect([...rackCodes(ten, 'halloween').values()].slice(7)).toEqual(['A8', 'B1', 'B2']);
  });
});
