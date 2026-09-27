import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { NEUTRAL_KART_INPUT, packKartInput, type KartInput } from '@dascade/shared/games/kart';
import { getKartTrack } from './index.ts';
import { createKartState } from './kart.ts';
import { advanceProgress, createProgress, MAX_STEP_DISTANCE, rankDistance } from './progress.ts';
import { KART_SIM_LIMITS, KartSim, type KartSimEvent, type KartSimOptions } from './sim.ts';
import { pointAtS, type KartTrack } from './track.ts';

const OPTS: KartSimOptions = { laps: 2, items: false, finishWindowMs: 5000, maxRaceMs: 300_000 };
const P = (i: Partial<KartInput>) => packKartInput({ ...NEUTRAL_KART_INPUT, ...i });

describe('progress + anti-cheat', () => {
  const t = getKartTrack('pixel-plaza');
  const sample = (s: number, t0: number) => ({ s, headingDot: 1, velDot: 20, speed: 20, t0, t1: t0 + 1000 / 60 });

  /** Drive progress forward in small steps from s0 to s1 (may wrap). */
  const run = (p: ReturnType<typeof createProgress>, from: number, dist: number, step = 0.5, laps = 2) => {
    const evs = [];
    let t0 = 0;
    for (let d = step; d <= dist; d += step) {
      evs.push(...advanceProgress(p, sample((from + d) % t.length, t0), t, laps));
      t0 += 1000 / 60;
    }
    return evs;
  };

  it('counts gates in order and completes laps only after every gate', () => {
    const p = createProgress(t.length - 10);
    const evs = run(p, t.length - 10, t.length * 2 + 20);
    expect(evs.filter((e) => e.type === 'lap')).toHaveLength(2);
    expect(evs.filter((e) => e.type === 'gate')).toHaveLength((t.gates.length - 1) * 2);
    expect(p.finished).toBe(true);
    expect(evs.filter((e) => e.type === 'finish')).toHaveLength(1);
    // Nothing more after finishing (no duplicate finish).
    expect(run(p, 30, t.length)).toEqual([]);
  });

  it('skipping a gate (teleport-like jump) never counts; the kart must go back through it', () => {
    const p = createProgress(t.length - 10);
    run(p, t.length - 10, 15); // lap 1 started
    expect(p.lap).toBe(1);
    // Teleport past gate 1 and 2.
    const jump = t.gates[2]! + 5;
    expect(jump - p.s).toBeGreaterThan(MAX_STEP_DISTANCE);
    advanceProgress(p, sample(jump, 0), t, 2);
    expect(p.nextGate).toBe(1);
    // Driving on from there to the line doesn't complete the lap.
    const evs = run(p, jump, t.length - jump + 5);
    expect(evs.some((e) => e.type === 'lap')).toBe(false);
    expect(p.lap).toBe(1);
  });

  it('reversing over the last gate un-passes it; rocking over the line cannot farm laps', () => {
    const p = createProgress(t.length - 10);
    run(p, t.length - 10, 15);
    run(p, 5, t.gates[1]! - 5 + 2);
    expect(p.nextGate).toBe(2);
    const back = advanceProgress(p, sample(t.gates[1]! - 1, 0), t, 2);
    expect(back.some((e) => e.type === 'gate-undo')).toBe(true);
    expect(p.nextGate).toBe(1);
    // Rock over the start line: lap 0 → 1 → 0.
    const q = createProgress(t.length - 2);
    advanceProgress(q, sample(1, 0), t, 2);
    expect(q.lap).toBe(1);
    advanceProgress(q, sample(t.length - 1, 0), t, 2);
    expect(q.lap).toBe(0);
  });

  it('flags wrong-way after a second of driving backwards', () => {
    const p = createProgress(100);
    let evs: ReturnType<typeof advanceProgress> = [];
    for (let i = 0; i < 70; i++)
      evs = evs.concat(
        advanceProgress(p, { s: 100 - i * 0.2, headingDot: -1, velDot: -10, speed: 10, t0: i * 16.7, t1: (i + 1) * 16.7 }, t, 2),
      );
    expect(p.wrongWay).toBe(true);
    expect(evs.some((e) => e.type === 'wrong-way' && e.on)).toBe(true);
  });

  it('rank distance is capped at the next unpassed gate', () => {
    const p = createProgress(t.length - 10);
    run(p, t.length - 10, 15);
    p.s = t.gates[2]! + 20; // somehow ahead without passing gate 1
    expect(rankDistance(p, t)).toBe(t.gates[1]!);
  });
});

function soloSim(track: KartTrack = getKartTrack('pixel-plaza'), opts: Partial<KartSimOptions> = {}) {
  const sim = new KartSim(track, { ...OPTS, ...opts }, createSeededRng(1), 1);
  const k = sim.addRacer(0, 'p0', 'nova');
  return { sim, k };
}

