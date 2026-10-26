/**
 * Press-and-hold timing (PRS-03 D): fires once, exactly when the hold completes; letting go early
 * (pointer up, leave, cancel, keyup, blur) never fires; repeats while held are ignored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AT_CONFIRM_MS, atClick, createHoldController } from './HoldButton.tsx';

describe('createHoldController', () => {
  let now = 0;
  const clock = () => now;
  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const advance = (ms: number) => {
    now += ms;
    vi.advanceTimersByTime(ms);
  };

  it('fires once the hold reaches its time, not a moment before', () => {
    const fire = vi.fn();
    const hold = createHoldController(800, fire, clock);
    expect(hold.start()).toBe(true);
    expect(hold.holding).toBe(true);
    advance(799);
    expect(fire).not.toHaveBeenCalled();
    expect(hold.progress()).toBeCloseTo(799 / 800);
    advance(1);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(hold.holding).toBe(false);
    expect(hold.progress()).toBe(0);
    advance(5000);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('letting go early never fires (and says it was early)', () => {
    const fire = vi.fn();
    const hold = createHoldController(800, fire, clock);
    hold.start();
    advance(500);
    expect(hold.progress()).toBeCloseTo(0.625);
    expect(hold.cancel()).toBe(true);
    advance(2000);
    expect(fire).not.toHaveBeenCalled();
    // Letting go when nothing is held is not an early release.
    expect(hold.cancel()).toBe(false);
  });

  it('ignores a second start while held (a key’s auto-repeat, a second finger)', () => {
    const fire = vi.fn();
    const hold = createHoldController(800, fire, clock);
    hold.start();
    advance(600);
    expect(hold.start()).toBe(false);
    advance(200);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('can be held again after an early release, timed from the new press', () => {
    const fire = vi.fn();
    const hold = createHoldController(800, fire, clock);
    hold.start();
    advance(700);
    hold.cancel();
    hold.start();
    advance(700);
    expect(fire).not.toHaveBeenCalled();
    advance(100);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('a release after it fired is not an early release', () => {
    const fire = vi.fn();
    const hold = createHoldController(1200, fire, clock);
    hold.start();
    advance(1200);
    expect(hold.cancel()).toBe(false);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('dispose stops a running hold (unmount)', () => {
    const fire = vi.fn();
    const hold = createHoldController(800, fire, clock);
    hold.start();
    advance(400);
    hold.dispose();
    advance(1000);
    expect(fire).not.toHaveBeenCalled();
  });

  it('caps progress at 1', () => {
    const fire = vi.fn();
    const hold = createHoldController(800, fire, () => now);
    hold.start();
    now += 5000; // the clock ran on but the timer hasn't fired yet (a busy main thread)
    expect(hold.progress()).toBe(1);
  });
});

describe('atClick (screen readers: press again to confirm)', () => {
  it('a first click arms, a second within the window fires', () => {
    const first = atClick(null, 1000);
    expect(first).toEqual({ fire: false, armedAt: 1000 });
    expect(atClick(first.armedAt, 1000 + AT_CONFIRM_MS)).toEqual({ fire: true, armedAt: null });
  });

  it('a second click after the window only arms again', () => {
    expect(atClick(1000, 1001 + AT_CONFIRM_MS)).toEqual({ fire: false, armedAt: 1001 + AT_CONFIRM_MS });
  });

  it('the window is about 4 seconds', () => {
    expect(AT_CONFIRM_MS).toBe(4000);
  });
});
