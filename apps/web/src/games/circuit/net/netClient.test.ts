import { describe, expect, it } from 'vitest';
import { CIRCUIT_SIM, packInput, type CarInput, type CircuitInputPacket } from '@dascade/shared/games/circuit';
import { CHASSIS, RaceSim, autopilot, createBotMemory, encodeSnapshot, getTrack, type SimOptions } from '@dascade/game-core/circuit';
import { CircuitNet } from './netClient.ts';

const OPTS: SimOptions = { laps: 3, collisions: false, boost: true, tickRate: CIRCUIT_SIM.tickRate, finishWindowMs: 30_000, maxRaceMs: 600_000 };
const TICK = 1000 / CIRCUIT_SIM.tickRate;

/**
 * A deterministic little network: server sim + one predicting client + one observing
 * client, with fixed one-way latency (in ticks) and optional jitter pattern.
 */
function harness(latencyTicks: number, jitter: (i: number) => number = () => 0) {
  const track = getTrack('neon-loop');
  const sim = new RaceSim(track, OPTS);
  sim.addCar(0, 'me', 'volt');
  sim.addCar(1, 'rival', 'comet');
  const toServer: Array<{ at: number; packet: CircuitInputPacket }> = [];
  const toClient: Array<{ at: number; bytes: Uint8Array }> = [];
  const toObserver: Array<{ at: number; bytes: Uint8Array }> = [];
  let now = 0;
  const me = new CircuitNet(track, (packet) => toServer.push({ at: now + latencyTicks * TICK, packet }));
  me.setLocal(0, CHASSIS.volt);
  const observer = new CircuitNet(track, () => undefined);
  const memory = createBotMemory();
  const rivalMemory = createBotMemory();
  let rivalSeq = 1;
  let i = 0;
  const step = (input?: (net: CircuitNet) => CarInput) => {
    i++;
    now += TICK;
    // Client frame.
    me.update(now, () => (input ? input(me) : me.predicted ? autopilot(me.predicted, CHASSIS.volt, track, memory, { skill: 0.9 }) : { throttle: 0, brake: 0, steer: 0, drift: false, boost: false }), me.status !== 1);
    // Deliver inputs.
    while (toServer.length && toServer[0]!.at <= now) {
      const { packet } = toServer.shift()!;
      sim.pushInputs(0, packet.seq, packet.inputs);
    }
    // The rival is driven server-side by a perfect local client.
    const rival = sim.car(1)!;
    sim.pushInputs(1, rivalSeq++, [packInput(autopilot(rival.state, rival.spec, track, rivalMemory, { skill: 0.85 }))]);
    sim.step();
    if (sim.tick % 2 === 0) {
      const bytes = sim.encodeSnapshot();
      const lag = latencyTicks * TICK + jitter(i);
      toClient.push({ at: now + lag, bytes });
      toObserver.push({ at: now + lag, bytes });
      toClient.sort((a, b) => a.at - b.at);
      toObserver.sort((a, b) => a.at - b.at);
    }
    while (toClient.length && toClient[0]!.at <= now) me.ingest(toClient.shift()!.bytes, now);
    while (toObserver.length && toObserver[0]!.at <= now) observer.ingest(toObserver.shift()!.bytes, now);
  };
  return { sim, me, observer, step, get now() {
    return now;
  } };
}

