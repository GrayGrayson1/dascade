import { describe, expect, it } from 'vitest';
import { answerValue, finaleSteps, medalFor } from '@dascade/shared/games/showdown';
import type { BookGuess } from './guesses.ts';
import { PERFECT_BONUS, olympic, rankOf, scoreShow, type ScoreCredit, type ScoreInput, type ScoreTurn } from './scoring.ts';

const board = (n: number, special = 4) => ({ answers: Array.from({ length: n }, (_, i) => i), special });
const g = (slot: number, pos: number, repeat = false): BookGuess => ({ slot, pos, repeat });

/** A one- or two-round show; every argument is per round. */
function show(over: Partial<ScoreInput> & { rev?: boolean[][]; lat?: boolean[][]; book?: Array<Record<string, BookGuess[]>> }): ScoreInput {
  const rounds = over.rounds ?? [board(10)];
  return {
    rounds,
    revealed: (r) => over.rev?.[r] ?? [],
    late: (r) => over.lat?.[r] ?? [],
    guesses: (r) => new Map(Object.entries(over.book?.[r] ?? {})),
    credits: over.credits ?? new Map(),
    turns: over.turns ?? [],
    gems: over.gems ?? true,
    nameOf: over.nameOf ?? ((id) => id.toUpperCase()),
  };
}

const all = (n: number, v = true) => Array.from({ length: n }, () => v);

describe('values and helpers', () => {
  it('#1 = 10 … #10 = 1, doubled for a hidden gem', () => {
    expect(Array.from({ length: 10 }, (_, i) => answerValue(i))).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(answerValue(1, true)).toBe(18);
  });

  it('medals by position; the special answer is the Golden Pumpkin', () => {
    expect([0, 2, 3, 6, 7, 9].map((s) => medalFor(s, 4))).toEqual(['gold', 'gold', 'silver', 'silver', 'bronze', 'bronze']);
    expect(medalFor(4, 4)).toBe('pumpkin');
    expect(medalFor(4, -1)).toBe('silver');
  });

  it('ranks share a place on a tie (1, 1, 3)', () => {
    expect(rankOf([30, 30, 12, 12, 5])).toEqual([1, 1, 3, 3, 5]);
    expect(rankOf([])).toEqual([]);
  });

  it('the finale’s steps: wrap, the medal ceremony (unless Never or none), then the podium 3rd → 1st', () => {
    const podium = [
      { playerId: 'a', name: 'A', points: 9, rank: 1 },
      { playerId: 'b', name: 'B', points: 9, rank: 1 },
      { playerId: 'c', name: 'C', points: 3, rank: 3 },
    ];
    const stars = [{ playerId: 'a', name: 'A', medals: { pumpkin: 1, gold: 0, silver: 0, bronze: 0, ribbon: 0 } }];
    expect(finaleSteps({ podium, stars, medals: 'round' })).toEqual(['wrap', 'medals', 'third', 'first']);
    expect(finaleSteps({ podium, stars, medals: 'never' })).toEqual(['wrap', 'third', 'first']);
    expect(finaleSteps({ podium: [], stars: [], medals: 'end' })).toEqual(['wrap']);
    expect(finaleSteps(null)).toEqual(['wrap']);
  });
});

