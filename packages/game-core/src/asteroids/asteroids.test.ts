import { describe, expect, it } from 'vitest';
import { createSeededRng, type Rng } from '@dascade/shared';
import { packControls, type ShipControls } from '@dascade/shared/games/asteroids';
import { DIRS } from '../classics/shared/index.ts';
import {
  RULES,
  ROCK,
  SHIP,
  WORLD,
  botFrame,
  createWorld,
  decodeAsteroidsSnapshot,
  delta,
  encodeAsteroidsSnapshot,
  headingVec,
  retireShip,
  stepShipMotion,
  stepWorld,
  waveRecipe,
  type AsteroidsRules,
  type AsteroidsSimEvent,
  type Rock,
  type ShipMotion,
  type World,
} from './index.ts';

const RULESET: AsteroidsRules = { difficulty: 'pilot', lives: 3, revive: true };
const ctl = (c: Partial<ShipControls>) => packControls({ left: false, right: false, thrust: false, fire: false, aim: false, aimDir: 0, ...c });

function motion(): ShipMotion {
  return { x: 800, y: 500, vx: 0, vy: 0, h: 48, cooldown: 0, shots: 0, spread: 0, rapid: 0, thrusting: false };
}

function world(ids = ['a'], rules: Partial<AsteroidsRules> = {}, seed = 'belt'): { w: World; rng: Rng } {
  const rng = createSeededRng(seed);
  return { w: createWorld({ ...RULESET, ...rules }, ids, rng), rng };
}

function rock(w: World, partial: Partial<Rock>): Rock {
  const r: Rock = { id: 900 + w.rocks.length, kind: 'stone', size: 3, hp: 1, x: 100, y: 100, vx: 0, vy: 0, spin: 0, ...partial };
  w.rocks.push(r);
  return r;
}

function run(w: World, rng: Rng, frames: number[] | ((w: World) => number[]), n: number): AsteroidsSimEvent[] {
  const out: AsteroidsSimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...stepWorld(w, typeof frames === 'function' ? frames(w) : frames, rng).events);
  return out;
}

describe('asteroids: ship flight model', () => {
  it('headings are unit vectors that match the kit table on whole steps', () => {
    for (let h = 0; h < 64; h += 0.125) {
      const [x, y] = headingVec(h);
      expect(Math.abs(x * x + y * y - 1)).toBeLessThan(1e-9);
    }
    expect(headingVec(16)).toEqual([DIRS[16]![0], DIRS[16]![1]]);
  });

  it('turns by the turn rate, staying on 1/8 steps inside [0, 64)', () => {
    const s = motion();
    stepShipMotion(s, ctl({ right: true }), 0);
    expect(s.h).toBe(48 + SHIP.turn);
    for (let i = 0; i < 200; i++) stepShipMotion(s, ctl({ left: true }), 0);
    expect(s.h).toBeGreaterThanOrEqual(0);
    expect(s.h).toBeLessThan(64);
    expect(s.h * 8).toBe(Math.round(s.h * 8));
    const before = s.h;
    stepShipMotion(s, ctl({ left: true, right: true }), 0);
    expect(s.h).toBe(before);
  });

  it('stick aim steers the shortest way and stops on target', () => {
    const s = motion(); // facing up (48)
    stepShipMotion(s, ctl({ aim: true, aimDir: 0 }), 0); // right is +16 away (clockwise)
    expect(s.h).toBe(48 + SHIP.turn);
    for (let i = 0; i < 60; i++) stepShipMotion(s, ctl({ aim: true, aimDir: 0 }), 0);
    expect(s.h).toBe(0);
    const t = motion();
    for (let i = 0; i < 60; i++) stepShipMotion(t, ctl({ aim: true, aimDir: 40 }), 0);
    expect(t.h).toBe(40);
  });

  it('thrust accelerates along the heading, speed is capped, drag slows a coasting ship', () => {
    const s = motion();
    stepShipMotion(s, ctl({ thrust: true }), 0);
    expect(s.vy).toBeLessThan(0);
    expect(Math.abs(s.vx)).toBeLessThan(1e-6);
    for (let i = 0; i < 300; i++) stepShipMotion(s, ctl({ thrust: true }), 0);
    expect(Math.sqrt(s.vx * s.vx + s.vy * s.vy)).toBeLessThanOrEqual(SHIP.maxSpeed + 1e-4);
    const v0 = Math.abs(s.vy);
    for (let i = 0; i < 30; i++) stepShipMotion(s, ctl({}), 0);
    expect(Math.abs(s.vy)).toBeLessThan(v0);
  });

  it('wraps around the belt edges and keeps float32-exact state', () => {
    const s = { ...motion(), x: 2, vx: -5 };
    stepShipMotion(s, ctl({}), 0);
    expect(s.x).toBeGreaterThan(WORLD.width - 10);
    for (const v of [s.x, s.y, s.vx, s.vy]) expect(v).toBe(Math.fround(v));
  });

  it('fires on cooldown; rapid fire halves it; spread fires three', () => {
    const s = motion();
    const a = stepShipMotion(s, ctl({ fire: true }), 2);
    expect(a).toHaveLength(1);
    expect(a[0]!.id).toBe((2 << 12) | 1);
    expect(a[0]!.vy).toBeLessThan(-SHIP.bulletSpeed + 0.001);
    let shots = 0;
    for (let i = 0; i < 60; i++) shots += stepShipMotion(s, ctl({ fire: true }), 2).length;
    expect(shots).toBe(Math.floor(60 / SHIP.fireCooldown));
    const r = { ...motion(), rapid: 1000 };
    let rapid = 0;
    for (let i = 0; i < 60; i++) rapid += stepShipMotion(r, ctl({ fire: true }), 0).length;
    expect(rapid).toBeGreaterThan(shots * 1.8);
    const sp = { ...motion(), spread: 100 };
    expect(stepShipMotion(sp, ctl({ fire: true }), 0)).toHaveLength(3);
    // Dead ships never fire.
    expect(stepShipMotion(motion(), ctl({ fire: true }), 0, false)).toHaveLength(0);
  });

  it('is deterministic: the same frames give bit-identical motion', () => {
    const frames = Array.from({ length: 400 }, (_, i) => ctl({ thrust: i % 7 < 4, left: i % 50 < 20, fire: i % 3 === 0, aim: i > 300, aimDir: i % 64 }));
    const a = motion();
    const b = motion();
    for (const f of frames) {
      stepShipMotion(a, f, 0);
      stepShipMotion(b, f, 0);
    }
    expect(a).toEqual(b);
  });
});

