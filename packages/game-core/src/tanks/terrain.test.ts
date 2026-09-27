import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { TANKS_WORLD } from '@dascade/shared/games/tanks';
import { dcos, dsin } from './trig.ts';
import {
  addDirt,
  carveCapsule,
  carveCircle,
  cloneTerrain,
  createTerrain,
  decodeTerrain,
  encodeTerrain,
  flattenPad,
  generateTerrain,
  heightAt,
  quantize,
  restHeight,
  TERRAIN_STYLE_LIST,
} from './terrain.ts';

const sum = (h: Float64Array) => h.reduce((s, v) => s + v, 0);

describe('deterministic trig', () => {
  it('hits exact cardinal values', () => {
    expect(dcos(0)).toBe(1);
    expect(dsin(0)).toBe(0);
    expect(dsin(90)).toBe(1);
    expect(dcos(90)).toBe(0);
    expect(dcos(180)).toBe(-1);
    expect(dsin(180)).toBe(0);
    expect(dsin(270)).toBe(-1);
  });

  it('matches Math.sin/cos to within a few ulps for every integer degree', () => {
    for (let d = -360; d <= 720; d++) {
      const r = (d * Math.PI) / 180;
      expect(Math.abs(dsin(d) - Math.sin(r))).toBeLessThan(3e-15);
      expect(Math.abs(dcos(d) - Math.cos(r))).toBeLessThan(3e-15);
    }
  });

  it('is mirror-symmetric around 90° (left and right shots are exact mirrors)', () => {
    for (let d = 0; d <= 90; d++) {
      expect(dsin(180 - d)).toBe(dsin(d));
      expect(dcos(180 - d) + dcos(d)).toBe(0);
    }
  });
});

describe('terrain generation', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    for (const style of TERRAIN_STYLE_LIST) {
      const a = generateTerrain(createSeededRng('t1'), style);
      const b = generateTerrain(createSeededRng('t1'), style);
      const c = generateTerrain(createSeededRng('t2'), style);
      expect(Array.from(a.h)).toEqual(Array.from(b.h));
      expect(Array.from(a.h)).not.toEqual(Array.from(c.h));
    }
  });

  it('stays inside the playable band and is quantized', () => {
    for (let seed = 0; seed < 20; seed++) {
      for (const style of TERRAIN_STYLE_LIST) {
        const t = generateTerrain(createSeededRng(seed), style);
        expect(t.h.length).toBe(TANKS_WORLD.width);
        const bad = Array.from(t.h).filter((v) => v < TANKS_WORLD.bedrock + 40 || v > 640 || quantize(v) !== v);
        expect(bad).toEqual([]);
      }
    }
  });

  it('gives each style its character', () => {
    const avg = (h: Float64Array, a: number, b: number) => {
      let s = 0;
      for (let i = a; i < b; i++) s += h[i]!;
      return s / (b - a);
    };
    for (let seed = 0; seed < 6; seed++) {
      const valley = generateTerrain(createSeededRng(seed), 'valley').h;
      expect(avg(valley, 0, 200)).toBeGreaterThan(avg(valley, 700, 900) + 150);
      const peaks = generateTerrain(createSeededRng(seed), 'peaks').h;
      expect(avg(peaks, 750, 850)).toBeGreaterThan(avg(peaks, 0, 200) + 120);
    }
  });
});

