import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import {
  DECEPTION_ROLES,
  DEFAULT_DECEPTION_SETTINGS,
  autoGlitchCount,
  describeSetup,
  planSetup,
  presetSpecials,
  roleTeam,
  type DeceptionSettings,
  type DeceptionSetup,
} from '@dascade/shared/games/deception';
import { dealRoles, roleDeck, teamMembers } from './roles.ts';

const settings = (patch: Partial<DeceptionSettings> = {}): DeceptionSettings => ({ ...DEFAULT_DECEPTION_SETTINGS, ...patch });
const plan = (n: number, patch: Partial<DeceptionSettings> = {}): DeceptionSetup => {
  const res = planSetup(n, settings(patch));
  if (!res.ok) throw new Error(res.error);
  return res.setup;
};
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
const sum = (s: DeceptionSetup) => DECEPTION_ROLES.reduce((acc, r) => acc + s.counts[r], 0);
const glitchSeats = (s: DeceptionSetup) => s.counts.glitch + s.counts.jammer;

describe('glitch count table', () => {
  it.each([
    [4, 1],
    [5, 1],
    [6, 1],
    [7, 2],
    [9, 2],
    [10, 3],
    [12, 3],
    [13, 4],
    [16, 4],
    [17, 5],
    [20, 5],
  ])('%i players → %i Glitches', (n, g) => {
    expect(autoGlitchCount(n)).toBe(g);
  });

  it('keeps the Glitches a strict minority at every supported size', () => {
    for (let n = 4; n <= 20; n++) expect(autoGlitchCount(n) * 2).toBeLessThan(n);
  });
});

