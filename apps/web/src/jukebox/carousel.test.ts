import { describe, expect, it } from 'vitest';
import { slotLook, slotOffset, swipeSteps } from './carousel.ts';

describe('record carousel', () => {
  it('offsets go the short way round the ring', () => {
    // Two records and the mix: one on each side of the middle.
    expect([0, 1, 2].map((i) => slotOffset(i, 0, 3))).toEqual([0, 1, -1]);
    expect([0, 1, 2].map((i) => slotOffset(i, 2, 3))).toEqual([1, -1, 0]);
    expect([0, 1, 2, 3].map((i) => slotOffset(i, 0, 4))).toEqual([0, 1, 2, -1]);
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => slotOffset(i, 3, 7))).toEqual([-3, -2, -1, 0, 1, 2, 3]);
    expect(slotOffset(0, 0, 0)).toBe(0);
  });

  it('the middle sleeve faces you; neighbours turn towards it, smaller and dimmer; the rest are out of sight', () => {
    expect(slotLook(0)).toMatchObject({ x: 0, turn: 0, scale: 1, dim: 1, far: false });
    const left = slotLook(-1);
    const right = slotLook(1);
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBe(-left.x);
    expect(left.turn).toBeGreaterThan(0);
    expect(right.turn).toBe(-left.turn);
    expect(right.scale).toBeLessThan(1);
    expect(right.z).toBeLessThan(slotLook(0).z);
    expect(slotLook(2).scale).toBeLessThan(right.scale);
    expect(slotLook(2).far).toBe(false);
    expect(slotLook(3).far).toBe(true);
    expect(slotLook(-9)).toMatchObject({ far: true });
    // A neighbour's middle is clear of the middle sleeve, so it can be clicked.
    expect(right.x).toBeGreaterThan(0.5);
  });

  it('a swipe left turns to the next record, right to the previous; small wobbles do nothing', () => {
    expect(swipeSteps(-40, 124, 3)).toBe(1);
    expect(swipeSteps(60, 124, 3)).toBe(-1);
    expect(swipeSteps(20, 124, 3)).toBe(0);
    expect(swipeSteps(-170, 124, 7)).toBe(2);
    // Never further than once round.
    expect(swipeSteps(-2000, 124, 3)).toBe(2);
  });
});
