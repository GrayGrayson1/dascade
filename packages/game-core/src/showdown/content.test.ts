import { describe, expect, it } from 'vitest';
import { createSeededRng, normalizeForCompare } from '@dascade/shared';
import {
  SHOWDOWN_LIMITS,
  SHOWDOWN_PACK_IDS,
  SHOWDOWN_PACK_INFO,
  ShowdownSettingsSchema,
  boardTotal,
  defaultShowdownSettings,
  resolveShowdownLook,
  teamName,
  validateShowContent,
  type ShowdownRoundInput,
} from '@dascade/shared/games/showdown';
import { SHOWDOWN_PACKS, pickRounds } from './packs.ts';
import { matchSlot } from './guesses.ts';

describe('built-in packs', () => {
  const all = SHOWDOWN_PACK_IDS.flatMap((id) => SHOWDOWN_PACKS[id]);

  it('match their published metadata', () => {
    for (const id of SHOWDOWN_PACK_IDS) expect(SHOWDOWN_PACKS[id], id).toHaveLength(SHOWDOWN_PACK_INFO[id].rounds);
  });

  it('are valid boards: 3–10 distinct answers, most popular first, at most 100 points', () => {
    const ids = new Set<string>();
    for (const round of all) {
      expect(ids.has(round.id), round.id).toBe(false);
      ids.add(round.id);
      expect(round.answers.length, round.id).toBeGreaterThanOrEqual(SHOWDOWN_LIMITS.answersMin);
      expect(round.answers.length, round.id).toBeLessThanOrEqual(SHOWDOWN_LIMITS.answersMax);
      expect(boardTotal(round), round.id).toBeLessThanOrEqual(100);
      const points = round.answers.map((a) => a.points);
      expect(points, round.id).toEqual([...points].sort((a, b) => b - a));
      const keys = round.answers.map((a) => normalizeForCompare(a.text));
      expect(new Set(keys).size, round.id).toBe(keys.length);
      for (const a of round.answers) {
        expect(a.text.length, a.text).toBeLessThanOrEqual(SHOWDOWN_LIMITS.answerMax);
        expect(a.aliases.length, a.text).toBeLessThanOrEqual(SHOWDOWN_LIMITS.aliasesPerAnswer + 2);
      }
      expect(round.prompt.length).toBeLessThanOrEqual(SHOWDOWN_LIMITS.promptMax);
    }
  });

  it('survive the custom-content validator unchanged (same rules for everyone)', () => {
    for (const round of all) {
      const input: ShowdownRoundInput = { prompt: round.prompt, answers: round.answers.map((a) => ({ text: a.text, points: a.points, aliases: a.aliases })) };
      const report = validateShowContent([input]);
      expect(report.issues, round.id).toEqual([]);
      expect(report.rounds[0]!.answers.map((a) => a.text)).toEqual(round.answers.map((a) => a.text));
    }
  });

  it('every answer and alias is matched back to its own slot (no alias steals another answer)', () => {
    for (const round of all) {
      round.answers.forEach((a, i) => {
        expect(matchSlot(round, a.text), `${round.id}: ${a.text}`).toBe(i);
        for (const alias of a.aliases) expect(matchSlot(round, alias), `${round.id}: ${alias}`).toBe(i);
      });
    }
  });

  it('pickRounds draws unseen questions first, from the chosen packs only', () => {
    const rng = createSeededRng(7);
    const first = pickRounds(['tech'], 5, rng);
    expect(first).toHaveLength(5);
    expect(first.every((r) => r.id.startsWith('tech-'))).toBe(true);
    const seen = new Set(first.map((r) => r.id));
    const second = pickRounds(['tech'], 5, rng, seen);
    expect(second.slice(0, 3).every((r) => !seen.has(r.id))).toBe(true); // 8 in the pack → 3 fresh, then repeats
    expect(pickRounds(['food'], 50, rng)).toHaveLength(SHOWDOWN_PACK_INFO.food.rounds);
    // Copies: changing a picked round never edits the bank.
    second[0]!.answers[0]!.text = 'mutated';
    expect(all.some((r) => r.answers.some((a) => a.text === 'mutated'))).toBe(false);
  });
});

