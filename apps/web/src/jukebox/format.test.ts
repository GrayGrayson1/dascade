import { describe, expect, it } from 'vitest';
import type { JukeboxTrack } from '@dascade/shared';
import { coverCells, formatTime, hash32, matchesQuery, sortTracks, spokenTime, voteText } from './format.ts';

const t = (id: string, title: string, order: number, duration: number, extra: Partial<JukeboxTrack> = {}): JukeboxTrack => ({
  id,
  title,
  order,
  duration,
  src: `/audio/jukebox/${id}.mp3`,
  file: `${title}.mp3`,
  ...extra,
});

const LIB = [
  t('neon', 'Neon Cruising', 2, 120, { artist: 'beanalicious' }),
  t('arcade', 'Arcade Pulse', 0, 64),
  t('eight', '8-Bit Outrun', 1, 162, { album: 'Cyber Nightpulse' }),
  t('cafe', 'Café Crème', 3, 64),
];

describe('formatTime', () => {
  it('formats m:ss and h:mm:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(83.9)).toBe('1:23');
    expect(formatTime(3725)).toBe('1:02:05');
  });
  it('clamps junk to 0:00', () => {
    expect(formatTime(-4)).toBe('0:00');
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
  it('speaks durations', () => {
    expect(spokenTime(83)).toBe('1 minute 23 seconds');
    expect(spokenTime(60)).toBe('1 minute');
    expect(spokenTime(1)).toBe('1 second');
    expect(spokenTime(0)).toBe('0 seconds');
  });
});

describe('library search + sort', () => {
  it('matches title, artist, album and file, ignoring case and accents', () => {
    expect(matchesQuery(LIB[0]!, 'BEAN')).toBe(true);
    expect(matchesQuery(LIB[2]!, 'nightpulse')).toBe(true);
    expect(matchesQuery(LIB[3]!, 'cafe creme')).toBe(true);
    expect(matchesQuery(LIB[0]!, 'neon zzz')).toBe(false);
    expect(matchesQuery(LIB[0]!, '   ')).toBe(true);
  });
  it('sorts by manifest order, title (numeric-aware) and duration with stable ties', () => {
    expect(sortTracks(LIB, 'order').map((x) => x.id)).toEqual(['arcade', 'eight', 'neon', 'cafe']);
    expect(sortTracks(LIB, 'title').map((x) => x.id)).toEqual(['eight', 'arcade', 'cafe', 'neon']);
    expect(sortTracks(LIB, 'duration').map((x) => x.id)).toEqual(['arcade', 'cafe', 'neon', 'eight']);
  });
  it('filters before sorting and never mutates the input', () => {
    const copy = [...LIB];
    expect(sortTracks(LIB, 'title', 'e').length).toBeGreaterThan(0);
    expect(sortTracks(LIB, 'order', 'pulse').map((x) => x.id)).toEqual(['arcade', 'eight']);
    expect(LIB).toEqual(copy);
  });
});

describe('generated cover art', () => {
  it('is deterministic per id and different across ids', () => {
    expect(coverCells('neon-cruising')).toEqual(coverCells('neon-cruising'));
    expect(coverCells('neon-cruising')).not.toEqual(coverCells('arcade-pulse'));
    expect(hash32('a')).not.toBe(hash32('b'));
  });
  it('is mirrored left/right and stays on the 8×8 grid', () => {
    for (const id of ['a', 'neon-cruising', 'hopes-turnaround', 'x'.repeat(64)]) {
      const cells = coverCells(id);
      const key = new Set(cells.map((c) => `${c.x},${c.y},${c.tone}`));
      for (const c of cells) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x).toBeLessThan(8);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeLessThan(8);
        expect(key.has(`${7 - c.x},${c.y},${c.tone}`)).toBe(true);
      }
    }
  });
});

describe('voteText', () => {
  it('states the threshold plainly', () => {
    expect(voteText(2, 3)).toBe('2 of 3 votes to skip');
    expect(voteText(0, 1)).toBe('0 of 1 vote to skip');
    expect(voteText(5, 3)).toBe('3 of 3 votes to skip');
    expect(voteText(-1, 0)).toBe('0 of 1 vote to skip');
  });
});