describe('asteroids: rocks, splits and scoring', () => {
  it('wave 1 opens with the recipe count, spawned away from the pilots', () => {
    const { w } = world(['a', 'b']);
    expect(w.wave).toBe(1);
    expect(w.rocks.length).toBe(waveRecipe(1, 2, 'pilot').count);
    for (const r of w.rocks) {
      for (const s of w.ships) {
        const dx = delta(s.x, r.x, WORLD.width);
        const dy = delta(s.y, r.y, WORLD.height);
        expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThanOrEqual(RULES.safeSpawn - 1);
      }
    }
    expect(waveRecipe(8, 4, 'ace').count).toBeGreaterThan(waveRecipe(1, 1, 'cadet').count);
    expect(waveRecipe(3, 1, 'pilot').irons).toBe(1);
    expect(waveRecipe(4, 1, 'pilot').crystals).toBe(2);
  });

  function shoot(w: World, rng: Rng, target: Rock): AsteroidsSimEvent[] {
    // Park the ship below the rock, facing up, and fire once.
    const s = w.ships[0]!;
    s.x = target.x;
    s.y = target.y + 140;
    s.vx = 0;
    s.vy = 0;
    s.h = 48;
    s.cooldown = 0;
    s.invuln = 999;
    const ev = run(w, rng, [ctl({ fire: true })], 1);
    ev.push(...run(w, rng, [0], 30));
    return ev;
  }

  it('a large stone splits into two mediums and scores for the shooter', () => {
    const { w, rng } = world();
    w.rocks = [];
    const r = rock(w, { x: 800, y: 300 });
    rock(w, { x: 100, y: 900, size: 1 }); // keep the wave alive
    const ev = shoot(w, rng, r);
    const hit = ev.find((e) => e.type === 'rock' && e.destroyed);
    expect(hit).toMatchObject({ size: 3, kind: 'stone', by: 0, points: ROCK.points.stone[3] });
    expect(w.rocks.filter((x) => x.size === 2)).toHaveLength(2);
    expect(w.ships[0]!.score).toBe(ROCK.points.stone[3]);
  });

  it('crystals split three ways; iron takes several hits; small rocks just shatter', () => {
    const c = world();
    c.w.rocks = [];
    rock(c.w, { x: 100, y: 900, size: 1 });
    shoot(c.w, c.rng, rock(c.w, { x: 800, y: 300, kind: 'crystal' }));
    expect(c.w.rocks.filter((x) => x.kind === 'crystal' && x.size === 2)).toHaveLength(3);

    const i = world();
    i.w.rocks = [];
    rock(i.w, { x: 100, y: 900, size: 1 });
    const iron = rock(i.w, { x: 800, y: 300, kind: 'iron', hp: ROCK.hp.iron[3] });
    const first = shoot(i.w, i.rng, iron);
    expect(first.find((e) => e.type === 'rock')).toMatchObject({ destroyed: false });
    expect(iron.hp).toBe(ROCK.hp.iron[3]! - 1);

    const s = world();
    s.w.rocks = [];
    rock(s.w, { x: 100, y: 900, size: 1 });
    shoot(s.w, s.rng, rock(s.w, { x: 800, y: 300, size: 1 }));
    expect(s.w.rocks).toHaveLength(1);
  });
});

