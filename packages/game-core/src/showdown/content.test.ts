import { describe, expect, it } from 'vitest';
import { createSeededRng, normalizeForCompare } from '@dascade/shared';
import {
  SHOWDOWN_EVENT_IDS,
  SHOWDOWN_EVENT_INFO,
  SHOWDOWN_LIMITS,
  SHOWDOWN_PACK_IDS,
  SHOWDOWN_PACK_INFO,
  ShowdownSettingsSchema,
  boardTotal,
  defaultShowdownSettings,
  eventTitle,
  resolveShowdownLook,
  roundToInput,
  teamName,
  validateShowContent,
  type ShowdownRoundInput,
} from '@dascade/shared/games/showdown';
import { SHOWDOWN_PACKS, pickRounds } from './packs.ts';
import { SHOWDOWN_EVENT_ROUNDS } from './events.ts';
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
      const input: ShowdownRoundInput = {
        prompt: round.prompt,
        answers: round.answers.map((a) => ({ text: a.text, points: a.points, aliases: a.aliases })),
      };
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
      {
        prompt: '  Name a\u0000 fruit  ',
        answers: [
          ...answers(['Banana', 20], ['  ', 50], ['Apple', 40], ['Kiwi', 20]),
          { text: 'Mango', points: 5, aliases: [' mangoes ', '', 'mangoes', 'a', 'b', 'c', 'd'] },
        ],
      },
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
    const many = Array.from({ length: SHOWDOWN_LIMITS.customRounds + 3 }, (_, i) => ({
      prompt: `Question number ${i}`,
      answers: answers(['A', 3], ['B', 2], ['C', 1]),
    }));
    const report = validateShowContent(many);
    expect(report.rounds).toHaveLength(SHOWDOWN_LIMITS.customRounds);
    expect(report.dropped).toBe(3);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]!.field).toBe('list');
  });
});

describe('validateShowContent: Presenter Showcase rounds', () => {
  const ranked = (n: number, extra: Partial<ShowdownRoundInput> = {}): ShowdownRoundInput => ({
    prompt: 'Name the Top 10 Halloween Songs.',
    answers: Array.from({ length: n }, (_, i) => ({ text: `Song ${i + 1}`, points: 0 })),
    ...extra,
  });

  it('keeps a ranked list (every answer at 0 points) in the order given', () => {
    const input = ranked(10);
    input.answers.reverse();
    const r = validateShowContent([input]).rounds[0]!;
    expect(r.ranked).toBe(true);
    expect(r.answers.map((a) => a.text)[0]).toBe('Song 10');
    expect(r.answers.every((a) => a.points === 0)).toBe(true);
  });

  it('refuses a mix of points and blanks, with a hint', () => {
    const input = ranked(4);
    input.answers[1]!.points = 20;
    const report = validateShowContent([input]);
    expect(report.rounds).toHaveLength(0);
    expect(report.issues[0]).toMatchObject({ field: 'answers', message: expect.stringContaining('leave every answer at 0') });
  });

  it('cleans the category, attribution and notes, and stores the special answer as a slot', () => {
    const r = validateShowContent([
      ranked(10, {
        title: '  Halloween\u0000 Songs ',
        source: ' DAS-O-Ween   Host Picks ',
        special: 5,
        answers: Array.from({ length: 10 }, (_, i) => ({
          text: `Song ${i + 1}`,
          points: 0,
          note: i === 0 ? '  Michael\u200b Jackson ' : '',
        })),
      }),
    ]).rounds[0]!;
    expect(r).toMatchObject({ title: 'Halloween Songs', source: 'DAS-O-Ween Host Picks', special: 4 });
    expect(r.answers[0]!.note).toBe('Michael Jackson');
    expect('note' in r.answers[1]!).toBe(false);
    expect(validateShowContent([ranked(10, { title: '   ', source: '!!!' })]).rounds[0]).not.toHaveProperty('title');
  });

  it('a special answer must be on the board', () => {
    const report = validateShowContent([ranked(4, { special: 5 }), ranked(5, { special: 5 }), ranked(5, { special: 0 })]);
    expect(report.issues).toEqual([{ index: 0, field: 'special', message: expect.stringContaining('#5') }]);
    expect(report.rounds[0]!.special).toBe(4);
    expect(report.rounds[1]).not.toHaveProperty('special');
  });

  it('roundToInput turns a stored round back into the same input', () => {
    const rounds = validateShowContent([
      ranked(10, { title: 'Songs', source: 'Host Picks', special: 5 }),
      {
        prompt: 'Name a pizza topping',
        answers: [
          { text: 'Cheese', points: 50, aliases: ['mozzarella'] },
          { text: 'Ham', points: 30 },
          { text: 'Corn', points: 20, note: 'Really' },
        ],
      },
    ]).rounds;
    const again = validateShowContent(rounds.map(roundToInput)).rounds;
    expect(again).toEqual(rounds);
  });

  it('long titles fit (up to the answer limit)', () => {
    const long = 'It’s the Great Pumpkin, Charlie Brown: The Movie!';
    const r = validateShowContent([
      {
        prompt: 'Name a Halloween classic',
        answers: [
          { text: long, points: 0 },
          { text: 'B', points: 0 },
          { text: 'C', points: 0 },
        ],
      },
    ]).rounds[0]!;
    expect(r.answers[0]!.text).toBe(long.slice(0, SHOWDOWN_LIMITS.answerMax));
  });
});

