import { describe, expect, it } from 'vitest';
import { MINI_W, PILL_W, TAB, choosePlacement, floatCandidates, intersects, type Box } from './placement.ts';

describe('intersects', () => {
  const a: Box = { x: 0, y: 0, w: 10, h: 10 };
  it('detects overlap and respects padding', () => {
    expect(intersects(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(intersects(a, { x: 10, y: 0, w: 5, h: 5 })).toBe(false); // touching edges don't overlap
    expect(intersects(a, { x: 12, y: 0, w: 5, h: 5 }, 3)).toBe(true);
    expect(intersects(a, { x: 20, y: 20, w: 5, h: 5 }, 3)).toBe(false);
  });
});

describe('floatCandidates', () => {
  it('offers the rich mini only on roomy viewports and only when something is loaded', () => {
    const desk = floatCandidates({ w: 1440, h: 900 }, true);
    expect(desk[0]).toMatchObject({ kind: 'mini', corner: 'bl' });
    expect(desk.map((c) => c.kind).slice(0, 6)).toEqual(['mini', 'mini', 'pill', 'pill', 'tab', 'tab']);
    expect(desk.filter((c) => c.corner === 'l' || c.corner === 'r')).toHaveLength(12);
    expect(floatCandidates({ w: 390, h: 844 }, true).some((c) => c.kind === 'mini')).toBe(false);
    expect(floatCandidates({ w: 1440, h: 900 }, false).every((c) => c.kind === 'tab')).toBe(true);
  });
  it('keeps every box inside the viewport and off the safe areas', () => {
    const vp = { w: 844, h: 390, safe: { top: 0, right: 47, bottom: 21, left: 47 } };
    for (const c of floatCandidates(vp, true)) {
      expect(c.box.x).toBeGreaterThanOrEqual(vp.safe.left);
      expect(c.box.x + c.box.w).toBeLessThanOrEqual(vp.w - vp.safe.right);
      expect(c.box.y + c.box.h).toBeLessThanOrEqual(vp.h - vp.safe.bottom);
      expect([MINI_W, PILL_W, TAB]).toContain(c.box.w);
    }
  });
});

describe('choosePlacement', () => {
  const cands = floatCandidates({ w: 1440, h: 900 }, true);
  it('takes the first candidate that collides with nothing', () => {
    expect(choosePlacement(cands, []).candidate).toMatchObject({ kind: 'mini', corner: 'bl' });
    // A plaque across the bottom-left and bottom-right (the arcade floor) pushes the mini out; pills fit the gutter.
    const plaque: Box = { x: 130, y: 712, w: 1180, h: 150 };
    expect(choosePlacement(cands, [plaque]).candidate).toMatchObject({ kind: 'pill', corner: 'bl' });
    const wide: Box = { x: 70, y: 700, w: 1300, h: 200 };
    expect(choosePlacement(cands, [wide]).candidate).toMatchObject({ kind: 'tab', corner: 'bl' });
  });
  it('when nothing is free, takes the tab that hides the least of anything', () => {
    const everything: Box = { x: 0, y: 0, w: 1440, h: 900 };
    const r = choosePlacement(cands, [everything]);
    expect(r.clear).toBe(false);
    expect(r.candidate.kind).toBe('tab');
    // Small buttons in both bottom corners + one huge cabinet everywhere: the tab goes over the cabinet edge.
    const btnL: Box = { x: 10, y: 840, w: 60, h: 50 };
    const btnR: Box = { x: 1370, y: 840, w: 60, h: 50 };
    const cabinet: Box = { x: 0, y: 100, w: 1440, h: 740 };
    const r2 = choosePlacement(cands, [btnL, btnR, cabinet]);
    expect(r2.clear).toBe(false);
    expect(['l', 'r']).toContain(r2.candidate.corner);
  });
});
