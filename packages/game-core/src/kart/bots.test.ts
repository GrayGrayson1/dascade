import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { KART_RACER_IDS, KART_TRACK_IDS, type KartBotSkill } from '@dascade/shared/games/kart';
import { getKartTrack, KART_PLACEHOLDER_TRACKS, KART_TRACK_DEFS } from './index.ts';
import { KartSim, type KartSimEvent } from './sim.ts';
import { driftQuality } from './lab/aborts.ts';
import { soloLap } from './lab/tiers.ts';
import { measurePar } from './lab/pars.ts';
import { BLIND, hazardRate } from './lab/hazards.ts';
import { NEUTRAL_KART_INPUT } from '@dascade/shared/games/kart';
import { createKartState, stepKart } from './kart.ts';
import { racerSpec } from './spec.ts';
import { groundAt, pointAtS } from './track.ts';

function botRace(id: (typeof KART_TRACK_IDS)[number], skill: KartBotSkill, seed: number, items = true) {
  const sim = new KartSim(getKartTrack(id), { laps: 3, items, finishWindowMs: 90_000, maxRaceMs: 480_000 }, createSeededRng(seed), seed);
  for (let i = 0; i < 8; i++) sim.addRacer(i, 'b' + i, KART_RACER_IDS[i]!, skill);
  sim.startCountdown(60);
  const events: KartSimEvent[] = [];
  while (sim.status !== 'done') events.push(...sim.step());
  return { sim, events };
}