describe('CircuitNet prediction + reconciliation', () => {
  it('predicts the local car exactly under constant latency (no corrections once running)', () => {
    const h = harness(4);
    h.sim.go();
    for (let k = 0; k < 60; k++) h.step();
    const before = h.me.stats().corrections;
    for (let k = 0; k < 600; k++) h.step();
    const stats = h.me.stats();
    expect(stats.corrections - before).toBe(0);
    // The prediction runs ahead of the server by the round trip.
    const server = h.sim.car(0)!.state;
    const predicted = h.me.predicted!;
    const ahead = Math.hypot(predicted.x - server.x, predicted.y - server.y);
    expect(ahead).toBeGreaterThan(20);
    expect(ahead).toBeLessThan(250);
    expect(stats.pendingInputs).toBeGreaterThan(4);
    expect(stats.pendingInputs).toBeLessThan(24);
    expect(stats.rttMs).toBeGreaterThan(8 * TICK - 1);
  });

  it('reconciles when the server disagrees (e.g. a collision) and converges back', () => {
    const h = harness(3);
    h.sim.go();
    for (let k = 0; k < 240; k++) h.step();
    // Server-side shove the predicting car sideways (as a car-car hit would).
    const car = h.sim.car(0)!;
    car.state = { ...car.state, x: Math.fround(car.state.x + 30), vx: Math.fround(car.state.vx * 0.6) };
    const before = h.me.stats().corrections;
    for (let k = 0; k < 30; k++) h.step();
    expect(h.me.stats().corrections).toBeGreaterThan(before);
    for (let k = 0; k < 60; k++) h.step();
    // After reconciliation the prediction replays exactly again: no new corrections.
    const settled = h.me.stats().corrections;
    for (let k = 0; k < 120; k++) h.step();
    expect(h.me.stats().corrections).toBe(settled);
    // The visual correction offset has decayed: the rendered car is within one tick of the prediction.
    const render = h.me.localRender()!;
    const p = h.me.predicted!;
    expect(Math.hypot(render.x - p.x, render.y - p.y)).toBeLessThan(Math.hypot(p.vx, p.vy) * (TICK / 1000) + 1);
  });

  it('keeps unlocked replay consistent across the green light', () => {
    const h = harness(5);
    for (let k = 0; k < 40; k++) h.step(() => ({ throttle: 1, brake: 0, steer: 0, drift: false, boost: false }));
    const grid = h.me.predicted!;
    h.sim.go();
    for (let k = 0; k < 90; k++) h.step(() => ({ throttle: 1, brake: 0, steer: 0, drift: false, boost: false }));
    const moved = h.me.predicted!;
    expect(Math.hypot(moved.x - grid.x, moved.y - grid.y)).toBeGreaterThan(50);
    const settled = h.me.stats().corrections;
    for (let k = 0; k < 90; k++) h.step(() => ({ throttle: 1, brake: 0, steer: 0, drift: false, boost: false }));
    expect(h.me.stats().corrections).toBe(settled);
  });
});

describe('CircuitNet interpolation', () => {
  it('renders remote cars smoothly between snapshots, even with jitter', () => {
    const h = harness(4, (i) => ((i * 7919) % 5) * 9);
    h.sim.go();
    for (let k = 0; k < 120; k++) h.step();
    const samples: Array<{ x: number; y: number; speed: number }> = [];
    for (let k = 0; k < 240; k++) {
      h.step();
      const r = h.observer.remoteRender(1, h.now);
      expect(r).not.toBeNull();
      samples.push({ x: r!.x, y: r!.y, speed: r!.speed });
    }
    // Frame-to-frame motion never jumps: displacement stays close to speed·dt.
    for (let k = 1; k < samples.length; k++) {
      const a = samples[k - 1]!;
      const b = samples[k]!;
      const step = Math.hypot(b.x - a.x, b.y - a.y);
      expect(step).toBeLessThan(Math.max(a.speed, b.speed) * (TICK / 1000) * 1.8 + 1.5);
    }
    expect(h.observer.stats().interpDelayMs).toBeGreaterThanOrEqual(60);
    expect(h.observer.stats().interpDelayMs).toBeLessThanOrEqual(300);
  });

  it('extrapolates briefly then holds when snapshots stop', () => {
    const h = harness(2);
    h.sim.go();
    for (let k = 0; k < 200; k++) h.step();
    const t0 = h.now;
    const at = (ms: number) => h.observer.remoteRender(1, t0 + ms)!;
    const a = at(400);
    const b = at(2000);
    // No new data: the car stops moving after the extrapolation cap.
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(1);
    expect(h.observer.stats().extrapolating).toBeGreaterThan(0);
  });

  it('re-syncs after a long outage instead of replaying a stale history', () => {
    const h = harness(3);
    h.sim.go();
    for (let k = 0; k < 120; k++) h.step();
    // Simulate an outage: the client keeps predicting but nothing reaches the server for 10 s.
    const net = h.me;
    for (let k = 0; k < 600; k++) net.update(h.now + (k + 1) * TICK, () => ({ throttle: 1, brake: 0, steer: 0, drift: false, boost: false }), false);
    const snap = h.sim.encodeSnapshot();
    net.ingest(snap, h.now + 601 * TICK);
    const car = h.sim.car(0)!;
    expect(net.predicted!.x).toBe(car.state.x);
    expect(net.stats().pendingInputs).toBe(0);
  });

  it('holds input packets while snapshots are stalled, then resumes', () => {
    const track = getTrack('neon-loop');
    const sim = new RaceSim(track, OPTS);
    sim.addCar(0, 'me', 'volt');
    sim.go();
    sim.step();
    const sent: CircuitInputPacket[] = [];
    const net = new CircuitNet(track, (p) => sent.push(p));
    net.setLocal(0, CHASSIS.volt);
    net.ingest(sim.encodeSnapshot(), 1000);
    const gas = () => ({ throttle: 1, brake: 0, steer: 0, drift: false, boost: false });
    for (let t = 1000; t <= 1400; t += TICK) net.update(t, gas, false);
    const beforeStall = sent.length;
    expect(beforeStall).toBeGreaterThan(5);
    for (let t = 1400; t <= 3000; t += TICK) net.update(t, gas, false);
    expect(sent.length).toBeLessThan(beforeStall + 4);
    expect(net.stats().packetsHeld).toBeGreaterThan(20);
    sim.step();
    sim.step();
    net.ingest(sim.encodeSnapshot(), 3000);
    const resumed = sent.length;
    for (let t = 3000; t <= 3100; t += TICK) net.update(t, gas, false);
    expect(sent.length).toBeGreaterThan(resumed);
  });

  it('continues the input sequence after the acknowledged frame when joining a race late', () => {
    const track = getTrack('neon-loop');
    const sim = new RaceSim(track, OPTS);
    sim.addCar(0, 'me', 'volt');
    sim.go();
    sim.pushInputs(0, 5000, [0, 0, 0]);
    for (let k = 0; k < 5; k++) sim.step();
    const sent: CircuitInputPacket[] = [];
    const net = new CircuitNet(track, (p) => sent.push(p));
    net.setLocal(0, CHASSIS.volt);
    net.ingest(sim.encodeSnapshot(), 1000);
    net.update(1000, () => ({ throttle: 1, brake: 0, steer: 0, drift: false, boost: false }), false);
    net.update(1050, () => ({ throttle: 1, brake: 0, steer: 0, drift: false, boost: false }), false);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0]!.seq).toBeGreaterThan(5002);
    expect(sim.pushInputs(0, sent[0]!.seq, sent[0]!.inputs)).toBe(sent[0]!.inputs.length);
  });
});

