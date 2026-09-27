import { describe, expect, it } from 'vitest';
import { ErrorSmoother, InterpBuffer, SnapshotClock, hermite, lerpAngle, wrapPi, type Pose } from './interp.ts';
import { InputOutbox, MAX_PENDING } from './outbox.ts';
import { KART_SIM, type KartInputPacket } from '@dascade/shared/games/kart';

const pose = (x: number, y: number, vx = 0, vy = 0, yaw = 0): Pose => ({ x, y, z: 0, yaw, vx, vy, vz: 0 });
const TICK_MS = 1000 / 60;

describe('SnapshotClock', () => {
  it('tracks the fastest path and adapts the delay to jitter', () => {
    const c = new SnapshotClock(TICK_MS);
    for (let i = 0; i < 60; i++) c.observe(i * 3, 1000 + i * 50);
    expect(c.offset).toBeCloseTo(1000, 5);
    const calm = c.delay;
    expect(calm).toBeGreaterThanOrEqual(60);
    expect(calm).toBeLessThan(110);
    for (let i = 60; i < 200; i++) c.observe(i * 3, 1000 + i * 50 + (i % 2 ? 60 : 0));
    expect(c.jitter).toBeGreaterThan(40);
    expect(c.delay).toBeGreaterThan(calm + 30);
    expect(c.delay).toBeLessThanOrEqual(320);
  });

  it('renders remote karts delay ms behind the live tick', () => {
    const c = new SnapshotClock(TICK_MS);
    c.observe(600, 10_000 + 600 * TICK_MS);
    const now = 10_000 + 700 * TICK_MS;
    expect(c.liveTick(now)).toBeCloseTo(700, 5);
    expect(c.liveTick(now) - c.renderTick(now)).toBeCloseTo(c.delay / TICK_MS, 5);
  });
});

describe('InterpBuffer', () => {
  it('interpolates between samples and passes through them exactly', () => {
    const b = new InterpBuffer<string>(1 / 60);
    b.push(0, pose(0, 0, 60, 0), 'a');
    b.push(3, pose(3, 0, 60, 0), 'b');
    const out = pose(0, 0);
    expect(b.sample(0, out)).toBe('a');
    expect(out.x).toBeCloseTo(0);
    b.sample(1.5, out);
    expect(out.x).toBeCloseTo(1.5, 5);
    expect(b.sample(2.9, out)).toBe('b');
  });

  it('holds a lone sample when the render time is before it (just after a reset)', () => {
    const b = new InterpBuffer<string>(1 / 60);
    b.push(10, pose(5, 0), 'only');
    const out = pose(0, 0);
    expect(b.sample(4, out)).toBe('only');
    expect(out.x).toBe(5);
  });

  it('ignores stale or duplicate ticks', () => {
    const b = new InterpBuffer<number>(1 / 60);
    b.push(5, pose(5, 0), 1);
    b.push(5, pose(99, 0), 2);
    b.push(4, pose(99, 0), 3);
    expect(b.items).toHaveLength(1);
  });

  it('extrapolates at most 8 ticks, then holds', () => {
    const b = new InterpBuffer<number>(1 / 60);
    b.push(0, pose(0, 0, 60, 0), 1);
    const out = pose(0, 0);
    b.sample(4, out);
    expect(out.x).toBeCloseTo(4, 5);
    b.sample(100, out);
    expect(out.x).toBeCloseTo(8, 5);
    expect(b.extrapolated).toBe(2);
  });

  it('does not sweep through the world on a teleport', () => {
    const b = new InterpBuffer<number>(1 / 60);
    b.push(0, pose(0, 0), 1);
    b.push(3, pose(500, 0), 2);
    const out = pose(0, 0);
    b.sample(1, out);
    expect(out.x).toBe(0);
    b.sample(2, out);
    expect(out.x).toBe(500);
  });

  it('caps its length', () => {
    const b = new InterpBuffer<number>(1 / 60, 10);
    for (let i = 0; i < 50; i++) b.push(i, pose(i, 0), i);
    expect(b.items).toHaveLength(10);
    expect(b.items[0]!.tick).toBe(40);
  });
});

