/* Drift quality: per track, drifts / aborted (< 0.45 s, no mini-turbo) per kart-lap and abort reasons. 8 bots, items on.
   pnpm exec tsx packages/game-core/src/kart/lab/aborts.ts [skill] */
import { createSeededRng } from '@dascade/shared';
import { KART_RACER_IDS, KART_TRACK_IDS, type KartBotSkill, type KartTrackId } from '@dascade/shared/games/kart';
import { getKartTrack, KartSim } from '../index.ts';
import { argv } from './args.ts';

export function driftQuality(skill: KartBotSkill, ids: readonly KartTrackId[] = KART_TRACK_IDS, seeds = [1, 2]) {
  const rows: Array<{ id: string; drifts: number; aborted: number; mts: number; laps: number; why: Record<string, number> }> = [];
  for (const id of ids) {
    const row = { id, drifts: 0, aborted: 0, mts: 0, laps: 0, why: {} as Record<string, number> };
    for (const seed of seeds) {
      const sim = new KartSim(
        getKartTrack(id),
        { laps: 3, items: true, finishWindowMs: 60000, maxRaceMs: 500000 },
        createSeededRng(seed),
        seed,
      );
      for (let i = 0; i < 8; i++) sim.addRacer(i, 'b' + i, KART_RACER_IDS[i]!, skill);
      sim.startCountdown(60);
      const start = new Map<number, number>();
      const maxStage = new Map<number, number>();
      while (sim.status !== 'done') {
        sim.step();
        for (const k of sim.karts) {
          if (k.progress.finished) continue;
          if (k.info.miniTurbo) row.mts++;
          if (k.state.driftDir !== 0) {
            if (!start.has(k.slot)) start.set(k.slot, sim.tick);
            maxStage.set(k.slot, Math.max(maxStage.get(k.slot) ?? 0, k.info.miniTurbo));
          } else if (start.has(k.slot)) {
            row.drifts++;
            const dur = (sim.tick - start.get(k.slot)!) / 60;
            if (dur < 0.45 && !k.info.miniTurbo) {
              row.aborted++;
              const why = k.state.spinTicks > 0 ? 'hit' : k.brain?.lastRelease || 'physics';
              row.why[why] = (row.why[why] ?? 0) + 1;
            }
            start.delete(k.slot);
          }
        }
      }
      row.laps += 8 * 3;
    }
    rows.push(row);
  }
  return rows;
}

if ((globalThis as { process?: { argv: string[] } }).process?.argv[1]?.endsWith('aborts.ts')) {
  const rows = driftQuality((argv[0] ?? 'hard') as KartBotSkill);
  let d = 0;
  let a = 0;
  for (const r of rows) {
    d += r.drifts;
    a += r.aborted;
    console.log(
      `${r.id.padEnd(19)} drifts/lap ${(r.drifts / r.laps).toFixed(2)} aborted ${(r.aborted / r.laps).toFixed(2)} MT/lap ${(r.mts / r.laps).toFixed(2)} why ${JSON.stringify(r.why)}`,
    );
  }
  console.log(`ALL aborted ${((a / d) * 100).toFixed(1)}% of ${d} drifts`);
}
