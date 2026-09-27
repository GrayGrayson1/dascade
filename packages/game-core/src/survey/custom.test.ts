import { describe, expect, it } from 'vitest';
import {
  SURVEY_LIMITS,
  SurveyCustomSchema,
  SurveySettingsSchema,
  DEFAULT_SURVEY_SETTINGS,
  validateCustomSurvey,
} from '@dascade/shared/games/survey';

describe('custom survey validation', () => {
  it('cleans and keeps a valid question of each kind', () => {
    const report = validateCustomSurvey([
      { mode: 'majority', prompt: '  Best   biscuit? ', options: [' Shortbread ', 'Ginger nut'] },
      { mode: 'rank', prompt: 'Rank the snacks', options: ['A', 'B', 'C'] },
      { mode: 'percent', prompt: 'Do you cycle to work?', options: ['Yes', 'No'], target: 1 },
    ]);
    expect(report.issues).toEqual([]);
    expect(report.dropped).toBe(0);
    expect(report.questions.map((q) => q.id)).toEqual(['custom-1', 'custom-2', 'custom-3']);
    expect(report.questions[0]).toMatchObject({ prompt: 'Best biscuit?', options: ['Shortbread', 'Ginger nut'], pack: 'custom' });
    expect(report.questions[0]!.target).toBeUndefined();
    expect(report.questions[2]!.target).toBe(1);
  });

  it('keeps the percent target on the chosen option when blank options are dropped', () => {
    const report = validateCustomSurvey([
      { mode: 'percent', prompt: 'Coffee or tea?', options: ['Coffee', '  ', 'Tea'], target: 2 },
      { mode: 'percent', prompt: 'Tabs or spaces?', options: ['Tabs', '\u200B', 'Spaces'], target: 1 },
    ]);
    expect(report.questions[0]).toMatchObject({ options: ['Coffee', 'Tea'], target: 1 });
    // A target on a blank option is reported, never moved to a different option.
    expect(report.questions).toHaveLength(1);
    expect(report.issues).toEqual([{ index: 1, field: 'target', message: expect.stringMatching(/Pick which option/) }]);
  });

  it('defaults the percent target to the first option', () => {
    const report = validateCustomSurvey([{ mode: 'percent', prompt: 'Do you like tea?', options: ['Yes', 'No'] }]);
    expect(report.questions[0]!.target).toBe(0);
  });

  it('rejects empty or symbol-only prompts', () => {
    const report = validateCustomSurvey([
      { mode: 'majority', prompt: '  ', options: ['A', 'B'] },
      { mode: 'majority', prompt: '???', options: ['A', 'B'] },
    ]);
    expect(report.questions).toEqual([]);
    expect(report.issues.map((i) => i.field)).toEqual(['prompt', 'prompt']);
    expect(report.dropped).toBe(2);
  });

  it('enforces option counts per kind', () => {
    const report = validateCustomSurvey([
      { mode: 'majority', prompt: 'One option?', options: ['Only'] },
      { mode: 'majority', prompt: 'Five options?', options: ['A', 'B', 'C', 'D', 'E'] },
      { mode: 'rank', prompt: 'Two options?', options: ['A', 'B'] },
      { mode: 'rank', prompt: 'Five options?', options: ['A', 'B', 'C', 'D', 'E'] },
    ]);
    expect(report.questions.map((q) => q.prompt)).toEqual(['Five options?']);
    expect(report.questions[0]!.mode).toBe('rank');
    expect(report.issues.map((i) => i.index)).toEqual([0, 1, 2]);
    expect(report.issues.every((i) => i.field === 'options')).toBe(true);
  });

  it('ignores blank options before counting', () => {
    const report = validateCustomSurvey([{ mode: 'majority', prompt: 'Tea?', options: ['Yes', '   ', 'No', ''] }]);
    expect(report.questions[0]!.options).toEqual(['Yes', 'No']);
  });

  it('rejects duplicate options case- and accent-insensitively', () => {
    const report = validateCustomSurvey([{ mode: 'majority', prompt: 'Which café?', options: ['Café', 'cafe'] }]);
    expect(report.questions).toEqual([]);
    expect(report.issues[0]).toMatchObject({ field: 'options', message: 'Each option must be different.' });
  });

  it('rejects a percent target outside the options', () => {
    const report = validateCustomSurvey([{ mode: 'percent', prompt: 'Tea?', options: ['Yes', 'No'], target: 2 }]);
    expect(report.issues[0]!.field).toBe('target');
  });

  it('strips control and invisible characters and bounds lengths', () => {
    const long = 'x'.repeat(300);
    const report = validateCustomSurvey([{ mode: 'majority', prompt: `Hi\u0000\u200Bthere ${long}`, options: [`A\u202E${long}`, 'B'] }]);
    const q = report.questions[0]!;
    expect(q.prompt.startsWith('Hithere')).toBe(true);
    expect(q.prompt.length).toBeLessThanOrEqual(SURVEY_LIMITS.promptMax);
    expect(q.options[0]!.length).toBeLessThanOrEqual(SURVEY_LIMITS.optionMax);
    expect(q.options[0]).not.toContain('\u202E');
  });

  it('masks profanity', () => {
    const report = validateCustomSurvey([{ mode: 'majority', prompt: 'What the shit?', options: ['bullshit', 'Fine'] }]);
    expect(report.questions[0]!.prompt).not.toMatch(/shit/i);
    expect(report.questions[0]!.options[0]).not.toMatch(/shit/i);
  });

  it('keeps only the first 30 valid questions and reports the overflow once', () => {
    const input = Array.from({ length: 34 }, (_, i) => ({ mode: 'majority' as const, prompt: `Question ${i + 1}?`, options: ['A', 'B'] }));
    const report = validateCustomSurvey(input);
    expect(report.questions).toHaveLength(SURVEY_LIMITS.customQuestions);
    expect(report.dropped).toBe(4);
    expect(report.issues.filter((i) => i.field === 'list')).toHaveLength(1);
  });

  it('bounds the raw payload with Zod', () => {
    expect(SurveyCustomSchema.safeParse({ questions: [{ mode: 'majority', prompt: 'x'.repeat(401), options: ['A', 'B'] }] }).success).toBe(
      false,
    );
    expect(SurveyCustomSchema.safeParse({ questions: [{ mode: 'nope', prompt: 'Hi', options: ['A', 'B'] }] }).success).toBe(false);
    expect(
      SurveyCustomSchema.safeParse({ questions: Array.from({ length: 61 }, () => ({ mode: 'rank', prompt: 'Hi', options: [] })) }).success,
    ).toBe(false);
    expect(SurveyCustomSchema.safeParse({ questions: [{ mode: 'rank', prompt: 'Hi', options: Array(9).fill('a') }] }).success).toBe(false);
  });
});

describe('survey settings', () => {
  it('accepts the defaults', () => {
    expect(SurveySettingsSchema.safeParse(DEFAULT_SURVEY_SETTINGS).success).toBe(true);
  });
  it('bounds every field', () => {
    const bad = [
      { questions: 2 },
      { questions: 31 },
      { answerSeconds: 5 },
      { predictSeconds: 91 },
      { revealSeconds: 3 },
      { mode: 'party' },
      { packs: ['office', 'office'] },
      { packs: ['moon'] },
    ];
    for (const patch of bad)
      expect(SurveySettingsSchema.safeParse({ ...DEFAULT_SURVEY_SETTINGS, ...patch }).success, JSON.stringify(patch)).toBe(false);
  });
});
