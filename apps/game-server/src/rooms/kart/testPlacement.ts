/**
 * Test-only helper (integration tests and the relaxed-limits `kart:test` hook): puts a kart on the
 * main line `distanceBefore` units before the finish, on its final lap with every checkpoint passed,
 * so the next few metres of real driving decide the finish through the normal progress rules.
 */
import { createKartState, pointAtS, type KartSim } from '@dascade/game-core/kart';

export function placeKartBeforeFinish(sim: KartSim, slot: number, distanceBefore: number, lateral = 0): void {
  const kart = sim.kart(slot);
  if (!kart || kart.retired || kart.progress.finished) return;
  const track = sim.track;
  const laps = sim.opts.laps;
  const sPos = track.length - Math.max(1, distanceBefore);
  const p = pointAtS(track, sPos);
  kart.state = createKartState(track, {
    x: p.x - p.ty * lateral,
    y: p.y + p.tx * lateral,
    z: p.z,
    heading: Math.atan2(p.ty, p.tx),
    s: sPos,
    d: lateral,
  });
  kart.state.item = 0;
  kart.state.itemUses = 0;
  const pr = kart.progress;
  pr.lap = laps;
  pr.lapStarts = Array.from({ length: laps }, (_, i) => i * 1000);
  pr.lapTimes = Array.from({ length: laps - 1 }, () => 1000);
  pr.bestLapMs = laps > 1 ? 1000 : 0;
  pr.nextGate = 0;
  pr.s = sPos;
  pr.wrongWay = false;
  pr.wrongWayMs = 0;
  kart.info.s = sPos;
}
