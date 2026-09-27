import { describe, expect, it } from 'vitest';
import { shownLength } from './length.ts';

describe('snake HUD length', () => {
  it('shows the live length while the snake is alive', () => {
    expect(shownLength({ alive: true, length: 7, best: 9 })).toBe(7);
  });
  it('shows the length reached after a crash (the body is cleared), matching the verdict', () => {
    expect(shownLength({ alive: false, length: 0, best: 4 })).toBe(4);
  });
  it('is 0 without a snake', () => {
    expect(shownLength(undefined)).toBe(0);
  });
});
