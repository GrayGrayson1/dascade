import { describe, expect, it } from 'vitest';
import { roundToInput, validateShowContent, type ShowdownRoundDef } from '@dascade/shared/games/showdown';
import {
  blankRound,
  cleanShowSettings,
  describeShowFile,
  describeShowSettings,
  fromInput,
  move,
  parseShowFile,
  pickShowSettings,
  showFileData,
  showFileName,
  toInput,
} from './consoleDraft.ts';

const ranked: ShowdownRoundDef = {
  id: 'custom-1',
  prompt: 'Name the Top 10 Halloween Songs.',
  title: 'Halloween Songs',
  source: 'DAS-O-Ween Host Picks',
  special: 4,
  ranked: true,
  answers: Array.from({ length: 10 }, (_, i) => ({
    text: `Song ${i + 1}`,
    points: 0,
    aliases: i === 0 ? ['first song'] : [],
    ...(i === 2 ? { note: 'Artist, 1984' } : {}),
  })),
};

const scored: ShowdownRoundDef = {
  id: 'custom-2',
  prompt: 'Name something people bring to a team offsite.',
  answers: [
    { text: 'Laptop', points: 34, aliases: ['computer'] },
    { text: 'Snacks', points: 22, aliases: [] },
    { text: 'Notebook', points: 14, aliases: [] },
  ],
};

describe('round editor drafts', () => {
  it('round-trips a stored ranked round (title, source, special, notes, aliases, order)', () => {
    const draft = fromInput([roundToInput(ranked)]);
    expect(draft[0]!.ranked).toBe(true);
    expect(draft[0]!.special).toBe(5);
    expect(draft[0]!.title).toBe('Halloween Songs');
    expect(draft[0]!.answers[2]!.note).toBe('Artist, 1984');
    const report = validateShowContent(toInput(draft));
    expect(report.issues).toEqual([]);
    const back = report.rounds[0]!;
    expect(back.ranked).toBe(true);
    expect(back.special).toBe(4);
    expect(back.source).toBe('DAS-O-Ween Host Picks');
    expect(back.answers.map((a) => a.text)).toEqual(ranked.answers.map((a) => a.text));
    expect(back.answers[0]!.aliases).toEqual(['first song']);
    expect(back.answers[2]!.note).toBe('Artist, 1984');
  });

  it('round-trips a scored round and keeps its points', () => {
    const draft = fromInput([roundToInput(scored)]);
    expect(draft[0]!.ranked).toBe(false);
    const back = validateShowContent(toInput(draft)).rounds[0]!;
    expect(back.ranked).toBeUndefined();
    expect(back.answers.map((a) => a.points)).toEqual([34, 22, 14]);
  });

  it('a ranked list sends every answer with 0 points, in the order shown', () => {
    const draft = fromInput([roundToInput(scored)]);
    draft[0]!.ranked = true;
    draft[0]!.answers = move(draft[0]!.answers, 2, -1);
    const input = toInput(draft)[0]!;
    expect(input.answers.every((a) => a.points === 0)).toBe(true);
    const back = validateShowContent([input]).rounds[0]!;
    expect(back.ranked).toBe(true);
    expect(back.answers.map((a) => a.text)).toEqual(['Laptop', 'Notebook', 'Snacks']);
  });

  it('leaves blank answers and blank optional fields out', () => {
    const round = blankRound(true);
    round.prompt = 'Name a candy.';
    round.answers[0]!.text = 'Toffee';
    round.answers[1]!.text = '   ';
    const input = toInput([round])[0]!;
    expect(input.answers).toHaveLength(1);
    expect(input).not.toHaveProperty('title');
    expect(input).not.toHaveProperty('source');
    expect(input).not.toHaveProperty('special');
    expect(input.answers[0]).not.toHaveProperty('note');
  });

  it('move() swaps neighbours and ignores moves off the ends', () => {
    expect(move([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(move([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
    expect(move([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  });
});

describe('whole-show files', () => {
  it('reads a show file with settings and an older rounds-only preset', () => {
    const rounds = [roundToInput(ranked)];
    const file = parseShowFile({ rounds, settings: { mode: 'showcase', look: 'halloween', minutes: 10, title: 'DAS-O-Ween Trivia' } });
    expect(file?.rounds).toHaveLength(1);
    expect(file?.settings).toEqual({ mode: 'showcase', look: 'halloween', minutes: 10, title: 'DAS-O-Ween Trivia' });
    expect(parseShowFile(rounds)?.settings).toBeUndefined();
    expect(parseShowFile({ nope: true })).toBeNull();
  });

  it('drops settings that are invalid on their own', () => {
    expect(cleanShowSettings({ mode: 'party', minutes: 99, look: 'halloween', packs: ['spooky'] })).toEqual({ look: 'halloween' });
    expect(cleanShowSettings(null)).toBeUndefined();
  });

  it('saves only the show settings and describes them', () => {
    const picked = pickShowSettings({ mode: 'showcase', look: 'halloween', minutes: 10, source: 'packs', packs: ['spooky'], rounds: 4 });
    expect(picked).toEqual({ mode: 'showcase', look: 'halloween', minutes: 10 });
    expect(describeShowSettings(picked)).toBe('Presenter Showcase · Halloween Night · 10-min clock');
  });

  it('carries the display profile in a show file', () => {
    expect(pickShowSettings({ mode: 'showcase', display: 'stream' })).toEqual({ mode: 'showcase', display: 'stream' });
    expect(cleanShowSettings({ display: 'projector' })).toEqual({ display: 'projector' });
    expect(cleanShowSettings({ display: 'tv' })).toBeUndefined();
    expect(describeShowSettings({ mode: 'showcase', display: 'stream' })).toBe('Presenter Showcase · Stream-safe display');
  });
});

describe('the show file on disk (ADM-01)', () => {
  const rounds = [roundToInput(ranked), roundToInput(scored)];

  it('names the file after the show', () => {
    expect(showFileName('DAS-O-Ween Trivia')).toBe('das-o-ween-trivia-show.json');
    expect(showFileName('Ça va?!')).toBe('ca-va-show.json');
    expect(showFileName('')).toBe('showdown-show.json');
    expect(showFileName(null)).toBe('showdown-show.json');
  });

  it('confirms a load in words, never with an answer', () => {
    const words = describeShowFile({ rounds, settings: { mode: 'showcase' } });
    expect(words).toBe('2 rounds, 1 with a special answer, plus its settings');
    for (const r of rounds) for (const a of r.answers) expect(words).not.toContain(a.text);
    expect(describeShowFile({ rounds: [roundToInput(ranked)] })).toBe('1 round, with a special answer');
  });

  it('round-trips a saved file (its tag is ignored on the way back)', () => {
    const data = showFileData({ rounds, settings: { mode: 'showcase', look: 'halloween' } }, new Date('2026-10-29T18:00:00Z'));
    expect(data.kind).toBe('dascade-showdown-show');
    const back = parseShowFile(JSON.parse(JSON.stringify(data)));
    expect(back?.rounds).toHaveLength(2);
    expect(back?.settings).toEqual({ mode: 'showcase', look: 'halloween' });
  });
});
