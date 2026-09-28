/* Pack-balance coefficient search: pnpm exec tsx packages/game-core/src/kart/lab/packsearch.ts '{"topPerSpeed":[0.35,0.45]}' [seeds] [firstSeed] */
import { KART_RACER_IDS } from '@dascade/shared/games/kart';
import { BALANCE, clearSpecCache } from '../spec.ts';
import { argv } from './args.ts';
import { formatPack, packBalance } from './pack.ts';

const grid = JSON.parse(argv[0] ?? '{}') as Record<string, number[]>;
const seeds = Number(argv[1] ?? 6);
const seed0 = Number(argv[2] ?? 0);
const keys = Object.keys(grid);
let combos: Record<string, number>[] = [{}];
for (const k of keys) combos = combos.flatMap((c) => grid[k]!.map((v) => ({ ...c, [k]: v })));
const base = { ...BALANCE };
for (const c of combos) {
  Object.assign(BALANCE, base, c);
  clearSpecCache();
  const a = packBalance({ seeds, items: false, seed0 });
  const b = packBalance({ seeds, items: true, seed0 });
  const place = (r: (typeof KART_RACER_IDS)[number]) => (a.place[r] + b.place[r]) / 2;
  const vals = KART_RACER_IDS.map(place);
  const wins = KART_RACER_IDS.map((r) => (a.wins[r] + b.wins[r]) / 2);
  console.log(
    JSON.stringify(c),
    `spread ${(Math.max(...vals) - Math.min(...vals)).toFixed(2)} wins ${(Math.min(...wins) * 100).toFixed(0)}–${(Math.max(...wins) * 100).toFixed(0)}%`,
  );
  console.log('   noitems', formatPack(a));
  console.log('   items  ', formatPack(b));
}
