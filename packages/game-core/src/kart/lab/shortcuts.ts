/* Shortcut value: a hard bot's time from 30 u before a branch to 40 u after its rejoin, forced along
   the main road or the branch, with or without a turbo in hand.
   pnpm exec tsx packages/game-core/src/kart/lab/shortcuts.ts [track…] */
import { createSeededRng } from '@dascade/shared';
import type { KartTrackId } from '@dascade/shared/games/kart';
import { getKartTrack, giveItem, KartSim } from '../index.ts';
import type { KartTrack } from '../track.ts';
import { argv } from './args.ts';

export type ShortcutMode = 'main' | 'main+turbo' | 'cut' | 'cut+turbo';

/** Segment time (s) through branch 0 of `track` for a hard nova bot (mean over seeds). */
export function segmentTime(track: KartTrack, mode: ShortcutMode, seeds = [1, 2]): number {
  const br = track.branches[0]!;
  let sum = 0;
  for (const seed of seeds) {
    const sim = new KartSim(track, { laps: 2, items: false, finishWindowMs: 1000, maxRaceMs: 600000 }, createSeededRng(seed), seed);
    const k = sim.addRacer(0, 'a', 'nova', 'hard');
    (k.brain as unknown as { forceShortcut: boolean }).forceShortcut = mode.startsWith('cut');
    sim.startCountdown(1 + seed * 17);
    let t0 = -1;
    let done = NaN;
    while (sim.status !== 'done' && sim.tick < 60 * 90) {
      sim.step();
      if (mode.endsWith('turbo') && k.state.item === 0 && t0 < 0 && sim.status === 'racing') giveItem(k.state, 'turbo');
      if (!mode.endsWith('turbo')) k.state.item = 0;
      const rel = (k.info.s - br.from + track.length) % track.length;
      if (t0 < 0 && k.progress.lap >= 1 && rel > track.length - 30) t0 = sim.tick;
      const past = (k.info.s - br.to + track.length) % track.length;
      if (t0 >= 0 && k.state.branch < 0 && past > 40 && past < 80) {
        done = (sim.tick - t0) / 60;
        break;
      }
    }
    sum += done;
  }
  return sum / seeds.length;
}

if ((globalThis as { process?: { argv: string[] } }).process?.argv[1]?.endsWith('shortcuts.ts')) {
  for (const id of (argv.length ? argv : ['dune-drift', 'midnight-mainframe']) as KartTrackId[]) {
    const t = getKartTrack(id);
    const m = segmentTime(t, 'main');
    const mt = segmentTime(t, 'main+turbo');
    const c = segmentTime(t, 'cut');
    const ct = segmentTime(t, 'cut+turbo');
    console.log(
      `${id}: main ${m.toFixed(2)} s, shortcut ${c.toFixed(2)} s (gain ${(m - c).toFixed(2)}) | with a turbo: main ${mt.toFixed(2)}, shortcut ${ct.toFixed(2)} (gain ${(mt - ct).toFixed(2)})`,
    );
  }
}
