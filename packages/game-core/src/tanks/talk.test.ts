import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { DEATH_LINES, FIRE_LINES, pickQuip } from './talk.ts';

describe('talking tanks', () => {
  it('every line is unique, trimmed and short enough for a speech bubble', () => {
    const all = [...FIRE_LINES, ...DEATH_LINES];
    expect(new Set(all).size).toBe(all.length);
    for (const line of all) {
      expect(line).toBe(line.trim());
      expect(line.length, line).toBeGreaterThan(0);
      expect(line.length, line).toBeLessThanOrEqual(52);
    }
    expect(FIRE_LINES.length).toBeGreaterThanOrEqual(80);
    expect(DEATH_LINES.length).toBeGreaterThanOrEqual(50);
  });

  it('stays quiet when talk is off, and otherwise picks from the right list', () => {
    const rng = createSeededRng('talk');
    for (let i = 0; i < 200; i++) {
      expect(pickQuip('fire', 'off', rng)).toBeNull();
      expect(pickQuip('death', 'off', rng)).toBeNull();
    }
    const fired = new Set<string>();
    const died = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const f = pickQuip('fire', 'lots', rng);
      const d = pickQuip('death', 'lots', rng);
      if (f !== null) fired.add(f);
      if (d !== null) died.add(d);
    }
    for (const f of fired) expect(FIRE_LINES).toContain(f);
    for (const d of died) expect(DEATH_LINES).toContain(d);
    // The new lines are reachable too.
    expect(fired.size).toBeGreaterThan(FIRE_LINES.length * 0.9);
    expect(died.size).toBeGreaterThan(DEATH_LINES.length * 0.9);
  });

  it('is deterministic for the same seed (the server picks, everyone sees the same bubble)', () => {
    const run = () => {
      const rng = createSeededRng('same');
      return Array.from({ length: 50 }, () => pickQuip('fire', 'some', rng));
    };
    expect(run()).toEqual(run());
  });
});
