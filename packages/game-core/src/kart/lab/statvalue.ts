/* What a stat point is worth: a neutral racer (all stats 3) with one stat set to 1 or 5, driven alone by the
   hard bot (no items, flying laps) on every track. Prints the lap-time swing 1 → 5 per stat (% of the lap).
   pnpm exec tsx packages/game-core/src/kart/lab/statvalue.ts [track…] */
import { createSeededRng } from '@dascade/shared';
import { KART_TRACK_IDS, type KartRacerStats, type KartTrackId } from '@dascade/shared/games/kart';
import { getKartTrack } from '../index.ts';
import { KartSim } from '../sim.ts';
import { BALANCE, clearSpecCache, specFromStats } from '../spec.ts';
import { argv } from './args.ts';

export const STAT_KEYS = ['speed', 'accel', 'handling', 'grip', 'weight'] as const;

function lapWith(id: KartTrackId, stats: KartRacerStats, seed: number): number {
  const sim = new KartSim(
    getKartTrack(id),
    { laps: 3, items: false, finishWindowMs: 1000, maxRaceMs: 400_000 },
    createSeededRng(seed),
    seed,
  );
  const k = sim.addRacer(0, 'solo', 'nova', 'hard');
  k.spec = specFromStats('nova', stats);
  sim.go();
  while (sim.status !== 'done') sim.step();
  const laps = k.progress.lapTimes.slice(1);
  return laps.reduce((a, b) => a + b, 0) / laps.length;
}

/** Mean lap (ms, all tracks summed) for a neutral racer with one stat at each level 1..5. */
export function statCurve(
  key: (typeof STAT_KEYS)[number],
  tracks: readonly KartTrackId[] = KART_TRACK_IDS,
  seeds: readonly number[] = [1, 2],
): number[] {
  return [1, 2, 3, 4, 5].map((level) => {
    let sum = 0;
    for (const id of tracks)
      for (const seed of seeds) sum += lapWith(id, { speed: 3, accel: 3, handling: 3, grip: 3, weight: 3, [key]: level }, seed);
    return sum / seeds.length;
  });
}

/** Lap-time swing (%) from stat 1 to stat 5 (positive = the stat makes you faster), averaged over tracks. */
export function statValue(
  tracks: readonly KartTrackId[] = KART_TRACK_IDS,
  seeds: readonly number[] = [1, 2],
): Record<(typeof STAT_KEYS)[number], number> {
  const out = { speed: 0, accel: 0, handling: 0, grip: 0, weight: 0 };
  for (const id of tracks) {
    for (const key of STAT_KEYS) {
      let lo = 0;
      let hi = 0;
      for (const seed of seeds) {
        lo += lapWith(id, { speed: 3, accel: 3, handling: 3, grip: 3, weight: 3, [key]: 1 }, seed);
        hi += lapWith(id, { speed: 3, accel: 3, handling: 3, grip: 3, weight: 3, [key]: 5 }, seed);
      }
      out[key] += (((lo - hi) / lo) * 100) / tracks.length;
    }
  }
  return out;
}

if ((globalThis as { process?: { argv: string[] } }).process?.argv[1]?.endsWith('statvalue.ts')) {
  // Optional BALANCE overrides: statvalue.ts '{"accelPerAccel":3}' [track…]
  const sets = argv.filter((a) => a.startsWith('{'));
  const ids = argv.filter((a) => !a.startsWith('{') && !a.startsWith('--')) as KartTrackId[];
  const base = { ...BALANCE };
  for (const set of sets.length ? sets : ['{}']) {
    Object.assign(BALANCE, base, JSON.parse(set));
    clearSpecCache();
    const v = statValue(ids.length ? ids : KART_TRACK_IDS);
    console.log(set.slice(0, 60), STAT_KEYS.map((k) => `${k} ${v[k].toFixed(2)}%`).join(' | '), '(lap-time gain, stat 1 → 5)');
    if (argv.includes('--curve')) {
      for (const k of STAT_KEYS) {
        const c = statCurve(k, ids.length ? ids : KART_TRACK_IDS);
        console.log(`  ${k.padEnd(8)} per level vs 3: ${c.map((t) => (((c[2]! - t) / c[2]!) * 100).toFixed(2) + '%').join('  ')}`);
      }
    }
  }
}
