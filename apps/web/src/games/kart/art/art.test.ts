import { describe, expect, it } from 'vitest';
import { KART_BODY_IDS, KART_ITEM_IDS, KART_RACERS, KART_RACER_IDS } from '@dascade/shared/games/kart';
import { MeshBuilder } from './builder.ts';
import { itemIconSvg, itemIconUrl } from './icons.ts';
import { itemModel, modelForItem } from './items.ts';
import { KART_SPECS, buildKartArt, buildWheelGeometry, headPivotFor, kartArtKey } from './karts.ts';
import { DRIFT_STAGE_COLORS, ITEM_COLORS, RACER_ART, cssToInt, hexToInt, intToHex, lumInt, matOr, mixInt, shadeInt, trimFor } from './palette.ts';
import { HEAD_PIVOT } from './racers.ts';
import type { BufferGeometry } from 'three';

function finite(g: BufferGeometry): boolean {
  const p = g.getAttribute('position').array;
  for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i]!)) return false;
  return true;
}

describe('palette helpers', () => {
  it('parses and formats hex colours', () => {
    expect(hexToInt('#22d3ee')).toBe(0x22d3ee);
    expect(hexToInt('#abc')).toBe(0xaabbcc);
    expect(hexToInt('nope', 7)).toBe(7);
    expect(hexToInt(undefined, 9)).toBe(9);
    expect(intToHex(0x0000ff)).toBe('#0000ff');
  });
  it('mixes and shades', () => {
    expect(mixInt(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mixInt(0x123456, 0xabcdef, 0)).toBe(0x123456);
    expect(mixInt(0x123456, 0xabcdef, 1)).toBe(0xabcdef);
    expect(shadeInt(0x808080, 1)).toBe(0xffffff);
    expect(shadeInt(0x808080, -1)).toBe(0x000000);
    expect(lumInt(0xffffff)).toBeCloseTo(1);
  });
  it('reads CSS colours a theme might supply', () => {
    expect(cssToInt('#ff0000')).toBe(0xff0000);
    expect(cssToInt('rgb(0, 255, 0)')).toBe(0x00ff00);
    expect(cssToInt('rgba(1,2,3,0.5)')).toBe(0x010203);
    expect(cssToInt('bogus')).toBeNull();
    expect(cssToInt(undefined)).toBeNull();
  });
  it('matOr returns the EXACT original when a theme gives nothing (Delta Neon)', () => {
    expect(matOr(undefined, 'asphalt', 0x2b2d3e)).toBe(0x2b2d3e);
    expect(matOr({}, 'asphalt', 0x2b2d3e)).toBe(0x2b2d3e);
    expect(matOr({ asphalt: 'garbage' }, 'asphalt', 0x2b2d3e)).toBe(0x2b2d3e);
    expect(matOr({ asphalt: '#101010' }, 'asphalt', 0x2b2d3e)).toBe(0x101010);
  });
  it('racer art follows the shared racer colours', () => {
    for (const id of KART_RACER_IDS) {
      expect(RACER_ART[id].main).toBe(hexToInt(KART_RACERS[id].colors.main));
      expect(RACER_ART[id].trim).toBe(hexToInt(KART_RACERS[id].colors.trim));
    }
  });
  it('trimFor keeps stripes readable on any paint', () => {
    for (const paint of [0xffffff, 0x000000, 0x22d3ee, 0xf8fafc, 0x1f2937])
      for (const id of KART_RACER_IDS) expect(Math.abs(lumInt(trimFor(paint, RACER_ART[id].trim)) - lumInt(paint))).toBeGreaterThan(0.15);
  });
  it('meaningful colours are distinct', () => {
    expect(new Set(DRIFT_STAGE_COLORS.slice(1)).size).toBe(3);
    for (const id of KART_ITEM_IDS) expect(ITEM_COLORS[id]).toBeDefined();
  });
});

describe('MeshBuilder', () => {
  it('merges primitives with colour + glow attributes', () => {
    const b = new MeshBuilder();
    b.box(0, 0, 0, 1, 1, 1, 0xff0000).cyl(1, 0, 0, 0.5, 1, 0x00ff00, 8, 'x', 1).ball(0, 2, 0, 0.5, 0x0000ff);
    const g = b.build();
    const n = g.getAttribute('position').count;
    expect(n).toBe(b.vertexCount);
    expect(g.getAttribute('color').count).toBe(n);
    expect(g.getAttribute('glow').count).toBe(n);
    expect(finite(g)).toBe(true);
    expect(g.boundingBox!.max.y).toBeGreaterThan(2);
  });
  it('push/pop restores the transform', () => {
    const b = new MeshBuilder();
    b.push().translate(10, 0, 0).pop();
    b.box(0, 0, 0, 1, 1, 1, 0xffffff);
    const g = b.build();
    expect(g.boundingBox!.max.x).toBeCloseTo(0.5);
  });
});

describe('kart art', () => {
  it('builds every racer × body with sane bounds and few triangles', () => {
    for (const racer of KART_RACER_IDS)
      for (const body of KART_BODY_IDS) {
        const art = buildKartArt(racer, body, KART_RACERS[racer].colors.main);
        expect(finite(art.body)).toBe(true);
        expect(finite(art.head)).toBe(true);
        const bb = art.body.boundingBox!;
        expect(bb.max.x - bb.min.x).toBeGreaterThan(1.8);
        expect(bb.max.x - bb.min.x).toBeLessThan(3.2);
        expect(bb.max.z - bb.min.z).toBeLessThan(2);
        // merged: one geometry per part, modest vertex counts (LOD far smaller)
        expect(art.body.getAttribute('position').count / 3).toBeLessThan(6000);
        expect(art.lod.getAttribute('position').count).toBeLessThan(art.body.getAttribute('position').count / 4);
        // head sits above the seat, below the name tag
        expect(art.spec.head[1]).toBeGreaterThan(art.spec.seat[1]);
        expect(art.spec.top).toBeGreaterThan(art.spec.head[1]);
      }
  });
  it('caches by racer/body/paint (case-insensitive paint)', () => {
    expect(buildKartArt('byte', 'buggy', '#22D3EE')).toBe(buildKartArt('byte', 'buggy', '#22d3ee'));
    expect(kartArtKey('byte', 'buggy', '#ABCDEF')).toBe('byte|buggy|#abcdef');
    expect(buildKartArt('byte', 'buggy', '#ff0000')).not.toBe(buildKartArt('byte', 'buggy', '#00ff00'));
  });
  it('head pivot = seat + HEAD_PIVOT for every body', () => {
    for (const body of KART_BODY_IDS) {
      const h = headPivotFor(body);
      KART_SPECS[body].head.forEach((v, i) => expect(v).toBeCloseTo(h[i]!));
      expect(KART_SPECS[body].seat[1] + HEAD_PIVOT[1]).toBeCloseTo(KART_SPECS[body].head[1]);
      expect(KART_SPECS[body].wheels.filter((w) => w.front)).toHaveLength(2);
    }
  });
  it('wheel geometry is a unit wheel around the Z axle', () => {
    const g = buildWheelGeometry();
    const bb = g.boundingBox!;
    expect(bb.max.y).toBeGreaterThan(0.95);
    expect(bb.max.y).toBeLessThan(1.25);
    expect(bb.max.z).toBeLessThan(0.6);
  });
});

describe('items', () => {
  it('every item has a model and an icon', () => {
    for (const id of KART_ITEM_IDS) {
      const g = itemModel(modelForItem(id));
      expect(g.getAttribute('position').count).toBeGreaterThan(0);
      expect(finite(g)).toBe(true);
      const svg = itemIconSvg(id);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('viewBox="0 0 64 64"');
      expect(itemIconUrl(id).startsWith('data:image/svg+xml')).toBe(true);
    }
    expect(itemIconSvg('prism')).toContain('<svg');
    expect(itemModel('prismShell').getAttribute('position').count).toBeGreaterThan(0);
    expect(itemModel('prismGlyph').getAttribute('position').count).toBeGreaterThan(0);
  });
  it('icons contain no scripts or external references', () => {
    for (const id of [...KART_ITEM_IDS, 'prism'] as const) {
      const svg = itemIconSvg(id);
      expect(svg).not.toMatch(/<script|href=|url\(http/i);
    }
  });
});