describe('CircuitNet robustness against malformed snapshots', () => {
  const finite = (c: { x: number; y: number; heading: number; vx: number; vy: number } | null) =>
    c !== null && [c.x, c.y, c.heading, c.vx, c.vy].every(Number.isFinite);

  /** A snapshot one tick ahead of the server whose cars carry non-finite state. */
  function poisoned(h: ReturnType<typeof harness>, value: number): Uint8Array {
    const snap = h.sim.snapshot();
    snap.tick += 1;
    snap.cars = snap.cars.map((c) => ({ ...c, state: { ...c.state, x: value, vx: value, heading: value } }));
    return encodeSnapshot(snap);
  }

  it('ignores cars with NaN/Infinity state instead of poisoning prediction, correction offsets or interpolation', () => {
    const h = harness(3);
    h.sim.go();
    for (let k = 0; k < 120; k++) h.step();
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => h.me.ingest(poisoned(h, bad), h.now)).not.toThrow();
      expect(() => h.observer.ingest(poisoned(h, bad), h.now)).not.toThrow();
      h.step();
      expect(finite(h.me.localRender())).toBe(true);
      expect(finite(h.me.predicted)).toBe(true);
      expect(finite(h.observer.remoteRender(1, h.now))).toBe(true);
    }
    // Normal snapshots keep flowing and everything stays finite afterwards.
    for (let k = 0; k < 60; k++) h.step();
    expect(finite(h.me.localRender())).toBe(true);
    expect(finite(h.observer.remoteRender(0, h.now + 50))).toBe(true);
  });

  it('survives truncated, oversized-count and random garbage packets', () => {
    const h = harness(2);
    h.sim.go();
    for (let k = 0; k < 60; k++) h.step();
    const good = h.sim.encodeSnapshot();
    const garbage: Uint8Array[] = [new Uint8Array(0), good.slice(0, 15), good.slice(0, good.length - 1)];
    const bigCount = good.slice();
    bigCount[12] = 255;
    garbage.push(bigCount);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (let n = 0; n < 200; n++) {
      const b = good.slice();
      for (let j = 0; j < 12; j++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
      b[0] = good[0]!; // keep the version byte so the body is actually parsed
      garbage.push(b);
    }
    for (const bytes of garbage) {
      expect(() => h.me.ingest(bytes, h.now)).not.toThrow();
      expect(() => h.observer.ingest(bytes, h.now)).not.toThrow();
    }
    for (let k = 0; k < 30; k++) h.step();
    expect(finite(h.me.localRender())).toBe(true);
    for (const slot of h.observer.slots()) expect(finite(h.observer.remoteRender(slot, h.now))).toBe(true);
  });
});