describe('preset role sets', () => {
  it('beginner is always Scanner + Firewall with plain Glitches', () => {
    for (let n = 4; n <= 20; n++) {
      const s = plan(n, { roleSet: 'beginner' });
      expect(s.counts.scanner).toBe(1);
      expect(s.counts.firewall).toBe(1);
      expect(s.counts.tracer + s.counts.sudo + s.counts.jammer).toBe(0);
      expect(s.counts.glitch).toBe(autoGlitchCount(n));
    }
  });

  it('standard scales Sudo (6+), Jammer (7+) and Tracer (10+)', () => {
    expect(presetSpecials('standard', 5)).toEqual(['scanner', 'firewall']);
    expect(presetSpecials('standard', 6)).toEqual(['scanner', 'firewall', 'sudo']);
    expect(presetSpecials('standard', 7)).toEqual(['scanner', 'firewall', 'sudo', 'jammer']);
    expect(presetSpecials('standard', 10)).toEqual(['scanner', 'firewall', 'sudo', 'jammer', 'tracer']);
    const s7 = plan(7);
    expect(s7.counts).toMatchObject({ glitch: 1, jammer: 1, scanner: 1, firewall: 1, sudo: 1, tracer: 0, sysop: 2 });
    const s20 = plan(20);
    expect(s20.counts).toMatchObject({ glitch: 4, jammer: 1, scanner: 1, firewall: 1, sudo: 1, tracer: 1, sysop: 11 });
  });

  it('every preset plan sums to the player count with the right Glitch team size', () => {
    for (const roleSet of ['beginner', 'standard'] as const) {
      for (let n = 4; n <= 20; n++) {
        const s = plan(n, { roleSet });
        expect(sum(s)).toBe(n);
        expect(glitchSeats(s)).toBe(s.glitches);
        expect(s.glitches).toBe(autoGlitchCount(n));
        expect(s.counts.sysop).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('documents the 4-player mini setup', () => {
    expect(plan(4).counts).toMatchObject({ glitch: 1, scanner: 1, firewall: 1, sysop: 1, jammer: 0, sudo: 0, tracer: 0 });
  });

  it('describes a setup in one line', () => {
    expect(describeSetup(plan(8))).toBe('2 Glitches (incl. Jammer) · Scanner · Firewall · Sudo · 3 Sysops');
    expect(describeSetup(plan(5, { roleSet: 'beginner' }))).toBe('1 Glitch · Scanner · Firewall · 2 Sysops');
  });
});

describe('custom mix validation', () => {
  const custom = (n: number, roles: Partial<DeceptionSettings['customRoles']>, glitchCount = 0) =>
    planSetup(
      n,
      settings({
        roleSet: 'custom',
        glitchCount,
        customRoles: { scanner: false, firewall: false, tracer: false, sudo: false, jammer: false, ...roles },
      }),
    );

  it('honours the chosen specials and a fixed Glitch count', () => {
    const res = custom(9, { tracer: true, jammer: true }, 3);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.setup.counts).toMatchObject({ glitch: 2, jammer: 1, tracer: 1, scanner: 0, sysop: 5 });
    expect(sum(res.setup)).toBe(9);
  });

  it('uses the automatic Glitch count when glitchCount is 0', () => {
    const res = custom(12, { scanner: true });
    expect(res.ok && res.setup.glitches).toBe(3);
  });

  it('allows a lone Jammer as the only Glitch', () => {
    const res = custom(5, { jammer: true }, 1);
    expect(res.ok && res.setup.counts).toMatchObject({ jammer: 1, glitch: 0 });
  });

  it('rejects Glitch majorities and parity', () => {
    const res = custom(6, {}, 3);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/minority/);
    expect(custom(7, {}, 3).ok).toBe(true);
  });

  it('rejects more special Sysops than Sysop seats', () => {
    const res = custom(5, { scanner: true, firewall: true, tracer: true, sudo: true }, 2);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Too many special/);
  });

  it('rejects player counts outside 4–20', () => {
    expect(planSetup(3, DEFAULT_DECEPTION_SETTINGS).ok).toBe(false);
    expect(planSetup(21, DEFAULT_DECEPTION_SETTINGS).ok).toBe(false);
    expect(planSetup(4.5, DEFAULT_DECEPTION_SETTINGS).ok).toBe(false);
  });
});

describe('dealRoles', () => {
  it('deals exactly the planned roles', () => {
    for (let n = 4; n <= 20; n++) {
      const setup = plan(n);
      const roles = dealRoles(ids(n), setup, createSeededRng(`deal-${n}`));
      expect(roles.size).toBe(n);
      const dealt = [...roles.values()].sort();
      expect(dealt).toEqual(roleDeck(setup).sort());
    }
  });

  it('is deterministic for a seed and varies across seeds', () => {
    const setup = plan(10);
    const a = dealRoles(ids(10), setup, createSeededRng('same'));
    const b = dealRoles(ids(10), setup, createSeededRng('same'));
    expect([...a]).toEqual([...b]);
    const distinct = new Set<string>();
    for (let seed = 0; seed < 20; seed++) distinct.add(JSON.stringify([...dealRoles(ids(10), setup, createSeededRng(seed))]));
    expect(distinct.size).toBeGreaterThan(15);
  });

  it('gives every seat a fair chance to be a Glitch', () => {
    const n = 8;
    const setup = plan(n, { roleSet: 'beginner' });
    const hits = new Map<string, number>();
    const trials = 4000;
    for (let t = 0; t < trials; t++) {
      const roles = dealRoles(ids(n), setup, createSeededRng(`fair-${t}`));
      for (const id of teamMembers(roles, 'glitches')) hits.set(id, (hits.get(id) ?? 0) + 1);
    }
    const expected = (trials * setup.glitches) / n;
    for (const id of ids(n)) expect(Math.abs((hits.get(id) ?? 0) - expected)).toBeLessThan(expected * 0.15);
  });

  it('Glitch team membership matches the role teams', () => {
    const roles = dealRoles(ids(12), plan(12), createSeededRng(7));
    const team = teamMembers(roles, 'glitches');
    expect(team).toHaveLength(3);
    for (const id of team) expect(roleTeam(roles.get(id)!)).toBe('glitches');
    expect(teamMembers(roles, 'sysops')).toHaveLength(9);
  });

  it('rejects a roster that does not match the setup', () => {
    expect(() => dealRoles(ids(5), plan(6), createSeededRng(1))).toThrow(RangeError);
    expect(() => dealRoles(['a', 'a', 'b', 'c'], plan(4), createSeededRng(1))).toThrow(RangeError);
  });
});
