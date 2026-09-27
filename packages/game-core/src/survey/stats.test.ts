import { describe, expect, it } from 'vitest';
import type { SurveyHistoryEntry, SurveyQuestion, SurveyResult } from '@dascade/shared/games/survey';
import { SurveyBook } from './book.ts';
import { SurveyStats, buildRecap, historyEntry, placeStandings, placementGroups } from './stats.ts';

describe('standings', () => {
  it('uses competition ranking with shared places', () => {
    const rows = placeStandings([
      { id: 'a', score: 900 },
      { id: 'b', score: 2000 },
      { id: 'c', score: 900 },
      { id: 'd', score: 100 },
    ]);
    expect(rows.map((r) => [r.id, r.place])).toEqual([
      ['b', 1],
      ['a', 2],
      ['c', 2],
      ['d', 4],
    ]);
  });

  it('groups placements for reportOutcome', () => {
    expect(
      placementGroups([
        { id: 'a', score: 5 },
        { id: 'b', score: 5 },
        { id: 'c', score: 1 },
      ]),
    ).toEqual([['a', 'b'], ['c']]);
    expect(placementGroups([])).toEqual([]);
  });
});

const q = (mode: SurveyQuestion['mode'], options: string[], prompt = 'Question?'): SurveyQuestion => ({
  id: `x-${mode}`,
  mode,
  prompt,
  options,
  pack: 'custom',
  ...(mode === 'percent' ? { target: 0 } : {}),
});

function play(question: SurveyQuestion, answers: number[], predictions: Record<string, unknown>, serial = 1): SurveyResult {
  const book = new SurveyBook(question, serial);
  answers.forEach((a, i) => book.answer(`v${i}`, a));
  book.closeAnswers();
  for (const [id, p] of Object.entries(predictions)) book.predict(id, p as never);
  return book.tally({ index: serial, seated: answers.length, order: Object.keys(predictions) });
}

describe('SurveyStats awards', () => {
  it('names the mind reader, the barometer, the ranker and bold callers (ties share)', () => {
    const stats = new SurveyStats();
    stats.record(
      play(
        q('majority', ['A', 'B']),
        [0, 0, 1],
        { a: { kind: 'majority', option: 0 }, b: { kind: 'majority', option: 0 }, c: { kind: 'majority', option: 1 } },
        1,
      ),
    );
    stats.record(
      play(
        q('majority', ['A', 'B', 'C']),
        [2, 2, 1, 0],
        { a: { kind: 'majority', option: 0 }, b: { kind: 'majority', option: 1 }, c: { kind: 'majority', option: 2 } },
        2,
      ),
    );
    stats.record(
      play(q('percent', ['Yes', 'No']), [0, 1, 1, 1], { a: { kind: 'percent', percent: 25 }, b: { kind: 'percent', percent: 60 } }, 3),
    );
    stats.record(
      play(q('percent', ['Yes', 'No']), [0, 0, 1, 1], { a: { kind: 'percent', percent: 45 }, b: { kind: 'percent', percent: 50 } }, 4),
    );
    stats.record(
      play(q('rank', ['A', 'B', 'C']), [0, 0, 1], { a: { kind: 'rank', order: [2, 1, 0] }, c: { kind: 'rank', order: [0, 1, 2] } }, 5),
    );

    const names: Record<string, string> = { a: 'Ada', b: 'Ben', c: 'Cy' };
    const awards = stats.awards((id) => names[id]);
    const byId = Object.fromEntries(awards.map((a) => [a.id, a]));
    // Majority: a and b hit Q1; c hit Q2 alone ("called it"). a: 1, b: 1, c: 1 → a three-way
    // tie singles nobody out, so there is no Mind Reader award.
    expect(byId['mind-reader']).toBeUndefined();
    expect(byId.bold!.playerIds).toEqual(['c']);
    expect(byId.bold!.value).toBe('1 bold call');
    // Percent: a is 0 then 5 off (avg 2.5); b is 35 then 0 off.
    expect(byId.barometer!.playerIds).toEqual(['a']);
    expect(byId.barometer!.value).toBe('avg 2.5 points off');
    // Only one rank question: c was perfect.
    expect(byId.ranker!.playerIds).toEqual(['c']);
    expect(byId.ranker!.value).toBe('every order perfect');
  });

  it('shares an award between a few tied standouts', () => {
    const stats = new SurveyStats();
    const pred = (option: number) => ({ kind: 'majority', option });
    stats.record(play(q('majority', ['A', 'B']), [0, 0, 1], { a: pred(0), b: pred(0), c: pred(1), d: pred(1), e: pred(1) }, 1));
    const awards = stats.awards((id) => id.toUpperCase());
    const reader = awards.find((w) => w.id === 'mind-reader')!;
    expect(reader.playerIds).toEqual(['a', 'b']);
    expect(reader.names).toEqual(['A', 'B']);
    // Both were right while 3 of 5 missed → a shared bold call.
    expect(awards.find((w) => w.id === 'bold')!.playerIds).toEqual(['a', 'b']);
  });

  it('skips players who left and voided questions', () => {
    const stats = new SurveyStats();
    stats.record(play(q('majority', ['A', 'B']), [0, 0, 0], { gone: { kind: 'majority', option: 0 } }));
    stats.record(play(q('majority', ['A', 'B']), [0, 1], { here: { kind: 'majority', option: 0 } })); // voided (2 answers)
    expect(stats.awards((id) => (id === 'here' ? 'Here' : undefined))).toEqual([]);
  });

  it('resets', () => {
    const stats = new SurveyStats();
    stats.record(play(q('majority', ['A', 'B']), [0, 0, 0], { a: { kind: 'majority', option: 0 } }));
    stats.reset();
    expect(stats.awards(() => 'x')).toEqual([]);
  });
});

