import { describe, expect, it } from 'vitest';
import { containsProfanity, normalizeForCompare } from '@dascade/shared';
import { MP_PLAYER_TOKEN, MP_PROMPT_TYPES, MP_PROMPT_TYPE_INFO } from '@dascade/shared/games/masterpiece';
import { PROMPT_PACK, SAFETY_ANSWERS, builtInPromptCount } from './prompts.ts';

describe('built-in prompt pack', () => {
  it('ships plenty of prompts for every round theme', () => {
    for (const type of MP_PROMPT_TYPES) expect(PROMPT_PACK[type].length, type).toBeGreaterThanOrEqual(40);
    expect(builtInPromptCount(MP_PROMPT_TYPES)).toBeGreaterThanOrEqual(360);
    expect(builtInPromptCount(['advice'])).toBe(PROMPT_PACK.advice.length);
  });

  it('has no duplicate prompts anywhere', () => {
    const seen = new Map<string, string>();
    for (const type of MP_PROMPT_TYPES) {
      for (const text of PROMPT_PACK[type]) {
        const key = normalizeForCompare(text);
        expect(seen.has(key), `duplicate: ${text} (${seen.get(key)})`).toBe(false);
        seen.set(key, type);
      }
    }
  });

  it('keeps prompts short, tidy and office-safe', () => {
    for (const type of MP_PROMPT_TYPES) {
      for (const text of PROMPT_PACK[type]) {
        expect(text.length, text).toBeLessThanOrEqual(130);
        expect(text, text).toBe(text.trim());
        expect(/\s{2,}/u.test(text), text).toBe(false);
        expect(containsProfanity(text), text).toBe(false);
        // Only the documented placeholder may use braces.
        expect(text.replaceAll(MP_PLAYER_TOKEN, '').includes('{') || text.replaceAll(MP_PLAYER_TOKEN, '').includes('}'), text).toBe(false);
      }
    }
  });

  it('formats each theme consistently', () => {
    for (const text of PROMPT_PACK.definition) expect(text, text).toMatch(/^[A-Z][a-z]+ \((noun|verb|adjective|exclamation)\)$/u);
    for (const text of PROMPT_PACK.advice) expect(text, text).toMatch(/^Terrible advice /u);
    for (const text of PROMPT_PACK.name) expect(text, text).toMatch(/^Name /u);
    for (const text of PROMPT_PACK.explain) expect(text, text).toMatch(/^Explain /u);
    for (const text of PROMPT_PACK.story) expect(text, text).toMatch(/two-line/u);
    for (const text of PROMPT_PACK.hypothetical) expect(text, text).toMatch(/\?$/u);
  });

  it('uses the player placeholder sparingly (a few per theme)', () => {
    for (const type of MP_PROMPT_TYPES) {
      const withName = PROMPT_PACK[type].filter((t) => t.includes(MP_PLAYER_TOKEN)).length;
      expect(withName, type).toBeLessThanOrEqual(4);
    }
  });

  it('has safety answers that fit every theme', () => {
    const shortest = Math.min(...MP_PROMPT_TYPES.map((t) => MP_PROMPT_TYPE_INFO[t].maxLength));
    expect(SAFETY_ANSWERS.length).toBeGreaterThanOrEqual(10);
    for (const s of SAFETY_ANSWERS) {
      expect(s.length).toBeLessThanOrEqual(shortest);
      expect(containsProfanity(s)).toBe(false);
    }
  });
});
