import { describe, expect, it } from 'vitest';
import { clampNumber, resolveNumberDraft } from './numberDraft.ts';

describe('resolveNumberDraft', () => {
  it('commits the whole typed number, not its first digit', () => {
    // Max players 2–16: typing "12" must commit 12 (the partial "1" is never committed on its own).
    expect(resolveNumberDraft('12', 2, 16)).toBe(12);
    expect(resolveNumberDraft(' 8 ', 2, 16)).toBe(8);
  });

  it('clamps out-of-range drafts into the allowed range', () => {
    expect(resolveNumberDraft('1', 2, 16)).toBe(2);
    expect(resolveNumberDraft('99', 2, 16)).toBe(16);
    expect(resolveNumberDraft('-5', 0)).toBe(0);
    expect(resolveNumberDraft('250000', undefined, 100_000)).toBe(100_000);
  });

  it('reverts (null) when the text is not a number', () => {
    for (const text of ['', '   ', '-', '1e', 'abc', 'NaN', 'Infinity']) expect(resolveNumberDraft(text, 0, 10)).toBeNull();
  });
});

describe('clampNumber', () => {
  it('handles open ranges', () => {
    expect(clampNumber(5)).toBe(5);
    expect(clampNumber(-3, 0)).toBe(0);
    expect(clampNumber(30, undefined, 20)).toBe(20);
  });
});
