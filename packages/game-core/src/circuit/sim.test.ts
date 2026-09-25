import { describe, expect, it } from 'vitest';
import { CHASSIS_IDS, CIRCUIT_TRACK_IDS, NEUTRAL_INPUT, packInput, unpackInput, type CarInput, type ChassisId } from '@dascade/shared/games/circuit';
import { autopilot, createBotMemory, type BotMemory } from './bot.ts';
import { stepCar } from './car.ts';
import { RaceSim, SIM_LIMITS, type SimEvent, type SimOptions } from './sim.ts';
import { decodeSnapshot } from './snapshot.ts';
import { getTrack } from './tracks.ts';
import type { CircuitTrackId } from '@dascade/shared/games/circuit';

const OPTS: SimOptions = { laps: 1, collisions: true, boost: true, tickRate: 60, finishWindowMs: 10_000, maxRaceMs: 240_000 };
const GAS = packInput({ throttle: 1, brake: 0, steer: 0, drift: false, boost: false });

interface Driver {
  slot: number;
  seq: number;
  memory: BotMemory;
  skill: number;
}

function botInput(sim: RaceSim, d: Driver): number {
  const car = sim.car(d.slot)!;
  return packInput(autopilot(car.state, car.spec, sim.track, d.memory, { skill: d.skill, lane: ((d.slot % 3) - 1) * 30 }));
}

/** Run a race where every car is driven by the autopilot, one input per tick (a perfect client). */
function race(trackId: CircuitTrackId, chassis: ChassisId[], opts: Partial<SimOptions> = {}, maxTicks = 60 * 200) {
  const sim = new RaceSim(getTrack(trackId), { ...OPTS, ...opts });
  const drivers: Driver[] = chassis.map((c, slot) => {
    sim.addCar(slot, `p${slot}`, c);
    return { slot, seq: 1, memory: createBotMemory(), skill: 0.9 };
  });
  const events: SimEvent[] = [];
  sim.go();
  for (let t = 0; t < maxTicks && sim.status !== 'done'; t++) {
    for (const d of drivers) sim.pushInputs(d.slot, d.seq++, [botInput(sim, d)]);
    events.push(...sim.step());
  }
  return { sim, events };
}

