import { describe, expect, it } from 'vitest';
import type { ShowdownMe } from '@dascade/shared/games/showdown';
import { BUZZ_FRESH_MS, hasLanded, poolStatus, shouldBuzz } from './poolStatus.ts';

const pool = (p: Partial<NonNullable<ShowdownMe['pool']>> = {}): NonNullable<ShowdownMe['pool']> => ({
  in: false,
  skip: false,
  done: false,
  turns: 0,
  excluded: false,
  crewOut: false,
  mode: 'fair',
  ...p,
});

describe('poolStatus — the phone’s pool card', () => {
  it('says the pool states in words (not colour alone)', () => {
    expect(poolStatus(pool({ in: true }), false, 12).title).toBe('You’re in the pool — you might be picked');
    expect(poolStatus(pool({ skip: true }), false, 12).title).toBe('Skip me is on — you’re out of the random draw');
    expect(poolStatus(pool({ excluded: true }), false, 12).title).toBe('You’re out of the random draw for now');
    expect(poolStatus(pool({ crewOut: true }), false, 12).title).toBe('You’re crew — not in the random draw');
    expect(poolStatus(pool({ done: true, turns: 1 }), false, 12).title).toBe(
      'You’ve had a turn — you’re back in once everyone has had one',
    );
    expect(poolStatus(pool(), false, 12).title).toBe('You’re not in the pool right now');
  });

  it('Skip me, Exclude and crew all say the presenter can still call you up by name', () => {
    for (const p of [pool({ skip: true }), pool({ excluded: true }), pool({ crewOut: true, turns: 2 })]) {
      expect(poolStatus(p, false, 5).detail).toMatch(/can still call you up by name/);
    }
  });

  it('never says why someone is out of the pool', () => {
    const out = poolStatus(pool(), false, 3);
    expect(out.key).toBe('out');
    expect(out.detail).toBe('');
  });

  it('puts the hot seat first, then your own Skip me, then Exclude, then a counted turn', () => {
    expect(poolStatus(pool({ skip: true, done: true }), true, 4).key).toBe('hot');
    expect(poolStatus(pool({ skip: true, done: true, excluded: true }), false, 4).key).toBe('skip');
    expect(poolStatus(pool({ excluded: true, turns: 1 }), false, 4).key).toBe('excluded');
    expect(poolStatus(pool({ in: false, done: true, turns: 1 }), false, 4).key).toBe('lap');
  });

  it('True random: a finished turn keeps you in the pool (only the very next pick skips you)', () => {
    expect(poolStatus(pool({ in: true, done: true, turns: 2, mode: 'random' }), false, 5).key).toBe('in');
    expect(poolStatus(pool({ in: false, done: true, turns: 1, mode: 'random' }), false, 5).key).toBe('done');
  });

  it('crew in the random draw (crewDraw on) are in the pool like anyone', () => {
    expect(poolStatus(pool({ in: true }), false, 5).key).toBe('in');
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
