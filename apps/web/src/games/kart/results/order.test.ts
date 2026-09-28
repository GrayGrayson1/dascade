import { describe, expect, it } from 'vitest';
import { KART_GP_POINTS, type KartGpEntryView, type KartRacerView } from '@dascade/shared/games/kart';
import { classify, gpStandings, medalFor, racerSubtitle } from './order.ts';

const racer = (p: Partial<KartRacerView>): KartRacerView => ({
  slot: 0,
  name: 'R',
  bot: false,
  racer: 'nova',
  body: 'buggy',
  paint: '#ffffff',
  lap: 1,
  position: 1,
  distance: 0,
  lapStartMs: 0,
  lastLapMs: 0,
  bestLapMs: 0,
  finished: false,
  finishMs: 0,
  finishOrder: 0,
  dnf: false,
  active: true,
  ...p,
});

const gp = (name: string, places: number[]): KartGpEntryView => ({
  name,
  bot: false,
  racer: 'nova',
  paint: '#fff',
  places,
  points: places.reduce((s, p) => s + (p > 0 ? (KART_GP_POINTS[p - 1] ?? 0) : 0), 0),
});

describe('classify', () => {
  it('orders finishers, then runners by position, then DNFs', () => {
    const rows = classify({
      a: racer({ position: 3 }),
      b: racer({ finishOrder: 2, finished: true }),
      c: racer({ dnf: true, position: 1 }),
      d: racer({ finishOrder: 1, finished: true }),
      e: racer({ position: 2 }),
    });
    expect(rows.map((r) => r.id)).toEqual(['d', 'b', 'e', 'a', 'c']);
  });
});

describe('gpStandings', () => {
  it('ranks by points with gains and previous ranks', () => {
    const rows = gpStandings({ a: gp('A', [1, 4]), b: gp('B', [2, 1]), c: gp('C', [3, 2]) }, 2, KART_GP_POINTS);
    expect(rows.map((r) => [r.id, r.rank, r.gained, r.prevRank])).toEqual([
      ['b', 1, 15, 2],
      ['a', 2, 8, 1],
      ['c', 3, 12, 3],
    ]);
  });
  it('breaks ties by wins and shares ranks on exact ties', () => {
    const rows = gpStandings({ a: gp('A', [1, 0]), b: gp('B', [0, 1]), c: gp('C', [6, 6]) }, 2, KART_GP_POINTS);
    expect(rows[0]!.rank).toBe(1);
    expect(rows[1]!.rank).toBe(1);
    expect(rows[2]).toMatchObject({ id: 'c', rank: 3 });
    const tie = gpStandings({ x: gp('X', [2, 1]), y: gp('Y', [1, 2]) }, 2, KART_GP_POINTS);
    expect(tie.map((r) => r.rank)).toEqual([1, 1]);
  });
  it('handles a DNF round as zero points', () => {
    const rows = gpStandings({ a: gp('A', [0]) }, 1, KART_GP_POINTS);
    expect(rows[0]).toMatchObject({ gained: 0, rank: 1, prevRank: 0 });
  });
});

describe('medalFor', () => {
  it('awards by margin to par', () => {
    expect(medalFor(40_000, 41_000)).toBe('gold');
    expect(medalFor(43_000, 41_000)).toBe('silver');
    expect(medalFor(47_000, 41_000)).toBe('bronze');
    expect(medalFor(60_000, 41_000)).toBeNull();
    expect(medalFor(0, 41_000)).toBeNull();
  });
});

describe('racerSubtitle', () => {
  it('never repeats a bot name', () => {
    expect(racerSubtitle('Brick', 'brick', true)).toBe('CPU');
    expect(racerSubtitle('Zed', 'nova', false)).toBe('Nova');
    expect(racerSubtitle('Bot 2', 'nova', true)).toBe('CPU · Nova');
  });
});
