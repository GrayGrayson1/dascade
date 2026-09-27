import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { DEFAULT_TRIVIA_SETTINGS, type TriviaAnswerInput, type TriviaQuestion } from '@dascade/shared/games/trivia';
import {
  PACK_CSV_EXAMPLE,
  arrangeFinal,
  buildPool,
  gradeAnswer,
  isValidAnswer,
  maxWager,
  packToJson,
  parseCsv,
  parsePackCsv,
  parsePackJson,
  pickQuestions,
  presentQuestion,
  questionPoints,
  scoreQuestion,
  validatePack,
  type AnswerKey,
  type PoolQuestion,
  type ScoreContext,
} from './index.ts';

const MC: TriviaQuestion = {
  id: 'science-1',
  category: 'science',
  difficulty: 'easy',
  type: 'mc',
  prompt: 'Closest planet to the Sun?',
  options: ['Mercury', 'Venus', 'Mars', 'Earth'],
  correct: 0,
};
const TF: TriviaQuestion = {
  id: 'general-1',
  category: 'general',
  difficulty: 'medium',
  type: 'tf',
  prompt: 'A week has seven days.',
  correct: true,
};
const TEXT: TriviaQuestion = {
  id: 'geography-1',
  category: 'geography',
  difficulty: 'hard',
  type: 'text',
  prompt: 'Longest river in Mississippi state?',
  accept: ['Mississippi', 'Mississippi River'],
};
const NUM: TriviaQuestion = {
  id: 'history-1',
  category: 'history',
  difficulty: 'medium',
  type: 'number',
  prompt: 'Year of the Moon landing?',
  correct: 1969,
};
const ORDER: TriviaQuestion = {
  id: 'science-2',
  category: 'science',
  difficulty: 'hard',
  type: 'order',
  prompt: 'Order by distance from the Sun',
  items: ['Mercury', 'Venus', 'Earth', 'Mars'],
  ends: ['Closest', 'Farthest'],
};
const STARTER = [MC, TF, TEXT, NUM, ORDER];

const present = (q: TriviaQuestion, seed = 'p', extra: Partial<{ isFinal: boolean; points: number }> = {}) =>
  presentQuestion(q, { seq: 1, index: 1, total: 5, isFinal: extra.isFinal ?? false, points: extra.points ?? 500 }, createSeededRng(seed));

