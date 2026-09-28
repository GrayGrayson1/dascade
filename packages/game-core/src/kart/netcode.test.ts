import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { KART_RACER_IDS, NEUTRAL_KART_INPUT, type KartInput } from '@dascade/shared/games/kart';
import { getKartTrack } from './index.ts';
import { decodeGhost, encodeGhost, GHOST_MAX_SAMPLES, ghostPoseAt, GhostRecorder } from './ghost.ts';
import { KartPredictor } from './predictor.ts';
import { KartSim } from './sim.ts';
import { decodeKartOwn, decodeKartSnapshot, KartFlag, OWN_BYTES, SNAP_HEADER, SNAP_KART, encodeOwn } from './snapshot.ts';
import { racerSpec } from './spec.ts';
import { giveItem } from './items.ts';

describe('snapshot', () => {
  const race = (n: number, ticks: number) => {
    const sim = new KartSim(
      getKartTrack('pixel-plaza'),
      { laps: 3, items: true, finishWindowMs: 20000, maxRaceMs: 600000 },
      createSeededRng(11),
      77,
    );
    for (let i = 0; i < n; i++) sim.addRacer(i, 'b' + i, KART_RACER_IDS[i % 8]!, 'normal');
    sim.startCountdown(30);
    for (let t = 0; t < ticks; t++) sim.step();
    return sim;
  };

  it('round-trips display records within quantization and carries entities + boxes', () => {
    const sim = race(30, 60 * 25);
    const bytes = sim.encodeSnapshot();
    const snap = decodeKartSnapshot(bytes)!;
    expect(snap).not.toBeNull();
    expect(snap.raceId).toBe(77);
    expect(snap.tick).toBe(sim.tick);
    expect(snap.status).toBe('racing');
    expect(snap.goTick).toBe(sim.goTick);
    expect(snap.karts).toHaveLength(30);
    expect(snap.boxes).toHaveLength(sim.track.itemBoxes.length);
    for (const sk of snap.karts) {
      const k = sim.kart(sk.slot)!;
      expect(Math.abs(sk.x - k.state.x)).toBeLessThanOrEqual(1 / 256 + 1e-9);
      expect(Math.abs(sk.y - k.state.y)).toBeLessThanOrEqual(1 / 256 + 1e-9);
      expect(Math.abs(sk.z - k.state.z)).toBeLessThanOrEqual(1 / 128 + 1e-9);
      expect(Math.abs(sk.vx - k.state.vx)).toBeLessThanOrEqual(1 / 512 + 1e-9);
      expect(Math.abs(sk.heading - k.state.heading)).toBeLessThan(1e-9);
      expect(sk.driftDir).toBe(k.state.driftDir);
      expect((sk.flags & KartFlag.drifting) !== 0).toBe(k.state.driftDir !== 0);
      expect((sk.flags & KartFlag.connected) !== 0).toBe(true);
    }
    expect(snap.entities.length).toBe(sim.entities.length);
    for (let i = 0; i < snap.entities.length; i++) {
      expect(snap.entities[i]!.id).toBe(sim.entities[i]!.id);
      expect(snap.entities[i]!.kind).toBe(sim.entities[i]!.kind);
      expect(Math.abs(snap.entities[i]!.x - sim.entities[i]!.x)).toBeLessThan(0.01);
    }
    // Size budget at 30 karts (lead target ≤ ~0.8 KB).
    expect(bytes.byteLength).toBe(SNAP_HEADER + Math.ceil(sim.boxes.length / 8) + 30 * SNAP_KART + snap.entities.length * 15);
    expect(SNAP_HEADER + 8 + 30 * SNAP_KART + 12 * 15).toBeLessThanOrEqual(820);
  });

  it('own records are exact and small', () => {
    const sim = race(4, 60 * 12);
    for (const k of sim.karts) {
      const bytes = sim.encodeOwn(k.slot)!;
      expect(bytes.byteLength).toBe(OWN_BYTES);
      const own = decodeKartOwn(bytes)!;
      expect(own.slot).toBe(k.slot);
      expect(own.ack).toBe(k.ackSeq);
      expect(own.tick).toBe(sim.tick);
      expect(own.state).toEqual(k.state);
    }
    expect(sim.encodeOwn(29)).toBeNull();
  });

  it('authoritative state is always exactly on the wire grid (items, magnets, bumps, hits)', () => {
    const sim = new KartSim(
      getKartTrack('pixel-plaza'),
      { laps: 3, items: true, finishWindowMs: 20000, maxRaceMs: 600000 },
      createSeededRng(21),
      5,
    );
    for (let i = 0; i < 8; i++) sim.addRacer(i, 'b' + i, KART_RACER_IDS[i]!, 'hard');
    sim.startCountdown(30);
    let magnetTicks = 0;
    let checked = 0;
    for (let t = 0; t < 60 * 60; t++) {
      // Hand out magnets so the tug path is exercised every race.
      if (t % 600 === 300) for (const k of sim.karts) if (k.position > 1 && k.state.item === 0) giveItem(k.state, 'magnet');
      sim.step();
      for (const k of sim.karts) {
        if (k.state.magnetTicks > 0) magnetTicks++;
        const own = decodeKartOwn(sim.encodeOwn(k.slot)!)!;
        expect(own.state).toEqual(k.state);
        checked++;
      }
    }
    expect(magnetTicks).toBeGreaterThan(300);
    expect(checked).toBeGreaterThan(20000);
  });

  it('rejects malformed input', () => {
    const sim = race(3, 100);
    const good = sim.encodeSnapshot();
    expect(decodeKartSnapshot(new Uint8Array(3))).toBeNull();
    expect(decodeKartSnapshot(good.slice(0, good.length - 1))).toBeNull();
    const badVersion = good.slice();
    badVersion[0] = 99;
    expect(decodeKartSnapshot(badVersion)).toBeNull();
    const badCount = good.slice();
    badCount[16] = 200;
    expect(decodeKartSnapshot(badCount)).toBeNull();
    expect(decodeKartSnapshot('nope' as unknown as Uint8Array)).toBeNull();
    const own = sim.encodeOwn(0)!;
    expect(decodeKartOwn(own.slice(0, 10))).toBeNull();
    const nan = own.slice();
    new DataView(nan.buffer).setFloat32(12, NaN, true);
    expect(decodeKartOwn(nan)).toBeNull();
    const badDrift = own.slice();
    badDrift[12 + 27] = 5;
    expect(decodeKartOwn(badDrift)).toBeNull();
    // A sub-array view (offset into a larger buffer) decodes the same.
    const big = new Uint8Array(own.length + 7);
    big.set(own, 7);
    expect(decodeKartOwn(big.subarray(7))).toEqual(decodeKartOwn(own));
    expect(encodeOwn(1, 2, 3, 4, decodeKartOwn(own)!.state)).toHaveLength(OWN_BYTES);
  });
});

