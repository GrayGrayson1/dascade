/* Par times: the hard bot's best CLEAN flying lap (nova, no items, no hazard hit or fall in that lap).
   pnpm exec tsx packages/game-core/src/kart/lab/pars.ts [track…] */
import { createSeededRng } from '@dascade/shared';
import { KART_TRACK_IDS, type KartTrackId } from '@dascade/shared/games/kart';
import { getKartTrack, KART_TRACK_DEFS, KartSim } from '../index.ts';
import { argv } from './args.ts';

export function measurePar(id: KartTrackId, seeds: readonly number[] = [1, 2, 3, 4]): { best: number; mean: number; median: number } {
  const clean: number[] = [];
  const all: number[] = [];
  for (const seed of seeds) {
    const sim = new KartSim(
      getKartTrack(id),
      { laps: 3, items: false, finishWindowMs: 1000, maxRaceMs: 400_000 },
      createSeededRng(seed),
      seed,
    );
    const k = sim.addRacer(0, 'a', 'nova', 'hard');
    sim.go();
    const dirty = new Set<number>();
    while (sim.status !== 'done') {
      for (const e of sim.step()) if (e.type === 'hit' && (e.cause === 'hazard' || e.cause === 'fall')) dirty.add(k.progress.lap);
    }
    k.progress.lapTimes.forEach((t, i) => {
      if (i === 0) return; // standing start
      all.push(t);
      if (!dirty.has(i + 1)) clean.push(t);
    });
  }
  const sorted = [...all].sort((a, b) => a - b);
  const median = (sorted[(sorted.length - 1) >> 1]! + sorted[sorted.length >> 1]!) / 2;
  return { best: Math.min(...(clean.length ? clean : all)), mean: all.reduce((a, b) => a + b, 0) / all.length, median };
}

if ((globalThis as { process?: { argv: string[] } }).process?.argv[1]?.endsWith('pars.ts')) {
  for (const id of (argv.length ? argv : KART_TRACK_IDS) as KartTrackId[]) {
    const { best, mean, median } = measurePar(id);
    const par = KART_TRACK_DEFS[id].parLapMs;
    console.log(
      `${id.padEnd(19)} par ${par} | best clean ${best.toFixed(0)} → ${Math.round(best / 100) * 100} | hard mean ${mean.toFixed(0)} (${((mean / par - 1) * 100).toFixed(1)}% vs par), median ${((median / par - 1) * 100).toFixed(1)}%`,
    );
  }
}