describe('the crowd: Called it', () => {
  it('a guess scores its tile’s value once the answer flips (however it flipped), +1 in the right spot', () => {
    const rev = [[true, false, true, false, false, false, false, false, false, false]];
    const s = show({ rev, book: [{ ada: [g(0, 0), g(2, 5), g(1, 1)] }] });
    const ada = s && scoreShow(s).byId.get('ada')!;
    // #1 in spot 1: 10 + 1; #3 in spot 6: 8; #2 isn't up yet.
    expect(ada).toMatchObject({ points: 19, calls: 2, positionHits: 1, rank: 1 });
    expect(ada.rounds).toEqual([19]);
  });

  it('never scores a miss, a repeat or an answer still hidden', () => {
    const rev = [all(10)];
    const s = scoreShow(show({ rev, book: [{ ada: [g(-1, 0), g(3, 3), g(3, 4, true)] }] }));
    expect(s.byId.get('ada')).toMatchObject({ points: 8, calls: 1, positionHits: 1 });
  });

  it('a perfect list (every answer, each in its exact spot) adds +20', () => {
    const exact = Array.from({ length: 10 }, (_, i) => g(i, i));
    const s = scoreShow(show({ rev: [all(10)], book: [{ ada: exact, ben: [...exact.slice(0, 9), g(9, 8, false)] }] }));
    // 55 for the values, +10 spot bonuses, +20.
    expect(s.byId.get('ada')).toMatchObject({ points: 55 + 10 + PERFECT_BONUS, perfect: 1, positionHits: 10 });
    expect(s.byId.get('ben')!.perfect).toBe(0);
    // Not every answer showing yet: no perfect bonus.
    const half = scoreShow(show({ rev: [[...all(9), false]], book: [{ ada: exact }] }));
    expect(half.byId.get('ada')!.perfect).toBe(0);
    // A smaller board: all of its answers.
    const small = scoreShow(show({ rounds: [board(5)], rev: [all(5)], book: [{ ada: exact.slice(0, 5) }] }));
    expect(small.byId.get('ada')!.perfect).toBe(1);
  });

  it('hidden gems pay double (the spot bonus stays +1); off, they pay the usual', () => {
    const rev = [all(10)];
    const lat = [[false, false, false, false, false, false, false, false, false, true]];
    const book = [{ ada: [g(9, 9)] }];
    expect(scoreShow(show({ rev, lat, book })).byId.get('ada')).toMatchObject({ points: 3, gems: 1 });
    expect(scoreShow(show({ rev, lat, book, gems: false })).byId.get('ada')).toMatchObject({ points: 2, gems: 0 });
  });

  it('Undo is exact: a tile hidden again takes its points back (everything is recomputed)', () => {
    const book = [{ ada: [g(0, 0)] }];
    expect(scoreShow(show({ rev: [[true]], book })).byId.get('ada')!.points).toBe(11);
    expect(scoreShow(show({ rev: [[false]], book })).byId.get('ada')!.points).toBe(0);
  });

  it('adds rounds up, ranks with ties, and leaves people without points unranked', () => {
    const rounds = [board(10), board(10)];
    const rev = [all(10), [true, ...all(9, false)]];
    const s = scoreShow(
      show({
        rounds,
        rev,
        book: [
          { ada: [g(0, 1)], ben: [g(0, 0)], cy: [g(-1, 2)] },
          { ada: [g(0, 0)], ben: [g(1, 1)] },
        ],
      }),
    );
    expect(s.byId.get('ada')).toMatchObject({ points: 21, rounds: [10, 11], rank: 1 });
    expect(s.byId.get('ben')).toMatchObject({ points: 11, rank: 2 });
    expect(s.byId.get('cy')).toMatchObject({ points: 0, rank: 0 });
    expect(s.of).toBe(2);
    expect(s.people.map((p) => p.playerId)).toEqual(['ada', 'ben', 'cy']);
    const tie = scoreShow(show({ rev: [all(10)], book: [{ ada: [g(0, 1)], ben: [g(0, 2)], cy: [g(5, 5)] }] }));
    expect(tie.people.map((p) => [p.playerId, p.rank])).toEqual([
      ['ada', 1],
      ['ben', 1],
      ['cy', 3],
    ]);
  });
});

describe('the hot seat: medals', () => {
  const credit = (id: string, draw: number): ScoreCredit => ({ id, name: id.toUpperCase(), draw });
  const turn = (id: string, draw: number, round = 0): ScoreTurn => ({ id, name: id.toUpperCase(), draw, round });

  it('a credited find earns its medal; a turn marked done with nothing found earns a Brave ribbon', () => {
    const credits = new Map([
      ['0:0', credit('ada', 1)],
      ['0:4', credit('ada', 1)],
      ['0:5', credit('ben', 2)],
      ['0:9', credit('cy', 4)],
    ]);
    const rev = [all(10)];
    const s = scoreShow(show({ rev, credits, turns: [turn('ada', 1), turn('ben', 2), turn('dee', 3)] }));
    expect(s.byId.get('ada')!.medals).toEqual({ pumpkin: 1, gold: 1, silver: 0, bronze: 0, ribbon: 0 });
    expect(s.byId.get('ben')!.medals).toMatchObject({ silver: 1, ribbon: 0 });
    expect(s.byId.get('cy')!.medals).toMatchObject({ bronze: 1 });
    expect(s.byId.get('dee')!.medals).toMatchObject({ ribbon: 1 });
    // Olympic order: pumpkins, golds, silvers, bronzes, ribbons.
    expect(s.stars.map((x) => x.playerId)).toEqual(['ada', 'ben', 'cy', 'dee']);
    // Medals and points never touch.
    expect(s.byId.get('ada')!.points).toBe(0);
    expect(s.finds.map((f) => [f.slot, f.medal])).toEqual([
      [0, 'gold'],
      [4, 'pumpkin'],
      [5, 'silver'],
      [9, 'bronze'],
    ]);
  });

  it('a credit on a tile hidden again (Undo) is no medal — and the turn becomes a ribbon', () => {
    const credits = new Map([['0:1', credit('ada', 7)]]);
    const turns = [turn('ada', 7)];
    expect(scoreShow(show({ rev: [[false, true]], credits, turns })).byId.get('ada')!.medals).toMatchObject({ gold: 1, ribbon: 0 });
    expect(scoreShow(show({ rev: [[false, false]], credits, turns })).byId.get('ada')!.medals).toMatchObject({ gold: 0, ribbon: 1 });
  });

  it('orders the medal wall Olympic-style', () => {
    const m = (pumpkin: number, gold: number, ribbon: number) => ({ pumpkin, gold, silver: 0, bronze: 0, ribbon });
    const list = [
      { name: 'Zed', medals: m(0, 0, 5) },
      { name: 'Amy', medals: m(0, 2, 0) },
      { name: 'Bo', medals: m(1, 0, 0) },
      { name: 'Cal', medals: m(0, 2, 0) },
    ];
    expect([...list].sort(olympic).map((x) => x.name)).toEqual(['Bo', 'Amy', 'Cal', 'Zed']);
  });
});