describe('terrain modification', () => {
  it('carves a surface crater as deep as the blast radius', () => {
    const t = createTerrain(400, 900, 300);
    const range = carveCircle(t, 200, 300, 40);
    expect(t.h[200]).toBeCloseTo(260, 0);
    expect(t.h[100]).toBe(300);
    expect(range.x0).toBeGreaterThanOrEqual(160);
    expect(range.x1).toBeLessThanOrEqual(241);
    // Removed exactly the lower half-disc (area ≈ πr²/2).
    const removed = 400 * 300 - sum(t.h);
    expect(Math.abs(removed - (Math.PI * 40 * 40) / 2)).toBeLessThan(40);
  });

  it('collapses the ground above an underground blast', () => {
    const t = createTerrain(400, 900, 300);
    carveCircle(t, 200, 150, 30);
    // The whole 60-unit hole is filled from above: the surface sinks by the column's chord.
    expect(t.h[200]).toBeCloseTo(240, 0);
    const removed = 400 * 300 - sum(t.h);
    expect(Math.abs(removed - Math.PI * 30 * 30)).toBeLessThan(40);
  });

  it('never digs below bedrock', () => {
    const t = createTerrain(200, 900, 60);
    carveCircle(t, 100, 30, 90);
    for (const v of t.h) expect(v).toBeGreaterThanOrEqual(TANKS_WORLD.bedrock);
    expect(t.h[100]).toBe(TANKS_WORLD.bedrock);
  });

  it('leaves the ground untouched by a blast in the air', () => {
    const t = createTerrain(200, 900, 100);
    const r = carveCircle(t, 100, 300, 40);
    expect(r).toEqual({ x0: 0, x1: 0 });
    expect(Array.from(t.h).every((v) => v === 100)).toBe(true);
  });

  it('adds dirt: the airborne part of the ball piles onto the ground', () => {
    const t = createTerrain(400, 900, 200);
    addDirt(t, 200, 200, 50);
    expect(t.h[200]).toBeCloseTo(250, 0);
    const added = sum(t.h) - 400 * 200;
    expect(Math.abs(added - (Math.PI * 50 * 50) / 2)).toBeLessThan(40);
    // A ball dropped from above lands whole.
    const t2 = createTerrain(400, 900, 200);
    addDirt(t2, 200, 400, 30);
    expect(t2.h[200]).toBeCloseTo(260, 0);
  });

  it('caps dirt at the ceiling', () => {
    const t = createTerrain(200, 900, TANKS_WORLD.ceiling - 10);
    addDirt(t, 100, TANKS_WORLD.ceiling, 60);
    for (const v of t.h) expect(v).toBeLessThanOrEqual(TANKS_WORLD.ceiling);
  });

  it('bores a capsule without double-counting overlapping samples', () => {
    const t = createTerrain(400, 900, 300);
    carveCapsule(t, 150, 280, 250, 280, 10);
    // A horizontal shaft of radius 10 removes 20 units from each interior column.
    expect(t.h[200]).toBeCloseTo(280, 0);
    expect(t.h[100]).toBe(300);
    const vertical = createTerrain(400, 900, 300);
    carveCapsule(vertical, 200, 290, 200, 190, 8);
    expect(vertical.h[200]).toBeCloseTo(300 - 116, 0);
  });

  it('flattens a spawn pad and blends its edges', () => {
    const t = createTerrain(200, 900, 100);
    for (let i = 0; i < 200; i++) t.h[i] = quantize(100 + i * 0.5);
    const level = flattenPad(t, 100, 20, 10);
    for (let i = 80; i <= 120; i++) expect(t.h[i]).toBe(level);
    expect(t.h[60]).toBeCloseTo(130, 0);
  });

  it('rests tanks on the highest column under their tracks', () => {
    const t = createTerrain(200, 900, 100);
    t.h[104] = 130;
    expect(restHeight(t, 100)).toBe(130);
    expect(restHeight(t, 150)).toBe(100);
    expect(heightAt(t, -5)).toBe(-Infinity);
    expect(heightAt(t, 250)).toBe(-Infinity);
  });

  it('round-trips through the wire encoding exactly', () => {
    const t = generateTerrain(createSeededRng('wire'), 'hills');
    carveCircle(t, 800, t.h[800]!, 44);
    const enc = encodeTerrain(t);
    const back = decodeTerrain(enc)!;
    expect(Array.from(back.h)).toEqual(Array.from(t.h));
    expect(decodeTerrain('not base64!')).toBeNull();
    expect(decodeTerrain(encodeTerrain(createTerrain(10)))).toBeNull();
    const copy = cloneTerrain(t);
    copy.h[0] = 1;
    expect(t.h[0]).not.toBe(1);
  });
});