describe('RaceSim', () => {
  it.each(CIRCUIT_TRACK_IDS)('the autopilot completes a lap of %s with every chassis', (trackId) => {
    for (const chassis of CHASSIS_IDS) {
      const { sim, events } = race(trackId, [chassis]);
      const car = sim.car(0)!;
      expect(car.progress.finished, `${trackId}/${chassis}`).toBe(true);
      expect(events.some((e) => e.type === 'finish')).toBe(true);
      expect(sim.status).toBe('done');
      // Lap time sanity: within 1.6× the track's par lap.
      expect(car.progress.finishMs).toBeLessThan(getTrack(trackId).def.parLapMs * 1.6);
      expect(car.progress.finishMs).toBeGreaterThan(getTrack(trackId).def.parLapMs * 0.6);
    }
  });

  it('is deterministic: same inputs → identical snapshots', () => {
    const a = race('skyline-switchback', ['volt', 'comet', 'pixel', 'brick'], { laps: 1 }, 60 * 12);
    const b = race('skyline-switchback', ['volt', 'comet', 'pixel', 'brick'], { laps: 1 }, 60 * 12);
    expect(a.sim.tick).toBe(b.sim.tick);
    expect(a.sim.encodeSnapshot()).toEqual(b.sim.encodeSnapshot());
  });

  it('decides finish order on the server and ends the race after the finish window', () => {
    const sim = new RaceSim(getTrack('neon-loop'), { ...OPTS, finishWindowMs: 3_000 });
    sim.addCar(0, 'fast', 'volt');
    sim.addCar(1, 'slow', 'volt');
    const fast: Driver = { slot: 0, seq: 1, memory: createBotMemory(), skill: 0.95 };
    let slowSeq = 1;
    sim.go();
    const events: SimEvent[] = [];
    for (let t = 0; t < 60 * 120 && sim.status !== 'done'; t++) {
      sim.pushInputs(0, fast.seq++, [botInput(sim, fast)]);
      // The slow car idles on the grid.
      sim.pushInputs(1, slowSeq++, [packInput(NEUTRAL_INPUT)]);
      events.push(...sim.step());
    }
    const finish = events.filter((e) => e.type === 'finish');
    expect(finish).toEqual([expect.objectContaining({ slot: 0, place: 1 })]);
    expect(events).toContainEqual({ type: 'dnf', slot: 1, reason: 'timeout' });
    expect(sim.status).toBe('done');
    expect(sim.standings().map((c) => c.slot)).toEqual([0, 1]);
    // The window closed ~3 s after the winner.
    expect((sim.tick - sim.firstFinishTick) * sim.dtMs).toBeGreaterThanOrEqual(3_000);
    expect((sim.tick - sim.firstFinishTick) * sim.dtMs).toBeLessThan(3_100);
  });

  it('keeps cars locked on the grid but still acknowledges their inputs', () => {
    const sim = new RaceSim(getTrack('neon-loop'), OPTS);
    const car = sim.addCar(0, 'a', 'volt');
    const start = { ...car.state };
    for (let t = 1; t <= 30; t++) {
      sim.pushInputs(0, t, [GAS]);
      sim.step();
    }
    expect(car.state.x).toBe(start.x);
    expect(car.state.y).toBe(start.y);
    expect(car.ackSeq).toBe(30);
    const snap = decodeSnapshot(sim.encodeSnapshot())!;
    expect(snap.status).toBe(0);
    expect(snap.cars[0]!.flags2 & 2).toBe(2);
  });

  it('cannot be sped up by flooding inputs: one step of credit per tick', () => {
    const sim = new RaceSim(getTrack('neon-loop'), OPTS);
    sim.addCar(0, 'cheat', 'volt');
    sim.addCar(1, 'honest', 'volt');
    sim.go();
    let honestSeq = 1;
    let cheatSeq = 1;
    for (let t = 0; t < 120; t++) {
      // The cheater sends 8 frames every tick; the honest client sends 1.
      sim.pushInputs(0, cheatSeq, Array.from({ length: 8 }, () => GAS));
      cheatSeq += 8;
      sim.pushInputs(1, honestSeq++, [GAS]);
      sim.step();
    }
    const cheat = sim.car(0)!;
    const honest = sim.car(1)!;
    expect(cheat.applied).toBeLessThanOrEqual(sim.tick + SIM_LIMITS.maxCredit);
    expect(cheat.applied).toBeLessThanOrEqual(honest.applied + 1);
    expect(cheat.queue.length).toBeLessThanOrEqual(SIM_LIMITS.maxQueue);
    // Same distance travelled (they started side by side on the grid).
    expect(Math.abs(cheat.progress.s - honest.progress.s)).toBeLessThan(60);
  });

  it('ignores duplicate / stale frames; a huge sequence jump re-anchors without buying extra steps', () => {
    const sim = new RaceSim(getTrack('neon-loop'), OPTS);
    const car = sim.addCar(0, 'a', 'volt');
    expect(sim.pushInputs(0, 10, [GAS, GAS, GAS])).toBe(3);
    expect(sim.pushInputs(0, 10, [GAS, GAS, GAS])).toBe(0);
    expect(sim.pushInputs(0, 11, [GAS, GAS, GAS])).toBe(1);
    // A jump far ahead re-anchors the sequence (older frames are then stale)…
    expect(sim.pushInputs(0, 10_000, [GAS])).toBe(1);
    expect(sim.pushInputs(0, 9_999, [GAS])).toBe(0);
    expect(car.queue.every((f) => f.seq >= 10_000)).toBe(true);
    expect(sim.pushInputs(7, 1, [GAS])).toBe(0);
    // …but it never simulates more than one step of credit per tick.
    sim.go();
    let seq = 10_001;
    for (let t = 0; t < 60; t++) {
      sim.pushInputs(0, seq, Array.from({ length: 8 }, () => GAS));
      seq += 5_000;
      sim.step();
    }
    expect(car.applied).toBeLessThanOrEqual(sim.tick + SIM_LIMITS.maxCredit);
  });

  it('accepts input again after a long stall where the client kept numbering frames (no wedged car)', () => {
    const sim = new RaceSim(getTrack('neon-loop'), OPTS);
    const car = sim.addCar(0, 'a', 'volt');
    sim.go();
    let seq = 1;
    for (let t = 0; t < 60; t++) {
      sim.pushInputs(0, seq++, [GAS]);
      sim.step();
    }
    // 15 s without snapshots (a network freeze / reconnect inside the grace period): the
    // client keeps predicting and numbering frames but holds its packets back.
    for (let t = 0; t < 900; t++) {
      seq++;
      sim.step();
    }
    const applied = car.applied;
    for (let t = 0; t < 60; t++) {
      sim.pushInputs(0, seq++, [GAS]);
      sim.step();
    }
    expect(car.applied - applied).toBeGreaterThan(50);
    expect(car.ackSeq).toBeGreaterThan(900);
  });

  it('coasts a starved or disconnected car instead of freezing it', () => {
    const sim = new RaceSim(getTrack('neon-loop'), OPTS);
    const car = sim.addCar(0, 'a', 'volt');
    sim.addCar(1, 'b', 'volt');
    sim.go();
    let seq = 1;
    for (let t = 0; t < 120; t++) {
      sim.pushInputs(0, seq++, [GAS]);
      sim.step();
    }
    const speedBefore = Math.hypot(car.state.vx, car.state.vy);
    expect(speedBefore).toBeGreaterThan(300);
    // Input stops: the car keeps moving (coasting) and slows down.
    const xBefore = car.state.x;
    for (let t = 0; t < 60; t++) sim.step();
    expect(car.state.x).not.toBe(xBefore);
    expect(Math.hypot(car.state.vx, car.state.vy)).toBeLessThan(speedBefore);
    sim.setConnected(0, false);
    for (let t = 0; t < 240; t++) sim.step();
    expect(Math.hypot(car.state.vx, car.state.vy)).toBeLessThan(5);
    expect(sim.isGhost(car)).toBe(true);
  });

  it('a disconnected racer does not stall the race', () => {
    const sim = new RaceSim(getTrack('neon-loop'), { ...OPTS, finishWindowMs: 60_000 });
    sim.addCar(0, 'finisher', 'comet');
    sim.addCar(1, 'dropped', 'volt');
    const d: Driver = { slot: 0, seq: 1, memory: createBotMemory(), skill: 0.95 };
    sim.go();
    sim.setConnected(1, false);
    const events: SimEvent[] = [];
    for (let t = 0; t < 60 * 90 && sim.status !== 'done'; t++) {
      sim.pushInputs(0, d.seq++, [botInput(sim, d)]);
      events.push(...sim.step());
    }
    expect(sim.status).toBe('done');
    expect(events).toContainEqual({ type: 'dnf', slot: 1, reason: 'disconnected' });
    // Ended right after the winner, not after the 60 s finish window.
    expect((sim.tick - sim.firstFinishTick) * sim.dtMs).toBeLessThan(1000);
  });

  it('retiring the last active racer ends the race', () => {
    const sim = new RaceSim(getTrack('neon-loop'), OPTS);
    sim.addCar(0, 'a', 'volt');
    sim.go();
    sim.step();
    const events = sim.retire(0, 'left');
    expect(events).toContainEqual({ type: 'dnf', slot: 0, reason: 'left' });
    expect(events).toContainEqual({ type: 'done' });
    expect(sim.status).toBe('done');
  });

  it('ends a race that runs past the hard time limit', () => {
    const sim = new RaceSim(getTrack('neon-loop'), { ...OPTS, maxRaceMs: 2_000 });
    sim.addCar(0, 'a', 'volt');
    sim.go();
    let seq = 1;
    const events: SimEvent[] = [];
    for (let t = 0; t < 200 && sim.status !== 'done'; t++) {
      sim.pushInputs(0, seq++, [packInput(NEUTRAL_INPUT)]);
      events.push(...sim.step());
    }
    expect(sim.status).toBe('done');
    expect(events).toContainEqual({ type: 'dnf', slot: 0, reason: 'timeout' });
  });

  it('collides cars on the same level and separates them', () => {
    const sim = new RaceSim(getTrack('neon-loop'), OPTS);
    const a = sim.addCar(0, 'a', 'volt');
    const b = sim.addCar(1, 'b', 'volt');
    // Put b right on top of a.
    b.state = { ...b.state, x: a.state.x + 10, y: a.state.y + 4, seg: a.state.seg };
    b.info = { ...b.info, s: a.info.s };
    const events = sim.step();
    expect(Math.hypot(a.state.x - b.state.x, a.state.y - b.state.y)).toBeGreaterThan(20);
    expect(events.every((e) => e.type !== 'done')).toBe(true);
  });

  it('client replay from a snapshot reproduces the server state exactly', () => {
    const sim = new RaceSim(getTrack('skyline-switchback'), { ...OPTS, collisions: false });
    sim.addCar(0, 'me', 'pixel');
    const d: Driver = { slot: 0, seq: 1, memory: createBotMemory(), skill: 0.9 };
    sim.go();
    const sent: Array<{ seq: number; packed: number }> = [];
    for (let t = 0; t < 400; t++) {
      const packed = botInput(sim, d);
      sent.push({ seq: d.seq, packed });
      sim.pushInputs(0, d.seq++, [packed]);
      sim.step();
    }
    const snap = decodeSnapshot(sim.encodeSnapshot())!;
    const mine = snap.cars.find((c) => c.slot === 0)!;
    // Server continues with 30 more inputs; the client replays the same inputs from the snapshot.
    let replay = mine.state;
    const car = sim.car(0)!;
    for (let t = 0; t < 30; t++) {
      const packed = botInput(sim, d);
      sim.pushInputs(0, d.seq++, [packed]);
      sim.step();
      replay = stepCar(replay, unpackInput(packed), car.spec, sim.track, { dt: sim.dt, boostEnabled: true }).state;
    }
    expect(replay).toEqual(car.state);
    expect(mine.ack).toBe(sent[sent.length - 1]!.seq);
  });

  it('bridges keep cars on different levels from colliding', () => {
    const track = getTrack('skyline-switchback');
    const bridge = track.bridges[0]!;
    const sim = new RaceSim(track, OPTS);
    const a = sim.addCar(0, 'upper', 'volt');
    const b = sim.addCar(1, 'lower', 'volt');
    sim.go();
    a.state = { ...a.state, x: Math.fround(bridge.x), y: Math.fround(bridge.y), seg: Math.floor(bridge.sUpper / track.spacing) };
    b.state = { ...b.state, x: Math.fround(bridge.x + 3), y: Math.fround(bridge.y), seg: Math.floor(bridge.sLower / track.spacing) };
    a.info = { ...a.info, s: bridge.sUpper };
    b.info = { ...b.info, s: bridge.sLower };
    const events = sim.step();
    expect(events.some((e) => e.type === 'collision')).toBe(false);
  });
});

describe('input helpers', () => {
  it('neutral input packs to zero throttle/brake and centred steering', () => {
    const u: CarInput = unpackInput(packInput(NEUTRAL_INPUT));
    expect(u).toEqual({ throttle: 0, brake: 0, steer: 0, drift: false, boost: false });
  });
});