// ---------------------------------------------------------------------------
describe('pool + selection', () => {
  it('filters by pack, categories, types and difficulty', () => {
    const custom: TriviaQuestion[] = [{ category: 'custom', difficulty: 'easy', type: 'tf', prompt: 'Custom?', correct: false }];
    const base = { ...DEFAULT_TRIVIA_SETTINGS };
    expect(buildPool(STARTER, custom, base).length).toBe(5);
    expect(buildPool(STARTER, custom, { ...base, pack: 'mixed' }).length).toBe(6);
    const onlyCustom = buildPool(STARTER, custom, { ...base, pack: 'custom' });
    expect(onlyCustom.map((p) => [p.key, p.source])).toEqual([['custom-0', 'custom']]);
    expect(buildPool(STARTER, custom, { ...base, categories: ['science'] }).map((p) => p.key)).toEqual(['science-1', 'science-2']);
    expect(buildPool(STARTER, custom, { ...base, types: ['tf', 'number'] }).map((p) => p.key)).toEqual(['general-1', 'history-1']);
    expect(buildPool(STARTER, custom, { ...base, difficulty: 'hard' }).map((p) => p.key)).toEqual(['geography-1', 'science-2']);
    // Custom questions ignore the category filter but honour types.
    expect(buildPool(STARTER, custom, { ...base, pack: 'mixed', categories: ['history'] }).map((p) => p.key)).toEqual([
      'history-1',
      'custom-0',
    ]);
  });

  it('pickQuestions deals across categories, avoids recent keys, deterministic with a seed', () => {
    const pool: PoolQuestion[] = [];
    for (const cat of ['general', 'science', 'history'] as const) {
      for (let i = 0; i < 6; i++)
        pool.push({ key: `${cat}-${i}`, source: 'starter', q: { ...TF, id: `${cat}-${i}`, category: cat, prompt: `${cat} ${i}` } });
    }
    const a = pickQuestions(pool, 6, createSeededRng('pick'));
    expect(a.map((p) => p.key)).toEqual(pickQuestions(pool, 6, createSeededRng('pick')).map((p) => p.key));
    const cats = a.map((p) => p.q.category);
    for (const c of ['general', 'science', 'history']) expect(cats.filter((x) => x === c).length).toBe(2);
    expect(new Set(a.map((p) => p.key)).size).toBe(6);
    const avoid = new Set(pool.slice(0, 15).map((p) => p.key));
    const b = pickQuestions(pool, 5, createSeededRng('avoid'), avoid);
    expect(b.slice(0, 3).every((p) => !avoid.has(p.key))).toBe(true);
    expect(b.length).toBe(5);
    expect(pickQuestions(pool, 100, createSeededRng('all')).length).toBe(18);
  });

  it('arrangeFinal moves a non-true/false (preferably harder) question to the end', () => {
    const picked: PoolQuestion[] = [TF, MC, NUM, TF].map((q, i) => ({ key: `k${i}`, q, source: 'starter' }));
    const out = arrangeFinal([...picked], createSeededRng('final'));
    expect(out.length).toBe(4);
    expect(out.at(-1)!.q).toBe(NUM); // medium beats easy MC
    const allTf = arrangeFinal([picked[0]!, picked[3]!], createSeededRng('x'));
    expect(allTf.map((p) => p.key)).toEqual(['k0', 'k3']);
  });

  it('questionPoints applies the difficulty multiplier only when enabled', () => {
    expect(questionPoints({ difficulty: 'hard' }, 500, false)).toBe(500);
    expect(questionPoints({ difficulty: 'hard' }, 500, true)).toBe(1000);
    expect(questionPoints({ difficulty: 'medium' }, 250, true)).toBe(375);
  });
});

// ---------------------------------------------------------------------------
describe('presentation never leaks the answer', () => {
  it('mc: options shuffled, key maps to the right option, view has no answer', () => {
    for (let s = 0; s < 20; s++) {
      const { view, key } = present(MC, `mc${s}`);
      expect(view.options![key.correctIndex!]).toBe('Mercury');
      expect(JSON.stringify(view)).not.toMatch(/correct|accept/);
    }
    const fixed = present({ ...MC, fixedOrder: true } as TriviaQuestion);
    expect(fixed.view.options).toEqual(MC.type === 'mc' ? MC.options : []);
  });

  it('tf / text / number views carry no answer', () => {
    expect(present(TF).view.options).toEqual(['True', 'False']);
    expect(present(TF).key.correctIndex).toBe(0);
    expect(JSON.stringify(present(TEXT).view)).not.toContain('Mississippi River');
    expect(JSON.stringify(present(NUM).view)).not.toContain('1969');
    expect(present(NUM).key.correctText).toBe('1969');
  });

  it('order: display order is never already correct; correctOrder maps back', () => {
    for (let s = 0; s < 30; s++) {
      const { view, key } = present(ORDER, `o${s}`);
      expect(view.items).not.toEqual(['Mercury', 'Venus', 'Earth', 'Mars']);
      expect(key.correctOrder!.map((i) => view.items![i])).toEqual(['Mercury', 'Venus', 'Earth', 'Mars']);
      expect(view.ends).toEqual(['Closest', 'Farthest']);
    }
  });
});

