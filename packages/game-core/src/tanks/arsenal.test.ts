import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { TANK_GEOM, TANKS_WORLD, type ConcreteWallMode, type ShotEvent, type ShotScript, type WeaponId } from '@dascade/shared/games/tanks';
import { dcos, dsin } from './trig.ts';
import { cloneTerrain, createTerrain, isBuried, quantize, restHeight, type Terrain } from './terrain.ts';
import { resolveHazard, resolveShot, resolveShots, type ShotRules, type SimTank, type SimWorld } from './sim.ts';
import { MUD_FLOW, NAPALM_FLOW, pour, wetRange } from './flow.ts';
import { PHYS, WEAPON_SPECS } from './weapons.ts';

const FFA: ShotRules = { teams: false, friendlyFire: true };

function flat(height = 200): Terrain {
  return createTerrain(TANKS_WORLD.width, TANKS_WORLD.height, height);
}

/** A V-shaped valley with its bottom at `bottom` (column `cx`). */
function valley(cx = 800, bottom = 120, slope = 0.5): Terrain {
  const t = flat(200);
  for (let x = 0; x < t.width; x++) t.h[x] = quantize(Math.min(500, bottom + Math.abs(x + 0.5 - cx) * slope));
  return t;
}

function tankAt(terrain: Terrain, id: string, x: number, extra: Partial<SimTank> = {}): SimTank {
  return { id, team: -1, x, y: restHeight(terrain, x), hp: 100, alive: true, shield: 0, shieldKind: '', chutes: 0, ...extra };
}

function world(terrain: Terrain, tanks: SimTank[], extra: Partial<SimWorld> = {}): SimWorld {
  return { terrain, tanks, wind: 0, walls: 'open', gravity: 1, ...extra };
}

function shoot(
  w: SimWorld,
  shooterId: string,
  angle: number,
  power: number,
  weapon: WeaponId,
  rules: ShotRules = FFA,
  seed = 1,
): ShotScript {
  return resolveShot(w, { shooterId, angle, power, weapon }, rules, { seq: 1, turnId: 1, seed });
}

/** Closed-form landing point on flat ground (no wind). */
function landing(t: { x: number; y: number }, angle: number, power: number, ground: number, g = PHYS.gravity): number {
  const c = dcos(angle);
  const s = dsin(angle);
  const x0 = t.x + c * TANK_GEOM.barrel;
  const y0 = t.y + TANK_GEOM.pivot + s * TANK_GEOM.barrel;
  const v = (PHYS.maxSpeed * power) / 100;
  const vy = s * v;
  const time = (vy + Math.sqrt(vy * vy + 2 * g * (y0 - ground))) / g;
  return x0 + c * v * time;
}

const of = <K extends ShotEvent['k']>(s: ShotScript, k: K) => s.events.filter((e): e is Extract<ShotEvent, { k: K }> => e.k === k);
const dmgTo = (s: ShotScript, id: string) =>
  of(s, 'dmg')
    .filter((e) => e.id === id)
    .reduce((n, e) => n + e.amount, 0);

describe('splitters', () => {
  it('a MIRV fans five full warheads out from the apex', () => {
    const terrain = flat();
    const a = tankAt(terrain, 'a', 200);
    const s = shoot(world(terrain, [a]), 'a', 60, 72, 'mirv');
    expect(of(s, 'split')).toHaveLength(1);
    expect(s.projectiles.filter((p) => p.kind === 'warhead')).toHaveLength(5);
    const booms = of(s, 'boom').filter((b) => b.w === 'warhead');
    expect(booms).toHaveLength(5);
    expect(booms.every((b) => b.r === WEAPON_SPECS.mirv.split!.sub.radius)).toBe(true);
    // The fan is wider than a cluster's.
    const spread = Math.max(...booms.map((b) => b.x)) - Math.min(...booms.map((b) => b.x));
    expect(spread).toBeGreaterThan(200);
  });

  it('a Party Popper bursts on impact into seeded, scattered confetti', () => {
    const run = (seed: number) => {
      const terrain = flat();
      const a = tankAt(terrain, 'a', 200);
      return shoot(world(terrain, [a]), 'a', 45, 60, 'popper', FFA, seed);
    };
    const s1 = run(7);
    expect(s1.projectiles.filter((p) => p.kind === 'confetti')).toHaveLength(9);
    expect(of(s1, 'boom').filter((b) => b.w === 'confetti')).toHaveLength(9);
    expect(run(7)).toEqual(s1);
    const xs = (s: ShotScript) =>
      of(s, 'boom')
        .filter((b) => b.w === 'confetti')
        .map((b) => b.x);
    expect(xs(run(8))).not.toEqual(xs(s1));
  });
});