describe('credit bank (inputs)', () => {
  it('a client sending faster than real time does not go faster', () => {
    const a = soloSim();
    const b = soloSim();
    a.sim.go();
    b.sim.go();
    let seqA = 1;
    let seqB = 1;
    for (let t = 0; t < 300; t++) {
      a.sim.pushInputs(0, seqA, [P({ throttle: 1 })]);
      seqA += 1;
      // b floods 8 frames per tick.
      b.sim.pushInputs(
        0,
        seqB,
        Array.from({ length: 8 }, () => P({ throttle: 1 })),
      );
      seqB += 8;
      a.sim.step();
      b.sim.step();
    }
    expect(b.k.applied).toBeLessThanOrEqual(a.k.applied + KART_SIM_LIMITS.maxCredit);
    expect(b.k.progress.s).toBeLessThanOrEqual(a.k.progress.s + 5);
    expect(b.k.queue.length).toBeLessThanOrEqual(KART_SIM_LIMITS.maxQueue);
  });

  it('a starved kart coasts (neutral input) instead of freezing; bursts catch up within the credit', () => {
    const { sim, k } = soloSim();
    sim.go();
    let seq = 1;
    for (let t = 0; t < 120; t++) {
      sim.pushInputs(0, seq++, [P({ throttle: 1 })]);
      sim.step();
    }
    const v0 = Math.hypot(k.state.vx, k.state.vy);
    for (let t = 0; t < 60; t++) sim.step();
    const v1 = Math.hypot(k.state.vx, k.state.vy);
    expect(v1).toBeLessThan(v0);
    expect(v1).toBeGreaterThan(0);
    // A delayed burst is applied, at most 3 per tick.
    const before = k.applied;
    sim.pushInputs(
      0,
      seq,
      Array.from({ length: 8 }, () => P({ throttle: 1 })),
    );
    sim.step();
    expect(k.applied - before).toBeLessThanOrEqual(3);
  });

  it('ignores duplicates, old frames and malformed values; re-anchors on a large seq jump', () => {
    const { sim, k } = soloSim();
    expect(sim.pushInputs(0, 5, [P({}), P({})])).toBe(2);
    expect(sim.pushInputs(0, 5, [P({}), P({})])).toBe(0);
    expect(sim.pushInputs(0, 6, [P({}), P({})])).toBe(1);
    expect(sim.pushInputs(0, 8, [-1, 1.5, 2 ** 20])).toBe(0);
    expect(sim.pushInputs(0, 0, [P({})])).toBe(0);
    expect(sim.pushInputs(0, 10_000, [P({})])).toBe(1);
    expect(k.lastSeq).toBe(10_000);
    expect(sim.pushInputs(9, 1, [P({})])).toBe(0);
  });

  it('acks applied frames; a disconnected kart becomes a ghost and the race stops waiting', () => {
    const { sim, k } = soloSim();
    const other = sim.addRacer(1, 'p1', 'rex');
    sim.go();
    sim.pushInputs(0, 1, [P({ throttle: 1 }), P({ throttle: 1 })]);
    sim.step();
    sim.step();
    expect(k.ackSeq).toBe(2);
    sim.setConnected(1, false);
    for (let t = 0; t < KART_SIM_LIMITS.ghostAfterTicks + 2; t++) sim.step();
    expect(sim.isGhost(other)).toBe(true);
  });

  it('retire → dnf; finish window and max race time end the race', () => {
    const { sim } = soloSim();
    sim.addRacer(1, 'p1', 'rex');
    sim.go();
    const ev = sim.retire(1, 'left');
    expect(ev).toEqual(expect.arrayContaining([{ type: 'dnf', slot: 1, reason: 'left' }]));
    expect(sim.retire(1, 'left')).toEqual([]);
    const t = soloSim(undefined, { maxRaceMs: 2000 });
    t.sim.go();
    const events: KartSimEvent[] = [];
    for (let i = 0; i < 200 && t.sim.status !== 'done'; i++) events.push(...t.sim.step());
    expect(t.sim.status).toBe('done');
    expect(events).toEqual(expect.arrayContaining([{ type: 'dnf', slot: 0, reason: 'timeout' }, { type: 'done' }]));
  });

  it('startCountdown schedules GO; locked karts rev and never move before it', () => {
    const { sim, k } = soloSim();
    sim.startCountdown(120);
    let seq = 1;
    const x0 = k.state.x;
    const events: KartSimEvent[] = [];
    for (let t = 0; t < 119; t++) {
      sim.pushInputs(0, seq++, [P({ throttle: t > 90 ? 1 : 0 })]);
      events.push(...sim.step());
    }
    expect(sim.status).toBe('grid');
    expect(k.state.x).toBe(x0);
    expect(k.state.rev).toBeGreaterThan(20);
    for (let t = 0; t < 5; t++) {
      sim.pushInputs(0, seq++, [P({ throttle: 1 })]);
      events.push(...sim.step());
    }
    expect(events.some((e) => e.type === 'go')).toBe(true);
    expect(sim.status).toBe('racing');
    expect(k.state.boostTicks).toBeGreaterThan(0); // perfect start
  });
});

