/* Headless race: pnpm exec tsx packages/game-core/src/kart/lab/race.ts <track> <skill> <karts> [noitems] */
import { createSeededRng } from '@dascade/shared';
import { argv } from './args.ts';
import { KART_RACER_IDS, type KartTrackId } from '@dascade/shared/games/kart';
import { KartSim, getKartTrack } from '../index.ts';
const id = (argv[0] ?? 'pixel-plaza') as KartTrackId;
const skill = (argv[1] ?? 'hard') as 'hard';
const n = Number(argv[2] ?? 8);
const items = argv[3] !== 'noitems';
const track = getKartTrack(id);
const sim = new KartSim(track, { laps: 3, items, finishWindowMs: 30000, maxRaceMs: 400000 }, createSeededRng(7), 1);
for (let i = 0; i < n; i++) sim.addRacer(i, 'b' + i, KART_RACER_IDS[i % 8]!, skill);
sim.startCountdown(240);
const counts: Record<string, number> = {};
const t0 = performance.now();
let steps = 0;
while (sim.status !== 'done' && sim.tick < 60 * 400) {
  for (const e of sim.step()) {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
    if (e.type === 'hit')
      counts['hit:' + e.cause + (e.blocked ? ':blocked' : '')] = (counts['hit:' + e.cause + (e.blocked ? ':blocked' : '')] ?? 0) + 1;
    if (e.type === 'lap' && e.slot < 3) console.log('lap', e.slot, sim.kart(e.slot)!.racer, e.lap, e.lapMs);
  }
  steps++;
}
const ms = performance.now() - t0;
console.log('ticks', sim.tick, 'ms/tick', (ms / steps).toFixed(3), 'snap bytes', sim.encodeSnapshot().byteLength);
for (const k of sim.standings())
  console.log(
    k.position,
    k.racer,
    k.progress.finished ? k.progress.finishMs : 'DNF',
    'best',
    k.progress.bestLapMs,
    'laps',
    k.progress.lapTimes.join(','),
  );
console.log(counts);
