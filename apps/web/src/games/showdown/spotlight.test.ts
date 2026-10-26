import { describe, expect, it } from 'vitest';
import {
  SPOT_CARD_MS,
  SPOT_CONVERGE_MS,
  SPOT_COUNT,
  SPOT_OUT_MS,
  easeInOut,
  pickPhase,
  seatCenter,
  seatFont,
  seatLayout,
  seeded,
  spotFrame,
  spotPaths,
  spotPoint,
} from './spotlight.ts';

/** The overlay's seat area on a 1920×1080 stage (right of the host column, under the title). */
const AREA_1080 = { w: 1500, h: 830 };
const AREA_720 = { w: 1000, h: 553 };

describe('the seat grid', () => {
  it('fits every seat inside the area, without overlaps, for 1 to 80 people', () => {
    for (const area of [AREA_1080, AREA_720, { w: 900, h: 640 }, { w: 300, h: 160 }]) {
      for (let n = 1; n <= 80; n++) {
        const l = seatLayout(n, area.w, area.h);
        expect(l.cols * l.rows, `${n} seats`).toBeGreaterThanOrEqual(n);
        expect((l.rows - 1) * l.cols, `${n} seats: no empty row`).toBeLessThan(n);
        const boxes = Array.from({ length: n }, (_, i) => seatCenter(l, i, n));
        for (const c of boxes) {
          expect(c.x - l.w / 2).toBeGreaterThanOrEqual(-0.01);
          expect(c.x + l.w / 2).toBeLessThanOrEqual(area.w + 0.01);
          expect(c.y - l.h / 2).toBeGreaterThanOrEqual(-0.01);
          expect(c.y + l.h / 2).toBeLessThanOrEqual(area.h + 0.01);
        }
        for (let a = 0; a < boxes.length; a++) {
          for (let b = a + 1; b < boxes.length; b++) {
            const apart = Math.abs(boxes[a]!.x - boxes[b]!.x) >= l.w - 0.01 || Math.abs(boxes[a]!.y - boxes[b]!.y) >= l.h - 0.01;
            expect(apart, `${n} seats: ${a} and ${b} overlap`).toBe(true);
          }
        }
      }
    }
  });

  it('keeps names readable at 60 seats on a 1080p stage (about 20 px or more)', () => {
    const l = seatLayout(60, AREA_1080.w, AREA_1080.h);
    // A typical full name and the longest a name can be (20 characters).
    expect(seatFont(l, 'Priya S.')).toBeGreaterThanOrEqual(20);
    expect(seatFont(l, 'Alexandra Montgomery')).toBeGreaterThanOrEqual(19);
    expect(seatFont(l, 'Bartholomew-Jones')).toBeGreaterThanOrEqual(15);
  });

  it('grows the seats for a small room, but never past a fifth of the area', () => {
    const six = seatLayout(6, AREA_1080.w, AREA_1080.h);
    const sixty = seatLayout(60, AREA_1080.w, AREA_1080.h);
    expect(six.h).toBeGreaterThan(sixty.h);
    expect(six.h).toBeLessThanOrEqual(AREA_1080.h * 0.2 + 0.01);
    expect(six.w / six.h).toBeLessThanOrEqual(3.11);
  });

  it('centres a short last row', () => {
    const l = seatLayout(7, AREA_720.w, AREA_720.h);
    if (l.rows > 1) {
      const lastRow = Math.floor(6 / l.cols);
      const firstOfLast = seatCenter(l, lastRow * l.cols, 7);
      const lastOfLast = seatCenter(l, 6, 7);
      expect((firstOfLast.x + lastOfLast.x) / 2).toBeCloseTo(AREA_720.w / 2, 3);
    }
  });

  it('a name never outgrows its seat', () => {
    const l = seatLayout(24, AREA_720.w, AREA_720.h);
    for (const name of ['Al', 'Sam 2', 'Priya Subramanian', 'Wolfeschlegelstein', 'A B C D E F G H I J']) {
      const f = seatFont(l, name);
      expect(f).toBeLessThanOrEqual(l.h * 0.34 + 0.01);
      expect(f).toBeGreaterThanOrEqual(l.h * 0.18 - 0.01);
    }
  });
});

