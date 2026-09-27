import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import {
  SURVEY_LIMITS,
  SURVEY_PACK_IDS,
  SURVEY_QUESTION_MODES,
  validateCustomSurvey,
  type SurveyQuestion,
} from '@dascade/shared/games/survey';
import { QuestionDeck, plannedCount, poolFor } from './deck.ts';
import { ALL_SURVEY_QUESTIONS, SURVEY_PACKS } from './packs.ts';

const allPacks = [...SURVEY_PACK_IDS];

describe('survey packs', () => {
  it('ships plenty of questions of every kind', () => {
    const byMode = (mode: string) => ALL_SURVEY_QUESTIONS.filter((q) => q.mode === mode).length;
    expect(byMode('majority')).toBeGreaterThanOrEqual(60);
    expect(byMode('rank')).toBeGreaterThanOrEqual(40);
    expect(byMode('percent')).toBeGreaterThanOrEqual(60);
  });

  it('gives every pack questions of every kind', () => {
    for (const pack of SURVEY_PACK_IDS) {
      for (const mode of SURVEY_QUESTION_MODES) expect(poolFor([pack], mode).length, `${pack}/${mode}`).toBeGreaterThanOrEqual(6);
    }
  });

  it('uses unique ids that match their pack and kind', () => {
    const seen = new Set<string>();
    for (const [pack, list] of Object.entries(SURVEY_PACKS)) {
      for (const q of list) {
        expect(seen.has(q.id), q.id).toBe(false);
        seen.add(q.id);
        expect(q.pack).toBe(pack);
        expect(q.id.startsWith(`${pack}-${q.mode[0]}-`)).toBe(true);
      }
    }
  });

  it('passes the same validation as custom questions (lengths, option counts, unique options)', () => {
    for (const q of ALL_SURVEY_QUESTIONS) {
      const report = validateCustomSurvey([{ mode: q.mode, prompt: q.prompt, options: q.options, target: q.target }]);
      expect(report.issues, `${q.id}: ${JSON.stringify(report.issues)}`).toEqual([]);
      // Cleaning must not change built-in text (no stray whitespace or masked words).
      expect(report.questions[0]!.prompt).toBe(q.prompt);
      expect(report.questions[0]!.options).toEqual(q.options);
      if (q.mode === 'percent') expect(q.target).toBe(0);
      else expect(q.target).toBeUndefined();
    }
  });

  it('keeps prompts short enough for phones', () => {
    for (const q of ALL_SURVEY_QUESTIONS) {
      expect(q.prompt.length, q.id).toBeLessThanOrEqual(SURVEY_LIMITS.promptMax);
      for (const o of q.options) expect(o.length, `${q.id}: ${o}`).toBeLessThanOrEqual(32);
    }
  });
});

describe('QuestionDeck', () => {
  it('plans single-kind games from the selected packs only', () => {
    const deck = new QuestionDeck();
    const plan = deck.plan({ mode: 'rank', count: 6, packs: ['food', 'tech'], custom: [] }, createSeededRng(1));
    expect(plan).toHaveLength(6);
    for (const q of plan) {
      expect(q.mode).toBe('rank');
      expect(['food', 'tech']).toContain(q.pack);
    }
  });

  it('interleaves the three kinds in mixed mode without back-to-back repeats', () => {
    const deck = new QuestionDeck();
    const plan = deck.plan({ mode: 'mixed', count: 12, packs: allPacks, custom: [] }, createSeededRng('mix'));
    expect(plan).toHaveLength(12);
    for (let i = 1; i < plan.length; i++) expect(plan[i]!.mode).not.toBe(plan[i - 1]!.mode);
    const counts = SURVEY_QUESTION_MODES.map((m) => plan.filter((q) => q.mode === m).length);
    expect(counts).toEqual([4, 4, 4]);
  });

  it('never repeats a question within a game', () => {
    for (let seed = 0; seed < 20; seed++) {
      const deck = new QuestionDeck();
      const plan = deck.plan({ mode: 'mixed', count: 30, packs: allPacks, custom: [] }, createSeededRng(seed));
      expect(new Set(plan.map((q) => q.id)).size).toBe(plan.length);
    }
  });

  it('prefers questions the room has not seen yet', () => {
    const deck = new QuestionDeck();
    const rng = createSeededRng(3);
    const first = deck.plan({ mode: 'majority', count: 6, packs: ['office'], custom: [] }, rng);
    const second = deck.plan({ mode: 'majority', count: 6, packs: ['office'], custom: [] }, rng);
    const overlap = second.filter((q) => first.some((f) => f.id === q.id));
    expect(overlap).toHaveLength(0);
    // The pack has 12 majority questions; a third game recycles the oldest ones first.
    const third = deck.plan({ mode: 'majority', count: 3, packs: ['office'], custom: [] }, rng);
    for (const q of third) expect(first.map((f) => f.id)).toContain(q.id);
  });

  it('caps the plan at the pool size', () => {
    const deck = new QuestionDeck();
    const plan = deck.plan({ mode: 'rank', count: 30, packs: ['travel'], custom: [] }, createSeededRng(4));
    expect(plan).toHaveLength(poolFor(['travel'], 'rank').length);
    expect(plannedCount({ mode: 'rank', count: 30, packs: ['travel'], custom: [] })).toBe(plan.length);
  });

  it('plays custom surveys in the order written', () => {
    const custom: SurveyQuestion[] = validateCustomSurvey([
      { mode: 'percent', prompt: 'Do you like Mondays?', options: ['Yes', 'No'] },
      { mode: 'majority', prompt: 'Best snack?', options: ['Crisps', 'Fruit'] },
    ]).questions;
    const deck = new QuestionDeck();
    const plan = deck.plan({ mode: 'custom', count: 3, packs: [], custom }, createSeededRng(5));
    expect(plan.map((q) => q.prompt)).toEqual(['Do you like Mondays?', 'Best snack?']);
    expect(plannedCount({ mode: 'custom', count: 3, packs: [], custom })).toBe(2);
    // Plans are copies: the room can't corrupt the stored survey.
    plan[0]!.options.push('Maybe');
    expect(custom[0]!.options).toEqual(['Yes', 'No']);
  });

  it('is deterministic for a seed', () => {
    const a = new QuestionDeck().plan({ mode: 'mixed', count: 10, packs: allPacks, custom: [] }, createSeededRng('same'));
    const b = new QuestionDeck().plan({ mode: 'mixed', count: 10, packs: allPacks, custom: [] }, createSeededRng('same'));
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id));
  });

  it('returns nothing without packs', () => {
    expect(new QuestionDeck().plan({ mode: 'mixed', count: 10, packs: [], custom: [] }, createSeededRng(1))).toEqual([]);
  });
});
