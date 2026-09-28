/**
 * DASphalt GP track pre-warming runs on process timers: it survives the first kart room of the
 * process closing at once (a room's clock is cleared on dispose). Its own file, so this process has
 * built no track yet.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import { KART_TRACK_IDS } from '@dascade/shared/games/kart';
import { getKartTrack } from '@dascade/game-core/kart';
import { bootTestServer, sleep, waitFor } from './helpers.ts';

let colyseus: ColyseusTestServer;
beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['kart']));
});
afterAll(async () => {
  await colyseus.shutdown();
});

describe('KartRoom track pre-warming', () => {
  it('builds every track even when the first kart room closes straight away', async () => {
    const room = await colyseus.sdk.create('kart', { name: 'Blink' });
    const code = room.roomId;
    await room.leave(true);
    await waitFor(() => !colyseus.getRoomById(code), 3000, 'room disposed');
    // 8 builds, one per timer turn (~40 ms apart, each a few tens of ms cold).
    await sleep(2_000);
    const t0 = performance.now();
    for (const id of KART_TRACK_IDS) getKartTrack(id);
    // Cold, the eight builds take hundreds of milliseconds; cached lookups take microseconds.
    expect(performance.now() - t0).toBeLessThan(20);
  });
});
