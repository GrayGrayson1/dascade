/* Solo-pace balance: every racer alone (hard bot, no items, flying laps) on every track; the score is the
   RMS spread of each racer's mean pace (% over the track's fastest). Deterministic, so it tunes cleanly;
   check the result against pack races (lab/pack.ts). Top speed (topPerSpeed) stays fixed: it sets the
   4–5 % top-speed spread the lead asked for.
   pnpm exec tsx packages/game-core/src/kart/lab/solotune.ts [--eval] [rounds] */
import { KART_RACER_IDS, KART_TRACK_IDS, type KartRacerId } from '@dascade/shared/games/kart';
import { getKartTrack } from '../index.ts';
import { BALANCE, clearSpecCache } from '../spec.ts';
import { argv } from './args.ts';
import { soloLaps } from './balance.ts';

/** Mean pace per racer: % slower than the fastest racer, averaged over all tracks. */
export function soloPace(): Record<KartRacerId, number> {
  clearSpecCache();
  const out = {} as Record<KartRacerId, number>;
  for (const r of KART_RACER_IDS) out[r] = 0;
  for (const id of KART_TRACK_IDS) {
    const t = getKartTrack(id);
    const lap = {} as Record<KartRacerId, number>;
    for (const r of KART_RACER_IDS) {
      const laps = [1, 2, 3].flatMap((seed) => soloLaps(t, r, 3, seed).slice(1));
      lap[r] = laps.reduce((a, b) => a + b, 0) / laps.length;
    }
    const min = Math.min(...Object.values(lap));
    for (const r of KART_RACER_IDS) out[r] += (((lap[r] - min) / min) * 100) / KART_TRACK_IDS.length;
  }
  return out;
}

function rms(p: Record<KartRacerId, number>): number {
  const vals = KART_RACER_IDS.map((r) => p[r]);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((a, v) => a + (v - mean) * (v - mean), 0) / vals.length);
}
const fmt = (p: Record<KartRacerId, number>) => KART_RACER_IDS.map((r) => `${r} +${p[r].toFixed(2)}%`).join(' | ');

if ((globalThis as { process?: { argv: string[] } }).process?.argv[1]?.endsWith('solotune.ts')) {
  const b = BALANCE as unknown as Record<string, number>;
  if (argv.includes('--eval')) {
    // --eval ['{"accelPerAccel":2.5}' …]: one line per override set.
    const sets = argv.filter((a) => a.startsWith('{'));
    const base = { ...b };
    for (const set of sets.length ? sets : ['{}']) {
      Object.assign(b, base, JSON.parse(set));
      const p = soloPace();
      console.log(set, 'rms', rms(p).toFixed(3), '\n  ', fmt(p));
    }
  } else {
    const rounds = Number(argv[0] ?? 2);
    // Knobs; a `[key, base, pivot]` pair keeps the stat-3 value fixed (only the per-point slope moves).
    const steps: Record<string, number> = {
      accelPerAccel: 0.5,
      accelPerWeight: 0.2,
      latPerGrip: 0.75,
      gripPerGrip: 0.4,
      turnPerHandling: 0.03,
      chargePerHandling: 0.03,
      steerTopPerHandling: 0.01,
    };
    const pivots: Record<string, string> = {
      accelPerAccel: 'accelBase',
      latPerGrip: 'latBase',
      gripPerGrip: 'gripBase',
      turnPerHandling: 'turnBase',
      steerTopPerHandling: 'steerTopBase',
    };
    let best = soloPace();
    let bestRms = rms(best);
    console.log('start', JSON.stringify(BALANCE), 'rms', bestRms.toFixed(3), '\n  ', fmt(best));
    for (let round = 0; round < rounds; round++) {
      for (const [key, step] of Object.entries(steps)) {
        const pivot = pivots[key];
        const orig = b[key]!;
        const origBase = pivot ? b[pivot]! : 0;
        for (const dir of [1, -1]) {
          b[key] = Math.round((orig + dir * step) * 1000) / 1000;
          if (pivot) b[pivot] = Math.round((origBase - (b[key]! - orig) * 3) * 1000) / 1000;
          const p = soloPace();
          const s = rms(p);
          if (s < bestRms - 0.02) {
            best = p;
            bestRms = s;
            console.log(`round ${round} ${key} ${orig} → ${b[key]} rms ${s.toFixed(3)}`);
            break;
          }
          b[key] = orig;
          if (pivot) b[pivot] = origBase;
        }
      }
    }
    console.log('best', JSON.stringify(BALANCE), 'rms', bestRms.toFixed(3), '\n  ', fmt(best));
  }
}
