/**
 * DASphalt GP × Tournament Center: tournament races are plain races with no computer racers, and a
 * racer whose connection drops can't hold a race (and the series) hostage. The finish window opened by
 * the first finisher closes it even while the dropped player is still inside the 180 s reconnect
 * grace. The full 4-player bracket (draws when nobody finishes, refused rematches) runs in
 * tournament-games.test.ts.
 */
process.env.DASCADE_TOURNAMENT_START_DELAY_MS = '30';
process.env.DASCADE_TOURNAMENT_INTERMISSION_MS = '150';
process.env.DASCADE_TOURNAMENT_CLOSE_DELAY_MS = '80';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import { KartBot, type KartSim } from '@dascade/game-core/kart';
import { bootTestServer, waitFor } from './helpers.ts';
import { admin, participantOf, setupField, useTournamentServer, type Viewer } from './tournament-helpers.ts';
import { gameLive, gamesOf, matchById, matchWithRoom, seatFor, useBracketServer } from './tournament-bracket.ts';
import { DRIVERS, stateOf } from './tournament-drivers.ts';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['tournament', 'kart']));
  useTournamentServer(colyseus);
  useBracketServer(colyseus);
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

describe('DASphalt GP tournament races', () => {
  it('a dropped racer inside the reconnect grace cannot stall the finish window: the race ends when it closes', async () => {
    const driver = DRIVERS.kart!;
    const { org, players } = await setupField(2, { gameId: 'kart' });
    expect((await admin(org, 'begin')).ok).toBe(true);
    const [p1, p2] = players as [Viewer, Viewer];
    const match = await matchWithRoom(org, () => true, 'match room');
    const a = await seatFor(driver, p1, match.id);
    const b = await seatFor(driver, p2, match.id);
    await gameLive(driver, a, 1);
    const server = a.server();
    const sim = server.sim as KartSim;
    // A plain race between the two participants: no computer racers on the grid.
    expect(sim.karts).toHaveLength(2);
    expect((stateOf(a.room).race as { mode: string }).mode).toBe('race');

    // The second racer's connection drops: they keep their seat (reconnect grace) and their kart.
    const loserId = b.playerId();
    const loserSlot = server.slotOf.get(loserId) as number;
    (b.room as unknown as { connection: { transport: { ws: { close(code: number): void } } } }).connection.transport.ws.close(4010);
    await waitFor(() => sim.kart(loserSlot)?.connected === false, 3000, 'dropped');
    expect(server.players.has(loserId)).toBe(true);
    expect(sim.kart(loserSlot)?.retired).toBe(false);

    // The other racer drives the whole race; the room's clock runs it to the end.
    const slot = server.slotOf.get(a.playerId()) as number;
    server.autopilots.set(slot, new KartBot('hard', slot + 1));
    for (let i = 0; i < 60 * 60 * 8 && sim.status !== 'done'; i++) server.tick();
    expect(sim.status).toBe('done');
    const winner = sim.kart(slot)!;
    expect(winner.progress.finished).toBe(true);
    expect(sim.kart(loserSlot)?.progress.finished).toBe(false);
    // Over when the finish window closed, not at the 180 s grace or the race's time cap.
    const windowMs = server.matchSettings.finishWindowSec * 1000;
    expect(sim.raceMs).toBeLessThanOrEqual(winner.progress.finishMs + windowMs + 50);
    expect(server.players.has(loserId)).toBe(true);

    await waitFor(() => gamesOf(matchById(org, match.id)).length === 1, 8000, 'race recorded');
    expect(gamesOf(matchById(org, match.id))[0]!.winnerId).toBe(participantOf(p1));
    await waitFor(() => org.view().status === 'COMPLETE', 8000, 'champion');
    expect(org.view().championId).toBe(participantOf(p1));
  }, 60_000);
});