describe('asteroids: shields, lives and respawn', () => {
  it('the shield soaks a collision and the ship bounces clear', () => {
    const { w, rng } = world();
    w.rocks = [];
    const s = w.ships[0]!;
    s.invuln = 0;
    rock(w, { x: s.x, y: s.y - 60, size: 3, hp: 5, vy: 0 });
    s.vy = -6;
    const ev = run(w, rng, [0], 3);
    expect(ev.find((e) => e.type === 'ship-hit')).toBeTruthy();
    expect(s.shield).toBeLessThan(RULES.shieldMax);
    expect(s.alive).toBe(true);
    expect(s.vy).toBeGreaterThan(0);
  });

  it('without enough shield the ship is lost, then respawns protected; no ships left = out = over', () => {
    const { w, rng } = world(['a'], { lives: 2 });
    w.rocks = [];
    rock(w, { x: 100, y: 900, size: 1 });
    const s = w.ships[0]!;
    s.invuln = 0;
    s.shield = 5;
    rock(w, { x: s.x, y: s.y, size: 3, hp: 5 });
    let ev = run(w, rng, [0], 1);
    expect(ev.find((e) => e.type === 'ship-down')).toMatchObject({ slot: 0, lives: 1 });
    expect(s.alive).toBe(false);
    w.rocks = w.rocks.filter((r) => r.size === 1);
    ev = run(w, rng, [0], RULES.respawnTicks);
    expect(ev.some((e) => e.type === 'respawn')).toBe(true);
    expect(s.alive).toBe(true);
    expect(s.shield).toBe(RULES.shieldMax);
    expect(s.invuln).toBeGreaterThan(0);
    s.invuln = 0;
    s.shield = 0;
    rock(w, { x: s.x, y: s.y, size: 3, hp: 5 });
    ev = run(w, rng, [0], 1);
    expect(s.out).toBe(true);
    expect(w.status).toBe('over');
    expect(ev.some((e) => e.type === 'over')).toBe(true);
    expect(stepWorld(w, [0], rng).events).toEqual([]);
  });

  it('the shield recharges after a quiet spell', () => {
    const { w, rng } = world();
    w.rocks = [];
    rock(w, { x: 100, y: 900, size: 1 });
    const s = w.ships[0]!;
    s.shield = 40;
    s.regenIn = 10;
    run(w, rng, [0], 10);
    expect(s.shield).toBe(40);
    run(w, rng, [0], 100);
    expect(s.shield).toBeGreaterThan(40);
  });
});

describe('asteroids: power-ups', () => {
  function pickup(kind: 'spread' | 'rapid' | 'shield' | 'nova' | 'life') {
    const { w, rng } = world();
    w.rocks = [];
    const keep = rock(w, { x: 100, y: 900, size: 1 });
    const s = w.ships[0]!;
    w.drops.push({ id: 5, kind, x: s.x, y: s.y, vx: 0, vy: 0, ttl: 100 });
    return { w, rng, s, keep, ev: () => run(w, rng, [0], 1) };
  }

  it('spread, rapid, shield and extra ship', () => {
    const sp = pickup('spread');
    expect(sp.ev().find((e) => e.type === 'pickup')).toMatchObject({ kind: 'spread' });
    expect(sp.s.spread).toBeGreaterThan(0);
    const rp = pickup('rapid');
    rp.ev();
    expect(rp.s.rapid).toBeGreaterThan(0);
    const sh = pickup('shield');
    sh.s.shield = 10;
    sh.ev();
    expect(sh.s.shield).toBe(RULES.shieldMax);
    const lf = pickup('life');
    lf.ev();
    expect(lf.s.lives).toBe(RULESET.lives + 1);
    expect(sp.w.drops).toHaveLength(0);
  });

  it('nova damages every rock in range (and not the ones outside)', () => {
    const nv = pickup('nova');
    const near = rock(nv.w, { x: nv.s.x + 150, y: nv.s.y, size: 1 });
    nv.s.invuln = 999;
    const ev = nv.ev();
    expect(ev.some((e) => e.type === 'nova')).toBe(true);
    expect(nv.w.rocks.includes(near)).toBe(false);
    expect(nv.w.rocks.includes(nv.keep)).toBe(true);
    expect(nv.s.score).toBe(ROCK.points.stone[1]);
  });

  it('uncollected drops fade', () => {
    const { w, rng } = world();
    w.drops.push({ id: 9, kind: 'rapid', x: 10, y: 10, vx: 0, vy: 0, ttl: 3 });
    w.ships[0]!.x = 800;
    run(w, rng, [0], 3);
    expect(w.drops.find((d) => d.id === 9)).toBeUndefined();
  });
});

