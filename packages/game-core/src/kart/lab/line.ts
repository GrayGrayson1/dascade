/* Racing-line report: per track, the tightest line radius vs the tightest centreline radius, and kinks. */
import { KART_TRACK_IDS } from '@dascade/shared/games/kart';
import { getKartTrack } from '../index.ts';
for (const id of KART_TRACK_IDS) {
  const t = getKartTrack(id);
  let minLine = Infinity;
  let minLineAt = 0;
  let kinks = 0;
  for (let i = 0; i < t.n; i++) {
    const k = Math.abs(t.racingLine.curvature[i]!);
    if (k > 0 && 1 / k < minLine) {
      minLine = 1 / k;
      minLineAt = t.s[i]! / t.length;
    }
    // A kink: the line turns much tighter than the centreline around it.
    let kc = 0;
    for (let j = -4; j <= 4; j++) kc = Math.max(kc, Math.abs(t.curvature[(i + j + t.n) % t.n]!));
    if (k > kc * 1.6 && k > 1 / 25) kinks++;
  }
  let minCentre = Infinity;
  for (let i = 0; i < t.n; i++) minCentre = Math.min(minCentre, 1 / Math.max(1e-9, Math.abs(t.curvature[i]!)));
  console.log(
    `${id.padEnd(19)} line min R ${minLine.toFixed(1)} @${minLineAt.toFixed(3)} | centre min R ${minCentre.toFixed(1)} | kink samples ${kinks}`,
  );
}
