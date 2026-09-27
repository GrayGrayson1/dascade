import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { KART_ITEM_IDS, packKartInput, NEUTRAL_KART_INPUT, type KartInput, type KartItemId } from '@dascade/shared/games/kart';
import { itemCode, itemFromCode, TRAILABLE_ITEMS, trapThrowsAhead } from './itemcodes.ts';
import { giveItem, ITEM_TUNING, itemWeights, rollItem, RARE_MIN_POSITION_FRAC } from './items.ts';
import { KartSim, type KartSimEvent, type SimKart } from './sim.ts';
import { createKartState } from './kart.ts';
import { rankDistance } from './progress.ts';
import { buildTrack, type KartTrack } from './track.ts';
import { LAB_DEF, LAB_WALL_DEF } from './lab/feel.ts';

describe('item codes', () => {
  it('round-trip and flag trailable items', () => {
    for (const id of KART_ITEM_IDS) expect(itemFromCode(itemCode(id))).toBe(id);
    expect(itemFromCode(0)).toBeNull();
    expect(itemFromCode(99)).toBeNull();
    expect([...TRAILABLE_ITEMS].sort()).toEqual(['fizz', 'mine', 'puck', 'puck3']);
    // Traps lob ahead only with the explicit `ahead` aim; `back` wins over `ahead`.
    expect(trapThrowsAhead({ back: false, ahead: true })).toBe(true);
    expect(trapThrowsAhead({ back: true, ahead: true })).toBe(false);
    expect(trapThrowsAhead({ back: false })).toBe(false);
    expect(trapThrowsAhead({ back: false, ahead: false })).toBe(false);
  });
});

describe('distribution', () => {
  const sum = (w: Record<KartItemId, number>) => KART_ITEM_IDS.reduce((a, id) => a + w[id], 0);
  const comeback = (w: Record<KartItemId, number>) => w.turbo3 + w.magnet + w.seeker + w.warp + w.pulse;

  it('every table sums to 1 with no negative weight', () => {
    for (let p = 0; p <= 1.0001; p += 0.05)
      for (const gap of [0, 50, 200, 800, 5000])
        for (const n of [1, 2, 8, 30]) {
          const w = itemWeights(p, gap, n);
          expect(sum(w)).toBeCloseTo(1, 10);
          for (const id of KART_ITEM_IDS) expect(w[id]).toBeGreaterThanOrEqual(0);
        }
  });

  it('the front never gets warp/pulse, the leader never gets seeker/magnet', () => {
    for (const gap of [0, 300, 3000]) {
      for (let p = 0; p < RARE_MIN_POSITION_FRAC; p += 0.02) {
        const w = itemWeights(p, gap, 12);
        expect(w.warp).toBe(0);
        expect(w.pulse).toBe(0);
      }
    }
    const leader = itemWeights(0, 0, 12);
    expect(leader.seeker).toBe(0);
    expect(leader.magnet).toBe(0);
    const solo = itemWeights(0.7, 500, 1);
    expect(solo.warp + solo.pulse + solo.seeker + solo.magnet).toBe(0);
  });

  it('the back gets comeback items much more often, and a big gap to the leader helps', () => {
    const front = comeback(itemWeights(0, 0, 12));
    const mid = comeback(itemWeights(0.5, 100, 12));
    const back = comeback(itemWeights(1, 100, 12));
    expect(back).toBeGreaterThan(front * 3);
    expect(back).toBeGreaterThan(mid);
    expect(comeback(itemWeights(0.5, 600, 12))).toBeGreaterThan(mid);
    expect(itemWeights(1, 0, 12).warp).toBeGreaterThan(0.05);
  });

  it('rolls follow the weights', () => {
    const rng = createSeededRng(42);
    const counts: Record<string, number> = {};
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const id = rollItem(rng, 1, 400, 12);
      counts[id] = (counts[id] ?? 0) + 1;
    }
    const w = itemWeights(1, 400, 12);
    for (const id of KART_ITEM_IDS) expect(Math.abs((counts[id] ?? 0) / N - w[id])).toBeLessThan(0.015);
  });
});

/** Put a kart at (x, y) on lap 1 with consistent progress (next gate after it) and distance. */
function placeKart(track: KartTrack, k: SimKart, x: number, y: number): void {
  k.state = createKartState(track, { x, y, z: 0, heading: 0, s: x, d: y });
  k.progress.s = x;
  k.progress.lap = 1;
  k.progress.lapStarts = [0];
  const next = track.gates.findIndex((g) => g > x);
  k.progress.nextGate = next < 0 ? 0 : next;
  k.distance = rankDistance(k.progress, track);
}