describe('asteroids: waves, co-op and snapshots', () => {
  it('clearing a wave pays a bonus, pauses, then opens the next, bigger wave', () => {
    const { w, rng } = world();
    w.rocks = [];
    const ev = run(w, rng, [0], 1);
    expect(ev.find((e) => e.type === 'wave')).toMatchObject({ wave: 1, bonus: RULES.waveBonus });
    expect(w.status).toBe('intermission');
    expect(w.ships[0]!.score).toBe(RULES.waveBonus);
    run(w, rng, [0], RULES.interTicks);
    expect(w.status).toBe('play');
    expect(w.wave).toBe(2);
    expect(w.rocks.length).toBe(waveRecipe(2, 1, 'pilot').count);
  });

  it('co-op revive brings a downed pilot back when the wave is cleared', () => {
    const { w, rng } = world(['a', 'b']);
    const b = w.ships[1]!;
    b.out = true;
    b.alive = false;
    b.lives = 0;
    w.rocks = [];
    const ev = run(w, rng, [0, 0], RULES.interTicks + 1);
    expect(ev.some((e) => e.type === 'revive' && e.slot === 1)).toBe(true);
    expect(b.alive).toBe(true);
    expect(b.lives).toBe(1);
    const off = world(['a', 'b'], { revive: false });
    off.w.ships[1]!.out = true;
    off.w.ships[1]!.alive = false;
    off.w.rocks = [];
    run(off.w, off.rng, [0, 0], RULES.interTicks + 1);
    expect(off.w.ships[1]!.out).toBe(true);
  });

  it('pilots leaving retire their ship; the run ends when nobody is left', () => {
    const { w } = world(['a', 'b']);
    expect(retireShip(w, 0)).toEqual([]);
    expect(w.status).toBe('play');
    expect(retireShip(w, 1).some((e) => e.type === 'over')).toBe(true);
    expect(retireShip(w, 1)).toEqual([]);
  });

  it('snapshots round-trip (exact ship state) and reject malformed bytes', () => {
    const { w, rng } = world(['a', 'b']);
    run(w, rng, (x) => [botFrame(x, 0), botFrame(x, 1)], 90);
    w.drops.push({ id: 77, kind: 'nova', x: 12.5, y: 40.25, vx: 0, vy: 0, ttl: 30 });
    const bytes = encodeAsteroidsSnapshot(w, 3, [11, 22]);
    const snap = decodeAsteroidsSnapshot(bytes)!;
    expect(snap.matchId).toBe(3);
    expect(snap.tick).toBe(w.tick);
    expect(snap.ships[1]!.ack).toBe(22);
    expect(snap.ships[0]!.x).toBe(w.ships[0]!.x);
    expect(snap.ships[0]!.vy).toBe(w.ships[0]!.vy);
    expect(snap.ships[0]!.h).toBe(w.ships[0]!.h);
    expect(snap.rocks).toHaveLength(w.rocks.length);
    expect(snap.rocks[0]!.x).toBeCloseTo(w.rocks[0]!.x, 1);
    expect(snap.bullets).toHaveLength(w.bullets.length);
    expect(snap.drops.find((d) => d.id === 77)).toMatchObject({ kind: 'nova', ttl: 30 });
    expect(decodeAsteroidsSnapshot(bytes.slice(0, bytes.length - 1))).toBeNull();
    const bad = bytes.slice();
    bad[0] = 42;
    expect(decodeAsteroidsSnapshot(bad)).toBeNull();
  });

  it('bot runs are deterministic and progress through waves until the pilots run out', () => {
    const play = (seed: string, pilots: string[]) => {
      const { w, rng } = world(pilots, { difficulty: 'cadet' }, seed);
      let guard = 0;
      while (w.status !== 'over' && guard++ < 60 * 60 * 6) stepWorld(w, pilots.map((_, i) => botFrame(w, i)), rng);
      return w;
    };
    const a = play('run', ['a']);
    const b = play('run', ['a']);
    expect(a.tick).toBe(b.tick);
    expect(a.teamScore).toBe(b.teamScore);
    expect(a.wave).toBeGreaterThanOrEqual(2);
    const coop = play('coop', ['a', 'b', 'c']);
    expect(coop.teamScore).toBe(coop.ships.reduce((n, s) => n + s.score, 0));
  });
});
