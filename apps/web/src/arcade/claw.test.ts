import { describe, expect, it } from 'vitest';
import { CLAW_ART, FLOOR_GLASS, FLOOR_HOME_X, floorOrder, floorPlacement } from './claw.ts';
import { BOX, CHUTE, stockToys } from './clawPile.ts';

describe('floor claw machine geometry', () => {
  it('keeps every plush of a stocked pile inside the floor art glass', () => {
    for (let seed = 1; seed < 40; seed++) {
      for (const t of stockToys(seed, 16)) {
        const p = floorPlacement(t);
        expect(p.x).toBeGreaterThanOrEqual(FLOOR_GLASS.x0);
        expect(p.x).toBeLessThanOrEqual(FLOOR_GLASS.x1);
        expect(p.y).toBeLessThanOrEqual(FLOOR_GLASS.floorY);
        expect(p.y).toBeGreaterThan(40);
        expect(p.y).toBeLessThan(CLAW_ART.floor);
      }
    }
  });

  it('clamps bogus coordinates', () => {
    const p = floorPlacement({ x: -50, y: -3, z: 999 });
    expect(p.x).toBe(FLOOR_GLASS.x0);
    expect(floorPlacement({ x: 500, y: 0, z: 0 }).x).toBe(FLOOR_GLASS.x1);
    expect(floorPlacement({ x: 50, y: 1e6, z: 0 }).y).toBeGreaterThanOrEqual(62);
  });

  it('lifts toys further back and higher up the pile', () => {
    const front = floorPlacement({ x: 50, y: 0, z: 0 });
    const back = floorPlacement({ x: 50, y: 0, z: BOX.d });
    const up = floorPlacement({ x: 50, y: 10, z: 0 });
    expect(back.y).toBeLessThan(front.y);
    expect(up.y).toBeLessThan(front.y);
  });

  it('draws back to front, then bottom to top', () => {
    const order = floorOrder([
      { id: 1, y: 0, z: 10 },
      { id: 2, y: 0, z: 40 },
      { id: 3, y: 8, z: 40 },
    ]);
    expect(order.map((t) => t.id)).toEqual([2, 3, 1]);
  });

  it('parks the claw over the prize chute', () => {
    const chuteL = FLOOR_GLASS.x0 + (CHUTE.x0 / BOX.w) * (FLOOR_GLASS.x1 - FLOOR_GLASS.x0);
    const chuteR = FLOOR_GLASS.x0 + (CHUTE.x1 / BOX.w) * (FLOOR_GLASS.x1 - FLOOR_GLASS.x0);
    expect(FLOOR_HOME_X).toBeGreaterThan(chuteL);
    expect(FLOOR_HOME_X).toBeLessThan(chuteR);
  });
});
