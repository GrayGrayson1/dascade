/* Pack balance: 8-kart races (one of each racer, all hard bots), grid rotated per race (Latin
   square), every track × seeds. Mean finishing place and win share per racer.
   pnpm exec tsx packages/game-core/src/kart/lab/pack.ts [seedsPerTrack] [items|noitems] */
import { createSeededRng } from '@dascade/shared';
import { KART_RACER_IDS, KART_TRACK_IDS, type KartRacerId, type KartTrackId } from '@dascade/shared/games/kart';
import { getKartTrack, KartSim } from '../index.ts';
import { argv } from './args.ts';

export interface PackResult {
  place: Record<KartRacerId, number>;
  wins: Record<KartRacerId, number>;
  races: number;
}

export function packBalance(opts: {
  tracks?: readonly KartTrackId[];
  seeds: number;
  items: boolean;
  laps?: number;
  seed0?: number;
}): PackResult {
  const place = {} as Record<KartRacerId, number>;
  const wins = {} as Record<KartRacerId, number>;
  for (const r of KART_RACER_IDS) {
    place[r] = 0;
    wins[r] = 0;
  }
  let races = 0;
  for (const id of opts.tracks ?? KART_TRACK_IDS) {
    const track = getKartTrack(id);
    for (let seed = opts.seed0 ?? 0; seed < (opts.seed0 ?? 0) + opts.seeds; seed++) {
      const sim = new KartSim(
        track,
        { laps: opts.laps ?? 3, items: opts.items, finishWindowMs: 120000, maxRaceMs: 600000 },
        createSeededRng(seed * 7919 + 13),
        seed + 1,
      );
      // Rotate the grid so every racer starts from every slot equally often.
      for (let slot = 0; slot < 8; slot++) sim.addRacer(slot, 'b' + slot, KART_RACER_IDS[(slot + seed) % 8]!, 'hard');
      sim.startCountdown(60);
      while (sim.status !== 'done') sim.step();
      for (const k of sim.karts) {
        const p = k.finishOrder || 8;
        place[k.racer] += p;
        if (p === 1) wins[k.racer]++;
      }
      races++;
    }
  }
  for (const r of KART_RACER_IDS) {
    place[r] /= races;
    wins[r] /= races;
  }
  return { place, wins, races };
}

export function formatPack(res: PackResult): string {
  return KART_RACER_IDS.map((r) => `${r} ${res.place[r].toFixed(2)} (${(res.wins[r] * 100).toFixed(0)}%)`).join(' | ');
}

if ((globalThis as { process?: { argv: string[] } }).process?.argv[1]?.endsWith('pack.ts')) {
  const seeds = Number(argv[0] ?? 8);
  const items = argv[1] !== 'noitems';
  const t0 = performance.now();
  const res = packBalance({ seeds, items });
  const vals = KART_RACER_IDS.map((r) => res.place[r]);
  console.log(`${res.races} races, items ${items}, ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  console.log(formatPack(res));
  console.log(`spread ${(Math.max(...vals) - Math.min(...vals)).toFixed(2)} places`);
}