describe('history + recap', () => {
  it('summarises a result without individual answers', () => {
    const result = play(q('majority', ['Pizza', 'Tacos'], 'Dinner?'), [0, 0, 0, 1], {
      a: { kind: 'majority', option: 0 },
      b: { kind: 'majority', option: 1 },
    });
    const h = historyEntry(result);
    expect(h).toMatchObject({ headline: 'Pizza', share: 75, margin: 50, predictors: 2, hitRate: 50, voided: false, respondents: 4 });
  });

  it('joins tied leaders in the headline', () => {
    const h = historyEntry(play(q('majority', ['Tea', 'Coffee']), [0, 1, 0, 1], {}));
    expect(h.headline).toBe('Tea & Coffee');
    expect(h.margin).toBe(0);
  });

  it('picks distinct united / divided / surprise questions', () => {
    const base = { mode: 'majority' as const, voided: false, respondents: 10, predictors: 10 };
    const history: SurveyHistoryEntry[] = [
      { ...base, q: 1, index: 1, prompt: 'Q1', headline: 'Pizza', share: 90, margin: 80, hitRate: 90 },
      { ...base, q: 2, index: 2, prompt: 'Q2', headline: 'Tea & Coffee', share: 50, margin: 0, hitRate: 60 },
      { ...base, q: 3, index: 3, prompt: 'Q3', headline: 'Cats', share: 40, margin: 10, hitRate: 10 },
      { ...base, q: 4, index: 4, prompt: 'Q4', headline: 'X', share: 100, margin: 100, hitRate: 0, voided: true },
    ];
    const recap = buildRecap(history);
    expect(recap.map((r) => [r.id, r.prompt])).toEqual([
      ['united', 'Q1'],
      ['divided', 'Q2'],
      ['surprise', 'Q3'],
    ]);
    expect(recap[0]!.detail).toBe('90% picked “Pizza”.');
    expect(recap[1]!.detail).toBe('A dead heat: Tea & Coffee.');
    expect(recap[2]!.detail).toBe('Only 10% of predictions landed.');
  });

  it('describes unanimity and returns nothing for an empty game', () => {
    const base = { mode: 'majority' as const, voided: false, respondents: 3, predictors: 3 };
    expect(buildRecap([{ ...base, q: 1, index: 1, prompt: 'Q', headline: 'A', share: 100, margin: 100, hitRate: 100 }])[0]!.detail).toBe(
      'Everyone picked “A”.',
    );
    expect(buildRecap([])).toEqual([]);
  });
});
