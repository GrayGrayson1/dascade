import { describe, expect, it } from 'vitest';
import { CABINET_IDS } from '@dascade/shared';
import {
  COVERFLOW,
  WheelStepper,
  clampIndex,
  coverflowSlot,
  initialIndex,
  keyAction,
  lineupFit,
  releaseTarget,
  slotScale,
  slotX,
  springSettled,
  springStep,
  stepIndex,
  type WheelInput,
} from './carousel.ts';

describe('coverflow layout', () => {
  it('centres the active cabinet at full size, lit and on top', () => {
    const s = coverflowSlot(0);
    expect(s.x).toBe(0);
    expect(s.y).toBeCloseTo(0);
    expect(s.scale).toBe(1);
    expect(s.shade).toBe(0);
    expect(s.side).toBe(0);
    expect(s.opacity).toBe(1);
    expect(s.tilt).toBeCloseTo(0);
  });

  it('is symmetric left/right', () => {
    for (const u of [0.25, 1, 1.5, 2, 3.2, 5]) {
      const r = coverflowSlot(u);
      const l = coverflowSlot(-u);
      expect(l.x).toBeCloseTo(-r.x);
      expect(l.scale).toBeCloseTo(r.scale);
      expect(l.z).toBe(r.z);
      expect(l.shade).toBeCloseTo(r.shade);
      expect(l.side).toBeCloseTo(-r.side);
      expect(l.tilt).toBeCloseTo(-r.tilt);
    }
  });

  it('recedes monotonically: further cabinets are smaller, darker, lower in the stack and further out', () => {
    let prev = coverflowSlot(0);
    for (let u = 0.25; u <= 6; u += 0.25) {
      const s = coverflowSlot(u);
      expect(s.x).toBeGreaterThan(prev.x);
      expect(s.scale).toBeLessThan(prev.scale);
      expect(s.z).toBeLessThan(prev.z);
      expect(s.shade).toBeGreaterThanOrEqual(prev.shade);
      expect(s.y).toBeLessThanOrEqual(prev.y);
      prev = s;
    }
  });

  it('keeps neighbours from overlapping the active face', () => {
    // Gap between the active face edge (0.5) and the neighbour's near face edge.
    const n = coverflowSlot(1);
    const nearEdge = n.x - n.scale / 2;
    expect(nearEdge).toBeGreaterThan(0.5);
    // …while the steps get shorter with distance (the row bunches up).
    expect(slotX(2) - slotX(1)).toBeLessThan(slotX(1) - slotX(0));
    expect(slotX(3) - slotX(2)).toBeLessThan(slotX(2) - slotX(1));
  });

  it('reveals the side panel that faces the centre', () => {
    expect(coverflowSlot(1).side).toBe(1); // right of centre → left panel
    expect(coverflowSlot(-2).side).toBe(-1);
    expect(Math.abs(coverflowSlot(0.3).side)).toBeLessThan(1);
    expect(coverflowSlot(0.3).side).toBeGreaterThan(0);
  });

  it('fades out beyond the visible range', () => {
    expect(coverflowSlot(COVERFLOW.maxVisible).opacity).toBe(1);
    expect(coverflowSlot(COVERFLOW.maxVisible + 0.5).opacity).toBeCloseTo(0.5);
    expect(coverflowSlot(COVERFLOW.maxVisible + 2).opacity).toBe(0);
  });

  it('drops the 3D tilt when motion is reduced', () => {
    expect(coverflowSlot(1, true).tilt).toBe(0);
    expect(coverflowSlot(-2, true).tilt).toBe(0);
    expect(Math.abs(coverflowSlot(1).tilt)).toBeGreaterThan(0);
  });

  it('caps the shade so far cabinets stay recognisable', () => {
    expect(coverflowSlot(10).shade).toBe(COVERFLOW.shadeMax);
    expect(slotScale(10)).toBeGreaterThan(0.2);
  });
});

