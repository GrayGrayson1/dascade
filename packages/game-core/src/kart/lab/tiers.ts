/* Bot tiers: solo flying laps (nova, no items, seeds 1–3) per skill, optionally with profile overrides.
   pnpm exec tsx packages/game-core/src/kart/lab/tiers.ts [track…] [--hard '{"corner":1.1}'] */
import { createSeededRng } from '@dascade/shared';
import { KART_TRACK_IDS, type KartBotSkill, type KartTrackId } from '@dascade/shared/games/kart';
import { getKartTrack, KART_TRACK_DEFS, KartSim } from '../index.ts';
import { argv } from './args.ts';

export function soloLap(
  id: KartTrackId,
  skill: KartBotSkill,
  profile: Record<string, number> = {},
  seeds = [1, 2, 3],
): { mean: number; best: number; hazards: number } {
  const laps: number[] = [];
  let hazards = 0;
  for (const seed of seeds) {
    const sim = new KartSim(
      getKartTrack(id),
      { laps: 3, items: false, finishWindowMs: 1000, maxRaceMs: 400000 },
      createSeededRng(seed),
      seed,
    );
    const k = sim.addRacer(0, 'a', 'nova', skill);
    const b = k.brain as unknown as { p: Record<string, number> };
    b.p = { ...b.p, ...profile };
    sim.go();
    while (sim.status !== 'done') for (const e of sim.step()) if (e.type === 'hit' && e.cause === 'hazard') hazards++;
    laps.push(...k.progress.lapTimes.slice(1));
  }
  return { mean: laps.reduce((a, b) => a + b, 0) / laps.length, best: Math.min(...laps), hazards: hazards / (seeds.length * 3) };
}

if ((globalThis as { process?: { argv: string[] } }).process?.argv[1]?.endsWith('tiers.ts')) {
  const ovIdx = argv.indexOf('--hard');
  const hardOv = ovIdx >= 0 ? (JSON.parse(argv[ovIdx + 1]!) as Record<string, number>) : {};
  const ids = argv.filter((a, i) => !a.startsWith('--') && (ovIdx < 0 || i !== ovIdx + 1)) as KartTrackId[];
  for (const id of ids.length ? ids : KART_TRACK_IDS) {
    const h = soloLap(id, 'hard', hardOv);
    const n = soloLap(id, 'normal');
    const e = soloLap(id, 'easy');
    console.log(
      `${id.padEnd(19)} par ${(KART_TRACK_DEFS[id].parLapMs / 1000).toFixed(1)} | hard ${(h.mean / 1000).toFixed(2)} (best ${(h.best / 1000).toFixed(2)}) | normal ${(n.mean / 1000).toFixed(2)} +${((n.mean / h.mean - 1) * 100).toFixed(1)}% | easy ${(e.mean / 1000).toFixed(2)} +${((e.mean / h.mean - 1) * 100).toFixed(1)}% | hazards/lap h ${h.hazards.toFixed(2)} e ${e.hazards.toFixed(2)}`,
    );
  }
}
