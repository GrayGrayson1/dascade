import { describe, expect, it } from 'vitest';
import { createTerrain } from '@dascade/game-core/tanks';
import { FIRE_SPREAD, fireFlames, fireSpan, flameHeight } from './fire.ts';
import { layoutBubbles, wrapLine } from './bubbles.ts';

describe('napalm flame geometry', () => {
  const terrain = createTerrain(400, 900, 150);
  const layer = { x0: 100, cells: new Array(60).fill(0).map((_, k) => (k >= 10 && k < 50 ? 1 + (k % 9) : 0)), dur: 3000, origin: 130 };

  it('spreads out from the origin, then covers every burning column', () => {
    const early = fireFlames(layer, terrain, 10, 1);
    const reach = (10 / 1000) * FIRE_SPREAD;
    expect(early.length).toBeGreaterThan(0);
    for (const f of early) expect(Math.abs(Math.floor(f.x) - layer.origin)).toBeLessThanOrEqual(Math.ceil(reach) + 1);
    const full = fireFlames(layer, terrain, 1000, 1);
    expect(full.length).toBe(40);
    for (const f of full) {
      expect(f.base).toBe(150);
      expect(f.alpha).toBeCloseTo(1);
    }
  });

  it('groups columns by step and dies down at the end', () => {
    const grouped = fireFlames(layer, terrain, 1000, 4);
    expect(grouped.length).toBeLessThanOrEqual(Math.ceil(40 / 4) + 1);
    const dying = fireFlames(layer, terrain, layer.dur - 100, 4);
    expect(dying.every((f) => f.alpha < 0.3)).toBe(true);
    expect(fireFlames(layer, terrain, layer.dur + 1, 4)).toEqual([]);
    expect(fireFlames(layer, terrain, -1, 4)).toEqual([]);
  });

  it('hotter cells make taller tongues; spans cover the burning range', () => {
    expect(flameHeight(9)).toBeGreaterThan(flameHeight(1));
    expect(fireSpan(layer)).toEqual({ x0: 110, x1: 150 });
    expect(fireSpan({ x0: 0, cells: [0, 0] })).toBeNull();
  });
});

describe('speech bubbles', () => {
  it('stacks the newest bubble nearest the tank and fades old ones out', () => {
    const quips = [
      { key: 1, id: 'a', line: 'first', start: 0, life: 2600 },
      { key: 2, id: 'a', line: 'second', start: 500, life: 2600 },
      { key: 3, id: 'b', line: 'other', start: 100, life: 2600 },
    ];
    const slots = layoutBubbles(quips, 1000);
    const a = slots.filter((s) => s.id === 'a');
    expect(a.find((s) => s.key === 2)!.row).toBe(0);
    expect(a.find((s) => s.key === 1)!.row).toBe(1);
    expect(slots.find((s) => s.id === 'b')!.row).toBe(0);
    const late = layoutBubbles(quips, 2500);
    expect(late.find((s) => s.key === 1)!.alpha).toBeLessThan(0.5);
    expect(layoutBubbles(quips, 4000)).toEqual([]);
    // Pops in.
    expect(layoutBubbles(quips, 510).find((s) => s.key === 2)!.scale).toBeLessThan(1);
  });

  it('wraps lines at word boundaries', () => {
    expect(wrapLine('Eat dirt and like it, you rusty old bucket', 16)).toEqual(['Eat dirt and', 'like it, you', 'rusty old bucket']);
    expect(wrapLine('Kaboom')).toEqual(['Kaboom']);
    expect(wrapLine('   ')).toEqual(['']);
  });
});