describe('lineup fit', () => {
  it('keeps the default spacing on narrow stages and fades beyond the edge', () => {
    const fit = lineupFit(1.3, 11);
    expect(fit.spread).toBeCloseTo(COVERFLOW.spread);
    expect(fit.maxVisible).toBeLessThan(2);
  });

  it('spreads the lineup out on wide stages so every cabinet fits', () => {
    const fit = lineupFit(5, 11);
    expect(fit.spread).toBeGreaterThan(COVERFLOW.spread);
    expect(fit.maxVisible).toBeGreaterThanOrEqual(5);
    // the furthest cabinet's outer edge stays on stage
    expect(slotX(5, fit.spread) + slotScale(5) / 2).toBeLessThanOrEqual(5.25);
  });

  it('keeps clear of the stage ends when they are taken', () => {
    for (const half of [1.6, 2.4, 3.1, 3.6, 4.2, 6]) {
      const fit = lineupFit(half, 11, true);
      const far = Math.floor(fit.maxVisible);
      if (far < 5) {
        // every cabinet still showing fits inside; the next one out is fully faded
        expect(slotX(far, fit.spread) + slotScale(far) / 2).toBeLessThanOrEqual(half);
        expect(coverflowSlot(far + 1, fit).opacity).toBe(0);
      }
      expect(coverflowSlot(far, fit).opacity).toBe(1);
      // never shows more than the relaxed fit
      expect(fit.maxVisible).toBeLessThanOrEqual(lineupFit(half, 11).maxVisible);
    }
    expect(lineupFit(40, 11, true).maxVisible).toBeGreaterThanOrEqual(5);
  });

  it('never spreads beyond the cap', () => {
    expect(lineupFit(40, 11).spread).toBeLessThanOrEqual(1.75);
  });

  it('applies options to the slot layout', () => {
    expect(coverflowSlot(2, { spread: 1.5 }).x).toBeCloseTo(slotX(2, 1.5));
    expect(coverflowSlot(3, { maxVisible: 1.5 }).opacity).toBe(0);
    expect(coverflowSlot(1, { reduced: true }).tilt).toBe(0);
  });
});

describe('index helpers', () => {
  it('clamps and steps within bounds', () => {
    expect(clampIndex(-3, 11)).toBe(0);
    expect(clampIndex(40, 11)).toBe(10);
    expect(clampIndex(4.6, 11)).toBe(5);
    expect(clampIndex(Number.NaN, 11)).toBe(0);
    expect(clampIndex(3, 0)).toBe(0);
    expect(stepIndex(0, -1, 11)).toBe(0);
    expect(stepIndex(10, 1, 11)).toBe(10);
    expect(stepIndex(4, 1, 11)).toBe(5);
  });

  it('opens on the remembered cabinet, else the middle of the lineup', () => {
    expect(initialIndex(CABINET_IDS, 'tanks')).toBe(CABINET_IDS.indexOf('tanks'));
    expect(initialIndex(CABINET_IDS, null)).toBe(5);
    expect(initialIndex(CABINET_IDS, undefined)).toBe(5);
    expect(initialIndex(['a', 'b'], 'zzz')).toBe(0);
  });
});

describe('drag release', () => {
  it('rounds a slow release to the nearest slot', () => {
    expect(releaseTarget(4.4, 0, 4, 11)).toBe(4);
    expect(releaseTarget(4.6, 0, 4, 11)).toBe(5);
  });

  it('advances at least one slot on a quick flick', () => {
    expect(releaseTarget(4.1, 0.004, 4, 11)).toBe(5);
    expect(releaseTarget(3.9, -0.004, 4, 11)).toBe(3);
  });

  it('lets momentum carry one cabinet past the release point, never more than three from the start', () => {
    expect(releaseTarget(4.3, 0.05, 4, 11)).toBe(5);
    expect(releaseTarget(6.4, 0.05, 4, 11)).toBe(7);
    expect(releaseTarget(8.2, 0.05, 4, 11)).toBe(7);
    expect(releaseTarget(1, -0.05, 1, 11)).toBe(0);
  });

  it('stays in bounds and survives bad input', () => {
    expect(releaseTarget(10.4, 0.02, 10, 11)).toBe(10);
    expect(releaseTarget(2, Number.NaN, 2, 11)).toBe(2);
  });
});

