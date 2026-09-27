/** Balance probe: each racer alone, hard bot, no items → mean lap (ms). Shared by balance.test.ts. */
import { createSeededRng } from '@dascade/shared';
import { KART_RACER_IDS, type KartRacerId, type KartTrackId } from '@dascade/shared/games/kart';
import { KartSim } from '../sim.ts';
import type { KartTrack } from '../track.ts';

export function soloLaps(track: KartTrack, racer: KartRacerId, laps = 3, seed = 1): number[] {
  const sim = new KartSim(track, { laps, items: false, finishWindowMs: 1000, maxRaceMs: 60_000 * laps * 3 }, createSeededRng(seed), seed);
  sim.addRacer(0, 'solo', racer, 'hard');
  sim.go();
  while (sim.status !== 'done' && sim.tick < 60 * 60 * laps * 3) sim.step();
  return sim.kart(0)!.progress.lapTimes;
}

export function balanceTable(track: KartTrack, seeds = [1, 2]): Record<KartRacerId, number> {
  const out = {} as Record<KartRacerId, number>;
  for (const r of KART_RACER_IDS) {
    const all: number[] = [];
    // Skip the standing-start lap: flying laps compare the racers' pace.
    for (const seed of seeds) all.push(...soloLaps(track, r, 3, seed).slice(1));
    out[r] = all.reduce((a, b) => a + b, 0) / all.length;
  }
  return out;
}

export type { KartTrackId };
