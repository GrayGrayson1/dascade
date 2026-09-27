import { describe, expect, it } from 'vitest';
import { MP_LIMITS, MP_PROMPT_TYPE_INFO, answerLength, cleanCustomPrompts, sanitizeAnswer, splitPromptList } from '@dascade/shared/games/masterpiece';

const ZWSP = String.fromCharCode(0x200b);
const RLO = String.fromCharCode(0x202e);

describe('sanitizeAnswer', () => {
  it('trims, collapses whitespace and strips invisible characters', () => {
    expect(sanitizeAnswer('  hello \t  world  ', 'finish')).toBe('hello world');
    expect(sanitizeAnswer(`a${ZWSP}b${RLO}c`, 'finish')).toBe('abc');
    expect(sanitizeAnswer('   ', 'finish')).toBe('');
    expect(sanitizeAnswer(`${ZWSP}${ZWSP}`, 'finish')).toBe('');
    expect(sanitizeAnswer(42 as unknown as string, 'finish')).toBe('');
  });

  it('bounds length per theme (code points, emoji-safe)', () => {
    const long = 'x'.repeat(500);
    expect(answerLength(sanitizeAnswer(long, 'name'))).toBe(MP_PROMPT_TYPE_INFO.name.maxLength);
    expect(answerLength(sanitizeAnswer(long, 'definition'))).toBe(MP_PROMPT_TYPE_INFO.definition.maxLength);
    const emoji = '🎨'.repeat(200);
    const cleaned = sanitizeAnswer(emoji, 'name');
    expect(Array.from(cleaned).every((c) => c === '🎨')).toBe(true);
    expect(answerLength(cleaned)).toBe(MP_PROMPT_TYPE_INFO.name.maxLength);
  });

  it('keeps single-line answers on one line', () => {
    expect(sanitizeAnswer('line one\nline two', 'advice')).toBe('line one line two');
  });

  it('lets two-line stories keep two non-empty lines', () => {
    expect(sanitizeAnswer('Once upon a time.\n\n\nThe end.\nExtra line', 'story')).toBe('Once upon a time.\nThe end.');
    expect(sanitizeAnswer('One\r\nTwo', 'story')).toBe('One\nTwo');
    expect(answerLength(sanitizeAnswer(`${'a'.repeat(150)}\n${'b'.repeat(150)}`, 'story'))).toBeLessThanOrEqual(MP_PROMPT_TYPE_INFO.story.maxLength);
  });

  it('masks profanity like the chat does', () => {
    expect(sanitizeAnswer('what the shit', 'finish')).toBe('what the s***');
  });

  it('never exceeds the global answer cap', () => {
    for (const type of Object.keys(MP_PROMPT_TYPE_INFO) as Array<keyof typeof MP_PROMPT_TYPE_INFO>) {
      expect(MP_PROMPT_TYPE_INFO[type].maxLength).toBeLessThanOrEqual(MP_LIMITS.answerMax);
    }
  });
});

describe('cleanCustomPrompts', () => {
  it('cleans, de-duplicates, filters and caps', () => {
    const report = cleanCustomPrompts(['  Best snack ever?  ', 'best SNACK ever', 'ok', '', 'What the shit?', 42, 'Name a team mascot.']);
    expect(report.prompts).toEqual(['Best snack ever?', 'Name a team mascot.']);
    expect(report.duplicates).toBe(1);
    expect(report.invalid).toBe(2); // "ok" and 42 → "42" (too short)
    expect(report.filtered).toBe(1);
    const many = Array.from({ length: MP_LIMITS.customPromptsMax + 5 }, (_, i) => `Prompt number ${i}`);
    const capped = cleanCustomPrompts(many);
    expect(capped.prompts).toHaveLength(MP_LIMITS.customPromptsMax);
    expect(capped.overflow).toBe(5);
  });

  it('bounds prompt length', () => {
    const [p] = cleanCustomPrompts(['y'.repeat(400)]).prompts;
    expect(p).toHaveLength(MP_LIMITS.customPromptMax);
  });

  it('splits pasted lists by line', () => {
    expect(splitPromptList('a\n\n  b  \r\nc')).toEqual(['a', 'b', 'c']);
  });
});
