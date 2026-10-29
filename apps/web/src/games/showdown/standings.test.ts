import { describe, expect, it } from 'vitest';
import type { ShowdownBoardView, ShowdownMedals, ShowdownSlotView } from '@dascade/shared/games/showdown';
import { PERFECT_BONUS as CORE_PERFECT_BONUS, SPOT_BONUS as CORE_SPOT_BONUS } from '@dascade/game-core/showdown';
import {
  PERFECT_BONUS,
  SPOT_BONUS,
  finaleView,
  groupByRank,
  medalCells,
  medalKindsHeld,
  medalLegend,
  medalList,
  medalWords,
  medalsOnBoard,
  placeWord,
  podiumColumns,
  pointsLegend,
  popFor,
} from './standings.ts';

const medals = (over: Partial<ShowdownMedals> = {}): ShowdownMedals => ({ pumpkin: 0, gold: 0, silver: 0, bronze: 0, ribbon: 0, ...over });
const slot = (over: Partial<ShowdownSlotView> = {}): ShowdownSlotView => ({
  revealed: false,
  by: -1,
  seq: 0,
  callers: 0,
  late: false,
  ...over,
});

describe('called-it pops', () => {
  it('show a flipped tile’s value and how many called it — nothing while it’s hidden', () => {
    expect(popFor(slot(), 0, true)).toBeNull();
    expect(popFor(slot({ revealed: true, callers: 6 }), 1, true)).toEqual({ value: 9, callers: 6, gem: false });
    // A hidden gem (found only by Reveal remaining) pays double; with gems off it doesn't.
    expect(popFor(slot({ revealed: true, late: true }), 9, true)).toEqual({ value: 2, callers: 0, gem: true });
    expect(popFor(slot({ revealed: true, late: true }), 9, false)).toEqual({ value: 1, callers: 0, gem: false });
  });
});

describe('medals', () => {
  it('lists medals Olympic-style, leaving out the kinds someone doesn’t hold', () => {
    expect(medalList(medals({ ribbon: 2, gold: 1, pumpkin: 1 })).map((m) => [m.kind, m.count, m.icon])).toEqual([
      ['pumpkin', 1, '🎃'],
      ['gold', 1, '🥇'],
      ['ribbon', 2, '🎗️'],
    ]);
    expect(medalWords(medals({ pumpkin: 1, ribbon: 2 }))).toBe('1 Golden Pumpkin, 2 Brave ribbons');
    expect(medalList(medals())).toEqual([]);
  });

  it('pins on the hot seat the medals of tiles credited to them on this board', () => {
    const board: Pick<ShowdownBoardView, 'slots' | 'special'> = {
      special: 4,
      slots: [
        slot({ revealed: true, calledBy: 'Priya' }),
        slot({ revealed: true, calledBy: 'Sam' }),
        slot(),
        slot(),
        slot({ revealed: true, calledBy: 'Priya' }),
        slot({ revealed: true, calledBy: 'Priya', late: true }),
        slot(),
        slot(),
        slot({ revealed: true, calledBy: 'Priya' }),
      ],
    };
    expect(medalsOnBoard(board, 'Priya')).toEqual(['gold', 'pumpkin', 'silver', 'bronze']);
    expect(medalsOnBoard(board, '')).toEqual([]);
  });
});

describe('standings and the podium', () => {
  it('writes places as words', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(placeWord)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
    ]);
  });

  it('groups ties into one place and lays the podium out 2nd, 1st, 3rd', () => {
    const rows = [
      { name: 'C', rank: 3 },
      { name: 'A', rank: 1 },
      { name: 'B', rank: 1 },
    ];
    expect(groupByRank(rows).map((g) => [g.rank, g.rows.map((r) => r.name)])).toEqual([
      [1, ['A', 'B']],
      [3, ['C']],
    ]);
    expect(podiumColumns(rows).map((c) => c.rank)).toEqual([1, 3]);
    expect(podiumColumns([...rows, { name: 'D', rank: 2 }]).map((c) => c.rank)).toEqual([2, 1, 3]);
  });

  it('paces the finale: the wrap, the medal ceremony, then 3rd → 2nd → 1st, earlier places staying up', () => {
    const podium = [
      { playerId: 'a', name: 'A', points: 30, rank: 1 },
      { playerId: 'b', name: 'B', points: 20, rank: 2 },
      { playerId: 'c', name: 'C', points: 10, rank: 3 },
    ];
    const stars = [{ playerId: 'a', name: 'A', medals: medals({ gold: 1 }) }];
    const finale = { podium, stars, medals: 'round' as const };
    expect(finaleView(finale, 0)).toMatchObject({ kind: 'wrap', paced: true });
    expect(finaleView(finale, 1).kind).toBe('medals');
    expect([...finaleView(finale, 2).places]).toEqual([3]);
    expect([...finaleView(finale, 4).places].sort()).toEqual([1, 2, 3]);
    expect(finaleView(finale, 4).kind).toBe('first');
    // A step past the end shows the last one; nothing to pace keeps today's wrap.
    expect(finaleView(finale, 9).kind).toBe('first');
    expect(finaleView({ podium: [], stars: [], medals: 'never' }, 3)).toMatchObject({ kind: 'wrap', paced: false });
    expect(finaleView(null, 0).kind).toBe('wrap');
  });
});

describe('the medal wall’s columns and the legend', () => {
  it('gives the wall a column for each kind anyone holds, a blank cell where someone has none', () => {
    const stars = [{ medals: medals({ gold: 2, ribbon: 1 }) }, { medals: medals({ bronze: 1 }) }];
    expect(medalKindsHeld(stars)).toEqual(['gold', 'bronze', 'ribbon']);
    expect(medalKindsHeld([])).toEqual([]);
    expect(medalCells(medals({ bronze: 1 }), ['gold', 'bronze', 'ribbon']).map((c) => [c.kind, c.count])).toEqual([
      ['gold', 0],
      ['bronze', 1],
      ['ribbon', 0],
    ]);
  });

  it('says what earns each medal, from the rules themselves', () => {
    expect(medalLegend().map((m) => [m.icon, m.text])).toEqual([
      ['🎃', 'Special answer'],
      ['🥇', 'Answer #1–3'],
      ['🥈', 'Answer #4–7'],
      ['🥉', 'Answer #8–10'],
      ['🎗️', 'Brave try, nothing found'],
    ]);
    expect(medalLegend().every((m) => m.title)).toBe(true);
  });

  it('says how points add up; hidden gems only when they’re on', () => {
    expect(pointsLegend(true).map((p) => p.text)).toEqual([
      'Answer #1 = 10 … #10 = 1',
      '+1 right spot',
      'Hidden gem ×2',
      '+20 perfect list',
    ]);
    expect(pointsLegend(false).map((p) => p.key)).toEqual(['value', 'spot', 'perfect']);
  });

  it('keeps the bonuses in step with the server’s scoring', () => {
    expect(SPOT_BONUS).toBe(CORE_SPOT_BONUS);
    expect(PERFECT_BONUS).toBe(CORE_PERFECT_BONUS);
  });
});
