import { describe, expect, it } from 'vitest';
import { TRIVIA_CATEGORY_IDS, TriviaQuestionSchema } from '@dascade/shared/games/trivia';
import { normalizeAnswer } from '../../party/index.ts';
import { STARTER_QUESTIONS } from './index.ts';

/** Minimum questions per category and overall (the brief asks for ~400 well-checked questions). */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const MIN_PER_CATEGORY = Number(env.TRIVIA_MIN_PER_CATEGORY ?? 40);
const MIN_TOTAL = Number(env.TRIVIA_MIN_TOTAL ?? 400);

describe('starter pack content', () => {
  it('every question passes the pack schema', () => {
    const failures: string[] = [];
    for (const q of STARTER_QUESTIONS) {
      const parsed = TriviaQuestionSchema.safeParse(q);
      if (!parsed.success) failures.push(`${q.id}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    }
    expect(failures).toEqual([]);
  });

  it('ids are unique, well-formed and prefixed with their category', () => {
    const seen = new Set<string>();
    const bad: string[] = [];
    for (const q of STARTER_QUESTIONS) {
      if (seen.has(q.id)) bad.push(`duplicate id ${q.id}`);
      seen.add(q.id);
      if (!q.id.startsWith(`${q.category}-`)) bad.push(`${q.id} is not prefixed with "${q.category}-"`);
    }
    expect(bad).toEqual([]);
  });

  it('prompts are unique (no duplicated questions)', () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const q of STARTER_QUESTIONS) {
      const key = normalizeAnswer(q.prompt);
      const prev = seen.get(key);
      if (prev) dupes.push(`${q.id} duplicates ${prev}`);
      seen.set(key, q.id);
    }
    expect(dupes).toEqual([]);
  });

  it('has enough questions in every category', () => {
    const counts = Object.fromEntries(TRIVIA_CATEGORY_IDS.map((c) => [c, STARTER_QUESTIONS.filter((q) => q.category === c).length]));
    for (const c of TRIVIA_CATEGORY_IDS) expect(counts[c], `category ${c}`).toBeGreaterThanOrEqual(MIN_PER_CATEGORY);
    expect(STARTER_QUESTIONS.length).toBeGreaterThanOrEqual(MIN_TOTAL);
  });

  it('covers every question type and difficulty', () => {
    for (const type of ['mc', 'tf', 'text', 'number', 'order'] as const) {
      expect(STARTER_QUESTIONS.filter((q) => q.type === type).length, type).toBeGreaterThanOrEqual(20);
    }
    for (const d of ['easy', 'medium', 'hard'] as const) {
      expect(STARTER_QUESTIONS.filter((q) => q.difficulty === d).length, d).toBeGreaterThanOrEqual(40);
    }
  });

  it('multiple choice questions have 3+ options, never "all/none of the above"', () => {
    const bad: string[] = [];
    for (const q of STARTER_QUESTIONS) {
      if (q.type !== 'mc') continue;
      if (q.options.length < 3) bad.push(`${q.id}: fewer than 3 options`);
      if (q.options.some((o) => /\b(all|none|both) of (the )?(above|these)\b/i.test(o))) bad.push(`${q.id}: uses all/none of the above`);
    }
    expect(bad).toEqual([]);
  });

  it('true/false prompts are statements (no "True or false:" prefix) and roughly balanced', () => {
    const tf = STARTER_QUESTIONS.filter((q) => q.type === 'tf');
    expect(tf.filter((q) => /^true or false/i.test(q.prompt)).map((q) => q.id)).toEqual([]);
    const trues = tf.filter((q) => q.type === 'tf' && q.correct).length;
    expect(trues / tf.length).toBeGreaterThan(0.3);
    expect(trues / tf.length).toBeLessThan(0.7);
  });

  it('typed answers normalize to non-empty, distinct keys', () => {
    const bad: string[] = [];
    for (const q of STARTER_QUESTIONS) {
      if (q.type !== 'text') continue;
      const keys = q.accept.map(normalizeAnswer);
      if (keys.some((k) => k.length === 0)) bad.push(`${q.id}: an accepted answer normalizes to nothing`);
    }
    expect(bad).toEqual([]);
  });

  it('numeric answers are finite and order questions have 4+ items', () => {
    for (const q of STARTER_QUESTIONS) {
      if (q.type === 'number') expect(Number.isFinite(q.correct), q.id).toBe(true);
      if (q.type === 'order') expect(q.items.length, q.id).toBeGreaterThanOrEqual(4);
    }
  });
});
