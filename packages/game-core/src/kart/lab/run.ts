/* Feel lab report: pnpm exec tsx packages/game-core/src/kart/lab/run.ts */
import { KART_RACER_IDS } from '@dascade/shared/games/kart';
import { racerSpec } from '../spec.ts';
import { drive, getWallTrack, meanSlipDeg, pathRadius, rolling, speedOf, stageTick, timeTo } from './feel.ts';

const rows: string[] = [];
const log = (s: string) => rows.push(s);

log('## Straight line (full throttle from rest)');
log('| racer | top | t→20 | t→95% top | 1 s | 2 s |');
for (const r of KART_RACER_IDS) {
  const spec = racerSpec(r);
  const f = drive(() => ({ throttle: 1 }), 600, { racer: r });
  log(
    `| ${r} | ${speedOf(f[599]!.state).toFixed(2)} | ${timeTo(f, 20).toFixed(2)} | ${timeTo(f, spec.topSpeed * 0.95).toFixed(2)} | ${speedOf(f[59]!.state).toFixed(1)} | ${speedOf(f[119]!.state).toFixed(1)} |`,
  );
}

log('\n## Grip turning (nova, full steer, throttle)');
log('| start v | steady v | yaw rate | radius | slip° | yaw 63% (ms) |');
for (const v of [6, 12, 20, 29]) {
  const f = drive(() => ({ throttle: v > 25 ? 1 : 0.6, steer: 1 }), 240, { start: rolling(v, 350, -15) });
  const w = f[200]!.state.angVel;
  const i63 = f.findIndex((fr) => fr.state.angVel >= w * 0.63);
  log(
    `| ${v} | ${speedOf(f[200]!.state).toFixed(1)} | ${w.toFixed(2)} | ${pathRadius(f, 150, 230).toFixed(1)} | ${meanSlipDeg(f, 150, 230).toFixed(1)} | ${(((i63 + 1) * 1000) / 60).toFixed(0)} |`,
  );
}

log('\n## Drift (nova at ~27 u/s: hop with steer left, then hold inside / neutral / outside)');
log('| steer | radius | slip° | stage1 s | stage2 s | stage3 s | speed |');
for (const [label, steer] of [
  ['inside', 1],
  ['neutral', 0.3],
  ['outside', -1],
] as const) {
  const f = drive((t) => ({ throttle: 1, drift: t >= 2, steer: t < 6 ? 1 : steer }), 260, { start: rolling(27, 350, -15) });
  log(
    `| ${label} | ${pathRadius(f, 30, 60).toFixed(1)} | ${meanSlipDeg(f, 30, 60).toFixed(1)} | ${(stageTick(f, 1) / 60).toFixed(2)} | ${(stageTick(f, 2) / 60).toFixed(2)} | ${(stageTick(f, 3) / 60).toFixed(2)} | ${speedOf(f[200]!.state).toFixed(1)} |`,
  );
}

log('\n## Mini-turbo (release at each stage, then straighten)');
log('| stage | peak speed | gain over top | boost s |');
for (const [stage, hold] of [
  [1, 50],
  [2, 80],
  [3, 125],
] as const) {
  const f = drive((t) => ({ throttle: 1, drift: t >= 2 && t < hold, steer: t < hold ? 1 : 0 }), hold + 200, {
    start: rolling(28, 350, -15),
  });
  let peak = 0;
  for (const fr of f.slice(hold)) peak = Math.max(peak, speedOf(fr.state));
  log(
    `| ${stage} | ${peak.toFixed(2)} | ${(peak - racerSpec('nova').topSpeed).toFixed(2)} | ${(f[hold]!.state.boostTicks / 60).toFixed(2)} |`,
  );
}

log('\n## Walls (nova at 29 u/s into the lab wall)');
log('| angle° | speed after | kept % | heading change° |');
for (const deg of [15, 30, 45, 90]) {
  const a = (deg * Math.PI) / 180;
  const st = rolling(29, 350, 8, getWallTrack());
  st.vx = 29 * Math.cos(a);
  st.vy = 29 * Math.sin(a);
  st.heading = a;
  const f = drive(() => ({ throttle: 1 }), 160, { start: st, track: getWallTrack() });
  const hit = f.findIndex((fr) => fr.info.wallImpact > 0);
  const after = f[Math.min(f.length - 1, hit + 3)]!;
  log(
    `| ${deg} | ${speedOf(after.state).toFixed(1)} | ${((speedOf(after.state) / speedOf(f[Math.max(0, hit - 1)]!.state)) * 100).toFixed(0)} | ${(((after.state.heading - a) * 180) / Math.PI).toFixed(0)} |`,
  );
}

log('\n## Hop');
{
  const f = drive((t) => ({ throttle: 1, drift: t >= 1 && t < 40 }), 60, { start: rolling(25, 350, 0) });
  const air = f.filter((fr) => !fr.state.grounded).length;
  let h = 0;
  for (const fr of f) h = Math.max(h, fr.state.z);
  log(`air ${(air / 60).toFixed(2)} s, height ${h.toFixed(2)} u`);
}

log('\n## Wall trace (15°)');
{
  const a = (15 * Math.PI) / 180;
  const st = rolling(29, 350, 12, getWallTrack());
  st.vx = 29 * Math.cos(a);
  st.vy = 29 * Math.sin(a);
  st.heading = a;
  const f = drive(() => ({ throttle: 1 }), 60, { start: st, track: getWallTrack() });
  for (const fr of f.slice(0, 40))
    if (fr.info.wallImpact > 0 || fr.t % 5 === 0)
      log(
        `t${fr.t} v=${speedOf(fr.state).toFixed(1)} imp=${fr.info.wallImpact.toFixed(1)} h=${(fr.state.heading * 57.3).toFixed(1)} vel=${(Math.atan2(fr.state.vy, fr.state.vx) * 57.3).toFixed(1)} d=${fr.info.d.toFixed(2)}`,
      );
}
console.log(rows.join('\n'));
