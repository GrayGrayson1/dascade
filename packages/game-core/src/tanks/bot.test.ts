import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { TANKS_WORLD, type CpuSkill } from '@dascade/shared/games/tanks';
import { createBattle, fire, tankById, type BattleConfig } from './battle.ts';
import { BOT_NOISE, planShot } from './bot.ts';
import { createTerrain, restHeight } from './terrain.ts';

const CONFIG: BattleConfig = {
  mode: 'ffa',
  style: 'hills',
  windMax: 10,
  fuelPerTurn: 0,
  armor: 100,
  arsenal: 'standard',
  maxRounds: 15,
  friendlyFire: false,
  theme: 'night',
};

function duel(seed: string | number, wind = 0, flat = true) {
  const rng = createSeededRng(seed);
  const b = createBattle(
    rng,
    [
      { id: 'cpu', name: 'CPU', color: '#fff', team: -1, cpu: true },
      { id: 'foe', name: 'Foe', color: '#fff', team: -1 },
    ],
    CONFIG,
  );
  if (flat) b.terrain = createTerrain(TANKS_WORLD.width, TANKS_WORLD.height, 200);
  const cpu = tankById(b, 'cpu')!;
  const foe = tankById(b, 'foe')!;
  cpu.x = 300;
  foe.x = 900 + (typeof seed === 'number' ? seed * 37 : 0) % 500;
  for (const t of b.tanks) t.y = restHeight(b.terrain, t.x);
  b.wind = wind;
  b.activeId = 'cpu';
  return { b, rng, cpu, foe };
}

describe('CPU gunner', () => {
  it('plans a legal shot with a weapon it has ammo for', () => {
    for (let seed = 0; seed < 10; seed++) {
      const { b, rng } = duel(seed, (seed % 5) * 3 - 6, false);
      const plan = planShot(b, 'cpu', 'veteran', rng);
      expect(plan.angle).toBeGreaterThanOrEqual(0);
      expect(plan.angle).toBeLessThanOrEqual(180);
      expect(plan.power).toBeGreaterThanOrEqual(5);
      expect(plan.power).toBeLessThanOrEqual(100);
      expect(tankById(b, 'cpu')!.ammo[plan.weapon]).not.toBe(0);
      expect(plan.targetId).toBe('foe');
    }
  });

  it('an ace almost always lands damage, even in the wind', () => {
    let hits = 0;
    for (let seed = 0; seed < 12; seed++) {
      const { b, rng, foe } = duel(seed, (seed % 7) * 2 - 6);
      const plan = planShot(b, 'cpu', 'ace', rng);
      const before = foe.hp;
      const s = fire(b, 'cpu', plan.angle, plan.power, plan.weapon);
      expect(typeof s).toBe('object');
      if (foe.hp < before) hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(10);
  });

  it('rookies are noticeably less accurate than aces', () => {
    const rate = (skill: CpuSkill) => {
      let dmg = 0;
      for (let seed = 0; seed < 16; seed++) {
        const { b, rng, foe } = duel(seed, (seed % 5) * 2 - 4);
        const plan = planShot(b, 'cpu', skill, rng);
        const before = foe.hp;
        fire(b, 'cpu', plan.angle, plan.power, plan.weapon);
        dmg += before - foe.hp;
      }
      return dmg;
    };
    expect(rate('ace')).toBeGreaterThan(rate('rookie'));
    expect(BOT_NOISE.rookie.angle).toBeGreaterThan(BOT_NOISE.ace.angle);
  });

  it('is deterministic for a seed and fast enough for the server', () => {
    const a = duel('det', 5, false);
    const b = duel('det', 5, false);
    const t0 = performance.now();
    const p1 = planShot(a.b, 'cpu', 'veteran', a.rng);
    const took = performance.now() - t0;
    const p2 = planShot(b.b, 'cpu', 'veteran', b.rng);
    expect(p1).toEqual(p2);
    expect(took).toBeLessThan(250);
  });

  it("doesn't aim at teammates and copes with no enemies left", () => {
    const rng = createSeededRng('team');
    const b = createBattle(
      rng,
      [
        { id: 'cpu', name: 'CPU', color: '#fff', team: 0, cpu: true },
        { id: 'mate', name: 'Mate', color: '#fff', team: 0 },
        { id: 'foe', name: 'Foe', color: '#fff', team: 1 },
      ],
      { ...CONFIG, mode: 'teams' },
    );
    b.activeId = 'cpu';
    expect(planShot(b, 'cpu', 'veteran', rng).targetId).toBe('foe');
    tankById(b, 'foe')!.alive = false;
    const lonely = planShot(b, 'cpu', 'veteran', rng);
    expect(lonely.targetId).toBeNull();
    expect(lonely.weapon).toBe('shell');
  });
});