describe('angles + hermite', () => {
  it('wraps and lerps the short way round', () => {
    expect(wrapPi(Math.PI * 3)).toBeCloseTo(Math.PI, 5);
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 1);
  });
  it('hermite follows a straight line with matching velocity exactly', () => {
    const out = pose(0, 0);
    hermite(pose(0, 0, 30, 0), pose(3, 0, 30, 0), 0.25, 0.1, out);
    expect(out.x).toBeCloseTo(0.75, 6);
  });
});

describe('ErrorSmoother', () => {
  it('decays small corrections and snaps big ones', () => {
    const e = new ErrorSmoother(12, 12);
    expect(e.add(1, 0, 0, 0)).toBe(true);
    e.decay(100);
    expect(e.x).toBeGreaterThan(0.2);
    expect(e.x).toBeLessThan(0.4);
    e.decay(1000);
    expect(e.x).toBe(0);
    expect(e.add(50, 0, 0, 0)).toBe(false);
    expect(e.x).toBe(0);
    expect(e.add(Number.NaN, 0, 0, 0)).toBe(false);
  });
});

describe('ErrorSmoother.addYaw', () => {
  it('glides a big heading change and clamps it', () => {
    const e = new ErrorSmoother();
    e.addYaw(1.5);
    expect(e.yaw).toBeCloseTo(1.5);
    e.addYaw(1.5);
    expect(e.yaw).toBe(1.8);
    e.decay(200);
    expect(Math.abs(e.yaw)).toBeLessThan(0.3);
  });
});

describe('InputOutbox', () => {
  it('sequences frames and sends one packet every inputEvery ticks', () => {
    const sent: KartInputPacket[] = [];
    const o = new InputOutbox((p) => sent.push(p));
    for (let i = 0; i < KART_SIM.inputEvery * 3; i++) o.push(i, i * 16, false);
    expect(sent).toHaveLength(3);
    expect(sent[0]).toEqual({ seq: 1, inputs: [0, 1].slice(0, KART_SIM.inputEvery) });
    expect(sent[1]!.seq).toBe(1 + KART_SIM.inputEvery);
    for (const p of sent) expect(p.inputs.length).toBeLessThanOrEqual(KART_SIM.maxInputsPerPacket);
  });

  it('acks drop applied frames and report the acked one', () => {
    const o = new InputOutbox(() => undefined);
    for (let i = 0; i < 10; i++) o.push(i, 100 + i, false);
    const f = o.ack(4);
    expect(f?.seq).toBe(4);
    expect(o.pending.map((p) => p.seq)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(o.ack(2)).toBeUndefined();
    expect(o.pending).toHaveLength(6);
  });

  it('holds packets while stalled and bounds pending frames', () => {
    const sent: KartInputPacket[] = [];
    const o = new InputOutbox((p) => sent.push(p));
    for (let i = 0; i < MAX_PENDING + 50; i++) o.push(1, i, true);
    expect(sent).toHaveLength(0);
    expect(o.held).toBeGreaterThan(0);
    expect(o.pending.length).toBe(MAX_PENDING);
  });

  it('resync continues the sequence after the ack', () => {
    const o = new InputOutbox(() => undefined);
    o.resync(500);
    expect(o.push(0, 0, false)).toBe(501);
  });
});

describe('InputOutbox with predictor-assigned sequence numbers', () => {
  it('never packs non-consecutive frames together', () => {
    const sent: KartInputPacket[] = [];
    const o = new InputOutbox((p) => sent.push(p));
    o.push(1, 0, false, 10);
    o.push(2, 0, false, 20);
    o.push(3, 0, false, 21);
    o.flush();
    expect(sent.map((p) => p.seq)).toEqual([10, 20]);
    expect(sent[1]!.inputs).toEqual([2, 3]);
  });
});
