import { describe, expect, it } from 'vitest';
import { carveCircle, cloneTerrain, createTerrain, applyPatch, type Terrain } from '@dascade/game-core/tanks';
import type { ShotEvent, ShotScript } from '@dascade/shared/games/tanks';
import {
  applyShotEvent,
  beamTimes,
  expireLayers,
  fireOrigin,
  gravityScale,
  QUIPS_PER_TANK,
  type DisplayTank,
  type PlaybackWorld,
} from './playback.ts';

function tank(id: string, x: number, y: number, extra: Partial<DisplayTank> = {}): DisplayTank {
  return {
    id,
    name: id,
    color: '#ff8a3d',
    team: -1,
    cpu: false,
    slot: 0,
    x,
    y,
    hp: 100,
    maxHp: 100,
    alive: true,
    gone: false,
    angle: 45,
    power: 60,
    weapon: 'shell',
    fuel: 0,
    maxFuel: 0,
    shield: 0,
    shieldMax: 0,
    shieldKind: '',
    buried: false,
    locked: false,
    anim: null,
    hitAt: 0,
    diedAt: 0,
    shieldHitAt: 0,
    warpAt: 0,
    ...extra,
  };
}

function world(
  terrain: Terrain = createTerrain(400, 900, 200),
  tanks: DisplayTank[] = [],
): PlaybackWorld & { dirty: Array<[number, number]>; scorched: number[] } {
  const dirty: Array<[number, number]> = [];
  const scorched: number[] = [];
  return {
    terrain,
    tanks: new Map(tanks.map((t) => [t.id, t])),
    fires: [],
    marks: [],
    quips: [],
    fx: [],
    markDirty: (x0, x1) => dirty.push([x0, x1]),
    scorch: (x) => scorched.push(x),
    serial: 0,
    dirty,
    scorched,
  };
}

