import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { KART_RACER_IDS, KART_TRACK_IDS, type KartBotSkill } from '@dascade/shared/games/kart';
import { getKartTrack, KART_PLACEHOLDER_TRACKS, KART_TRACK_DEFS } from './index.ts';
import { KartSim, type KartSimEvent } from './sim.ts';
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

  it('skills are ordered: hard beats normal beats easy', () => {
    const mean = (skill: KartBotSkill) => {
      const { sim } = botRace('pixel-plaza', skill, 8, false);
      const all = sim.karts.map((k) => k.progress.finishMs);
      return all.reduce((a, b) => a + b, 0) / all.length;
    };
    const hard = mean('hard');
    const normal = mean('normal');
    const easy = mean('easy');
    expect(hard).toBeLessThan(normal);
    expect(normal).toBeLessThan(easy);
    expect(easy / hard).toBeLessThan(1.35);
  });

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

  it('easy bots finish too (recovering from walls, spins and falls)', () => {
    for (const id of ['dune-drift', 'pixel-plaza'] as const) {
      const { sim } = botRace(id, 'easy', 2);
      expect(sim.karts.every((k) => k.progress.finished)).toBe(true);
    }
  });
});
