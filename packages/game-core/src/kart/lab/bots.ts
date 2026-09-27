/* Bot survey: pnpm exec tsx packages/game-core/src/kart/lab/bots.ts [skill] — every track, 8 bots, items on. */
import { argv } from './args.ts';
import { createSeededRng } from '@dascade/shared';
import { KART_RACER_IDS, KART_TRACK_IDS, type KartBotSkill } from '@dascade/shared/games/kart';
import { getKartTrack, KART_TRACK_DEFS, KartSim } from '../index.ts';

const skill = (argv[2 - 2] ?? 'hard') as KartBotSkill;
for (const id of KART_TRACK_IDS) {
  const track = getKartTrack(id);
  const sim = new KartSim(track, { laps: 3, items: true, finishWindowMs: 60000, maxRaceMs: 400000 }, createSeededRng(5), 1);
  for (let i = 0; i < 8; i++) sim.addRacer(i, 'b' + i, KART_RACER_IDS[i]!, skill);
  sim.startCountdown(60);
  const c: Record<string, number> = {};
  const mt = [0, 0, 0, 0];
  let driftTicks = 0;
  let wall = 0;
  let total = 0;
  while (sim.status !== 'done') {
    for (const e of sim.step()) {
      const key = e.type === 'hit' ? `hit:${e.cause}` : e.type;
      c[key] = (c[key] ?? 0) + 1;
    }
    for (const k of sim.karts) {
      if (k.progress.finished) continue;
      total++;
      if (k.state.driftDir !== 0) driftTicks++;
      if (k.info.miniTurbo) mt[k.info.miniTurbo]!++;
      if (k.info.wallImpact > 4) wall++;
    }
  }
  const laps = sim.karts.flatMap((k) => k.progress.lapTimes.slice(1));
  const best = Math.min(...laps);
  const mean = laps.reduce((a, b) => a + b, 0) / Math.max(1, laps.length);
  const fin = sim.karts.filter((k) => k.progress.finished).length;
  const stuck = sim.karts.map((k) => k.progress.lapTimes.length).join('');
  console.log(
    `${id.padEnd(19)} fin ${fin}/8 par ${(KART_TRACK_DEFS[id].parLapMs / 1000).toFixed(1)} best ${(best / 1000).toFixed(1)} mean ${(mean / 1000).toFixed(1)} laps ${stuck} falls ${c['hit:fall'] ?? 0} hazard ${c['hit:hazard'] ?? 0} items ${c.use ?? 0} hits ${Object.entries(
      c,
    )
      .filter(([k]) => k.startsWith('hit:') && k !== 'hit:fall' && k !== 'hit:hazard')
      .map(([k, v]) => k.slice(4) + v)
      .join(',')} bumps ${c.bump ?? 0} drift ${((driftTicks / total) * 100).toFixed(0)}% mt ${mt.slice(1).join('/')} walls ${wall}`,
  );
}