describe('rollers and bouncers', () => {
  it('a roller lands on a slope, rolls down and blows up in the valley', () => {
    const terrain = valley(800, 120, 0.45);
    const a = tankAt(terrain, 'a', 300);
    // Land it on the left slope, short of the valley floor.
    const s = shoot(world(terrain, [a]), 'a', 50, 62, 'roller');
    const flight = s.projectiles.find((p) => p.kind === 'roller')!;
    expect(flight.end).toBe('roll');
    const roll = s.projectiles.find((p) => p.kind === 'rolling')!;
    expect(roll).toBeTruthy();
    const boom = of(s, 'boom')[0]!;
    const landX = flight.pts[flight.pts.length - 2]!;
    expect(Math.abs(boom.x - 800)).toBeLessThan(60);
    expect(Math.abs(boom.x - 800)).toBeLessThan(Math.abs(landX - 800) - 100);
  });

  it('a roller stops at a tank in its way and hits it directly', () => {
    const terrain = valley(800, 120, 0.45);
    const a = tankAt(terrain, 'a', 300);
    const victim = tankAt(terrain, 'v', 950);
    const s = shoot(world(terrain, [a, victim]), 'a', 50, 62, 'roller');
    const boom = of(s, 'boom')[0]!;
    expect(boom.direct).toBe('v');
    const blast = of(s, 'dmg').filter((e) => e.id === 'v' && e.src === 'blast');
    expect(blast.reduce((n, e) => n + e.amount, 0)).toBe(WEAPON_SPECS.roller.blast.damage);
  });

  it('a leapfrog explodes on three landings', () => {
    const terrain = flat();
    const a = tankAt(terrain, 'a', 200);
    const s = shoot(world(terrain, [a]), 'a', 45, 55, 'leapfrog');
    expect(of(s, 'boom').filter((b) => b.w === 'leapfrog')).toHaveLength(3);
    expect(s.projectiles.filter((p) => p.kind === 'hop')).toHaveLength(2);
    const xs = of(s, 'boom').map((b) => b.x);
    expect(xs[1]!).toBeGreaterThan(xs[0]!);
    expect(xs[2]!).toBeGreaterThan(xs[1]!);
  });
});

