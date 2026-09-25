import { describe, expect, it } from 'vitest';
import { classifyGuess, closeThreshold } from './guess.ts';

describe('classifyGuess', () => {
  it('accepts exact answers regardless of case, accents, spacing and punctuation', () => {
    expect(classifyGuess('cat', 'cat')).toBe('correct');
    expect(classifyGuess('  CAT! ', 'cat')).toBe('correct');
    expect(classifyGuess('hotdog', 'hot dog')).toBe('correct');
    expect(classifyGuess('Hot-Dog', 'hot dog')).toBe('correct');
    expect(classifyGuess('cafe', 'café')).toBe('correct');
    expect(classifyGuess('tshirt', 't-shirt')).toBe('correct');
    expect(classifyGuess("rock n roll", "rock'n'roll")).toBe('correct');
  });

  it('flags near misses (typos) as close, scaled by word length', () => {
    expect(classifyGuess('elefant', 'elephant')).toBe('close');
    expect(classifyGuess('pinapple', 'pineapple')).toBe('close');
    expect(classifyGuess('pineaple', 'pineapple')).toBe('close');
    expect(classifyGuess('pengin', 'penguin')).toBe('close');
    expect(classifyGuess('cats', 'cat')).toBe('close'); // contains the answer
    expect(classifyGuess('bat', 'cat')).toBe('wrong'); // too short for fuzzy matching
    expect(classifyGuess('dog', 'cat')).toBe('wrong');
    expect(classifyGuess('penny', 'penguin')).toBe('wrong');
  });

  it('never lets a guess that contains the answer through as a normal chat line', () => {
    expect(classifyGuess('is it a cat?', 'cat')).toBe('close');
    expect(classifyGuess('bigpizzaslice', 'pizza')).toBe('close');
  });

  it('treats one word of a multi-word answer as close', () => {
    expect(classifyGuess('cream', 'ice cream')).toBe('close');
    expect(classifyGuess('the ice', 'ice cream')).toBe('close');
    expect(classifyGuess('dessert', 'ice cream')).toBe('wrong');
  });

  it('never lets a short (two-letter) answer through inside a longer message', () => {
    expect(classifyGuess('a tv', 'tv')).toBe('close');
    expect(classifyGuess('is it a TV?', 'tv')).toBe('close');
    expect(classifyGuess('ox', 'ox')).toBe('correct');
    expect(classifyGuess('box', 'ox')).toBe('wrong');
  });

  it('matches full-width and other compatibility forms (IME input) instead of leaking them publicly', () => {
    expect(classifyGuess('ｃａｔ', 'cat')).toBe('correct');
    expect(classifyGuess('ＰＩＺＺＡ', 'pizza')).toBe('correct');
    expect(classifyGuess('ｔｖ', 'tv')).toBe('correct');
    expect(classifyGuess('ｂｉｇ ｃａｔ', 'cat')).toBe('close');
    expect(classifyGuess('ﬁsh', 'fish')).toBe('correct');
  });

  it('handles empty and symbol-only guesses', () => {
    expect(classifyGuess('', 'cat')).toBe('wrong');
    expect(classifyGuess('???', 'cat')).toBe('wrong');
    expect(classifyGuess('cat', '')).toBe('wrong');
  });

  it('uses increasing typo tolerance for longer words', () => {
    expect(closeThreshold(3)).toBe(0);
    expect(closeThreshold(5)).toBe(1);
    expect(closeThreshold(8)).toBe(2);
    expect(classifyGuess('strawbery', 'strawberry')).toBe('close');
    expect(classifyGuess('strwbery', 'strawberry')).toBe('close');
    expect(classifyGuess('strwbry', 'strawberry')).toBe('wrong');
  });
});