// ---------------------------------------------------------------------------
describe('validation + grading', () => {
  it('isValidAnswer checks kind, ranges and permutations', () => {
    const mc = present(MC).view;
    expect(isValidAnswer(mc, { kind: 'mc', index: 3 })).toBe(true);
    expect(isValidAnswer(mc, { kind: 'mc', index: 4 })).toBe(false);
    expect(isValidAnswer(mc, { kind: 'tf', value: true })).toBe(false);
    const order = present(ORDER).view;
    expect(isValidAnswer(order, { kind: 'order', order: [0, 1, 2, 3] })).toBe(true);
    expect(isValidAnswer(order, { kind: 'order', order: [0, 1, 1, 3] })).toBe(false);
    expect(isValidAnswer(order, { kind: 'order', order: [0, 1, 2] })).toBe(false);
    expect(isValidAnswer(present(TEXT).view, { kind: 'text', text: '   ' })).toBe(false);
    expect(isValidAnswer(present(NUM).view, { kind: 'number', value: 12 })).toBe(true);
  });

  it('grades text with normalization and safe typos', () => {
    const key = present(TEXT).key;
    expect(gradeAnswer(key, { kind: 'text', text: 'the MISSISSIPPI river!' }).correct).toBe(true);
    expect(gradeAnswer(key, { kind: 'text', text: 'Missisipi' }).correct).toBe(true);
    expect(gradeAnswer(key, { kind: 'text', text: 'Missouri' }).correct).toBe(false);
  });

  it('grades order with partial credit share', () => {
    const { key } = present(ORDER, 'g');
    const right = key.correctOrder!;
    expect(gradeAnswer(key, { kind: 'order', order: right })).toEqual({ correct: true, partialShare: 0 });
    const swapped = [right[1]!, right[0]!, right[2]!, right[3]!];
    expect(gradeAnswer(key, { kind: 'order', order: swapped })).toEqual({ correct: false, partialShare: 0.5 });
  });
});