describe('validateShowContent', () => {
  const answers = (...pairs: Array<[string, number]>) => pairs.map(([text, points]) => ({ text, points }));

  it('cleans text, drops blank answers and sorts by points', () => {
    const report = validateShowContent([
      { prompt: '  Name a\u0000 fruit  ', answers: [...answers(['Banana', 20], ['  ', 50], ['Apple', 40], ['Kiwi', 20]), { text: 'Mango', points: 5, aliases: [' mangoes ', '', 'mangoes', 'a', 'b', 'c', 'd'] }] },
    ]);
    expect(report.issues).toEqual([]);
    const r = report.rounds[0]!;
    expect(r.prompt).toBe('Name a fruit');
    expect(r.id).toBe('custom-1');
    expect(r.answers.map((a) => a.text)).toEqual(['Apple', 'Banana', 'Kiwi', 'Mango']);
    expect(r.answers[3]!.aliases).toEqual(['mangoes', 'a', 'b', 'c']);
  });

  it('reports and drops invalid rounds', () => {
    const report = validateShowContent([
      { prompt: 'Hi', answers: answers(['A', 1], ['B', 2], ['C', 3]) },
      { prompt: 'Name a colour', answers: answers(['Red', 10], ['Blue', 9]) },
      { prompt: 'Name a colour', answers: answers(...Array.from({ length: 11 }, (_, i) => [`C${i}`, 5] as [string, number])) },
      { prompt: 'Name a colour', answers: answers(['Red', 10], ['red', 9], ['Blue', 3]) },
      { prompt: 'Name a colour', answers: answers(['Red', 0], ['Green', 9], ['Blue', 3]) },
      { prompt: 'Name a colour', answers: answers(['Red', 101], ['Green', 9], ['Blue', 3]) },
      { prompt: '?????', answers: answers(['Red', 10], ['Green', 9], ['Blue', 3]) },
      { prompt: 'Name a colour', answers: answers(['Red', 10], ['Green', 9], ['Blue', 3]) },
    ]);
    expect(report.rounds).toHaveLength(1);
    expect(report.dropped).toBe(7);
    expect(report.issues.map((i) => [i.index, i.field])).toEqual([
      [0, 'prompt'],
      [1, 'answers'],
      [2, 'answers'],
      [3, 'answers'],
      [4, 'answers'],
      [5, 'answers'],
      [6, 'prompt'],
    ]);
  });

  it('keeps at most the custom round limit', () => {
    const many = Array.from({ length: SHOWDOWN_LIMITS.customRounds + 3 }, (_, i) => ({ prompt: `Question number ${i}`, answers: answers(['A', 3], ['B', 2], ['C', 1]) }));
    const report = validateShowContent(many);
    expect(report.rounds).toHaveLength(SHOWDOWN_LIMITS.customRounds);
    expect(report.dropped).toBe(3);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]!.field).toBe('list');
  });
});

describe('settings', () => {
  it('defaults are valid, seasonal in October', () => {
    expect(ShowdownSettingsSchema.safeParse(defaultShowdownSettings(new Date(2026, 9, 14))).success).toBe(true);
    expect(defaultShowdownSettings(new Date(2026, 9, 14)).packs).toEqual(['spooky']);
    expect(defaultShowdownSettings(new Date(2026, 10, 2)).packs).not.toContain('spooky');
  });

  it('cleans titles and team names, and rejects bad values', () => {
    const base = defaultShowdownSettings(new Date(2026, 0, 1));
    const parsed = ShowdownSettingsSchema.parse({ ...base, title: '  Big\u0000   Show ', teamNames: [' Ghouls ', 'x'.repeat(50)] });
    expect(parsed.title).toBe('Big Show');
    expect(parsed.teamNames).toEqual(['Ghouls', 'x'.repeat(22)]);
    expect(ShowdownSettingsSchema.safeParse({ ...base, packs: [] }).success).toBe(false);
    expect(ShowdownSettingsSchema.safeParse({ ...base, packs: ['office', 'office'] }).success).toBe(false);
    expect(ShowdownSettingsSchema.safeParse({ ...base, rounds: 9 }).success).toBe(false);
    expect(ShowdownSettingsSchema.safeParse({ ...base, look: 'disco' }).success).toBe(false);
    expect(teamName(parsed, 0)).toBe('Ghouls');
    expect(teamName({ teamNames: ['', ''] }, 1)).toBe('Team Sierra');
  });

  it('resolves the seasonal look from the date', () => {
    expect(resolveShowdownLook('auto', new Date(2026, 9, 31))).toBe('halloween');
    expect(resolveShowdownLook('auto', new Date(2026, 10, 1))).toBe('showtime');
    expect(resolveShowdownLook('auto', null)).toBe('showtime');
    expect(resolveShowdownLook('halloween', new Date(2026, 4, 1))).toBe('halloween');
    expect(resolveShowdownLook('showtime', new Date(2026, 9, 15))).toBe('showtime');
  });
});
