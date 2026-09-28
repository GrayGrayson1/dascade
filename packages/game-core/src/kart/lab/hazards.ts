/* Hazard exposure: hits per lap for a racing-line follower that ignores hazards ("blind") and for the
   bots, averaged over start offsets (so every arrival phase of timed hazards is sampled).
   pnpm exec tsx packages/game-core/src/kart/lab/hazards.ts [track…] */
import { createSeededRng } from '@dascade/shared';
import type { KartBotSkill, KartTrackId } from '@dascade/shared/games/kart';
import { getKartTrack, KartSim } from '../index.ts';
import type { KartTrack } from '../track.ts';
import { argv } from './args.ts';

export const BLIND = { hazards: 0, mistakeRate: 0, noise: 0 };

export function hazardRate(track: KartTrack, skill: KartBotSkill, profile: Record<string, number> = {}, offsets = 8, laps = 3): number {
  let hits = 0;
  for (let o = 0; o < offsets; o++) {
    const sim = new KartSim(track, { laps, items: false, finishWindowMs: 1000, maxRaceMs: 600000 }, createSeededRng(o + 1), o + 1);
    const k = sim.addRacer(0, 'a', 'nova', skill);
    const b = k.brain as unknown as { p: Record<string, number> };
    b.p = { ...b.p, ...profile };
    // Offset the race start against the hazard cycles by a prime-ish number of ticks per run.
    sim.startCountdown(1 + o * 23);
    while (sim.status !== 'done') for (const e of sim.step()) if (e.type === 'hit' && e.cause === 'hazard' && e.victim === 0) hits++;
  }
  return hits / (offsets * laps);
}

if ((globalThis as { process?: { argv: string[] } }).process?.argv[1]?.endsWith('hazards.ts')) {
  const ids = (
    argv.length ? argv : ['harbor-hairpins', 'frostbyte-pass', 'gearworks', 'midnight-mainframe', 'pinball-park']
  ) as KartTrackId[];
  for (const id of ids) {
    const t = getKartTrack(id);
    const r = (skill: KartBotSkill, p: Record<string, number> = {}) => hazardRate(t, skill, p).toFixed(2);
    console.log(
      `${id.padEnd(19)} blind(hard line) ${r('hard', BLIND)} | blind(easy line) ${r('easy', { hazards: 0 })} | easy ${r('easy')} | normal ${r('normal')} | hard ${r('hard')}`,
    );
  }
}