describe('fire and liquid earth', () => {
  it('pouring conserves volume and runs downhill into the valley', () => {
    const terrain = valley(800, 120, 0.5);
    const pool = pour(terrain, 700, 1000, NAPALM_FLOW);
    const sum = pool.depth.reduce((n, v) => n + v, 0);
    expect(sum).toBeCloseTo(1000, 6);
    const deepest = pool.depth.indexOf(Math.max(...pool.depth)) + pool.x0;
    expect(Math.abs(deepest - 800)).toBeLessThan(8);
    // Thicker mud keeps a steeper body than fuel.
    const mud = pour(terrain, 700, 1000, MUD_FLOW);
    const w = (p: typeof pool) => wetRange(p).b - wetRange(p).a;
    expect(w(mud)).toBeLessThanOrEqual(w(pool));
  });

  it('napalm pools in the valley and burns the tank sitting there, in pulses, capped', () => {
    const terrain = valley(800, 120, 0.4);
    const a = tankAt(terrain, 'a', 300);
    const camper = tankAt(terrain, 'c', 800);
    const far = tankAt(terrain, 'f', 1450);
    const s = shoot(world(terrain, [a, camper, far]), 'a', 50, 62, 'napalm');
    const fire = of(s, 'fire')[0]!;
    expect(fire).toBeTruthy();
    expect(fire.x0).toBeLessThan(800);
    expect(fire.x0 + fire.cells.length).toBeGreaterThan(800);
    const burns = of(s, 'dmg').filter((e) => e.id === 'c' && e.src === 'burn');
    expect(burns.length).toBeGreaterThanOrEqual(3);
    expect(burns.every((e, i) => i === 0 || e.t > burns[i - 1]!.t)).toBe(true);
    const burned = burns.reduce((n, e) => n + e.amount, 0);
    expect(burned).toBeGreaterThan(20);
    expect(burned).toBeLessThanOrEqual(WEAPON_SPECS.napalm.fire!.damage);
    expect(far.hp).toBe(100);
    // The playback covers the whole burn.
    expect(s.durationMs).toBeGreaterThanOrEqual(fire.t + fire.dur);
    expect(s.damage.a).toBe(100 - camper.hp);
  });

  it('a mudslide fills the valley and buries whoever is down there', () => {
    const terrain = valley(800, 120, 0.4);
    const before = cloneTerrain(terrain);
    const a = tankAt(terrain, 'a', 300);
    const camper = tankAt(terrain, 'c', 800);
    const s = shoot(world(terrain, [a, camper]), 'a', 50, 62, 'mudslide');
    const patch = of(s, 'patch')[0]!;
    expect(patch.h.length).toBeGreaterThan(10);
    expect(terrain.h[800]!).toBeGreaterThan(before.h[800]! + TANK_GEOM.buriedDepth);
    expect(isBuried(terrain, camper.x, camper.y)).toBe(true);
    expect(camper.hp).toBe(100);
  });
});

describe('specials', () => {
  it('a seeker steers toward the enemy after the apex', () => {
    const terrain = flat();
    const run = (weapon: WeaponId) => {
      const t = cloneTerrain(terrain);
      const a = tankAt(t, 'a', 200);
      const target = tankAt(t, 'b', 1100);
      const s = shoot(world(t, [a, target]), 'a', 55, 62, weapon);
      return Math.abs(of(s, 'boom')[0]!.x - 1100);
    };
    expect(run('seeker')).toBeLessThan(run('shell') * 0.5);
  });

  it('the railgun beam ignores gravity and wind, pierces a thin hill and hits the tank behind', () => {
    const terrain = flat();
    for (let x = 500; x < 530; x++) terrain.h[x] = 260;
    const a = tankAt(terrain, 'a', 200);
    const b = tankAt(terrain, 'b', 900);
    const s = shoot(world(terrain, [a, b], { wind: 15 }), 'a', 0, 60, 'railgun');
    expect(s.projectiles).toHaveLength(0);
    const beam = of(s, 'beam')[0]!;
    expect(beam.w).toBe('railgun');
    expect(of(s, 'bore').length).toBeGreaterThanOrEqual(1);
    expect(dmgTo(s, 'b')).toBe(WEAPON_SPECS.railgun.beam!.damage);
    expect(terrain.h[515]!).toBeLessThan(260);
  });

  it('the railgun stops inside a hill thicker than it can pierce', () => {
    const terrain = flat();
    for (let x = 400; x < 700; x++) terrain.h[x] = 320;
    const a = tankAt(terrain, 'a', 200);
    const b = tankAt(terrain, 'b', 900);
    shoot(world(terrain, [a, b]), 'a', 0, 60, 'railgun');
    expect(b.hp).toBe(100);
  });

  it('a Sky Lance marks the spot, then an orbital beam strikes there a moment later', () => {
    const terrain = flat();
    const a = tankAt(terrain, 'a', 200);
    const x = Math.round(landing(a, 45, 60, 200));
    const b = tankAt(terrain, 'b', x + 10);
    const s = shoot(world(terrain, [a, b]), 'a', 45, 60, 'skylance');
    const mark = of(s, 'mark')[0]!;
    const beam = of(s, 'beam')[0]!;
    expect(beam.w).toBe('skylance');
    expect(beam.t - mark.t).toBeGreaterThanOrEqual(WEAPON_SPECS.skylance.lance!.delayMs - 20);
    expect(beam.x0).toBe(beam.x1);
    expect(dmgTo(s, 'b')).toBeGreaterThan(30);
    expect(terrain.h[Math.round(beam.x0)]!).toBeLessThan(200 - 60);
  });

  it('a Warp Shell moves its shooter to where it lands (and misses off the field)', () => {
    const terrain = flat();
    const a = tankAt(terrain, 'a', 200);
    const x = landing(a, 45, 60, 200);
    const s = shoot(world(terrain, [a]), 'a', 45, 60, 'warp');
    const warp = of(s, 'warp')[0]!;
    expect(Math.abs(warp.x1 - x)).toBeLessThan(4);
    expect(a.x).toBe(warp.x1);
    expect(a.y).toBe(restHeight(terrain, a.x));
    expect(of(s, 'boom')).toHaveLength(0);
    const b = tankAt(terrain, 'b', 1500);
    const miss = shoot(world(terrain, [b]), 'b', 10, 100, 'warp');
    expect(of(miss, 'warp')).toHaveLength(0);
    expect(b.x).toBe(1500);
  });

  it('tracers, excavators and dirt hurt nobody; the excavator clears a bowl', () => {
    const terrain = flat();
    const a = tankAt(terrain, 'a', 200);
    const x = Math.round(landing(a, 45, 60, 200));
    const b = tankAt(terrain, 'b', x);
    const tracer = shoot(world(cloneTerrain(terrain), [{ ...a }, { ...b }]), 'a', 45, 60, 'tracer');
    expect(of(tracer, 'boom')).toHaveLength(0);
    expect(of(tracer, 'dmg')).toHaveLength(0);
    const t2 = cloneTerrain(terrain);
    const b2 = tankAt(t2, 'b', x + 120);
    const dig = shoot(world(t2, [tankAt(t2, 'a', 200), b2]), 'a', 45, 60, 'excavator');
    expect(of(dig, 'dmg').filter((e) => e.src === 'blast')).toHaveLength(0);
    expect(t2.h[x]!).toBeLessThan(200 - 25);
  });
});

