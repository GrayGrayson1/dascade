/**
 * Balance: every racer, driven alone by the hard bot (no items), laps each reference track within a
 * few percent of the others — no racer dominates. Coefficients live in spec.ts (BALANCE).
 */
import { describe, expect, it } from 'vitest';
import { KART_RACER_IDS } from '@dascade/shared/games/kart';
import { getKartTrack } from './index.ts';
import { balanceTable } from './lab/balance.ts';

describe('racer balance', () => {
  it.each(['pixel-plaza', 'dune-drift'] as const)('%s: flying laps within 4 percent across racers', (id) => {
    const t = balanceTable(getKartTrack(id), [1, 2]);
    const v = KART_RACER_IDS.map((r) => t[r]);
    const min = Math.min(...v);
    const max = Math.max(...v);
    expect((max - min) / min).toBeLessThan(0.04);
  });
});