describe('applyShotEvent (client replay of a shot script)', () => {
  it('carves craters bit-exactly like the engine and marks the columns dirty', () => {
    const w = world();
    const expected = cloneTerrain(w.terrain);
    carveCircle(expected, 120.3, 200.1, 40);
    applyShotEvent(w, { k: 'boom', t: 0, x: 120.3, y: 200.1, r: 40, w: 'shell', terrain: 'crater', owner: 'a' }, 0, false);
    expect(Array.from(w.terrain.h)).toEqual(Array.from(expected.h));
    expect(w.dirty.length).toBe(1);
    expect(w.scorched).toEqual([120.3]);
    expect(w.fx[0]).toMatchObject({ kind: 'boom', w: 'shell', owner: 'a' });
  });

  it('applies terrain patches (mudslides) and reports whether the ground rose', () => {
    const w = world();
    const h = [210, 220.25, 230.5];
    const expected = cloneTerrain(w.terrain);
    applyPatch(expected, 50, h);
    applyShotEvent(w, { k: 'patch', t: 0, x0: 50, h }, 0, false);
    expect(Array.from(w.terrain.h)).toEqual(Array.from(expected.h));
    expect(w.fx[0]).toMatchObject({ kind: 'patch', x0: 50, x1: 53, raised: true });
  });

  it('a bore at the same moment as a beam is instant; a driller bore takes its time', () => {
    const w = world();
    const script = { events: [{ k: 'beam', t: 100, x0: 0, y0: 0, x1: 50, y1: 50, w: 'railgun' }] } as unknown as ShotScript;
    const beams = beamTimes(script);
    applyShotEvent(w, { k: 'bore', t: 100, x0: 10, y0: 200, x1: 60, y1: 150, r: 5 }, 0, false, beams);
    applyShotEvent(w, { k: 'bore', t: 500, x0: 10, y0: 200, x1: 10, y1: 50, r: 9 }, 0, false, beams);
    const [beamBore, drill] = w.fx as Array<{ durMs: number }>;
    expect(beamBore!.durMs).toBeLessThan(100);
    expect(drill!.durMs).toBeGreaterThan(300);
  });

  it('shields soak hits and break; deaths clear them', () => {
    const t = tank('a', 100, 200, { shield: 60, shieldMax: 60, shieldKind: 'deflector' });
    const w = world(undefined, [t]);
    applyShotEvent(w, { k: 'shield', t: 0, id: 'a', hp: 25, absorbed: 35 }, 10, false);
    expect(t.shield).toBe(25);
    expect(t.shieldKind).toBe('deflector');
    expect(t.shieldHitAt).toBe(10);
    applyShotEvent(w, { k: 'shield', t: 0, id: 'a', hp: 0, absorbed: 25 }, 20, false);
    expect(t.shield).toBe(0);
    expect(t.shieldKind).toBe('');
    expect(w.fx[1]).toMatchObject({ kind: 'shield', broke: true, shieldKind: 'deflector' });
    applyShotEvent(w, { k: 'dmg', t: 0, id: 'a', amount: 30, hp: 70, src: 'burn', by: 'b' }, 30, false);
    expect(t.hp).toBe(70);
    applyShotEvent(w, { k: 'death', t: 0, id: 'a', by: 'b' }, 40, false);
    expect(t.alive).toBe(false);
    expect(w.fx.at(-1)).toMatchObject({ kind: 'death', by: 'b' });
  });

  it('parachute falls are flagged; warps move the tank at once', () => {
    const t = tank('a', 100, 300);
    const w = world(undefined, [t]);
    applyShotEvent(w, { k: 'move', t: 0, id: 'a', y0: 300, y1: 200, dur: 1100, chute: true }, 5, false);
    expect(t.anim).toMatchObject({ chute: true, y1: 200, dur: 1100 });
    expect(w.fx[0]).toMatchObject({ kind: 'chute' });
    applyShotEvent(w, { k: 'warp', t: 0, id: 'a', x0: 100, y0: 300, x1: 320, y1: 210 }, 6, false);
    expect(t).toMatchObject({ x: 320, y: 210, anim: null, warpAt: 6 });
  });

  it('keeps at most two speech bubbles per tank, newest wins', () => {
    const w = world(undefined, [tank('a', 100, 200)]);
    for (let i = 0; i < 4; i++) applyShotEvent(w, { k: 'quip', t: 0, id: 'a', line: `line ${i}` }, i * 10, false);
    expect(w.quips.length).toBe(QUIPS_PER_TANK);
    expect(w.quips.map((q) => q.line)).toEqual(['line 2', 'line 3']);
  });

  it('fires become layers spreading from the highest burning ground; markers wait for the lance', () => {
    const terrain = createTerrain(400, 900, 200);
    for (let i = 100; i < 110; i++) terrain.h[i] = 260 - (i - 100) * 4;
    const w = world(terrain);
    const cells = new Array(20).fill(0).map((_, k) => (k < 15 ? 5 : 0));
    applyShotEvent(w, { k: 'fire', t: 0, x0: 98, cells, dur: 3000, hot: false }, 100, false);
    expect(w.fires.length).toBe(1);
    expect(w.fires[0]!.origin).toBe(100);
    expect(w.scorched.length).toBe(15);
    applyShotEvent(w, { k: 'mark', t: 0, x: 200, y: 200 }, 100, false);
    expect(w.marks.length).toBe(1);
    applyShotEvent(w, { k: 'beam', t: 900, x0: 202, y0: 900, x1: 202, y1: 100, w: 'skylance' }, 1000, false);
    expect(w.marks.length).toBe(0);
    expireLayers(w, 100 + 3001);
    expect(w.fires.length).toBe(0);
  });

  it('fast-forward (quiet) changes the state but shows nothing', () => {
    const t = tank('a', 100, 200);
    const w = world(undefined, [t]);
    const events: ShotEvent[] = [
      { k: 'boom', t: 0, x: 100, y: 200, r: 30, w: 'shell', terrain: 'crater', owner: 'b' },
      { k: 'quip', t: 0, id: 'a', line: 'ow' },
      { k: 'fire', t: 0, x0: 90, cells: [3, 3], dur: 2000, hot: true },
      { k: 'dmg', t: 0, id: 'a', amount: 40, hp: 60, src: 'blast', by: 'b' },
    ];
    for (const e of events) applyShotEvent(w, e, 0, true);
    expect(w.fx.length).toBe(0);
    expect(w.quips.length).toBe(0);
    expect(w.fires.length).toBe(0);
    expect(t.hp).toBe(60);
    expect(w.terrain.h[100]).toBeLessThan(200);
  });
});

describe('playback helpers', () => {
  it('fireOrigin picks the highest burning column', () => {
    const terrain = createTerrain(50, 900, 100);
    terrain.h[12] = 140;
    expect(fireOrigin(terrain, 10, [0, 2, 2, 2])).toBe(12);
    expect(fireOrigin(terrain, 10, [0, 0])).toBe(10);
  });

  it('gravityScale maps the battle setting', () => {
    expect(gravityScale('low')).toBeLessThan(1);
    expect(gravityScale('normal')).toBe(1);
    expect(gravityScale('high')).toBeGreaterThan(1);
    expect(gravityScale(undefined)).toBe(1);
  });
});
