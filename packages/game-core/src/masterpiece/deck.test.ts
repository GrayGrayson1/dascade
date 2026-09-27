import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { MP_PROMPT_TYPES } from '@dascade/shared/games/masterpiece';
import { PromptDeck, deckThemes, fillPlayerToken } from './deck.ts';
import { PROMPT_PACK } from './prompts.ts';

describe('deckThemes', () => {
  it('lists enabled built-in themes plus House Specials when custom prompts exist', () => {
    expect(deckThemes({ types: ['advice', 'name'], custom: [], customOnly: false })).toEqual(['advice', 'name']);
    expect(deckThemes({ types: ['name', 'advice'], custom: ['Why?'], customOnly: false })).toEqual(['advice', 'name', 'custom']);
    expect(deckThemes({ types: ['advice'], custom: ['Why?'], customOnly: true })).toEqual(['custom']);
    expect(deckThemes({ types: ['advice'], custom: [], customOnly: true })).toEqual([]);
  });
});

describe('PromptDeck', () => {
  it('rotates through every theme before repeating, never twice in a row', () => {
    const deck = new PromptDeck({ types: [...MP_PROMPT_TYPES], custom: [], customOnly: false }, createSeededRng('themes'));
    const seen: string[] = [];
    for (let i = 0; i < MP_PROMPT_TYPES.length * 4; i++) seen.push(deck.nextTheme());
    for (let cycle = 0; cycle < 4; cycle++) {
      const slice = seen.slice(cycle * MP_PROMPT_TYPES.length, (cycle + 1) * MP_PROMPT_TYPES.length);
      expect(new Set(slice).size).toBe(MP_PROMPT_TYPES.length);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
  });

  it('keeps returning the only theme when just one is enabled', () => {
    const deck = new PromptDeck({ types: ['pitch'], custom: [], customOnly: false }, createSeededRng(1));
    expect([deck.nextTheme(), deck.nextTheme(), deck.nextTheme()]).toEqual(['pitch', 'pitch', 'pitch']);
  });

  it('falls back to every built-in theme when nothing is selected (never stalls)', () => {
    const deck = new PromptDeck({ types: [], custom: [], customOnly: false }, createSeededRng(2));
    expect(deck.availableThemes).toEqual([...MP_PROMPT_TYPES]);
  });

  it('never repeats a prompt until the theme is exhausted, then recycles', () => {
    const deck = new PromptDeck({ types: ['advice'], custom: [], customOnly: false }, createSeededRng('draws'));
    const total = PROMPT_PACK.advice.length;
    const ids: string[] = [];
    while (ids.length < total) ids.push(...deck.draw('advice', 8).map((p) => p.id));
    const firstCycle = ids.slice(0, total);
    expect(new Set(firstCycle).size).toBe(total);
    expect(deck.remainingOf('advice')).toBeLessThanOrEqual(total);
    const next = deck.draw('advice', 8);
    expect(next).toHaveLength(8);
    expect(new Set(next.map((p) => p.id)).size).toBe(8);
  });

  it('draws unique prompts within one draw even across a recycle boundary', () => {
    const deck = new PromptDeck({ types: ['name'], custom: [], customOnly: false }, createSeededRng('boundary'));
    const total = PROMPT_PACK.name.length;
    deck.draw('name', total - 3);
    const draw = deck.draw('name', 8);
    expect(new Set(draw.map((p) => p.id)).size).toBe(8);
  });

  it('repeats custom prompts only when the list is smaller than the draw', () => {
    const custom = ['Best snack?', 'Worst meeting?'];
    const deck = new PromptDeck({ types: [], custom, customOnly: true }, createSeededRng('tiny'));
    expect(deck.nextTheme()).toBe('custom');
    const draw = deck.draw('custom', 5);
    expect(draw).toHaveLength(5);
    expect(new Set(draw.slice(0, 2).map((p) => p.text))).toEqual(new Set(custom));
    for (const p of draw) {
      expect(p.type).toBe('custom');
      expect(custom).toContain(p.text);
    }
  });

  it('refuses themes that are not in the deck', () => {
    const deck = new PromptDeck({ types: ['advice'], custom: [], customOnly: false }, createSeededRng(3));
    expect(() => deck.draw('custom', 1)).toThrow(RangeError);
  });

  it('is deterministic for a seed and varies across seeds', () => {
    const run = (seed: string) => {
      const deck = new PromptDeck({ types: [...MP_PROMPT_TYPES], custom: [], customOnly: false }, createSeededRng(seed));
      const theme = deck.nextTheme();
      return `${theme}:${deck.draw(theme, 4).map((p) => p.id).join(',')}`;
    };
    expect(run('a')).toBe(run('a'));
    const variants = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(run));
    expect(variants.size).toBeGreaterThan(3);
  });
});

describe('fillPlayerToken', () => {
  it('replaces every token with one chosen name', () => {
    const rng = createSeededRng('names');
    const out = fillPlayerToken('{player} met {player}.', ['Ana', 'Bo'], rng);
    expect(out === 'Ana met Ana.' || out === 'Bo met Bo.').toBe(true);
  });

  it('leaves prompts without a token untouched and has a fallback name', () => {
    const rng = createSeededRng('x');
    expect(fillPlayerToken('Explain rain.', ['Ana'], rng)).toBe('Explain rain.');
    expect(fillPlayerToken('Hello {player}', [], rng)).toBe('Hello Someone');
  });
});
