/* Coordinate descent on the stat coefficients against pack balance (RMS deviation of mean place
   from the middle, items on + off, common seeds). pnpm exec tsx packages/game-core/src/kart/lab/balancetune.ts [seeds] */
import { KART_RACER_IDS } from '@dascade/shared/games/kart';
import { BALANCE, clearSpecCache } from '../spec.ts';
import { argv } from './args.ts';
import { formatPack, packBalance } from './pack.ts';

const seeds = Number(argv[0] ?? 12);
const steps: Record<string, number> = {
  topPerSpeed: 0.05,
  accelPerAccel: 0.3,
  accelPerWeight: 0.15,
  turnPerHandling: 0.04,
  steerTopPerHandling: 0.01,
  latBase: 2,
  latPerGrip: 1,
  massPerWeight: 0.03,
  chargePerHandling: 0.02,
};
function score(): { rms: number; text: string } {
  clearSpecCache();
  const a = packBalance({ seeds, items: false, laps: 2 });
  const b = packBalance({ seeds, items: true, laps: 2 });
  let ss = 0;
  for (const r of KART_RACER_IDS) {
    const p = (a.place[r] + b.place[r]) / 2;
    ss += (p - 4.5) * (p - 4.5);
  }
  return { rms: Math.sqrt(ss / 8), text: `noitems ${formatPack(a)}\n   items   ${formatPack(b)}` };
}
let best = score();
console.log('start', JSON.stringify(BALANCE), 'rms', best.rms.toFixed(3));
for (let round = 0; round < 3; round++) {
  for (const [key, step] of Object.entries(steps)) {
    const b = BALANCE as unknown as Record<string, number>;
    const orig = b[key]!;
    for (const dir of [1, -1]) {
      b[key] = Math.round((orig + dir * step) * 1000) / 1000;
      const sc = score();
      if (sc.rms < best.rms - 0.01) {
        best = sc;
        console.log(`round ${round} ${key} ${orig} → ${b[key]} rms ${sc.rms.toFixed(3)}`);
        break;
      }
      b[key] = orig;
    }
  }
}
console.log('best', JSON.stringify(BALANCE), 'rms', best.rms.toFixed(3));
console.log('   ' + best.text);