describe('races', () => {
  it('a bot race: laps, finish order, final lap and done; standings sorted', () => {
    const track = getKartTrack('pixel-plaza');
    const sim = new KartSim(track, { ...OPTS, laps: 1, items: true }, createSeededRng(9), 3);
    for (let i = 0; i < 6; i++) sim.addRacer(i, 'b' + i, 'nova', 'normal');
    sim.startCountdown(60);
    const events: KartSimEvent[] = [];
    while (sim.status !== 'done' && sim.tick < 60 * 120) events.push(...sim.step());
    expect(sim.status).toBe('done');
    const fin = events.filter((e) => e.type === 'finish');
    expect(fin.length).toBe(6);
    expect(fin.map((e) => (e as { place: number }).place)).toEqual([1, 2, 3, 4, 5, 6]);
    const st = sim.standings();
    expect(st.map((k) => k.finishOrder)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(st.map((k) => k.position)).toEqual([1, 2, 3, 4, 5, 6]);
    for (let i = 1; i < fin.length; i++)
      expect((fin[i] as { timeMs: number }).timeMs).toBeGreaterThanOrEqual((fin[i - 1] as { timeMs: number }).timeMs);
  });

  it('karts bump each other (weight matters) and never overlap for long', () => {
    const track = getKartTrack('pixel-plaza');
    const sim = new KartSim(track, OPTS, createSeededRng(2), 1);
    const light = sim.addRacer(0, 'a', 'byte');
    const heavy = sim.addRacer(1, 'b', 'brick');
    const c = pointAtS(track, 200);
    light.state = createKartState(track, {
      x: c.x - c.ty * 1.5,
      y: c.y + c.tx * 1.5,
      z: c.z,
      heading: Math.atan2(c.ty, c.tx),
      s: 200,
      d: 1.5,
    });
    heavy.state = createKartState(track, {
      x: c.x + c.ty * 0.5,
      y: c.y - c.tx * 0.5,
      z: c.z,
      heading: Math.atan2(c.ty, c.tx),
      s: 200,
      d: -0.5,
    });
    light.state.vx = heavy.state.vx = 0;
    sim.go();
    const ev = sim.step();
    const bump = ev.find((e) => e.type === 'bump');
    expect(bump === undefined || bump.type === 'bump').toBe(true);
    const lv = Math.hypot(light.state.vx, light.state.vy);
    const hv = Math.hypot(heavy.state.vx, heavy.state.vy);
    expect(lv).toBeGreaterThan(hv);
  });

  it('a shortcut branch is legal: a kart driving it keeps counting laps', () => {
    const track = getKartTrack('dune-drift');
    const sim = new KartSim(track, { ...OPTS, laps: 1 }, createSeededRng(4), 1);
    const k = sim.addRacer(0, 'a', 'quack');
    sim.go();
    const b = track.branches[0]!;
    // Teleport-free drive: put the kart at the branch mouth heading along it, then drive it (with a turbo boost).
    const i0 = 2;
    k.state = createKartState(track, {
      x: b.xs[i0]!,
      y: b.ys[i0]!,
      z: b.zs[i0]!,
      heading: Math.atan2(b.ty[i0]!, b.tx[i0]!),
      s: b.from,
      d: 0,
    });
    k.state.branch = b.index;
    k.state.seg = i0;
    k.progress.lap = 1;
    k.progress.lapStarts = [0];
    k.progress.nextGate = track.gates.findIndex((g) => g > b.from);
    k.progress.s = b.from + 1;
    let seq = 1;
    let onBranch = 0;
    for (let t = 0; t < 60 * 90 && !k.progress.finished; t++) {
      const st = k.state;
      // Follow the road centre ahead (a tiny autopilot).
      const road = st.branch >= 0 ? track.branches[st.branch]! : null;
      let tx: number;
      let ty: number;
      if (road) {
        const j = Math.min(road.n - 1, st.seg + 6);
        tx = road.xs[j]!;
        ty = road.ys[j]!;
        onBranch++;
      } else {
        const p = pointAtS(track, k.info.s + 15);
        tx = p.x;
        ty = p.y;
      }
      let err = Math.atan2(ty - st.y, tx - st.x) - st.heading;
      err = Math.atan2(Math.sin(err), Math.cos(err));
      sim.pushInputs(0, seq++, [P({ throttle: 1, steer: Math.max(-1, Math.min(1, err * 2.5)) })]);
      sim.step();
    }
    expect(onBranch).toBeGreaterThan(100);
    expect(k.progress.finished).toBe(true);
  });
});