describe('event presets', () => {
  it('match their metadata, and their settings are valid', () => {
    for (const id of SHOWDOWN_EVENT_IDS) {
      const info = SHOWDOWN_EVENT_INFO[id];
      const report = validateShowContent(SHOWDOWN_EVENT_ROUNDS[id]);
      expect(report.issues).toEqual([]);
      // A settings-only preset brings no rounds: its boards come from the presenter's show file.
      expect(report.rounds).toHaveLength(info.settingsOnly ? 0 : info.rounds);
      expect(ShowdownSettingsSchema.safeParse({ ...defaultShowdownSettings(new Date(2026, 10, 2)), ...info.settings }).success).toBe(true);
      expect(info.settings.mode).toBe('showcase');
      expect(info.event).toBe(true);
    }
  });

  it('ADM-01: no real show content in the repo — every preset but the practice boards is settings only', () => {
    for (const id of SHOWDOWN_EVENT_IDS) {
      const info = SHOWDOWN_EVENT_INFO[id];
      if (info.rehearsal) continue;
      expect(info.settingsOnly, id).toBe(true);
      expect(SHOWDOWN_EVENT_ROUNDS[id], id).toEqual([]);
    }
    expect(SHOWDOWN_EVENT_INFO['dasoween-2026'].settings).toMatchObject({
      mode: 'showcase',
      look: 'halloween',
      title: 'DAS-O-Ween Trivia',
      minutes: 10,
    });
  });

  it('the rehearsal: two ranked practice boards, #5 special, attributed as host picks (not a poll)', () => {
    const rounds = validateShowContent(SHOWDOWN_EVENT_ROUNDS['dasoween-rehearsal']).rounds;
    expect(rounds).toHaveLength(2);
    for (const r of rounds) {
      expect(r.answers).toHaveLength(10);
      expect(r.ranked).toBe(true);
      expect(r.special).toBe(4);
      expect(r.source).toBeTruthy();
    }
    expect(SHOWDOWN_EVENT_INFO['dasoween-rehearsal'].rehearsal).toBe(true);
    expect(SHOWDOWN_EVENT_INFO['dasoween-rehearsal'].settingsOnly).toBe(false);
  });

  it('every answer and alias is matched back to its own slot', () => {
    for (const id of SHOWDOWN_EVENT_IDS) {
      for (const round of validateShowContent(SHOWDOWN_EVENT_ROUNDS[id]).rounds) {
        round.answers.forEach((a, slot) => {
          expect(matchSlot(round, a.text)).toBe(slot);
          for (const alias of a.aliases) expect(matchSlot(round, alias), `${round.prompt}: ${alias}`).toBe(slot);
        });
      }
    }
  });
});

describe('settings', () => {
  it('defaults are valid, seasonal in October', () => {
    expect(ShowdownSettingsSchema.safeParse(defaultShowdownSettings(new Date(2026, 9, 14))).success).toBe(true);
    // New rooms are Team Showdown, as before; the showcase clock defaults to 10 minutes.
    expect(defaultShowdownSettings(new Date(2026, 9, 14))).toMatchObject({ mode: 'classic', minutes: 10, stageClock: true, eventName: '' });
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
    expect(ShowdownSettingsSchema.safeParse({ ...base, mode: 'quiz' }).success).toBe(false);
    expect(ShowdownSettingsSchema.safeParse({ ...base, minutes: 31 }).success).toBe(false);
    const ev = ShowdownSettingsSchema.parse({ ...base, eventName: '  Remoties\u0000  Happy Hour ' });
    expect(eventTitle(ev)).toBe('Remoties Happy Hour');
    expect(eventTitle({ ...ev, eventName: '' })).toBe('DAS Survey Showdown');
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
