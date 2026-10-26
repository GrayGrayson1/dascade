import { describe, expect, it } from 'vitest';
import { BUZZ_FRESH_MS, hasLanded, poolStatus, shouldBuzz } from './poolStatus.ts';

const pool = (p: Partial<{ in: boolean; skip: boolean; done: boolean }> = {}) => ({ in: false, skip: false, done: false, ...p });

describe('poolStatus — the phone’s pool card', () => {
  it('says the four pool states in words (not colour alone)', () => {
    expect(poolStatus(pool({ in: true }), false, 12).title).toBe('You’re in the pool — you might be picked');
    expect(poolStatus(pool({ skip: true }), false, 12).title).toBe('Skip me is on — you won’t be picked');
    expect(poolStatus(pool({ done: true }), false, 12).title).toBe('Your turn’s done this round — you’re back in next round');
    expect(poolStatus(pool(), false, 12).title).toBe('You’re not in the pool right now');
  });

  it('never says why someone is out of the pool', () => {
    const out = poolStatus(pool(), false, 3);
    expect(out.key).toBe('out');
    expect(out.detail).toBe('');
  });

  it('puts the hot seat first, then your own Skip me, then a counted turn', () => {
    expect(poolStatus(pool({ skip: true, done: true }), true, 4).key).toBe('hot');
    expect(poolStatus(pool({ skip: true, done: true }), false, 4).key).toBe('skip');
    expect(poolStatus(pool({ in: false, done: true }), false, 4).key).toBe('done');
  });

  it('counts the others in the pool', () => {
    expect(poolStatus(pool({ in: true }), false, 12).detail).toMatch(/^You and 11 others could be picked next/);
    expect(poolStatus(pool({ in: true }), false, 2).detail).toMatch(/^You and 1 other could be picked next/);
    expect(poolStatus(pool({ in: true }), false, 1).detail).toBe('Rather not? Switch on Skip me.');
  });
});

describe('timing — the phone never runs ahead of the stage', () => {
  it('lands at landAt, not before', () => {
    expect(hasLanded(0, 5000)).toBe(false);
    expect(hasLanded(10_000, 9_999)).toBe(false);
    expect(hasLanded(10_000, 10_000)).toBe(true);
  });

  it('buzzes only for a fresh landing', () => {
    expect(shouldBuzz(10_000, 9_000)).toBe(false);
    expect(shouldBuzz(10_000, 10_050)).toBe(true);
    expect(shouldBuzz(10_000, 10_000 + BUZZ_FRESH_MS)).toBe(false);
  });
});
