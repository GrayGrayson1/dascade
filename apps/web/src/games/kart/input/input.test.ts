import { describe, expect, it } from 'vitest';
import { packKartInput, unpackKartInput } from '@dascade/shared/games/kart';
import { padInput, shapeSteer, stickAxis, type PadLike } from './input.ts';

const pad = (axes: number[], pressed: number[] = [], values: Record<number, number> = {}): PadLike => ({
  connected: true,
  mapping: 'standard',
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: values[i] ?? (pressed.includes(i) ? 1 : 0) })),
});

describe('stickAxis', () => {
  it('has a dead zone, is odd-symmetric and reaches full lock', () => {
    expect(stickAxis(0.1)).toBe(0);
    expect(stickAxis(-0.1)).toBe(0);
    expect(stickAxis(1)).toBeCloseTo(1);
    expect(stickAxis(-1)).toBeCloseTo(-1);
    expect(stickAxis(0.5)).toBeCloseTo(-stickAxis(-0.5));
    expect(stickAxis(0.5)).toBeLessThan(0.5);
    expect(stickAxis(Number.NaN)).toBe(0);
  });
});

describe('padInput', () => {
  it('returns null when untouched', () => {
    expect(padInput(pad([0.05, 0]))).toBeNull();
  });
  it('maps stick right to steer right (negative) and triggers to pedals', () => {
    const r = padInput(pad([1, 0], [], { 7: 0.8, 6: 0.2 }))!;
    expect(r.input.steer).toBeCloseTo(-1);
    expect(r.input.throttle).toBeCloseTo(0.8);
    expect(r.input.brake).toBeCloseTo(0.2);
  });
  it('face buttons: A gas, B brake, RB drift, LB item, stick down aims back, up aims ahead', () => {
    const r = padInput(pad([0, 0.9], [0, 5, 4]))!;
    expect(r.input).toMatchObject({ throttle: 1, drift: true, item: true, back: true, ahead: false });
    expect(padInput(pad([0, -0.9], [4]))!.input).toMatchObject({ item: true, back: false, ahead: true });
    expect(padInput(pad([0, 0], [12]))!.input).toMatchObject({ throttle: 0, ahead: true });
    expect(padInput(pad([0, 0], [1]))!.input.brake).toBe(1);
    expect(padInput(pad([0, 0], [14]))!.input.steer).toBe(1);
    expect(padInput(pad([0, 0], [9]))!.menu).toBe(true);
  });
  it("neutral stick = the item's default direction", () => {
    expect(padInput(pad([0, 0], [4]))!.input).toMatchObject({ item: true, back: false, ahead: false });
  });
  it('produces inputs that survive the wire packing', () => {
    const r = padInput(pad([-0.7, 0], [2], { 7: 1 }))!;
    const q = unpackKartInput(packKartInput(r.input));
    expect(q.steer).toBeGreaterThan(0);
    expect(q.drift).toBe(true);
  });
});

describe('shapeSteer', () => {
  it('ramps to full lock in ~130 ms and returns faster', () => {
    let s = 0;
    for (let i = 0; i < 6; i++) s = shapeSteer(s, 1, 1 / 60);
    expect(s).toBeGreaterThan(0.6);
    expect(s).toBeLessThan(1);
    for (let i = 0; i < 4; i++) s = shapeSteer(s, 1, 1 / 60);
    expect(s).toBe(1);
    for (let i = 0; i < 6; i++) s = shapeSteer(s, 0, 1 / 60);
    expect(s).toBe(0);
  });
  it('reverses faster than it ramps from centre', () => {
    const fromCentre = shapeSteer(0, -1, 1 / 60);
    const reversing = shapeSteer(0.5, -1, 1 / 60) - 0.5;
    expect(Math.abs(reversing)).toBeGreaterThan(Math.abs(fromCentre));
  });
});