// ---------------------------------------------------------------------------
describe('scoreQuestion', () => {
  const ctxFor = (
    q: TriviaQuestion,
    answers: Array<[string, TriviaAnswerInput, number]>,
    extra: Partial<ScoreContext> = {},
  ): ScoreContext => {
    const p = present(q, 's', { isFinal: extra.view?.isFinal });
    return {
      view: p.view,
      key: p.key,
      playerIds: ['a', 'b', 'c'],
      answers: answers.map(([playerId, input, elapsedMs]) => ({ playerId, input, elapsedMs })),
      windowMs: 10_000,
      speedBonus: false,
      streakBonus: false,
      streaks: new Map(),
      ...extra,
    };
  };
  const mcKey = present(MC, 's').key;
  const right: TriviaAnswerInput = { kind: 'mc', index: mcKey.correctIndex! };
  const wrong: TriviaAnswerInput = { kind: 'mc', index: (mcKey.correctIndex! + 1) % 4 };

  it('base points, wrong answers and missing players', () => {
    const r = scoreQuestion(
      ctxFor(MC, [
        ['a', right, 1000],
        ['b', wrong, 500],
      ]),
    );
    expect(r.results.a).toMatchObject({ correct: true, points: 500, answered: true, answerText: 'Mercury' });
    expect(r.results.b).toMatchObject({ correct: false, points: 0 });
    expect(r.results.c).toMatchObject({ answered: false, points: 0 });
    expect(r.reveal).toMatchObject({ correctText: 'Mercury', answeredCount: 2, correctCount: 1 });
    expect(r.reveal.distribution!.reduce((x, y) => x + y, 0)).toBe(2);
    expect(r.reveal.distribution![mcKey.correctIndex!]).toBe(1);
  });

  it('speed bonus is linear in time left; streak bonus grows and resets', () => {
    const r = scoreQuestion(
      ctxFor(
        MC,
        [
          ['a', right, 0],
          ['b', right, 5000],
          ['c', right, 10_000],
        ],
        { speedBonus: true },
      ),
    );
    expect([r.results.a!.points, r.results.b!.points, r.results.c!.points]).toEqual([750, 625, 500]);
    expect(r.results.b!.speedBonus).toBe(125);
    const s = scoreQuestion(
      ctxFor(
        MC,
        [
          ['a', right, 10_000],
          ['b', wrong, 0],
        ],
        {
          streakBonus: true,
          streaks: new Map([
            ['a', 3],
            ['b', 5],
          ]),
        },
      ),
    );
    expect(s.results.a).toMatchObject({ points: 500 + 150, streakBonus: 150 });
    expect(s.streaks.get('a')).toBe(4);
    expect(s.streaks.get('b')).toBe(0);
    const capped = scoreQuestion(ctxFor(MC, [['a', right, 10_000]], { streakBonus: true, streaks: new Map([['a', 20]]) }));
    expect(capped.results.a!.streakBonus).toBe(250);
  });

  it('closest number wins; ties share full points; near guesses earn half', () => {
    const r = scoreQuestion(
      ctxFor(NUM, [
        ['a', { kind: 'number', value: 1965 }, 100],
        ['b', { kind: 'number', value: 1973 }, 50],
        ['c', { kind: 'number', value: 1800 }, 50],
      ]),
    );
    // 1965 is 4 away, 1973 is 4 away → both win.
    expect(r.results.a).toMatchObject({ correct: true, points: 500 });
    expect(r.results.b).toMatchObject({ correct: true, points: 500 });
    expect(r.results.c).toMatchObject({ correct: false, points: 250, partial: true }); // within 10% of 1969
    expect(r.reveal.closest).toMatchObject({ distance: 4 });
    expect(r.reveal.closest!.ids.sort()).toEqual(['a', 'b']);
    expect(r.reveal.correctNumber).toBe(1969);
    const far = scoreQuestion(
      ctxFor(NUM, [
        ['a', { kind: 'number', value: 1969 }, 0],
        ['b', { kind: 'number', value: 100 }, 0],
      ]),
    );
    expect(far.results.b!.points).toBe(0);
  });

  it('order partial credit = P × share / 2', () => {
    const { key } = present(ORDER, 's');
    const r0 = key.correctOrder!;
    const half = [r0[1]!, r0[0]!, r0[2]!, r0[3]!];
    const r = scoreQuestion(
      ctxFor(ORDER, [
        ['a', { kind: 'order', order: r0 }, 0],
        ['b', { kind: 'order', order: half }, 0],
      ]),
    );
    expect(r.results.a).toMatchObject({ correct: true, points: 500 });
    expect(r.results.b).toMatchObject({ correct: false, partial: true, points: 125 });
    expect(r.reveal.correctOrder).toEqual(r0);
  });

  it('final wager: correct +wager, wrong/no answer −wager, never below zero, no bonuses', () => {
    const p = present(MC, 's', { isFinal: true });
    const r = scoreQuestion({
      view: p.view,
      key: p.key,
      playerIds: ['a', 'b', 'c'],
      answers: [
        { playerId: 'a', input: right, elapsedMs: 0 },
        { playerId: 'b', input: wrong, elapsedMs: 0 },
      ],
      windowMs: 10_000,
      speedBonus: true,
      streakBonus: true,
      streaks: new Map([['a', 4]]),
      wagers: new Map([
        ['a', 800],
        ['b', 900],
        ['c', 300],
      ]),
      scores: new Map([
        ['a', 1000],
        ['b', 400],
        ['c', 1200],
      ]),
    });
    expect(r.results.a).toMatchObject({ correct: true, points: 800, speedBonus: 0, streakBonus: 0, wager: 800 });
    expect(r.results.b).toMatchObject({ points: -400, wager: 900 }); // floor at 0
    expect(r.results.c).toMatchObject({ answered: false, points: -300 });
  });

  it('maxWager = max(score, base points)', () => {
    expect(maxWager(1200, 500)).toBe(1200);
    expect(maxWager(0, 500)).toBe(500);
    expect(maxWager(-50, 250)).toBe(250);
  });

  it('typed answers are masked in the public answer text', () => {
    const r = scoreQuestion(ctxFor(TEXT, [['a', { kind: 'text', text: 'shit river' }, 0]]));
    expect(r.results.a!.answerText).toBe('s*** river');
  });
});

