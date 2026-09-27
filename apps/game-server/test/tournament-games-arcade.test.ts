/**
 * Tournament Center × the real-time arcade games (putt, paddle, snake): the full 4-player best-of-3
 * bracket through the real rooms (see tournament-bracket.ts). Split from tournament-games.test.ts
 * so the two files run in parallel.
 */
process.env.DASCADE_TOURNAMENT_START_DELAY_MS = '30';
process.env.DASCADE_TOURNAMENT_INTERMISSION_MS = '150';
process.env.DASCADE_TOURNAMENT_CLOSE_DELAY_MS = '80';

import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { GameId } from '@dascade/shared';
import { bootTestServer } from './helpers.ts';
import { useTournamentServer } from './tournament-helpers.ts';
import { runBracketScenario, useBracketServer } from './tournament-bracket.ts';

const ARCADE_GAMES: GameId[] = ['putt', 'paddle', 'snake'];

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['tournament', ...ARCADE_GAMES]));
  useTournamentServer(colyseus);
  useBracketServer(colyseus);
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

describe('Tournament Center × real-time arcade rooms', () => {
  for (const gameId of ARCADE_GAMES) {
    it(
      `${gameId}: 4-player best-of-3 bracket — tickets, auto-start, sides, series, concurrent semis, champion`,
      () => runBracketScenario(gameId),
      120_000,
    );
  }
});