describe('defense', () => {
  it('a shield soaks damage before the armor, then breaks and passes the rest on', () => {
    const terrain = flat();
    const a = tankAt(terrain, 'a', 200);
    const x = Math.round(landing(a, 45, 60, 200));
    const b = tankAt(terrain, 'b', x, { shield: 30, shieldKind: 'shield' });
    const s = shoot(world(terrain, [a, b]), 'a', 45, 60, 'shell');
    const hit = of(s, 'shield')[0]!;
    expect(hit.absorbed).toBe(30);
    expect(hit.hp).toBe(0);
    expect(b.shield).toBe(0);
    expect(b.shieldKind).toBe('');
    expect(b.hp).toBe(100 - (WEAPON_SPECS.shell.blast.damage - 30));
    expect(of(s, 'dmg')[0]!.shield).toBe(30);
  });

  it('a shell bursts on the shield bubble instead of the hull', () => {
    const terrain = flat();
    const a = tankAt(terrain, 'a', 200);
    const x = Math.round(landing(a, 45, 60, 200));
    const b = tankAt(terrain, 'b', x, { shield: 130, shieldKind: 'heavyshield' });
    const s = shoot(world(terrain, [a, b]), 'a', 45, 60, 'heavy');
    const boom = of(s, 'boom')[0]!;
    expect(boom.direct).toBe('b');
    const cy = b.y + TANK_GEOM.hitCenter;
    expect(Math.hypot(boom.x - b.x, boom.y - cy)).toBeGreaterThan(TANK_GEOM.hitRadius);
    // The shield soaked the whole blast (falling into the crater isn't something a shield stops).
    expect(of(s, 'dmg').filter((e) => e.id === 'b' && e.src === 'blast')).toHaveLength(0);
    expect(b.shield).toBe(130 - WEAPON_SPECS.heavy.blast.damage);
  });

  it('a deflector turns a shell away unharmed', () => {
    const terrain = flat();
    const a = tankAt(terrain, 'a', 200);
    const x = Math.round(landing(a, 45, 60, 200));
    const b = tankAt(terrain, 'b', x, { shield: 60, shieldKind: 'deflector' });
    const s = shoot(world(terrain, [a, b]), 'a', 45, 60, 'shell');
    expect(of(s, 'deflect')).toHaveLength(1);
    expect(b.hp).toBe(100);
    expect(b.shield).toBe(60 - PHYS.deflectCost);
    expect(Math.abs(of(s, 'boom')[0]!.x - x)).toBeGreaterThan(30);
  });

  it('a parachute opens on a long drop: no fall damage, one chute spent', () => {
    const run = (chutes: number) => {
      const terrain = flat(300);
      const a = tankAt(terrain, 'a', 200);
      const x = Math.round(landing(a, 45, 60, 300));
      const b = tankAt(terrain, 'b', x + 60, { chutes, hp: 300 });
      // A heavy just beside b digs the ground out from under it.
      const s = shoot(world(terrain, [a, b]), 'a', 45, 60, 'nuke');
      return { s, b };
    };
    const without = run(0);
    const fallHurt = of(without.s, 'dmg').filter((e) => e.id === 'b' && e.src === 'fall');
    expect(fallHurt.length).toBe(1);
    const withChute = run(2);
    expect(of(withChute.s, 'dmg').filter((e) => e.id === 'b' && e.src === 'fall')).toHaveLength(0);
    const move = of(withChute.s, 'move').find((e) => e.id === 'b')!;
    expect(move.chute).toBe(true);
    expect(withChute.b.chutes).toBe(1);
  });
});

