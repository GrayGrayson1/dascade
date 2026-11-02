/**
 * DAS Putt × Tournament Center: a golfer who walks out during the countdown of a later game of a
 * series forfeits that game once it is live — the kiosk records it and the series moves on instead of
 * freezing (the countdown-time forfeit used to be dropped as a duplicate outcome of the previous game).
 * The organizer's course length (gameSettings.course) sets the route and its playoff holes.
 */
process.env.DASCADE_TOURNAMENT_START_DELAY_MS = '30';
process.env.DASCADE_TOURNAMENT_INTERMISSION_MS = '150';
process.env.DASCADE_TOURNAMENT_CLOSE_DELAY_MS = '80';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import { PUTT_MSG, PUTT_TOURNAMENT_SETTINGS, type PuttEvent } from '@dascade/shared/games/putt';
import { bootTestServer, collect, waitFor } from './helpers.ts';
import { admin, participantOf, setupField, useTournamentServer } from './tournament-helpers.ts';
import { gameLive, gamesOf, matchById, matchWithRoom, playGame, seatFor, useBracketServer } from './tournament-bracket.ts';
import { DRIVERS, stateOf } from './tournament-drivers.ts';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['tournament', 'putt']));
  useTournamentServer(colyseus);
  useBracketServer(colyseus);
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

describe('DAS Putt tournament series', () => {
  it('leaving during the countdown of game 2 forfeits that game; the kiosk records it and decides the series', async () => {
    const driver = DRIVERS.putt!;
    const { org, players } = await setupField(2, { gameId: 'putt', format: 'single_elimination', bestOf: 3 });
    const [p1, p2] = players as [(typeof players)[number], (typeof players)[number]];
    await admin(org, 'seed', { method: 'manual', order: players.map(participantOf) });
    expect((await admin(org, 'begin')).ok).toBe(true);
    const match = await matchWithRoom(org, (m) => m.round === 1, 'match room');
    const a = await seatFor(driver, p1, match.id);
    const b = await seatFor(driver, p2, match.id);
    await gameLive(driver, a, 1);
    // Game 2 gets a countdown long enough to walk out during it.
    a.server().countdownMs = 900;
    await playGame(driver, org, match.id, [a, b], a);
    await waitFor(() => a.info().gameNumber === 2 && stateOf(a.room).phase === 'COUNTDOWN', 8000, 'game 2 countdown');
    await b.room.leave(true);
    await waitFor(() => gamesOf(matchById(org, match.id)).length === 2, 8000, 'game 2 recorded');
    expect(gamesOf(matchById(org, match.id))[1]!.winnerId).toBe(participantOf(p1));
    await waitFor(() => a.info().seriesStatus === 'decided', 5000, 'series decided');
  }, 60_000);

  it("the organizer's course length: front three, and a tie's playoff holes come from the same three", async () => {
    const driver = DRIVERS.putt!;
    const { org, players } = await setupField(2, { gameId: 'putt', bestOf: 1, gameSettings: { course: 'front' } });
    expect((await admin(org, 'begin')).ok).toBe(true);
    const [p1, p2] = players as [(typeof players)[number], (typeof players)[number]];
    const match = await matchWithRoom(org, () => true, 'match room');
    const a = await seatFor(driver, p1, match.id);
    const b = await seatFor(driver, p2, match.id);
    const events = collect<PuttEvent>(a.room, PUTT_MSG.event);
    await gameLive(driver, a, 1);
    // The fixed tournament format, on the organizer's course.
    expect(a.server().config).toEqual({ ...PUTT_TOURNAMENT_SETTINGS, course: 'front' });
    expect(stateOf(a.room).regulation).toBe(3);
    expect([...(stateOf(a.room).route as number[])]).toEqual([1, 2, 3]);
    // Both golfers pick up every hole: level after regulation, then on every playoff hole.
    await playGame(driver, org, match.id, [a, b], 'draw');
    const playoffs = events.filter((e): e is Extract<PuttEvent, { kind: 'playoff' }> => e.kind === 'playoff').map((e) => e.hole);
    expect(playoffs).toEqual([3, 2, 1]);
  }, 60_000);
});
