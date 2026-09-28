/* Hit cost lab: seconds lost to a hit at top speed vs driving on, per racer. */
import { KART_RACER_IDS, type KartRacerId } from '@dascade/shared/games/kart';
import { applyHit } from '../kart.ts';
import { racerSpec } from '../spec.ts';
import { drive, rolling, speedOf } from './feel.ts';

export function hitCost(racer: KartRacerId, kind: 'spin' | 'stumble'): { lost: number; exitShare: number } {
  const spec = racerSpec(racer);
  const T = 420;
  const clean = drive(() => ({ throttle: 1 }), T, { racer, start: rolling(spec.topSpeed, 300, 0) });
  const st = rolling(spec.topSpeed, 300, 0);
  applyHit(st, kind, false);
  const hit = drive(() => ({ throttle: 1 }), T, { racer, start: st });
  const end = kind === 'spin' ? 59 : 29;
  return { lost: (clean[T - 1]!.state.x - hit[T - 1]!.state.x) / spec.topSpeed, exitShare: speedOf(hit[end]!.state) / spec.topSpeed };
}

if ((globalThis as { process?: { argv: string[] } }).process?.argv[1]?.endsWith('hits.ts')) {
  for (const kind of ['spin', 'stumble'] as const) {
    console.log(
      kind,
      KART_RACER_IDS.map((r) => {
        const c = hitCost(r, kind);
        return `${r} ${c.lost.toFixed(2)}s (exit ${(c.exitShare * 100).toFixed(0)}%)`;
      }).join(' | '),
    );
  }
}
