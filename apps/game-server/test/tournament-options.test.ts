/**
 * Tournament Center organizer options (the create wizard's per-game settings, TOURNAMENT_GAME_SETTINGS)
 * reach the match rooms and change how the matches play: Memory Matrix's mode and lives, and DAS
 * Ships' firing mode with its fleet + grid preset.
 */
process.env.DASCADE_TOURNAMENT_START_DELAY_MS = '30';
process.env.DASCADE_TOURNAMENT_INTERMISSION_MS = '150';
process.env.DASCADE_TOURNAMENT_CLOSE_DELAY_MS = '80';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import { randomLayout } from '@dascade/game-core/ships';
import { SHIPS_MSG } from '@dascade/shared/games/ships';
import { createSeededRng } from '@dascade/shared';
import { TOURNAMENT_GAME_SETTINGS, applyTournamentGameSetting } from '@dascade/shared/tournamentGames';
import { bootTestServer, waitFor } from './helpers.ts';
import { admin, participantOf, setupField, useTournamentServer, type Viewer } from './tournament-helpers.ts';
import { gameLive, gamesOf, matchById, matchWithRoom, playGame, seatFor, useBracketServer } from './tournament-bracket.ts';
import { DRIVERS, stateOf } from './tournament-drivers.ts';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['tournament', 'memory', 'ships']));
  useTournamentServer(colyseus);
  useBracketServer(colyseus);
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

/** gameSettings exactly as the wizard builds them from the chosen option ids. */
function wizardSettings(gameId: 'memory' | 'ships', picks: Record<string, string>): Record<string, unknown> {
  let gs: Record<string, unknown> = {};
  for (const f of TOURNAMENT_GAME_SETTINGS[gameId]!)
    gs = applyTournamentGameSetting(
      gs,
      f,
      f.options.find((o) => o.id === picks[f.key])!,
    );
  return gs;
}

describe('Tournament organizer options', () => {
  it('memory: flash mode with sudden death — every pattern is a flash and each player has one life', async () => {
    const driver = DRIVERS.memory!;
    const gameSettings = wizardSettings('memory', { variant: 'flash', rule: 'sudden' });
    expect(gameSettings).toEqual({ variant: 'flash', rule: 'sudden' });
    const { org, players } = await setupField(2, { gameId: 'memory', gameSettings });
    expect((await admin(org, 'begin')).ok).toBe(true);
    const [p1, p2] = players as [Viewer, Viewer];
    const match = await matchWithRoom(org, () => true, 'match room');
    const a = await seatFor(driver, p1, match.id);
    const b = await seatFor(driver, p2, match.id);
    await gameLive(driver, a, 1);
    expect(a.server().getSettings()).toEqual({ variant: 'flash', rule: 'sudden' });
    await waitFor(() => a.patterns.length > 0, 5000, 'first pattern');
    const standings = stateOf(a.room).standings as Map<string, { lives: number }>;
    expect([...standings.values()].map((s) => s.lives)).toEqual([1, 1]);
    await playGame(driver, org, match.id, [a, b], a);
    expect(a.patterns.length).toBeGreaterThan(1);
    expect(a.patterns.every((p) => p.kind === 'flash')).toBe(true);
    await waitFor(() => org.view().status === 'COMPLETE', 8000, 'champion');
    expect(org.view().championId).toBe(participantOf(p1));
  }, 60_000);

  it('ships: salvo with the skirmish fleet on 8×8 — the battle uses that sea, fleet and volley size', async () => {
    const driver = DRIVERS.ships!;
    const gameSettings = wizardSettings('ships', { firing: 'salvo', fleetGrid: 'skirmish-8' });
    expect(gameSettings).toEqual({ firing: 'salvo', fleet: 'skirmish', gridSize: 8 });
    const { org, players } = await setupField(2, { gameId: 'ships', gameSettings });
    expect((await admin(org, 'begin')).ok).toBe(true);
    const [p1, p2] = players as [Viewer, Viewer];
    const match = await matchWithRoom(org, () => true, 'match room');
    const a = await seatFor(driver, p1, match.id);
    const b = await seatFor(driver, p2, match.id);
    await gameLive(driver, a, 1);
    const server = a.server();
    expect(server.settings).toMatchObject(gameSettings);
    expect(stateOf(a.room)).toMatchObject({ gridSize: 8, fleet: 'skirmish', firing: 'salvo' });
    expect(server.rules.size).toBe(8);
    expect(server.rules.fleet).toHaveLength(4);
    const rng = createSeededRng('options-fleet');
    for (const seat of [a, b]) seat.room.send(SHIPS_MSG.layout, { vessels: randomLayout(rng, server.rules), ready: true });
    await waitFor(() => stateOf(a.room).stage === 'battle', 3000, 'battle');
    // Salvo: one shot per vessel still afloat.
    expect(stateOf(a.room).shotsAllowed).toBe(4);
    b.room.send(SHIPS_MSG.resign, {});
    await waitFor(() => gamesOf(matchById(org, match.id)).length === 1, 8000, 'game recorded');
    expect(gamesOf(matchById(org, match.id))[0]!.winnerId).toBe(participantOf(p1));
  }, 60_000);
});