describe('bots', () => {
  it.each(KART_TRACK_IDS)('hard bots finish every lap of %s with sane lap times vs par', (id) => {
    const { sim, events } = botRace(id, 'hard', 5);
    expect(sim.karts.every((k) => k.progress.finished)).toBe(true);
    const laps = sim.karts.flatMap((k) => k.progress.lapTimes.slice(1));
    const best = Math.min(...laps);
    const par = KART_TRACK_DEFS[id].parLapMs;
    if (!KART_PLACEHOLDER_TRACKS.has(id)) {
      // Hard bots are close to par, but a good human (par) can beat them.
      expect(best / par).toBeGreaterThan(0.82);
      expect(best / par).toBeLessThan(1.15);
    }
    expect(best).toBeGreaterThan(30_000);
    expect(best).toBeLessThan(60_000);
    // They use items and drift.
    expect(events.filter((e) => e.type === 'use').length).toBeGreaterThan(10);
  });

  it.each(KART_TRACK_IDS)("%s: par is the hard bot's best clean lap, and its median lap sits within ~1 % of par", (id) => {
    const { best, median } = measurePar(id);
    const par = KART_TRACK_DEFS[id].parLapMs;
    // Re-measure with lab/pars.ts after any physics, balance or bot change.
    expect(Math.abs(best / par - 1)).toBeLessThan(0.012);
    expect(median / par).toBeGreaterThan(0.995);
    expect(median / par).toBeLessThan(1.02);
  });

  it('drift quality: hard bots rarely abort a drift (no hop-hop-hop), and drift for mini-turbos', () => {
    const rows = driftQuality('hard', ['pixel-plaza', 'harbor-hairpins', 'gearworks', 'midnight-mainframe'], [1]);
    let drifts = 0;
    let aborted = 0;
    let mts = 0;
    for (const r of rows) {
      drifts += r.drifts;
      aborted += r.aborted;
      mts += r.mts;
    }
    expect(drifts).toBeGreaterThan(200);
    expect(aborted / drifts).toBeLessThan(0.05);
    expect(mts / drifts).toBeGreaterThan(0.6);
  }, 60_000);

  it('skill tiers: normal laps ~8 % slower than hard, easy ~18 % slower', () => {
    for (const id of ['pixel-plaza', 'gearworks'] as const) {
      const hard = soloLap(id, 'hard', {}, [1, 2]).mean;
      const normal = soloLap(id, 'normal', {}, [1, 2]).mean;
      const easy = soloLap(id, 'easy', {}, [1, 2]).mean;
      expect(normal / hard - 1, `${id} normal`).toBeGreaterThan(0.04);
      expect(normal / hard - 1, `${id} normal`).toBeLessThan(0.13);
      expect(easy / hard - 1, `${id} easy`).toBeGreaterThan(0.12);
      expect(easy / hard - 1, `${id} easy`).toBeLessThan(0.25);
    }
  }, 60_000);

  it('hazards are fair to newcomers: a racing-line follower that never dodges takes ≤ 0.5 hits/lap', () => {
    for (const id of KART_TRACK_IDS) {
      const t = getKartTrack(id);
      if (t.hazards.length === 0) continue;
      const rate = hazardRate(t, 'hard', BLIND, 6, 2);
      expect(rate, id).toBeLessThanOrEqual(0.5);
    }
  }, 120_000);

  it('frostbyte rollers: a driver holding the safe lane is never hit, whatever the timing', () => {
    const track = getKartTrack('frostbyte-pass');
    const rollers = track.hazards.filter((h) => h.kind === 'roller');
    expect(rollers.length).toBeGreaterThan(0);
    const spec = racerSpec('nova');
    // Hold d = 0 on the first run (outer-lane snowballs), d = ±5.1 on the second (centre snowball).
    for (const [lane, from, to] of [
      [0, rollers[0]!.s - rollers[0]!.amp - 40, rollers[0]!.s + 10],
      [5.1, rollers[2]!.s - rollers[2]!.amp - 40, rollers[2]!.s + 10],
      [-5.1, rollers[2]!.s - rollers[2]!.amp - 40, rollers[2]!.s + 10],
    ] as const) {
      for (let phase = 0; phase < 480; phase += 37) {
        const c = pointAtS(track, from);
        let st = createKartState(track, {
          x: c.x - c.ty * lane,
          y: c.y + c.tx * lane,
          z: c.z,
          heading: Math.atan2(c.ty, c.tx),
          s: from,
          d: lane,
        });
        st.vx = 18 * c.tx;
        st.vy = 18 * c.ty;
        let hits = 0;
        for (let t = 0; t < 60 * 12; t++) {
          const g = groundAt(track, st.x, st.y, { branch: st.branch, seg: st.seg });
          if (g.s > to) break;
          const p = pointAtS(track, g.s + 6);
          const aim = Math.atan2(p.y + p.tx * lane - st.y, p.x - p.ty * lane - st.x) - st.heading;
          const steer = Math.max(-1, Math.min(1, Math.atan2(Math.sin(aim), Math.cos(aim)) * 3));
          // A careful line: ease off while steering hard (the run starts out of a hairpin).
          const r = stepKart(st, { ...NEUTRAL_KART_INPUT, throttle: Math.abs(steer) > 0.4 ? 0.2 : 0.8, steer }, spec, track, {
            locked: false,
            tick: phase + t,
          });
          st = r.state;
          if (r.info.hazardHit >= 0 && track.hazards[r.info.hazardHit]!.kind === 'roller') hits++;
        }
        expect(hits, `lane ${lane} phase ${phase}`).toBe(0);
      }
    }
  });

  it('stuck detector: no bot of any skill is ever wedged (8 tracks × mixed fields, items on)', () => {
    const skills: KartBotSkill[] = ['easy', 'easy', 'easy', 'normal', 'normal', 'normal', 'hard', 'hard'];
    for (const id of KART_TRACK_IDS) {
      for (const seed of [7, 101]) {
        const sim = new KartSim(
          getKartTrack(id),
          { laps: 3, items: true, finishWindowMs: 120_000, maxRaceMs: 600_000 },
          createSeededRng(seed),
          seed,
        );
        for (let i = 0; i < 8; i++) sim.addRacer(i, 'b' + i, KART_RACER_IDS[i]!, skills[i]!);
        sim.startCountdown(60);
        const lastMove = new Map<number, { tick: number; dist: number }>();
        let worst = 0;
        let worstWho = '';
        while (sim.status !== 'done') {
          sim.step();
          if (sim.status !== 'racing') continue;
          for (const k of sim.karts) {
            if (k.progress.finished) continue;
            const m = lastMove.get(k.slot);
            if (!m || k.distance > m.dist + 5 || k.state.fallTicks > 0)
              lastMove.set(k.slot, { tick: sim.tick, dist: Math.max(k.distance, m?.dist ?? -Infinity) });
            else if (sim.tick - m.tick > worst) {
              worst = sim.tick - m.tick;
              worstWho = `${k.bot} ${k.racer} at s=${k.info.s.toFixed(0)} d=${k.info.d.toFixed(1)}`;
            }
          }
        }
        // Never more than 6 s without 5 u of progress (spins, falls and bumps included).
        expect(worst / 60, `${id} seed ${seed}: ${worstWho}`).toBeLessThan(6);
        expect(
          sim.karts.every((k) => k.progress.finished),
          `${id} seed ${seed}`,
        ).toBe(true);
      }
    }
  }, 120_000);

  it('easy bots finish too (recovering from walls, spins and falls)', () => {
    for (const id of ['dune-drift', 'pixel-plaza'] as const) {
      const { sim } = botRace(id, 'easy', 2);
      expect(sim.karts.every((k) => k.progress.finished)).toBe(true);
    }
  });
});
