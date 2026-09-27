/* Drift trace for one bot: pnpm exec tsx packages/game-core/src/kart/lab/drifts.ts <track> <skill> */
import { createSeededRng } from '@dascade/shared';
import type { KartBotSkill, KartTrackId } from '@dascade/shared/games/kart';
import { driftStage, getKartTrack, KartSim } from '../index.ts';
import { argv } from './args.ts';

const sim = new KartSim(
  getKartTrack((argv[0] ?? 'pixel-plaza') as KartTrackId),
  { laps: 1, items: false, finishWindowMs: 1000, maxRaceMs: 200000 },
  createSeededRng(1),
  1,
);
const k = sim.addRacer(0, 'a', 'nova', (argv[1] ?? 'hard') as KartBotSkill);
sim.go();
let start = -1;
let maxStage = 0;
while (sim.status !== 'done') {
  sim.step();
  const st = k.state;
  if (st.driftDir !== 0 && start < 0) {
    start = sim.tick;
    maxStage = 0;
    console.log(`t${sim.tick} s=${k.info.s.toFixed(0)} DRIFT dir ${st.driftDir} v=${k.info.forwardSpeed.toFixed(1)}`);
  }
  if (st.driftDir !== 0) maxStage = Math.max(maxStage, driftStage(st));
  if (st.driftDir === 0 && start >= 0) {
    console.log(
      `   end t${sim.tick} s=${k.info.s.toFixed(0)} after ${((sim.tick - start) / 60).toFixed(2)}s stage ${maxStage} mt ${k.info.miniTurbo} v=${k.info.forwardSpeed.toFixed(1)} wall ${k.info.wallImpact.toFixed(1)}`,
    );
    start = -1;
  }
}
console.log('lap', k.progress.lapTimes);
