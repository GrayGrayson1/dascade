import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { TANK_GEOM, TANKS_WORLD, WEAPON_IDS, type ShotEvent, type ShotScript, type WeaponId } from '@dascade/shared/games/tanks';
import { dcos, dsin } from './trig.ts';
import { cloneTerrain, createTerrain, generateTerrain, restHeight, type Terrain } from './terrain.ts';
import { launchState, previewArc, resolveShot, type ShotRules, type SimTank, type SimWorld } from './sim.ts';
import { PHYS, WEAPON_SPECS, WRECK_BLAST, blastDamage, fallDamage, fallDurationMs } from './weapons.ts';

const FFA: ShotRules = { teams: false, friendlyFire: true };

function tankAt(terrain: Terrain, id: string, x: number, team = -1, hp = 100): SimTank {
  return { id, team, x, y: restHeight(terrain, x), hp, alive: true };
}

function flat(height = 200, width: number = TANKS_WORLD.width): Terrain {
  return createTerrain(width, TANKS_WORLD.height, height);
}

/** Closed-form landing point on flat ground (no wind). */
function analyticLanding(t: { x: number; y: number }, angle: number, power: number, ground: number): number {
  const c = dcos(angle);
  const s = dsin(angle);
  const x0 = t.x + c * TANK_GEOM.barrel;
  const y0 = t.y + TANK_GEOM.pivot + s * TANK_GEOM.barrel;
  const v = (PHYS.maxSpeed * power) / 100;
  const vy = s * v;
  const g = PHYS.gravity;
  const time = (vy + Math.sqrt(vy * vy + 2 * g * (y0 - ground))) / g;
  return x0 + c * v * time;
}

const booms = (s: ShotScript) => s.events.filter((e): e is Extract<ShotEvent, { k: 'boom' }> => e.k === 'boom');
const dmgTo = (s: ShotScript, id: string) =>
  s.events.filter((e): e is Extract<ShotEvent, { k: 'dmg' }> => e.k === 'dmg' && e.id === id).reduce((n, e) => n + e.amount, 0);

function shoot(world: SimWorld, shooterId: string, angle: number, power: number, weapon: WeaponId = 'shell', rules: ShotRules = FFA): ShotScript {
  return resolveShot(world, { shooterId, angle, power, weapon }, rules, { seq: 1, turnId: 1 });
}