describe('burial', () => {
  it('a buried tank that fires a shell blows it up at the muzzle; an excavator digs it out unharmed', () => {
    const setup = () => {
      const terrain = flat();
      const a = tankAt(terrain, 'a', 400);
      for (let x = 340; x < 460; x++) terrain.h[x] = 270;
      return { terrain, a };
    };
    const one = setup();
    expect(isBuried(one.terrain, one.a.x, one.a.y)).toBe(true);
    const s = shoot(world(one.terrain, [one.a, tankAt(one.terrain, 'b', 1200)]), 'a', 45, 60, 'shell');
    const boom = of(s, 'boom')[0]!;
    expect(Math.hypot(boom.x - one.a.x, boom.y - one.a.y)).toBeLessThan(40);
    expect(one.a.hp).toBeLessThan(100);
    const two = setup();
    shoot(world(two.terrain, [two.a, tankAt(two.terrain, 'b', 1200)]), 'a', 90, 20, 'excavator');
    expect(two.a.hp).toBe(100);
    expect(isBuried(two.terrain, two.a.x, two.a.y)).toBe(false);
  });
});

describe('walls', () => {
  const edgeShot = (walls: ConcreteWallMode) => {
    const terrain = flat();
    const a = tankAt(terrain, 'a', 1450);
    return { s: shoot(world(terrain, [a], { walls }), 'a', 40, 80, 'shell'), a, terrain };
  };

  it('open walls lose shells off the side', () => {
    const { s } = edgeShot('open');
    expect(s.projectiles[0]!.end).toBe('out');
    expect(of(s, 'boom')).toHaveLength(0);
  });

  it('concrete walls make them burst at the wall', () => {
    const { s } = edgeShot('concrete');
    expect(of(s, 'boom')[0]!.x).toBe(TANKS_WORLD.width);
  });

  it('bounce walls send them back into the field', () => {
    const { s } = edgeShot('bounce');
    const boom = of(s, 'boom')[0]!;
    expect(boom.x).toBeLessThan(1350);
    expect(s.projectiles).toHaveLength(1);
  });

  it('wrap-around walls bring them in from the other side as a new path', () => {
    const { s } = edgeShot('wrap');
    expect(s.projectiles[0]!.end).toBe('wrap');
    expect(s.projectiles).toHaveLength(2);
    expect(s.projectiles[1]!.pts[0]!).toBeLessThan(10);
    expect(s.projectiles[1]!.end).toBe('boom');
  });
});

