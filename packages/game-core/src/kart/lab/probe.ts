/* Track probe: pnpm exec tsx packages/game-core/src/kart/lab/probe.ts — builds every track and prints length, gates, branches and the lap fraction of each control point (handy when placing features). */
import { KART_TRACK_IDS } from '@dascade/shared/games/kart';
import { buildTrack, KART_TRACK_DEFS } from '../index.ts';
for (const id of KART_TRACK_IDS) {
  try {
    const t = buildTrack(KART_TRACK_DEFS[id]);
    const fr = t.def.points.map((p) => {
      let best = 0,
        bd = Infinity;
      for (let i = 0; i < t.n; i++) {
        const d = (t.xs[i]! - p[0]) ** 2 + (t.ys[i]! - p[1]) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return (t.s[best]! / t.length).toFixed(3);
    });
    console.log(
      id,
      'L',
      t.length.toFixed(0),
      'n',
      t.n,
      'gates',
      t.gates.length,
      'branches',
      t.branches.map((b) => b.length.toFixed(0) + '/' + (b.to - b.from).toFixed(0)).join(','),
      'fracs',
      fr.join(' '),
    );
  } catch (e) {
    console.log(id, 'ERR', (e as Error).message);
  }
}