// ---------------------------------------------------------------------------
describe('custom packs', () => {
  it('validates with readable per-question errors', () => {
    const r = validatePack({ questions: [MC, { ...MC, options: ['x'] }, { type: 'zz', prompt: 'p' }] });
    expect(r.pack).toBeNull();
    expect(r.errors.some((e) => e.startsWith('Question 2 — options'))).toBe(true);
    expect(r.errors.some((e) => e.startsWith('Question 3'))).toBe(true);
    expect(validatePack({ questions: [] }).errors[0]).toMatch(/no questions/);
  });

  it('accepts a bare array, sanitizes text and masks profanity', () => {
    const r = validatePack([{ ...TF, prompt: 'Is this​ a shit question?\u0007' }]);
    expect(r.errors).toEqual([]);
    expect(r.pack!.questions[0]!.prompt).toBe('Is this a s*** question?');
    expect(r.pack!.title).toBe('Custom pack');
    expect('id' in r.pack!.questions[0]!).toBe(false);
  });

  it('rejects fields that sanitation empties or makes identical (server-side too)', () => {
    // Invisible characters survive zod's trim() but not cleanText().
    const blankPrompt = validatePack([{ ...TF, prompt: '​‍' }]);
    expect(blankPrompt.pack).toBeNull();
    expect(blankPrompt.errors[0]).toMatch(/^Question 1 — prompt/);
    const twins = validatePack([{ ...MC, options: ['Paris', 'Paris​', 'Rome'], correct: 0 }]);
    expect(twins.pack).toBeNull();
    expect(twins.errors[0]).toMatch(/options must be different/);
    const blankAccept = validatePack([{ type: 'text', category: 'custom', difficulty: 'easy', prompt: 'Name it', accept: ['⁠'] }]);
    expect(blankAccept.pack).toBeNull();
    const blankOrderItem = validatePack([
      { type: 'order', category: 'custom', difficulty: 'easy', prompt: 'Order', items: ['a', 'b', '﻿​'], ends: ['x', 'y'] },
    ]);
    expect(blankOrderItem.pack).toBeNull();
  });

  it('parsePackJson: invalid JSON, size limit, round trip through export', () => {
    expect(parsePackJson('{nope').errors[0]).toMatch(/valid JSON/);
    expect(parsePackJson('x'.repeat(300_000)).errors[0]).toMatch(/too big/);
    const first = validatePack({ title: 'Office', questions: STARTER }).pack!;
    const again = parsePackJson(packToJson(first));
    expect(again.errors).toEqual([]);
    expect(again.pack!.questions).toEqual(first.questions);
    expect(again.pack!.title).toBe('Office');
  });

  it('parseCsv handles quotes, commas, doubled quotes and newlines', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n"multi\nline",x,\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['multi\nline', 'x', ''],
    ]);
  });

  it('parsePackCsv imports every question type from the example', () => {
    const r = parsePackCsv(PACK_CSV_EXAMPLE);
    expect(r.errors).toEqual([]);
    const qs = r.pack!.questions;
    expect(qs.map((q) => q.type)).toEqual(['mc', 'tf', 'text', 'number', 'order']);
    const mc = qs[0]!;
    expect(mc.type === 'mc' && mc.options[mc.correct]).toBe('Third');
    expect(qs[3]).toMatchObject({ correct: 42, unit: 'steps' });
    expect(qs[4]).toMatchObject({ items: ['Alpha', 'Beta', 'Gamma'], ends: ['Earliest', 'Latest'] });
  });

  it('parsePackCsv reports row-numbered problems', () => {
    const csv = 'type,prompt,answer,alt1\nmc,Only one option?,Yes,\nnumber,How many?,lots,\nbanana,What?,x,';
    const r = parsePackCsv(csv);
    expect(r.pack).toBeNull();
    expect(r.errors[0]).toMatch(/^Row 2 — multiple choice needs at least one wrong option/);
    expect(r.errors[1]).toMatch(/^Row 3 — "lots" is not a number/);
    expect(r.errors[2]).toMatch(/^Row 4 — type "banana"/);
    expect(parsePackCsv('prompt\nx').errors[0]).toMatch(/header row/);
  });
});

// Keep the AnswerKey type exercised for the compiler.
const _unused: AnswerKey | null = null;
void _unused;
