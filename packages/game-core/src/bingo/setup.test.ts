import { describe, expect, it } from 'vitest';
import { BingoSettingsSchema, DEFAULT_BINGO_SETTINGS, sanitizeBingoItems, type BingoSettings } from '@dascade/shared/games/bingo';
import { buildPlan, parseItemsInput, roundsInPlay, setupProblems, summarizeItems } from './index.ts';

const settings = (patch: Partial<BingoSettings>): BingoSettings => ({ ...DEFAULT_BINGO_SETTINGS, ...patch });
const items = (n: number) => Array.from({ length: n }, (_, i) => `Item ${i + 1}`);

describe('bulk paste parsing', () => {
  it('splits newline-separated items and strips list bullets / numbering', () => {
    expect(parseItemsInput('Coffee spill\n- Reply all\n• Someone is on mute\n3. Can you see my screen?\r\n\n  ')).toEqual([
      'Coffee spill',
      'Reply all',
      'Someone is on mute',
      'Can you see my screen?',
    ]);
  });

  it('keeps commas inside phrases in line mode', () => {
    expect(parseItemsInput('Well, actually\nYes, and…', 'auto')).toEqual(['Well, actually', 'Yes, and…']);
    expect(parseItemsInput('Well, actually\nYes, and…', 'lines')).toEqual(['Well, actually', 'Yes, and…']);
  });

  it('splits a single delimited line as CSV (quotes respected)', () => {
    expect(parseItemsInput('apple, banana; cherry,"date, dried"')).toEqual(['apple', 'banana', 'cherry', 'date, dried']);
  });

  it('handles spreadsheet (tab-separated) and quoted CSV pastes', () => {
    expect(parseItemsInput('a\tb\tc\nd\te')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(parseItemsInput('"one, two","three"\n"four","five ""5"""')).toEqual(['one, two', 'three', 'four', 'five "5"']);
  });

  it('forced CSV mode splits every line', () => {
    expect(parseItemsInput('a,b\nc,d', 'csv')).toEqual(['a', 'b', 'c', 'd']);
    expect(parseItemsInput('a,b\nc,d', 'auto')).toEqual(['a,b', 'c,d']);
  });

  it('summarizes duplicates, truncation and overflow', () => {
    const long = 'x'.repeat(80);
    const summary = summarizeItems(`Cat\ncat\nCAT!\nDog\n${long}`);
    expect(summary.items).toEqual(['Cat', 'Dog', 'x'.repeat(60)]);
    expect(summary.duplicates).toBe(2);
    expect(summary.truncated).toBe(1);
    const many = summarizeItems(items(520).join('\n'));
    expect(many.items).toHaveLength(500);
    expect(many.overflow).toBe(20);
  });

  it('the settings schema cleans, bounds and dedupes items (idempotently)', () => {
    const parsed = BingoSettingsSchema.parse({ ...DEFAULT_BINGO_SETTINGS, items: ['  a  ', 'A', 'b\u0000', '', 'c'.repeat(90)] });
    expect(parsed.items).toEqual(['a', 'b', 'c'.repeat(60)]);
    expect(BingoSettingsSchema.parse(parsed).items).toEqual(parsed.items);
    expect(sanitizeBingoItems(['🎉', '🎉', 'Party 🎉'])).toEqual(['🎉', 'Party 🎉']);
  });

  it('the settings schema rejects out-of-range values', () => {
    expect(BingoSettingsSchema.safeParse({ ...DEFAULT_BINGO_SETTINGS, size: 9 }).success).toBe(false);
    expect(BingoSettingsSchema.safeParse({ ...DEFAULT_BINGO_SETTINGS, callSeconds: 1 }).success).toBe(false);
    expect(BingoSettingsSchema.safeParse({ ...DEFAULT_BINGO_SETTINGS, rounds: [] }).success).toBe(false);
    expect(BingoSettingsSchema.safeParse({ ...DEFAULT_BINGO_SETTINGS, tieWindowMs: 9000 }).success).toBe(false);
    expect(BingoSettingsSchema.safeParse(DEFAULT_BINGO_SETTINGS).success).toBe(true);
  });
});

describe('setup validation', () => {
  it('the defaults are ready to play', () => {
    expect(setupProblems(DEFAULT_BINGO_SETTINGS)).toEqual([]);
  });

  it('text mode needs enough distinct items for the board', () => {
    expect(setupProblems(settings({ mode: 'text', size: 5, items: items(23) }))[0]).toMatch(/Add 1 more item/);
    expect(setupProblems(settings({ mode: 'text', size: 5, items: items(24) }))).toEqual([]);
    expect(setupProblems(settings({ mode: 'text', size: 5, freeCenter: false, items: items(24) }))[0]).toMatch(/at least 25/);
    expect(setupProblems(settings({ mode: 'text', size: 4, items: items(16) }))).toEqual([]);
    expect(setupProblems(settings({ mode: 'text', size: 3, items: [] }))[0]).toMatch(/Add 8 more items/);
  });

  it('flags patterns that do not fit the board', () => {
    const problems = setupProblems(
      settings({
        mode: 'text',
        size: 4,
        items: items(16),
        rounds: [{ prize: '', patterns: [{ type: 'preset', id: 'diamond', rotate: false, mirror: false }] }],
      }),
    );
    expect(problems.join(' ')).toMatch(/Diamond/);
    const custom = setupProblems(
      settings({ rounds: [{ prize: '', patterns: [{ type: 'custom', name: 'Tiny', size: 3, mask: '111000000', rotate: false, mirror: false }] }] }),
    );
    expect(custom.join(' ')).toMatch(/3×3/);
  });

  it('flags patterns satisfied by the free square alone', () => {
    const centerOnly = '0'.repeat(12) + '1' + '0'.repeat(12);
    const problems = setupProblems(settings({ rounds: [{ prize: '', patterns: [{ type: 'custom', name: 'Dot', size: 5, mask: centerOnly, rotate: false, mirror: false }] }] }));
    expect(problems.join(' ')).toMatch(/free square/);
    expect(setupProblems(settings({ freeCenter: false, rounds: [{ prize: '', patterns: [{ type: 'custom', name: 'Dot', size: 5, mask: centerOnly, rotate: false, mirror: false }] }] }))).toEqual([]);
  });

  it('single format plays only the first round; progressive plays all', () => {
    const rounds = [
      { prize: 'Line', patterns: [{ type: 'preset' as const, id: 'any-line' as const, rotate: false, mirror: false }] },
      { prize: 'Corners', patterns: [{ type: 'preset' as const, id: 'four-corners' as const, rotate: false, mirror: false }] },
      { prize: 'Full house', patterns: [{ type: 'preset' as const, id: 'blackout' as const, rotate: false, mirror: false }] },
    ];
    expect(roundsInPlay(settings({ format: 'single', rounds }))).toHaveLength(1);
    expect(roundsInPlay(settings({ format: 'progressive', rounds }))).toHaveLength(3);
    // A broken later round only matters when it is actually played.
    const broken = [...rounds, { prize: '', patterns: [{ type: 'custom' as const, name: 'Bad', size: 3, mask: '111111111', rotate: false, mirror: false }] }];
    expect(setupProblems(settings({ format: 'single', rounds: broken }))).toEqual([]);
    expect(setupProblems(settings({ format: 'progressive', rounds: broken }))[0]).toMatch(/Round 4/);
  });
});

describe('published plan', () => {
  it('resolves every round into mask strings with titles and prizes', () => {
    const plan = buildPlan(
      settings({
        format: 'progressive',
        rounds: [
          { prize: 'Snack', patterns: [{ type: 'preset', id: 'any-line', rotate: false, mirror: false }] },
          { prize: '', patterns: [{ type: 'preset', id: 'letter-l', rotate: true, mirror: false }, { type: 'preset', id: 'x', rotate: false, mirror: false }] },
        ],
      }),
    );
    expect(plan).toHaveLength(2);
    expect(plan[0]!.prize).toBe('Snack');
    expect(plan[0]!.title).toBe('Any line');
    expect(plan[0]!.patterns[0]!.masks).toHaveLength(12);
    expect(plan[0]!.patterns[0]!.family).toBe(true);
    expect(plan[1]!.patterns[0]!.masks).toHaveLength(4);
    expect(plan[1]!.patterns[0]!.rotate).toBe(true);
    expect(plan[1]!.title).toBe('Letter L or Big X');
    for (const round of plan) for (const p of round.patterns) for (const m of p.masks) expect(m).toMatch(/^[01]{25}$/);
  });
});

describe('published plan size', () => {
  it('repeating a pattern in a round does not multiply the plan (a 7 KB settings object once built a 600 KB state string)', () => {
    const twoLines = { type: 'preset' as const, id: 'two-lines' as const, rotate: true, mirror: true };
    const settings = BingoSettingsSchema.parse({
      ...DEFAULT_BINGO_SETTINGS,
      mode: 'text',
      size: 7,
      items: Array.from({ length: 60 }, (_, i) => `Square ${i + 1}`),
      format: 'progressive',
      rounds: Array.from({ length: 8 }, () => ({ prize: 'x', patterns: Array.from({ length: 12 }, () => twoLines) })),
    });
    const plan = buildPlan(settings);
    expect(plan).toHaveLength(8);
    for (const round of plan) expect(round.patterns).toHaveLength(1);
    expect(JSON.stringify(plan).length).toBeLessThan(100_000);
    // The same custom mask drawn twice (even under another name) is one pattern too.
    const custom = (name: string) => ({ type: 'custom' as const, name, size: 7, mask: '1'.repeat(7) + '0'.repeat(42), rotate: false, mirror: false });
    const twice = buildPlan(BingoSettingsSchema.parse({ ...settings, format: 'single', rounds: [{ prize: '', patterns: [custom('Top'), custom('Top again')] }] }));
    expect(twice[0]!.patterns.map((p) => p.name)).toEqual(['Top']);
  });
});