describe('client prediction', () => {
  /**
   * A human kart driven through the credit bank with network delay (inputs arrive 4 ticks late,
   * own-records every 3 ticks arrive 5 ticks late). The predictor's corrections must be exactly 0.
   */
  it('reconciliation reproduces the server bit for bit when uninterrupted (drift, pads, turbos)', () => {
    const track = getKartTrack('pixel-plaza');
    const sim = new KartSim(
      track,
      { laps: 3, items: false, startItem: 'turbo3', collisions: false, finishWindowMs: 5000, maxRaceMs: 600000 },
      createSeededRng(1),
      5,
    );
    const k = sim.addRacer(0, 'me', 'mochi');
    const pred = new KartPredictor(track, k.spec);
    const toServer: Array<{ at: number; seq: number; packed: number[] }> = [];
    const toClient: Array<{ at: number; bytes: Uint8Array }> = [];
    sim.startCountdown(40);
    let errors = 0;
    let reconciles = 0;
    let maxErr = 0;
    for (let t = 0; t < 60 * 25; t++) {
      // Client: a scripted player (weaves, drifts, fires the turbos).
      const input: KartInput = {
        ...NEUTRAL_KART_INPUT,
        throttle: t > 20 ? 1 : 0,
        steer: Math.sin(t / 40) * 0.8,
        drift: t % 150 > 60 && t % 150 < 140,
        item: t === 300 || t === 500 || t === 700,
      };
      const racing = sim.status === 'racing';
      const f = pred.step(input, !racing && t < 42, sim.tick + 1);
      toServer.push({ at: t + 4, seq: f.seq, packed: [f.packed] });
      // Network.
      while (toServer.length && toServer[0]!.at <= t) {
        const p = toServer.shift()!;
        sim.pushInputs(0, p.seq, p.packed);
      }
      sim.step();
      if (t % 3 === 0) toClient.push({ at: t + 5, bytes: sim.encodeOwn(0)! });
      while (toClient.length && toClient[0]!.at <= t) {
        const own = decodeKartOwn(toClient.shift()!.bytes)!;
        const err = pred.reconcile(own.state, own.ack, own.tick, sim.status === 'racing');
        reconciles++;
        if (err > 0) errors++;
        maxErr = Math.max(maxErr, err);
      }
    }
    expect(reconciles).toBeGreaterThan(400);
    expect(k.state.itemUses).toBeLessThan(3); // turbos really used on the server
    // The only mispredictions allowed are around the green light (lock state). After that: none.
    expect(errors).toBeLessThanOrEqual(3);
    // Final: drain the network and compare exactly.
    for (let t = 0; t < 20; t++) {
      while (toServer.length) {
        const p = toServer.shift()!;
        sim.pushInputs(0, p.seq, p.packed);
      }
      sim.step();
    }
    const own = decodeKartOwn(sim.encodeOwn(0)!)!;
    pred.reconcile(own.state, own.ack, own.tick, true);
    expect(pred.pending).toHaveLength(0);
    expect(pred.state).toEqual(k.state);
  });

  it('start boost / stall: the prediction agrees with the server at 0, 100 and 200 ms', () => {
    const track = getKartTrack('pixel-plaza');
    const outcomes: string[] = [];
    for (const lag of [0, 6, 12]) {
      // `hold`: frames of throttle before the kart's own first unlocked frame (0 = gas at GO).
      for (const hold of [0, 2, 3, 10, 30, 55, 60, 61, 90, 239]) {
        const sim = new KartSim(track, { laps: 1, items: false, finishWindowMs: 1000, maxRaceMs: 60_000 }, createSeededRng(1), 3);
        sim.addRacer(0, 'me', 'nova');
        const pred = new KartPredictor(track, racerSpec('nova'));
        sim.startCountdown(240);
        const toServer: Array<{ at: number; seq: number; packed: number[] }> = [];
        const toClient: Array<{ at: number; bytes: Uint8Array }> = [];
        let predicted = 'none';
        let server = 'none';
        for (let t = 0; t < 420; t++) {
          const locked = pred.nextFrameLocked(sim.goTick);
          const throttle = pred.framesToGo(sim.goTick) <= hold ? 1 : 0;
          const f = pred.step({ ...NEUTRAL_KART_INPUT, throttle }, locked, sim.tick + 1 + lag);
          if (pred.info && pred.info.startBoost !== 'none' && predicted === 'none') predicted = pred.info.startBoost;
          toServer.push({ at: t + lag, seq: f.seq, packed: [f.packed] });
          while (toServer.length && toServer[0]!.at <= t) {
            const p = toServer.shift()!;
            sim.pushInputs(0, p.seq, p.packed);
          }
          sim.step();
          const k = sim.kart(0)!;
          if (k.info.startBoost !== 'none' && server === 'none') server = k.info.startBoost;
          toClient.push({ at: t + lag, bytes: sim.encodeOwn(0)! });
          while (toClient.length && toClient[0]!.at <= t) {
            const own = decodeKartOwn(toClient.shift()!.bytes)!;
            pred.reconcile(own.state, own.ack, own.tick, sim.status === 'racing', own.goSeq);
          }
        }
        outcomes.push(`${lag}/${hold}:${server}`);
        expect(predicted, `lag ${lag} ticks, hold ${hold}: server ${server}`).toBe(server);
        const want = hold >= 3 && hold <= 60 ? 'boost' : hold > 60 ? 'stall' : 'none';
        expect(server, `lag ${lag}, hold ${hold}`).toBe(want);
      }
    }
    expect(outcomes.length).toBe(30);
  });

  it('frames before the first reconcile are numbered and replayed; reset clears', () => {
    const track = getKartTrack('pixel-plaza');
    const pred = new KartPredictor(track, racerSpec('nova'));
    expect(pred.step({ ...NEUTRAL_KART_INPUT, throttle: 1 }, true, 1)).toMatchObject({ seq: 1 });
    expect(pred.state).toBeNull();
    pred.reset();
    expect(pred.pending).toHaveLength(0);
  });
});

