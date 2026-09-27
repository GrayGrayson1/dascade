/* Balance coefficient grid search: pnpm exec tsx packages/game-core/src/kart/lab/search.ts '{"topPerSpeed":[0.3,0.35]}' */
import { KART_RACER_IDS } from '@dascade/shared/games/kart';
import { argv } from './args.ts';
import { getKartTrack } from '../index.ts';
import { BALANCE, clearSpecCache } from '../spec.ts';
import { balanceTable } from './balance.ts';
const tracks = [getKartTrack('pixel-plaza'), getKartTrack('dune-drift')];
function score(): { spread: number; detail: string } {
  clearSpecCache();
  let spread = 0;
  let detail = '';
  for (const t of tracks) {
    const tab = balanceTable(t, [1]);
    const v = Object.values(tab);
    const min = Math.min(...v),
      max = Math.max(...v);
    spread = Math.max(spread, (max - min) / min);
    detail += KART_RACER_IDS.map((r) => (((tab[r] - min) / min) * 100).toFixed(1)).join(' ') + ' | ';
  }
  return { spread, detail };
}
const grid = JSON.parse(argv[0] ?? '{}') as Record<string, number[]>;
const keys = Object.keys(grid);
const combos: Record<string, number>[] = [{}];
for (const k of keys) {
  const next: Record<string, number>[] = [];
  for (const c of combos) for (const v of grid[k]!) next.push({ ...c, [k]: v });
  combos.splice(0, combos.length, ...next);
}
const base = { ...BALANCE };
for (const c of combos) {
  Object.assign(BALANCE, base, c);
  const r = score();
  console.log(JSON.stringify(c), (r.spread * 100).toFixed(2) + '%', r.detail);
}
