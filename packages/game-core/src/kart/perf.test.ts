/** Performance budget: 30 karts with items step well under 2 ms per tick on average. */
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { KART_RACER_IDS } from '@dascade/shared/games/kart';
import { getKartTrack } from './index.ts';
import { KartSim } from './sim.ts';

describe('performance', () => {
  it('30 karts + items: average step < 2 ms (typically ~0.1 ms)', () => {
    const sim = new KartSim(
      getKartTrack('pixel-plaza'),
      { laps: 3, items: true, finishWindowMs: 60000, maxRaceMs: 600000 },
      createSeededRng(1),
      1,
    );
    for (let i = 0; i < 30; i++) sim.addRacer(i, 'b' + i, KART_RACER_IDS[i % 8]!, i % 2 ? 'hard' : 'normal');
    sim.go();
    for (let t = 0; t < 600; t++) sim.step(); // warm-up (JIT)
    const ticks = 3000;
    const t0 = performance.now();
    let snapBytes = 0;
    for (let t = 0; t < ticks; t++) {
      sim.step();
      if (t % 3 === 0) {
        snapBytes = sim.encodeSnapshot().byteLength;
        for (let s = 0; s < 30; s++) sim.encodeOwn(s);
      }
    }
    const perTick = (performance.now() - t0) / ticks;
    console.info(
      `[kart perf] 30 karts: ${perTick.toFixed(3)} ms/tick (incl. snapshots), snapshot ${snapBytes} B, entities ${sim.entities.length}`,
    );
    expect(perTick).toBeLessThan(2);
    expect(snapBytes).toBeLessThan(1000);
  });
});