describe('gravity', () => {
  it('low gravity carries a shell much farther', () => {
    const land = (gravity: number) => {
      const terrain = flat();
      const a = tankAt(terrain, 'a', 100);
      return of(shoot(world(terrain, [a], { gravity, walls: 'concrete' }), 'a', 45, 40, 'shell'), 'boom')[0]!.x;
    };
    expect(land(0.6)).toBeGreaterThan(land(1) * 1.4);
    expect(land(1.45)).toBeLessThan(land(1));
  });
});

describe('volleys and hazards', () => {
  it('every locked-in shot flies in one script, a beat apart, each credited to its shooter', () => {
    const terrain = flat();
    const a = tankAt(terrain, 'a', 200);
    const b = tankAt(terrain, 'b', 1400);
    const xa = Math.round(landing(a, 45, 70, 200));
    const victim = tankAt(terrain, 'v', xa, { hp: 40 });
    const s = resolveShots(
      world(terrain, [a, b, victim]),
      [
        { shooterId: 'a', angle: 45, power: 70, weapon: 'shell' },
        { shooterId: 'b', angle: 135, power: 40, weapon: 'shell' },
      ],
      FFA,
      { seq: 3, turnId: 9, kind: 'volley', staggerMs: 160 },
    );
    expect(s.kind).toBe('volley');
    expect(s.launches.map((l) => l.shooterId)).toEqual(['a', 'b']);
    expect(s.launches[1]!.t0 - s.launches[0]!.t0).toBeCloseTo(160, -1);
    expect(s.kills).toEqual([{ by: 'a', id: 'v' }]);
    expect(s.damage.a).toBe(40);
    expect(new Set(s.projectiles.map((p) => p.owner))).toEqual(new Set(['a', 'b']));
    expect(of(s, 'death')[0]!.by).toBe('a');
  });

  it('meteors crater the field and credit nobody; lightning strikes near its column', () => {
    const terrain = flat();
    const a = tankAt(terrain, 'a', 400);
    const s = resolveHazard(
      world(terrain, [a]),
      {
        what: 'meteor',
        strikes: [
          { x: 900, vx: 0 },
          { x: 1200, vx: 40 },
        ],
      },
      FFA,
      { seq: 1, turnId: 1 },
    );
    expect(s.kind).toBe('hazard');
    expect(s.launches).toHaveLength(0);
    expect(of(s, 'boom').filter((b) => b.w === 'meteor')).toHaveLength(2);
    expect(of(s, 'boom').every((b) => b.owner === '')).toBe(true);
    expect(terrain.h[900]!).toBeLessThan(200);
    const t2 = flat();
    const b = tankAt(t2, 'b', 600);
    const bolt = resolveHazard(world(t2, [b]), { what: 'lightning', strikes: [{ x: 606 }] }, FFA, { seq: 2, turnId: 1 });
    expect(of(bolt, 'beam')[0]!.w).toBe('lightning');
    expect(b.hp).toBeLessThan(100);
    expect(of(bolt, 'dmg')[0]!.by).toBe('');
    expect(Object.keys(bolt.damage)).toHaveLength(0);
  });

  it('tanks talk when they fire and die, when asked to', () => {
    const terrain = flat();
    const a = tankAt(terrain, 'a', 200);
    const x = Math.round(landing(a, 45, 60, 200));
    const b = tankAt(terrain, 'b', x, { hp: 10 });
    const rng = createSeededRng(1);
    const s = resolveShots(world(terrain, [a, b]), [{ shooterId: 'a', angle: 45, power: 60, weapon: 'shell' }], FFA, {
      seq: 1,
      turnId: 1,
      quip: (kind, id) => `${kind}:${id}:${rng.int(10)}`,
    });
    const quips = of(s, 'quip');
    expect(quips.map((q) => q.line.split(':').slice(0, 2).join(':'))).toEqual(['fire:a', 'death:b']);
  });
});