describe('weapon maths', () => {
  it('blast damage falls off linearly with distance', () => {
    const b = WEAPON_SPECS.shell.blast;
    const inner = TANK_GEOM.hitRadius * 0.6;
    expect(blastDamage(b, 0, TANK_GEOM.hitRadius)).toBe(b.damage);
    expect(blastDamage(b, inner, TANK_GEOM.hitRadius)).toBe(b.damage);
    expect(blastDamage(b, inner + b.radius / 2, TANK_GEOM.hitRadius)).toBe(Math.round(b.damage / 2));
    expect(blastDamage(b, inner + b.radius * 0.75, TANK_GEOM.hitRadius)).toBe(Math.round(b.damage / 4));
    expect(blastDamage(b, inner + b.radius, TANK_GEOM.hitRadius)).toBe(0);
    expect(blastDamage(b, 500, TANK_GEOM.hitRadius)).toBe(0);
    expect(blastDamage(WEAPON_SPECS.dirt.blast, 0, TANK_GEOM.hitRadius)).toBe(0);
    // Monotonic.
    let prev = Infinity;
    for (let d = 0; d < 80; d++) {
      const v = blastDamage(b, d, TANK_GEOM.hitRadius);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });

  it('falls hurt only beyond the safe drop, capped', () => {
    expect(fallDamage(PHYS.safeFall)).toBe(0);
    expect(fallDamage(PHYS.safeFall + 40)).toBe(12);
    expect(fallDamage(5000)).toBe(PHYS.maxFallDamage);
    expect(fallDurationMs(0)).toBe(0);
    expect(fallDurationMs(90)).toBeGreaterThan(fallDurationMs(20));
  });
});

describe('ballistics', () => {
  it('launches from the barrel tip with the aimed velocity', () => {
    const l = launchState({ x: 100, y: 200 }, 90, 50);
    expect(l.x).toBe(100);
    expect(l.y).toBe(200 + TANK_GEOM.pivot + TANK_GEOM.barrel);
    expect(l.vx).toBe(0);
    expect(l.vy).toBe(PHYS.maxSpeed / 2);
    const left = launchState({ x: 100, y: 200 }, 180, 100);
    expect(left.vx).toBe(-PHYS.maxSpeed);
  });

  it('a known shot lands where the closed-form trajectory says', () => {
    for (const [angle, power] of [
      [45, 60],
      [30, 70],
      [60, 55],
      [135, 60],
      [80, 45],
    ] as const) {
      const terrain = flat(200);
      const shooter = tankAt(terrain, 'a', angle > 90 ? 1400 : 200);
      const world: SimWorld = { terrain, tanks: [shooter], wind: 0 };
      const expected = analyticLanding(shooter, angle, power, 200);
      const s = shoot(world, 'a', angle, power);
      const hit = booms(s)[0]!;
      expect(Math.abs(hit.x - expected)).toBeLessThan(6);
      expect(Math.abs(hit.y - 200)).toBeLessThanOrEqual(PHYS.collideStep);
      expect(s.projectiles[0]!.end).toBe('boom');
    }
  });

  it('a known shot directly hits a tank standing at the landing point', () => {
    const terrain = flat(200);
    const a = tankAt(terrain, 'a', 200);
    const x = Math.round(analyticLanding(a, 45, 60, 200));
    const b = tankAt(terrain, 'b', x);
    const s = shoot({ terrain, tanks: [a, b], wind: 0 }, 'a', 45, 60);
    const hit = booms(s)[0]!;
    expect(hit.direct).toBe('b');
    const blast = s.events.filter((e) => e.k === 'dmg' && e.id === 'b' && e.src === 'blast');
    expect(blast).toHaveLength(1);
    expect(blast[0]!.k === 'dmg' && blast[0]!.amount).toBe(WEAPON_SPECS.shell.blast.damage);
    // The crater under it may drop it a little too.
    expect(b.hp).toBe(100 - dmgTo(s, 'b'));
    expect(s.damage).toBe(dmgTo(s, 'b'));
    expect(dmgTo(s, 'a')).toBe(0);
  });

  it('splash damage falls off with distance from the impact', () => {
    const terrain = flat(200);
    const a = tankAt(terrain, 'a', 200);
    const land = analyticLanding(a, 45, 60, 200);
    const near = tankAt(terrain, 'near', land + 30);
    const far = tankAt(terrain, 'far', land + 75);
    const s = shoot({ terrain, tanks: [a, near, far], wind: 0 }, 'a', 45, 60);
    const boom = booms(s)[0]!;
    const expectNear = blastDamage(WEAPON_SPECS.shell.blast, Math.hypot(near.x - boom.x, 200 + TANK_GEOM.hitCenter - boom.y), TANK_GEOM.hitRadius);
    expect(expectNear).toBeGreaterThan(0);
    expect(dmgTo(s, 'near')).toBe(expectNear);
    expect(dmgTo(s, 'far')).toBe(0);
  });

  it('wind pushes shells downwind', () => {
    const land = (wind: number) => {
      const terrain = flat(200);
      const a = tankAt(terrain, 'a', 300);
      return booms(shoot({ terrain, tanks: [a], wind }, 'a', 55, 60))[0]!.x;
    };
    const calm = land(0);
    expect(land(10)).toBeGreaterThan(calm + 40);
    expect(land(-10)).toBeLessThan(calm - 40);
    expect(land(15)).toBeGreaterThan(land(10));
  });

  it('the heavy shell drifts less in the wind', () => {
    const drift = (weapon: WeaponId) => {
      const run = (wind: number) => {
        const terrain = flat(200);
        const a = tankAt(terrain, 'a', 300);
        return booms(shoot({ terrain, tanks: [a], wind }, 'a', 55, 60, weapon))[0]!.x;
      };
      return run(12) - run(0);
    };
    expect(drift('heavy')).toBeLessThan(drift('shell'));
  });

  it('modifies the terrain where the shell lands (and nowhere else)', () => {
    const terrain = flat(200);
    const a = tankAt(terrain, 'a', 200);
    const before = cloneTerrain(terrain);
    const s = shoot({ terrain, tanks: [a], wind: 0 }, 'a', 45, 60);
    const x = Math.floor(booms(s)[0]!.x);
    expect(terrain.h[x]).toBeLessThan(200 - WEAPON_SPECS.shell.blast.radius * 0.8);
    for (let i = 0; i < terrain.width; i++) {
      if (Math.abs(i - x) > WEAPON_SPECS.shell.blast.radius + 1) expect(terrain.h[i]).toBe(before.h[i]);
    }
  });

  it('shells leaving the side of the world vanish without exploding', () => {
    const terrain = flat(100);
    const a = tankAt(terrain, 'a', 1500);
    const s = shoot({ terrain, tanks: [a], wind: 0 }, 'a', 20, 100);
    expect(s.projectiles[0]!.end).toBe('out');
    expect(booms(s)).toHaveLength(0);
    expect(a.hp).toBe(100);
  });

  it("the shooter's own shell can't hit it on the way out, but can on the way back", () => {
    const terrain = flat(200);
    const a = tankAt(terrain, 'a', 800);
    const s = shoot({ terrain, tanks: [a], wind: 0 }, 'a', 90, 40);
    const boom = booms(s)[0]!;
    expect(boom.direct).toBe('a');
    expect(a.hp).toBe(100 - WEAPON_SPECS.shell.blast.damage);
    expect(s.damage).toBe(0);
  });

  it('records samples at 60 Hz ending exactly at the impact', () => {
    const terrain = flat(200);
    const a = tankAt(terrain, 'a', 200);
    const s = shoot({ terrain, tanks: [a], wind: 0 }, 'a', 45, 60);
    const p = s.projectiles[0]!;
    const n = p.pts.length / 2;
    const flightMs = p.t1 - p.t0;
    expect(Math.abs(n - 2 - flightMs / (1000 / 60))).toBeLessThanOrEqual(1);
    expect(p.pts[p.pts.length - 2]).toBeCloseTo(booms(s)[0]!.x, 0);
    expect(s.origin[0]).toBeCloseTo(p.pts[0]!, 0);
  });

  it('keeps events sorted and the duration covers them', () => {
    const terrain = generateTerrain(createSeededRng('sorted'), 'hills');
    const tanks = [300, 700, 1100].map((x, i) => tankAt(terrain, `t${i}`, x));
    const s = shoot({ terrain, tanks, wind: 4 }, 't0', 50, 70, 'cluster');
    for (let i = 1; i < s.events.length; i++) expect(s.events[i]!.t).toBeGreaterThanOrEqual(s.events[i - 1]!.t);
    const last = s.events[s.events.length - 1]!;
    expect(s.durationMs).toBeGreaterThan(last.t);
  });

  it('previews only the first moments of the arc', () => {
    const pts = previewArc({ x: 100, y: 200 }, 45, 60);
    expect(pts.length).toBeGreaterThan(8);
    const l = launchState({ x: 100, y: 200 }, 45, 60);
    expect(pts[0]).toBe(l.x);
    expect(pts[pts.length - 2]! - l.x).toBeLessThan(l.vx * 0.4);
  });
});

describe('tanks falling and dying', () => {
  it('a tank falls into a crater dug beneath it and takes fall damage', () => {
    const base = flat(200);
    // Target on a tall, thin pillar; the shooter lobs a heavy shell at the pillar's foot from the right.
    for (let i = 990; i < 1010; i++) base.h[i] = 330;
    const shooterX = 1300;
    let found: number | null = null;
    for (let power = 20; power <= 100 && found === null; power++) {
      const terrain = cloneTerrain(base);
      const probe: SimWorld = { terrain, tanks: [tankAt(terrain, 'a', shooterX), tankAt(terrain, 'b', 1000)], wind: 0 };
      const b = booms(resolveShot(probe, { shooterId: 'a', angle: 135, power, weapon: 'heavy' }, FFA))[0];
      if (b && !b.direct && b.x > 1012 && b.x < 1050) found = power;
    }
    expect(found).not.toBeNull();
    const terrain = cloneTerrain(base);
    const target = tankAt(terrain, 'b', 1000);
    expect(target.y).toBe(330);
    const s = resolveShot({ terrain, tanks: [tankAt(terrain, 'a', shooterX), target], wind: 0 }, { shooterId: 'a', angle: 135, power: found!, weapon: 'heavy' }, FFA);
    const fall = s.events.find((e) => e.k === 'move' && e.id === 'b');
    expect(fall).toBeTruthy();
    if (fall?.k === 'move') {
      expect(fall.y1).toBeLessThan(fall.y0 - 40);
      expect(fall.dur).toBe(fallDurationMs(fall.y0 - fall.y1));
      const falls = s.events.filter((e) => e.k === 'dmg' && e.id === 'b' && e.src === 'fall');
      expect(falls).toHaveLength(1);
      expect(falls[0]!.k === 'dmg' && falls[0]!.amount).toBe(fallDamage(fall.y0 - fall.y1));
      expect(falls[0]!.t).toBeCloseTo(fall.t + fall.dur, 0);
    }
    expect(target.y).toBe(restHeight(terrain, 1000));
  });

  it('destroys a tank at 0 HP, credits the kill and blows up the wreck', () => {
    const terrain = flat(200);
    const a = tankAt(terrain, 'a', 200);
    const x = Math.round(analyticLanding(a, 45, 60, 200));
    const b = tankAt(terrain, 'b', x, -1, 20);
    const s = shoot({ terrain, tanks: [a, b], wind: 0 }, 'a', 45, 60);
    expect(b.alive).toBe(false);
    expect(b.hp).toBe(0);
    expect(s.kills).toEqual(['b']);
    expect(s.damage).toBe(20);
    const death = s.events.find((e) => e.k === 'death')!;
    const wreck = booms(s).find((e) => e.w === 'wreck')!;
    expect(wreck).toBeTruthy();
    expect(wreck.t).toBeGreaterThan(death.t);
    expect(wreck.r).toBe(WRECK_BLAST.radius);
    expect(s.tanks.find((t) => t.id === 'b')).toMatchObject({ alive: false, hp: 0 });
  });

  it('wrecks chain-react into neighbours', () => {
    const terrain = flat(200);
    const a = tankAt(terrain, 'a', 200);
    const x = Math.round(analyticLanding(a, 45, 60, 200));
    const b = tankAt(terrain, 'b', x, -1, 10);
    // Outside the shell's blast, inside b's wreck blast.
    const c = tankAt(terrain, 'c', x + 36, -1, 1);
    const s = shoot({ terrain, tanks: [a, b, c], wind: 0 }, 'a', 45, 60);
    expect(b.alive).toBe(false);
    expect(c.alive).toBe(false);
    const wrecks = booms(s).filter((e) => e.w === 'wreck');
    expect(wrecks).toHaveLength(2);
    const cDmg = s.events.find((e) => e.k === 'dmg' && e.id === 'c')!;
    expect(cDmg.t).toBe(wrecks[0]!.t);
    expect(s.kills.sort()).toEqual(['b', 'c']);
  });
});

describe('weapons', () => {
  const setup = () => {
    const terrain = flat(200);
    const a = tankAt(terrain, 'a', 200);
    return { terrain, a };
  };

  it('heavy shells blast a wider, deeper crater than standard shells', () => {
    const run = (weapon: WeaponId) => {
      const { terrain, a } = setup();
      const s = shoot({ terrain, tanks: [a], wind: 0 }, 'a', 45, 60, weapon);
      const x = Math.floor(booms(s)[0]!.x);
      let width = 0;
      for (let i = 0; i < terrain.width; i++) if (terrain.h[i]! < 199.9) width++;
      return { depth: 200 - terrain.h[x]!, width };
    };
    const shell = run('shell');
    const heavy = run('heavy');
    expect(heavy.depth).toBeGreaterThan(shell.depth + 15);
    expect(heavy.width).toBeGreaterThan(shell.width + 30);
  });

  it('cluster shots split into five bomblets at the apex', () => {
    const { terrain, a } = setup();
    const s = shoot({ terrain, tanks: [a], wind: 0 }, 'a', 60, 70, 'cluster');
    const split = s.events.find((e) => e.k === 'split')!;
    expect(split).toBeTruthy();
    const main = s.projectiles[0]!;
    expect(main.end).toBe('split');
    const bomblets = s.projectiles.filter((p) => p.kind === 'bomblet');
    expect(bomblets).toHaveLength(5);
    expect(bomblets.every((p) => Math.abs(p.t0 - main.t1) < 1)).toBe(true);
    const bx = booms(s).map((b) => b.x);
    expect(bx).toHaveLength(5);
    expect(Math.max(...bx) - Math.min(...bx)).toBeGreaterThan(150);
    // The apex: vertical speed ≈ 0 → split height is the arc's peak.
    const peak = Math.max(...main.pts.filter((_, i) => i % 2 === 1));
    expect(split.k === 'split' && Math.abs(split.y - peak)).toBeLessThan(1.5);
  });

  it('cluster shots that hit before the apex burst and throw bomblets', () => {
    const terrain = flat(200);
    for (let i = 300; i < 340; i++) terrain.h[i] = 600;
    const a = tankAt(terrain, 'a', 200);
    const s = shoot({ terrain, tanks: [a], wind: 0 }, 'a', 40, 80, 'cluster');
    expect(s.projectiles[0]!.end).toBe('boom');
    expect(s.events.some((e) => e.k === 'split')).toBe(false);
    expect(s.projectiles.filter((p) => p.kind === 'bomblet')).toHaveLength(5);
    expect(booms(s).length).toBeGreaterThanOrEqual(5);
  });

  it('airbursts detonate above a tank, hurting it without cratering', () => {
    const { terrain, a } = setup();
    const x = Math.round(analyticLanding(a, 45, 60, 200));
    const b = tankAt(terrain, 'b', x);
    const before = cloneTerrain(terrain);
    const s = shoot({ terrain, tanks: [a, b], wind: 0 }, 'a', 45, 60, 'airburst');
    const boom = booms(s)[0]!;
    expect(boom.terrain).toBe('none');
    expect(boom.y).toBeGreaterThan(200 + 10);
    expect(Array.from(terrain.h)).toEqual(Array.from(before.h));
    expect(dmgTo(s, 'b')).toBeGreaterThan(15);
  });

  it('airbursts fuse above open ground when nothing is near', () => {
    const { terrain, a } = setup();
    const s = shoot({ terrain, tanks: [a], wind: 0 }, 'a', 45, 60, 'airburst');
    const boom = booms(s)[0]!;
    expect(boom.y - 200).toBeLessThanOrEqual(WEAPON_SPECS.airburst.airburst!.fuseHeight + 1);
    expect(boom.y - 200).toBeGreaterThan(WEAPON_SPECS.airburst.airburst!.fuseHeight - 8);
  });

  it('drillers bore into the ground and detonate deep down, later', () => {
    const { terrain, a } = setup();
    const shell = (() => {
      const t2 = flat(200);
      const a2 = tankAt(t2, 'a', 200);
      return shoot({ terrain: t2, tanks: [a2], wind: 0 }, 'a', 45, 60, 'shell');
    })();
    const s = shoot({ terrain, tanks: [a], wind: 0 }, 'a', 45, 60, 'driller');
    expect(s.projectiles[0]!.end).toBe('drill');
    const bore = s.events.find((e) => e.k === 'bore')!;
    expect(bore).toBeTruthy();
    const boom = booms(s)[0]!;
    expect(boom.y).toBeLessThan(200 - 80);
    expect(boom.t).toBeGreaterThan(bore.t + 200);
    expect(boom.t).toBeGreaterThan(booms(shell)[0]!.t);
  });

  it('drillers tunnel through a hill to reach a tank behind it', () => {
    const terrain = flat(200);
    for (let i = 600; i < 660; i++) terrain.h[i] = 330;
    const a = tankAt(terrain, 'a', 300);
    const b = tankAt(terrain, 'b', 720);
    let hit = false;
    for (let power = 30; power <= 70 && !hit; power++) {
      const w = { terrain: cloneTerrain(terrain), tanks: [{ ...a }, { ...b }], wind: 0 };
      const s = resolveShot(w, { shooterId: 'a', angle: 20, power, weapon: 'driller' }, FFA);
      if (s.events.some((e) => e.k === 'bore') && dmgTo(s, 'b') > 0) hit = true;
    }
    expect(hit).toBe(true);
  });

  it('dirt mounds raise the ground and lift tanks, with no damage', () => {
    const { terrain, a } = setup();
    const x = Math.round(analyticLanding(a, 45, 60, 200));
    const b = tankAt(terrain, 'b', x + 20);
    const s = shoot({ terrain, tanks: [a, b], wind: 0 }, 'a', 45, 60, 'dirt');
    const boom = booms(s)[0]!;
    expect(boom.terrain).toBe('dirt');
    expect(terrain.h[Math.floor(boom.x)]).toBeGreaterThan(240);
    expect(b.hp).toBe(100);
    expect(b.y).toBeGreaterThan(210);
    const lift = s.events.find((e) => e.k === 'move' && e.id === 'b');
    expect(lift?.k === 'move' && lift.y1 > lift.y0).toBe(true);
  });

  it('every weapon resolves on rough terrain without leaving anything in flight', () => {
    for (const weapon of WEAPON_IDS) {
      for (let seed = 0; seed < 8; seed++) {
        const terrain = generateTerrain(createSeededRng(`${weapon}${seed}`), 'hills');
        const tanks = [250, 800, 1350].map((x, i) => tankAt(terrain, `t${i}`, x));
        const rng = createSeededRng(seed);
        const s = shoot({ terrain, tanks, wind: rng.int(21) - 10 }, 't0', 20 + rng.int(70), 30 + rng.int(70), weapon);
        expect(s.projectiles.every((p) => p.end !== 'fizzle')).toBe(true);
        expect(s.durationMs).toBeLessThanOrEqual(20_000);
        for (const t of tanks) {
          expect(t.hp).toBeGreaterThanOrEqual(0);
          expect(t.alive).toBe(t.hp > 0);
          if (t.alive) expect(t.y).toBe(restHeight(terrain, t.x));
        }
      }
    }
  });
});

describe('teams and friendly fire', () => {
  const layout = (friendlyFire: boolean) => {
    const terrain = flat(200);
    const a = tankAt(terrain, 'a', 200, 0);
    const x = Math.round(analyticLanding(a, 45, 60, 200));
    const mate = tankAt(terrain, 'mate', x, 0);
    const foe = tankAt(terrain, 'foe', x + 40, 1);
    const s = resolveShot({ terrain, tanks: [a, mate, foe], wind: 0 }, { shooterId: 'a', angle: 45, power: 60, weapon: 'heavy' }, { teams: true, friendlyFire });
    return { s, mate, foe };
  };

  it('with friendly fire off, teammates take no damage but enemies do', () => {
    const { s, mate, foe } = layout(false);
    expect(mate.hp).toBe(100);
    expect(foe.hp).toBeLessThan(100);
    expect(s.damage).toBe(100 - foe.hp);
  });

  it('with friendly fire on, teammates are hurt (and not counted as enemy damage)', () => {
    const { s, mate, foe } = layout(true);
    expect(mate.hp).toBeLessThan(100);
    expect(s.damage).toBe(100 - foe.hp);
  });

  it('shooters always take their own splash damage', () => {
    const terrain = flat(200);
    const a = tankAt(terrain, 'a', 800, 0);
    resolveShot({ terrain, tanks: [a], wind: 0 }, { shooterId: 'a', angle: 0, power: 5, weapon: 'shell' }, { teams: true, friendlyFire: false });
    expect(a.hp).toBeLessThan(100);
  });
});

describe('determinism', () => {
  it('same world + same input → identical script and world', () => {
    const make = () => {
      const terrain = generateTerrain(createSeededRng('det'), 'mesa');
      const tanks = [200, 600, 1000, 1400].map((x, i) => tankAt(terrain, `t${i}`, x, i % 2));
      return { terrain, tanks, wind: 7 } as SimWorld;
    };
    for (const weapon of WEAPON_IDS) {
      const w1 = make();
      const w2 = make();
      const s1 = resolveShot(w1, { shooterId: 't1', angle: 62, power: 71, weapon }, { teams: true, friendlyFire: true });
      const s2 = resolveShot(w2, { shooterId: 't1', angle: 62, power: 71, weapon }, { teams: true, friendlyFire: true });
      expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
      expect(Array.from(w1.terrain.h)).toEqual(Array.from(w2.terrain.h));
    }
  });

  it('a seeded 60-shot playout is reproducible', () => {
    const playout = () => {
      const rng = createSeededRng('playout');
      const terrain = generateTerrain(rng, 'hills');
      const tanks = [150, 450, 750, 1050, 1350].map((x, i) => tankAt(terrain, `t${i}`, x));
      const world: SimWorld = { terrain, tanks, wind: 0 };
      const log: string[] = [];
      for (let i = 0; i < 60; i++) {
        const alive = tanks.filter((t) => t.alive);
        if (alive.length < 2) break;
        const shooter = alive[i % alive.length]!;
        world.wind = rng.int(21) - 10;
        const s = resolveShot(world, { shooterId: shooter.id, angle: rng.int(181), power: 5 + rng.int(96), weapon: WEAPON_IDS[rng.int(WEAPON_IDS.length)]! }, FFA);
        log.push(`${s.events.length}:${s.durationMs}:${tanks.map((t) => `${t.x},${t.y},${t.hp}`).join('|')}`);
      }
      return { log, h: Array.from(terrain.h) };
    };
    const a = playout();
    const b = playout();
    expect(a.log).toEqual(b.log);
    expect(a.h).toEqual(b.h);
  });
});

describe('client replay', () => {
  it('replaying the script terrain events on the pre-shot terrain reproduces the server terrain exactly', async () => {
    const { addDirt, carveCapsule, carveCircle } = await import('./terrain.ts');
    for (const weapon of WEAPON_IDS) {
      for (let seed = 0; seed < 6; seed++) {
        const terrain = generateTerrain(createSeededRng(`replay-${weapon}-${seed}`), 'hills');
        const before = cloneTerrain(terrain);
        const tanks = [300, 700, 1100, 1400].map((x, i) => tankAt(terrain, `t${i}`, x, -1, 30));
        const rng = createSeededRng(seed);
        const s = shoot({ terrain, tanks, wind: rng.int(21) - 10 }, 't1', 30 + rng.int(120), 40 + rng.int(60), weapon);
        for (const e of s.events) {
          if (e.k === 'boom' && e.terrain === 'crater') carveCircle(before, e.x, e.y, e.r);
          else if (e.k === 'boom' && e.terrain === 'dirt') addDirt(before, e.x, e.y, e.r);
          else if (e.k === 'bore') carveCapsule(before, e.x0, e.y0, e.x1, e.y1, e.r);
        }
        expect(Array.from(before.h)).toEqual(Array.from(terrain.h));
      }
    }
  });
});