describe('ghosts', () => {
  const record = (samples: number) => {
    const rec = new GhostRecorder();
    for (let t = 0; t < samples * 6; t++)
      rec.push({ x: 100 + t * 0.5, y: -40 + Math.sin(t / 50) * 20, z: 2 + Math.sin(t / 30), heading: ((t / 100) % 6) - 3 }, 1000 + t);
    return rec.finish({ track: 'dune-drift', racer: 'quack', body: 'tub', paint: '#ffd23f', timeMs: 123456 });
  };

  it('records at 10 Hz and round-trips through JSON within quantization', () => {
    const g = record(500);
    expect(g.samples).toHaveLength(500);
    const json = encodeGhost(g);
    const back = decodeGhost(json)!;
    expect(back).not.toBeNull();
    expect(back.track).toBe('dune-drift');
    expect(back.samples).toHaveLength(500);
    for (let i = 0; i < 500; i++) {
      expect(Math.abs(back.samples[i]!.x - g.samples[i]!.x)).toBeLessThan(1 / 16);
      expect(Math.abs(back.samples[i]!.z - g.samples[i]!.z)).toBeLessThan(1 / 16);
    }
    expect(decodeGhost(JSON.parse(json))).toEqual(back);
    const pose = ghostPoseAt(back, 1050)!;
    expect(pose.x).toBeGreaterThan(back.samples[10]!.x);
    expect(pose.x).toBeLessThan(back.samples[11]!.x);
    expect(ghostPoseAt(back, 10_000_000)).toBeNull();
  });

  it('is bounded in size (10 minutes fits the storage cap)', () => {
    const g = record(GHOST_MAX_SAMPLES + 50);
    expect(g.samples.length).toBe(GHOST_MAX_SAMPLES);
    expect(encodeGhost(g).length).toBeLessThan(96 * 1024);
  });

  it('rejects anything malformed', () => {
    const good = JSON.parse(encodeGhost(record(20))) as Record<string, unknown>;
    const bad = (patch: Record<string, unknown>) => decodeGhost({ ...good, ...patch });
    expect(bad({})).not.toBeNull();
    expect(bad({ v: 2 })).toBeNull();
    expect(bad({ track: 'nowhere' })).toBeNull();
    expect(bad({ racer: 'mario' })).toBeNull();
    expect(bad({ paint: 'red' })).toBeNull();
    expect(bad({ timeMs: -5 })).toBeNull();
    expect(bad({ timeMs: 1.5 })).toBeNull();
    expect(bad({ data: 'abc' })).toBeNull();
    expect(bad({ data: '!!!!' })).toBeNull();
    expect(bad({ data: 'AAAA' })).toBeNull();
    expect(decodeGhost('{not json')).toBeNull();
    expect(decodeGhost(null)).toBeNull();
    expect(decodeGhost([1, 2])).toBeNull();
    expect(decodeGhost('x'.repeat(200 * 1024))).toBeNull();
  });
});
