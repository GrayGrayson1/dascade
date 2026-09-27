import { describe, expect, it } from 'vitest';
import { CLASSICS } from '@dascade/shared/games/classics';
import {
  ByteReader,
  ByteWriter,
  DIRS,
  DIR_COUNT,
  FixedStepper,
  InputRecorder,
  IntentQueue,
  SnapshotBuffer,
  advanceSim,
  decodeEvents,
  dirIndexOf,
  encodeEvents,
  intentBits,
  isqrt,
  reflect,
  replayRun,
  rotateBy,
  seeded,
  shuffle,
  substream,
  type ClassicsSim,
} from './index.ts';

/** Toy engine: score += code each time; ends at tick 100. */
class Counter implements ClassicsSim {
  tick = 0;
  score = 0;
  get over() {
    return this.tick >= 100;
  }
  input(code: number) {
    if (code > 9) return false;
    this.score += code;
    return true;
  }
  step() {
    if (!this.over) this.tick++;
  }
  summary() {
    return { score: this.score, level: 1, lives: 1, stat: this.tick };
  }
}

describe('deterministic math', () => {
  it('direction table holds unit vectors in screen orientation', () => {
    expect(DIRS).toHaveLength(DIR_COUNT);
    for (const [x, y] of DIRS) expect(Math.abs(x * x + y * y - 1)).toBeLessThan(1e-9);
    expect(DIRS[0]).toEqual([1, 0]);
    expect(DIRS[16]![1]).toBeCloseTo(1);
    expect(DIRS[48]![1]).toBeCloseTo(-1);
  });

  it('dirIndexOf finds the nearest table direction without atan2', () => {
    expect(dirIndexOf(1, 0)).toBe(0);
    expect(dirIndexOf(0, 1)).toBe(16);
    expect(dirIndexOf(-1, 0)).toBe(32);
    expect(dirIndexOf(0, -3)).toBe(48);
    expect(dirIndexOf(1, 1)).toBe(8);
  });

  it('rotateBy and reflect behave', () => {
    const [x, y] = rotateBy(1, 0, 16);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(1);
    expect(reflect(3, 4, 0, -1)).toEqual([3, -4]);
  });

  it('isqrt floors exactly', () => {
    for (let n = 0; n < 2000; n++) {
      const r = isqrt(n);
      expect(r * r).toBeLessThanOrEqual(n);
      expect((r + 1) * (r + 1)).toBeGreaterThan(n);
    }
  });
});

describe('fixed stepper', () => {
  it('turns wall time into whole steps and drops long stalls', () => {
    const s = new FixedStepper(60, 5);
    expect(s.advance(1000 / 60)).toBe(1);
    expect(s.advance(8)).toBe(0);
    expect(s.advance(9)).toBe(1);
    expect(s.advance(500)).toBe(5);
    expect(s.dropped).toBeGreaterThan(0);
  });
});