/** Two karts on a wide straight: 0 behind, 1 ahead. */
function duel(opts: { gap?: number; lat?: number; items?: boolean; wall?: boolean } = {}) {
  const track = buildTrack(opts.wall ? LAB_WALL_DEF : LAB_DEF);
  const sim = new KartSim(track, { laps: 3, items: opts.items ?? true, finishWindowMs: 10_000, maxRaceMs: 600_000 }, createSeededRng(3), 9);
  const a = sim.addRacer(0, 'a', 'nova');
  const b = sim.addRacer(1, 'b', 'nova');
  placeKart(track, a, 300, 0);
  placeKart(track, b, 300 + (opts.gap ?? 30), opts.lat ?? 0);
  sim.go();
  let seqA = 1;
  let seqB = 1;
  const events: KartSimEvent[] = [];
  const tick = (ia: Partial<KartInput> = {}, ib: Partial<KartInput> = {}) => {
    sim.pushInputs(0, seqA++, [packKartInput({ ...NEUTRAL_KART_INPUT, ...ia })]);
    sim.pushInputs(1, seqB++, [packKartInput({ ...NEUTRAL_KART_INPUT, ...ib })]);
    events.push(...sim.step());
  };
  return { sim, a, b, tick, events, track };
}

describe('item effects', () => {
  it('puck: fires straight ahead, hits the kart in line, spins it; blocked by a shield', () => {
    const d = duel();
    giveItem(d.a.state, 'puck');
    d.tick({ item: true });
    d.tick({ item: false });
    expect(d.sim.entities.some((e) => e.kind === 'puck')).toBe(true);
    for (let i = 0; i < 90; i++) d.tick();
    const hit = d.events.find((e) => e.type === 'hit');
    expect(hit).toMatchObject({ type: 'hit', victim: 1, by: 0, cause: 'puck', blocked: false });
    expect(d.b.state.spinTicks > 0 || d.b.state.immuneTicks > 0).toBe(true);

    const s = duel();
    giveItem(s.a.state, 'puck');
    s.b.state.shieldTicks = 300;
    s.tick({ item: true });
    s.tick();
    for (let i = 0; i < 90; i++) s.tick();
    expect(s.events.find((e) => e.type === 'hit')).toMatchObject({ victim: 1, cause: 'puck', blocked: true });
    expect(s.b.state.spinTicks).toBe(0);
  });

  it('puck: ricochets off walls at most 3 times, then breaks; expires after its lifetime', () => {
    const d = duel({ wall: true, gap: 400 });
    giveItem(d.a.state, 'puck');
    d.a.state.heading = 1.2; // aim at the wall
    d.tick({ item: true });
    d.tick();
    let maxBounces = 0;
    let alive = 0;
    for (let i = 0; i < ITEM_TUNING.puckLife + 10; i++) {
      d.tick();
      const p = d.sim.entities.find((e) => e.kind === 'puck');
      if (p) {
        alive = i;
        maxBounces = Math.max(maxBounces, p.bounces);
      }
    }
    expect(maxBounces).toBeGreaterThanOrEqual(1);
    expect(maxBounces).toBeLessThanOrEqual(ITEM_TUNING.puckBounces);
    expect(alive).toBeLessThan(ITEM_TUNING.puckLife);
  });

  it('puck aimed back hits the kart behind; a trailing item blocks a puck from behind', () => {
    const d = duel({ gap: 25 });
    giveItem(d.b.state, 'puck');
    d.tick({}, { item: true });
    d.tick({}, { item: false, back: true });
    for (let i = 0; i < 60; i++) d.tick();
    expect(d.events.find((e) => e.type === 'hit')).toMatchObject({ victim: 0, by: 1, cause: 'puck', blocked: false });

    const t = duel({ gap: 25 });
    giveItem(t.a.state, 'puck');
    giveItem(t.b.state, 'mine');
    t.tick({ item: true }, { item: true }); // b starts trailing its mine
    t.tick({ item: false }, { item: true });
    for (let i = 0; i < 60; i++) t.tick({}, { item: true });
    expect(t.events.find((e) => e.type === 'hit')).toMatchObject({ victim: 1, cause: 'puck', blocked: true });
    expect(t.b.state.item).toBe(0);
    expect(t.b.state.spinTicks).toBe(0);
  });

  it('seeker: follows the track to the racer directly ahead and hits them', () => {
    const d = duel({ gap: 80, lat: 8 });
    giveItem(d.a.state, 'seeker');
    d.tick({ item: true });
    const s = d.sim.entities.find((e) => e.kind === 'seeker');
    expect(s?.target).toBe(1);
    for (let i = 0; i < 180; i++) d.tick({ throttle: 0 }, { throttle: 1 });
    expect(d.events.find((e) => e.type === 'hit')).toMatchObject({ victim: 1, by: 0, cause: 'seeker' });
  });

  it('mine: dropped behind, arms, spins whoever runs into it; lobbed ahead with the forward aim', () => {
    const d = duel({ gap: -30 }); // b is behind a
    giveItem(d.a.state, 'mine');
    d.tick({ item: true });
    d.tick({ item: false }); // default aim: dropped behind
    const m = d.sim.entities.find((e) => e.kind === 'mine')!;
    expect(m.x).toBeLessThan(d.a.state.x);
    for (let i = 0; i < 120; i++) d.tick({}, { throttle: 1 });
    expect(d.events.find((e) => e.type === 'hit')).toMatchObject({ victim: 1, by: 0, cause: 'mine' });

    // Full throttle alone still drops it behind (never inferred from the throttle).
    const t = duel({ gap: 60 });
    giveItem(t.a.state, 'mine');
    t.tick({ item: true, throttle: 1 });
    t.tick({ item: false, throttle: 1 });
    const dropped = t.sim.entities.find((e) => e.kind === 'mine')!;
    expect(dropped.flying).toBe(false);
    expect(dropped.x).toBeLessThan(t.a.state.x);

    const l = duel({ gap: 60 });
    giveItem(l.a.state, 'mine');
    l.a.state.vx = 25;
    l.tick({ item: true, throttle: 1, ahead: true });
    l.tick({ item: false, throttle: 1, ahead: true });
    const lob = l.sim.entities.find((e) => e.kind === 'mine')!;
    expect(lob.flying).toBe(true);
    for (let i = 0; i < 60; i++) l.tick();
    const landed = l.sim.entities.find((e) => e.kind === 'mine')!;
    expect(landed.flying).toBe(false);
    expect(landed.x).toBeGreaterThan(318); // thrown ~25 u ahead of where it was used (x = 300)
  });

  it('fizz: a puddle that makes karts lose grip (no spin), lasting a while', () => {
    const d = duel({ gap: -20 });
    giveItem(d.a.state, 'fizz');
    d.tick({ item: true, back: true });
    d.tick({ item: false, back: true });
    for (let i = 0; i < 80; i++) d.tick({ throttle: 1 }, { throttle: 1 });
    const hit = d.events.find((e) => e.type === 'hit');
    expect(hit).toMatchObject({ victim: 1, cause: 'fizz' });
    expect(d.b.state.spinTicks).toBe(0);
    expect(d.sim.entities.some((e) => e.kind === 'puddle')).toBe(true);
  });

  it('magnet: locks on the kart ahead with power scaled by the gap', () => {
    const near = duel({ gap: 20 });
    giveItem(near.a.state, 'magnet');
    near.tick({ item: true });
    const far = duel({ gap: 150 });
    giveItem(far.a.state, 'magnet');
    far.tick({ item: true });
    expect(near.a.state.magnetTicks).toBeGreaterThan(0);
    expect(far.a.state.magnetPower).toBeGreaterThan(near.a.state.magnetPower);
    // It pulls a coasting kart toward the one ahead and above its top speed.
    for (let i = 0; i < 150; i++) far.tick({ throttle: 1 }, { throttle: 0 });
    expect(Math.hypot(far.a.state.vx, far.a.state.vy)).toBeGreaterThan(far.a.spec.topSpeed);
  });

  it('pulse: hits every kart within ~120 u ahead; shields block; karts behind are safe', () => {
    const track = buildTrack(LAB_DEF);
    const sim = new KartSim(track, { laps: 3, items: true, finishWindowMs: 10_000, maxRaceMs: 600_000 }, createSeededRng(5), 1);
    const ks = [0, 1, 2, 3].map((i) => sim.addRacer(i, 'k' + i, 'nova'));
    const xs = [100, 150, 200, 400];
    ks.forEach((k, i) => placeKart(track, k, xs[i]!, 0));
    ks[2]!.state.shieldTicks = 100;
    sim.go();
    giveItem(ks[0]!.state, 'pulse');
    sim.step(); // distances
    sim.pushInputs(0, 1, [packKartInput({ ...NEUTRAL_KART_INPUT, item: true })]);
    const ev = sim.step().filter((e) => e.type === 'hit');
    expect(ev).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ victim: 1, cause: 'pulse', blocked: false }),
        expect.objectContaining({ victim: 2, cause: 'pulse', blocked: true }),
      ]),
    );
    expect(ev.some((e) => e.type === 'hit' && e.victim === 3)).toBe(false);
  });

  it('pulse spins at most the 8 nearest karts ahead (no pack wipe-out)', () => {
    const track = buildTrack(LAB_DEF);
    const sim = new KartSim(track, { laps: 3, items: true, finishWindowMs: 10_000, maxRaceMs: 600_000 }, createSeededRng(5), 1);
    const ks = Array.from({ length: 14 }, (_, i) => sim.addRacer(i, 'k' + i, 'nova'));
    ks.forEach((k, i) => placeKart(track, k, 100 + i * 7, (i % 3) * 4 - 4));
    sim.go();
    giveItem(ks[0]!.state, 'pulse');
    sim.step();
    sim.pushInputs(0, 1, [packKartInput({ ...NEUTRAL_KART_INPUT, item: true })]);
    const hits = sim.step().filter((e) => e.type === 'hit');
    expect(hits.length).toBe(ITEM_TUNING.pulseMaxVictims);
    expect(hits.map((h) => (h as { victim: number }).victim).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('warp makes the kart intangible (no bumps, no hits)', () => {
    const d = duel({ gap: 3 });
    d.a.state.warpTicks = 100;
    for (let i = 0; i < 30; i++) d.tick({}, {});
    expect(d.events.some((e) => e.type === 'bump')).toBe(false);
  });
});

describe('item boxes + roulette + caps', () => {
  it('a cube starts the roulette, the server rolls an item ~1.1 s later, the cube respawns ~2 s later', () => {
    const d = duel();
    const box = d.track.itemBoxes;
    expect(box.length).toBe(0); // the lab track has no rows; use a real track below
    const sim = new KartSim(
      buildTrack({ ...LAB_DEF, itemRows: [{ at: 0.05, count: 3 }] }),
      { laps: 3, items: true, finishWindowMs: 1000, maxRaceMs: 600000 },
      createSeededRng(1),
      1,
    );
    const k = sim.addRacer(0, 'a', 'nova');
    const b0 = sim.track.itemBoxes[1]!;
    k.state = createKartState(sim.track, { x: b0.x - 10, y: b0.y, z: 0, heading: 0, s: b0.s - 10, d: 0 });
    k.progress.s = b0.s - 10;
    sim.go();
    const ev: KartSimEvent[] = [];
    let seq = 1;
    for (let i = 0; i < 200; i++) {
      sim.pushInputs(0, seq++, [packKartInput({ ...NEUTRAL_KART_INPUT, throttle: 1 })]);
      ev.push(...sim.step().map((e) => ({ ...e, t: i }) as unknown as KartSimEvent));
    }
    const pick = ev.find((e) => e.type === 'box') as KartSimEvent & { t: number };
    const got = ev.find((e) => e.type === 'item') as KartSimEvent & { t: number };
    expect(pick).toBeTruthy();
    expect(got).toBeTruthy();
    expect((got.t - pick.t) / 60).toBeGreaterThan(1);
    expect((got.t - pick.t) / 60).toBeLessThan(1.2);
    expect(k.state.item).not.toBe(0);
    const idx = (pick as { box: number }).box;
    expect(sim.boxes[idx]!.present).toBe(true); // respawned after 2 s (200 ticks later)
  });

  it('caps live entities at 60, dropping the oldest traps first', () => {
    const d = duel({ gap: 500 });
    for (let i = 0; i < 80; i++) {
      giveItem(d.a.state, 'mine');
      d.tick({ item: true, back: true });
      d.tick({ item: false, back: true });
    }
    expect(d.sim.entities.length).toBeLessThanOrEqual(ITEM_TUNING.maxEntities);
    const ids = d.sim.entities.map((e) => e.id);
    expect(Math.min(...ids)).toBeGreaterThan(10);
  });

  it('time trial: every racer starts with a Turbo Trio', () => {
    const sim = new KartSim(
      buildTrack(LAB_DEF),
      { laps: 1, items: false, startItem: 'turbo3', finishWindowMs: 1000, maxRaceMs: 60000 },
      createSeededRng(1),
      1,
    );
    const k = sim.addRacer(0, 'a', 'nova');
    expect(itemFromCode(k.state.item)).toBe('turbo3');
    expect(k.state.itemUses).toBe(3);
    expect(sim.boxes.every((b) => !b.present)).toBe(true);
  });
});
