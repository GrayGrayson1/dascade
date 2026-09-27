/* Balance report: pnpm exec tsx packages/game-core/src/kart/lab/balance-report.ts [track…] */
import { KART_RACER_IDS, type KartTrackId } from '@dascade/shared/games/kart';
import { argv } from './args.ts';
import { getKartTrack } from '../index.ts';
import { balanceTable } from './balance.ts';
for (const id of (argv.length ? argv : ['pixel-plaza', 'dune-drift']) as KartTrackId[]) {
  const t = balanceTable(getKartTrack(id));
  const vals = Object.values(t);
  const min = Math.min(...vals);
  console.log(id, KART_RACER_IDS.map((r) => `${r} ${(t[r] / 1000).toFixed(2)} (+${(((t[r] - min) / min) * 100).toFixed(1)}%)`).join(' | '));
}