describe('spring', () => {
  it('converges on the target without overshooting (critically damped)', () => {
    let s = { pos: 0, vel: 0 };
    let max = 0;
    for (let i = 0; i < 120; i++) {
      s = springStep(s, 3, 1 / 60);
      max = Math.max(max, s.pos);
    }
    expect(springSettled(s, 3)).toBe(true);
    expect(max).toBeLessThanOrEqual(3.0001);
  });

  it('is stable with large frame gaps', () => {
    const s = springStep({ pos: 0, vel: 20 }, 1, 2);
    expect(Number.isFinite(s.pos)).toBe(true);
    expect(Math.abs(s.pos - 1)).toBeLessThan(0.01);
  });
});

describe('wheel stepper', () => {
  const ev = (t: number, deltaY: number, deltaX = 0, extra: Partial<WheelInput> = {}): WheelInput => ({
    t,
    deltaX,
    deltaY,
    deltaMode: 0,
    allowVertical: true,
    ...extra,
  });

  it('turns a whole trackpad swipe with inertia into a single step', () => {
    const w = new WheelStepper();
    const steps: number[] = [];
    let t = 0;
    // ramp up, then a long decaying momentum tail at 60 Hz
    const deltas = [2, 4, 8, 14, 22, 30, 36, 40, 38, 34, 30, 26, 22, 18, 15, 12, 10, 8, 6, 5, 4, 3, 2, 2, 1, 1, 1];
    for (const d of deltas) {
      steps.push(w.push(ev(t, 0, d)));
      t += 16;
    }
    expect(steps.filter((s) => s !== 0)).toEqual([1]);
  });

  it('steps once per notched mouse-wheel click', () => {
    const w = new WheelStepper();
    const out = [w.push(ev(0, 100)), w.push(ev(160, 100)), w.push(ev(320, 100)), w.push(ev(900, -100))];
    expect(out).toEqual([1, 1, 1, -1]);
  });

  it('treats a continuous fast spin as one gesture', () => {
    const w = new WheelStepper();
    const out: number[] = [];
    for (let i = 0; i < 10; i++) out.push(w.push(ev(i * 25, 100)));
    expect(out.filter((s) => s !== 0)).toEqual([1]);
  });

  it('starts a new gesture after a quiet gap', () => {
    const w = new WheelStepper();
    expect(w.push(ev(0, 0, 30))).toBe(1);
    expect(w.push(ev(16, 0, 30))).toBe(0);
    expect(w.push(ev(400, 0, -30))).toBe(-1);
  });

  it('accumulates small deltas before stepping', () => {
    const w = new WheelStepper();
    expect(w.push(ev(0, 5))).toBe(0);
    expect(w.push(ev(16, 5))).toBe(0);
    expect(w.push(ev(32, 20))).toBe(1);
  });

  it('ignores vertical movement when the page scrolls vertically', () => {
    const w = new WheelStepper();
    expect(w.push(ev(0, 120, 0, { allowVertical: false }))).toBe(0);
    expect(w.push(ev(300, 0, -60, { allowVertical: false }))).toBe(-1);
  });

  it('normalises line and page delta modes', () => {
    const w = new WheelStepper();
    expect(w.push(ev(0, 3, 0, { deltaMode: 1 }))).toBe(1);
    w.reset();
    expect(w.push(ev(0, -1, 0, { deltaMode: 2 }))).toBe(-1);
  });

  it('uses the dominant axis', () => {
    const w = new WheelStepper();
    expect(w.push(ev(0, 10, -60))).toBe(-1);
  });
});

describe('keyboard', () => {
  it('maps browse and open keys', () => {
    expect(keyAction('ArrowRight', 3, 11)).toEqual({ kind: 'move', to: 4 });
    expect(keyAction('ArrowLeft', 0, 11)).toEqual({ kind: 'move', to: 0 });
    expect(keyAction('Home', 7, 11)).toEqual({ kind: 'move', to: 0 });
    expect(keyAction('End', 2, 11)).toEqual({ kind: 'move', to: 10 });
    expect(keyAction('PageDown', 9, 11)).toEqual({ kind: 'move', to: 10 });
    expect(keyAction('Enter', 2, 11)).toEqual({ kind: 'open' });
    expect(keyAction(' ', 2, 11)).toEqual({ kind: 'open' });
    expect(keyAction('a', 2, 11)).toBeNull();
  });
});
