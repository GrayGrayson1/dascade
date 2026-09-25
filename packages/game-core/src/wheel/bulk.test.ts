import { describe, expect, it } from 'vitest';
import { WHEEL_LIMITS } from '@dascade/shared/games/wheel';
import { formatBulkLine, isIconToken, parseBulkSegments, parseColorToken, parseWeightToken, splitLeadingIcon } from './index.ts';

describe('tokens', () => {
  it('parses weights in friendly formats', () => {
    expect(parseWeightToken('3')).toBe(3);
    expect(parseWeightToken(' x3 ')).toBe(3);
    expect(parseWeightToken('3x')).toBe(3);
    expect(parseWeightToken('×2.5')).toBe(2.5);
    expect(parseWeightToken('25%')).toBe(25);
    expect(parseWeightToken('.5')).toBe(0.5);
    expect(parseWeightToken('0')).toBe(0);
    expect(parseWeightToken('99999')).toBe(WHEEL_LIMITS.weightMax);
    expect(parseWeightToken('-2')).toBeUndefined();
    expect(parseWeightToken('three')).toBeUndefined();
    expect(parseWeightToken('3 apples')).toBeUndefined();
  });

  it('parses hex colors', () => {
    expect(parseColorToken('#FF0000')).toBe('#ff0000');
    expect(parseColorToken('#f0a')).toBe('#ff00aa');
    expect(parseColorToken('ff0000')).toBeUndefined();
    expect(parseColorToken('#ggg')).toBeUndefined();
  });

  it('recognizes icon tokens and leading icons', () => {
    expect(isIconToken('🍕')).toBe(true);
    expect(isIconToken('👩‍💻')).toBe(true);
    expect(isIconToken('🍕🍕🍕')).toBe(false);
    expect(isIconToken('A')).toBe(false);
    expect(isIconToken('🍕 pie')).toBe(false);
    expect(splitLeadingIcon('🍕 Pizza night')).toEqual({ emoji: '🍕', label: 'Pizza night' });
    expect(splitLeadingIcon('Pizza 🍕')).toEqual({ emoji: '', label: 'Pizza 🍕' });
    expect(splitLeadingIcon('🍕')).toEqual({ emoji: '', label: '🍕' });
  });
});

describe('parseBulkSegments', () => {
  it('reads one option per line, skipping blanks and trimming', () => {
    expect(parseBulkSegments('  Alpha \n\n Bravo\r\nCharlie\n   \n')).toEqual([
      { label: 'Alpha', emoji: '' },
      { label: 'Bravo', emoji: '' },
      { label: 'Charlie', emoji: '' },
    ]);
  });

  it('parses CSV-like extras: label, weight, color, icon in any order', () => {
    const out = parseBulkSegments('Pizza, 3, #ff0000\nTacos;#0f0;x2;🌮\nSushi\t🍣\t5');
    expect(out).toEqual([
      { label: 'Pizza', emoji: '', weight: 3, color: '#ff0000' },
      { label: 'Tacos', emoji: '🌮', weight: 2, color: '#00ff00' },
      { label: 'Sushi', emoji: '🍣', weight: 5 },
    ]);
  });

  it('keeps commas that are part of the label', () => {
    const out = parseBulkSegments('Salt, pepper\n"Fish, chips", 4\nPlain');
    expect(out[0]).toEqual({ label: 'Salt, pepper', emoji: '' });
    expect(out[1]).toEqual({ label: 'Fish, chips', emoji: '', weight: 4 });
  });

  it('splits a single comma-separated line into several options', () => {
    expect(parseBulkSegments('Pizza, Tacos, Sushi').map((s) => s.label)).toEqual(['Pizza', 'Tacos', 'Sushi']);
    expect(parseBulkSegments('Pizza, 3, #ff0000')).toHaveLength(1);
  });

  it('splits a single line of plain numbers into options instead of reading them as weights', () => {
    // A dice / number wheel: "1, 2, 3, 4, 5, 6" used to become ONE option "1, 3, 4, 5, 6" with weight 2.
    expect(parseBulkSegments('1, 2, 3, 4, 5, 6').map((s) => s.label)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(parseBulkSegments('10;20; 30').map((s) => s.label)).toEqual(['10', '20', '30']);
    expect(parseBulkSegments('1, 2, 3').every((s) => s.weight === undefined)).toBe(true);
    // Still a record when it isn't all numbers, and multi-line CSV keeps "label, weight".
    expect(parseBulkSegments('Pizza, 3')).toEqual([{ label: 'Pizza', emoji: '', weight: 3 }]);
    expect(parseBulkSegments('7, 2, #ff0000')).toEqual([{ label: '7', emoji: '', weight: 2, color: '#ff0000' }]);
    expect(parseBulkSegments('1, 2\n3, 4')).toEqual([
      { label: '1', emoji: '', weight: 2 },
      { label: '3', emoji: '', weight: 4 },
    ]);
  });

  it('extracts leading emoji and icon-only entries', () => {
    expect(parseBulkSegments('🍕 Pizza\n🌮\n🎉 🎉')).toEqual([
      { label: 'Pizza', emoji: '🍕' },
      { label: '', emoji: '🌮' },
      { label: '', emoji: '🎉🎉' },
    ]);
  });

  it('skips a header row', () => {
    expect(parseBulkSegments('label,weight,color\nA,1,#ffffff').map((s) => s.label)).toEqual(['A']);
    expect(parseBulkSegments('Name, Weight\nB, 2')).toEqual([{ label: 'B', emoji: '', weight: 2 }]);
  });

  it('keeps duplicates, bounds huge labels and caps the item count', () => {
    expect(parseBulkSegments('Same\nSame\nsame')).toHaveLength(3);
    const huge = parseBulkSegments('Z'.repeat(5000));
    expect(Array.from(huge[0]!.label)).toHaveLength(WHEEL_LIMITS.label);
    const many = Array.from({ length: 400 }, (_, i) => `Item ${i}`).join('\n');
    expect(parseBulkSegments(many)).toHaveLength(WHEEL_LIMITS.segments);
    expect(parseBulkSegments(many, 5)).toHaveLength(5);
  });

  it('strips control characters and ignores junk input', () => {
    expect(parseBulkSegments('Bad\u0000Label‮')).toEqual([{ label: 'BadLabel', emoji: '' }]);
    expect(parseBulkSegments(undefined as unknown as string)).toEqual([]);
    expect(parseBulkSegments('\n , , \n')).toEqual([]);
  });

  it('round-trips through formatBulkLine', () => {
    const segments = [
      { label: 'Pizza', emoji: '🍕', weight: 3, color: '#ff0000' },
      { label: 'Fish, "chips"', emoji: '', weight: 0.5, color: '#00ff00' },
      { label: '', emoji: '🌮', weight: 1, color: '#0000ff' },
    ];
    const text = segments.map(formatBulkLine).join('\n');
    expect(parseBulkSegments(text)).toEqual(segments.map((s) => ({ label: s.label, emoji: s.emoji, weight: s.weight, color: s.color })));
  });
});