describe('seeded rng', () => {
  it('is reproducible and independent per purpose', () => {
    const a = seeded('x');
    const b = seeded('x');
    for (let i = 0; i < 20; i++) expect(a.int(1000)).toBe(b.int(1000));
    const p = substream('run', 'pieces').int(1_000_000);
    const q = substream('run', 'drops').int(1_000_000);
    expect(p).not.toBe(q);
    expect(shuffle(seeded(1), [1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('input log', () => {
  it('encodes deltas and decodes back', () => {
    const events = [
      { tick: 3, code: 1 },
      { tick: 3, code: 2 },
      { tick: 10, code: 5 },
    ];
    const flat = encodeEvents(events, 0);
    expect(flat).toEqual([3, 1, 0, 2, 7, 5]);
    const back = decodeEvents(flat, 0, 11, 9);
    expect(back).toEqual({ ok: true, events });
  });

  it('rejects out-of-range, past-upTo and flooding events', () => {
    expect(decodeEvents([1, 99], 0, 10, 9).ok).toBe(false);
    expect(decodeEvents([10, 1], 0, 10, 9).ok).toBe(false);
    const flood: number[] = [];
    for (let i = 0; i <= CLASSICS.maxEventsPerTick; i++) flood.push(i === 0 ? 1 : 0, 1);
    expect(decodeEvents(flood, 0, 5, 9).ok).toBe(false);
    expect(decodeEvents([1], 0, 5, 9).ok).toBe(false);
  });

  it('recorder batches, splits at the cap and rewinds', () => {
    const rec = new InputRecorder();
    for (let t = 0; t < 400; t++) rec.record(t, 1);
    const first = rec.take(400)!;
    expect(first.seq).toBe(1);
    expect(first.events.length / 2).toBeLessThanOrEqual(CLASSICS.maxBatchEvents);
    expect(first.upTo).toBe(CLASSICS.maxBatchEvents);
    const second = rec.take(400)!;
    expect(second.seq).toBe(2);
    expect(second.upTo).toBe(400);
    expect(rec.take(400)).toBeNull();
    rec.rewind(first.upTo, 1);
    const again = rec.take(400)!;
    expect(again).toEqual(second);
  });
});

describe('advanceSim / replay', () => {
  it('applies events before stepping their tick and stops at upTo', () => {
    const sim = new Counter();
    const r = advanceSim(sim, [{ tick: 0, code: 5 }, { tick: 4, code: 2 }], 10);
    expect(r).toEqual({ ok: true, ticks: 10, over: false });
    expect(sim.score).toBe(7);
  });

  it('refuses invalid codes and events outside the window', () => {
    expect(advanceSim(new Counter(), [{ tick: 1, code: 42 }], 5).ok).toBe(false);
    expect(advanceSim(new Counter(), [{ tick: 7, code: 1 }], 5).ok).toBe(false);
  });

  it('client and replay agree', () => {
    const events = Array.from({ length: 50 }, (_, i) => ({ tick: i * 2, code: i % 10 }));
    const live = new Counter();
    advanceSim(live, events.slice(0, 20), 40);
    advanceSim(live, events.slice(20), 100);
    const replayed = replayRun(() => new Counter(), 's', {}, events, 100);
    expect(replayed.summary()).toEqual(live.summary());
  });
});

describe('bytes', () => {
  it('round-trips and never throws past the end', () => {
    const w = new ByteWriter(8);
    w.u8(7).u16(65535).i16(-5).u32(123456789).f32(1.5).fx16(3.25, 8);
    const r = new ByteReader(w.bytes());
    expect([r.u8(), r.u16(), r.i16(), r.u32(), r.f32(), r.fx16(8)]).toEqual([7, 65535, -5, 123456789, 1.5, 3.25]);
    expect(r.ok).toBe(true);
    expect(r.u32()).toBe(0);
    expect(r.ok).toBe(false);
  });
});

describe('realtime helpers', () => {
  it('intentBits packs and unpacks', () => {
    const bits = intentBits(['up', 'down', 'fire'] as const);
    const f = bits.pack({ up: true, fire: true });
    expect(bits.unpack(f)).toEqual({ up: true, down: false, fire: true });
    expect(bits.has(f, 'down')).toBe(false);
    expect(bits.max).toBe(7);
  });

  it('IntentQueue never runs faster than real time and ignores duplicates', () => {
    const q = new IntentQueue();
    q.push(1, [1, 2, 3, 4, 5, 6, 7, 8], 15);
    q.push(1, [9, 9], 15); // duplicate seqs
    let consumed = 0;
    for (let t = 0; t < 4; t++) {
      q.next();
      consumed = q.ackSeq;
    }
    expect(consumed).toBeLessThanOrEqual(8);
    expect(q.current).not.toBe(9);
    // Out-of-range frames are neutralized.
    q.push(9, [999], 15);
    for (let t = 0; t < 10; t++) q.next();
    expect(q.current).toBe(0);
    for (let t = 0; t < 20; t++) q.next();
    expect(q.starved).toBe(true);
  });

  it('SnapshotBuffer interpolates between bracketing snapshots', () => {
    const buf = new SnapshotBuffer<number>(50, 100);
    buf.push(1, 1050, 10);
    buf.push(2, 1100, 20);
    buf.push(3, 1150, 30);
    const s = buf.sample(1225)!; // render tick = (1225-100-1000)/50 = 2.5
    expect(s.a).toBe(20);
    expect(s.b).toBe(30);
    expect(s.t).toBeCloseTo(0.5);
  });
});