describe('the sweep', () => {
  it('the seeded generator repeats per seed and differs between seeds', () => {
    const a = seeded(42);
    const b = seeded(42);
    const c = seeded(43);
    const xs = Array.from({ length: 8 }, () => a());
    expect(Array.from({ length: 8 }, () => b())).toEqual(xs);
    expect(Array.from({ length: 8 }, () => c())).not.toEqual(xs);
    for (const v of xs) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('every screen sweeps the same way for the same draw, and differently for the next one', () => {
    const one = spotPaths(5, 3500);
    expect(spotPaths(5, 3500)).toEqual(one);
    expect(spotPaths(6, 3500)).not.toEqual(one);
    expect(one).toHaveLength(SPOT_COUNT);
  });

  it('paths stay inside the room and cover the whole sweep', () => {
    for (let draw = 1; draw <= 40; draw++) {
      for (const path of spotPaths(draw, 3500)) {
        expect(path.points.length * path.step).toBeGreaterThan(3500);
        for (let t = 0; t <= 3500; t += 50) {
          const [x, y] = spotPoint(path, t);
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(1);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('the spots really move (no spot sits still during the sweep)', () => {
    for (let draw = 1; draw <= 20; draw++) {
      for (const path of spotPaths(draw, 3500)) {
        let travelled = 0;
        let prev = spotPoint(path, 0);
        for (let t = 50; t <= 2000; t += 50) {
          const p = spotPoint(path, t);
          travelled += Math.sqrt((p[0] - prev[0]) * (p[0] - prev[0]) + (p[1] - prev[1]) * (p[1] - prev[1]));
          prev = p;
        }
        expect(travelled, `draw ${draw}`).toBeGreaterThan(0.6);
      }
    }
  });

  it('converges from where the spots are, and lands all three on the winner exactly at the landing', () => {
    const landT = 3500;
    const target: [number, number] = [0.8, 0.3];
    for (let draw = 1; draw <= 20; draw++) {
      const paths = spotPaths(draw, landT);
      const start = landT - SPOT_CONVERGE_MS;
      // No jump when the converge begins.
      const before = spotFrame(paths, start, landT, target);
      const after = spotFrame(paths, start + 1, landT, target);
      expect(before.converge).toBe(0);
      before.spots.forEach((p, i) => {
        expect(Math.abs(p[0] - after.spots[i]![0])).toBeLessThan(0.01);
        expect(Math.abs(p[1] - after.spots[i]![1])).toBeLessThan(0.01);
      });
      // Every spot ends on the winner's seat.
      const landed = spotFrame(paths, landT, landT, target);
      expect(landed.converge).toBe(1);
      for (const p of landed.spots) {
        expect(p[0]).toBeCloseTo(target[0], 6);
        expect(p[1]).toBeCloseTo(target[1], 6);
      }
      // And stays there after.
      for (const p of spotFrame(paths, landT + 2000, landT, target).spots) expect(p[0]).toBeCloseTo(target[0], 6);
    }
  });

  it('eases in and out', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 6);
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
    for (let k = 0; k < 1; k += 0.05) expect(easeInOut(k + 0.05)).toBeGreaterThanOrEqual(easeInOut(k));
  });
});

describe('the moment, in time', () => {
  const pickAt = 100_000;
  const landAt = pickAt + 3500;

  it('a screen that saw the draw sweeps, lands with the card, fades out, then rests', () => {
    const draw = { pickAt, landAt, seenAt: pickAt + 30 };
    expect(pickPhase(draw, pickAt)).toBe('sweep');
    expect(pickPhase(draw, landAt - 1)).toBe('sweep');
    expect(pickPhase(draw, landAt)).toBe('card');
    expect(pickPhase(draw, landAt + SPOT_CARD_MS - 1)).toBe('card');
    expect(pickPhase(draw, landAt + SPOT_CARD_MS)).toBe('out');
    expect(pickPhase(draw, landAt + SPOT_CARD_MS + SPOT_OUT_MS)).toBe('idle');
  });

  it('a screen that joins mid-sweep picks it up at the right point', () => {
    expect(pickPhase({ pickAt, landAt, seenAt: pickAt + 2000 }, pickAt + 2000)).toBe('sweep');
    expect(pickPhase({ pickAt, landAt, seenAt: landAt - 1 }, landAt + 10)).toBe('card');
  });

  it('a screen that loads or reconnects after the landing replays nothing', () => {
    for (const seenAt of [landAt, landAt + 1, landAt + 1000, landAt + 60_000]) {
      for (const now of [seenAt, seenAt + 500, landAt + SPOT_CARD_MS - 1]) expect(pickPhase({ pickAt, landAt, seenAt }, now)).toBe('idle');
    }
  });

  it('no draw, no moment', () => {
    expect(pickPhase({ pickAt: 0, landAt: 0, seenAt: 0 }, 5)).toBe('idle');
  });
});
