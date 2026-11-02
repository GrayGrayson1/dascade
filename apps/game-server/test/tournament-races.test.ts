/**
 * Block Drop and Brick Blitz × Tournament Center: every match is a fixed 3-minute Blitz score race,
 * whatever the organizer's raw gameSettings say. The format is published (clients show it), the run
 * tickets carry its clock, and the lobby can't change it. The full brackets run in
 * tournament-games.test.ts.
 */
process.env.DASCADE_TOURNAMENT_START_DELAY_MS = '30';
process.env.DASCADE_TOURNAMENT_INTERMISSION_MS = '150';
process.env.DASCADE_TOURNAMENT_CLOSE_DELAY_MS = '80';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import { BLOCKS_TOURNAMENT_SETTINGS } from '@dascade/shared/games/blocks';
import { BRICKS_TOURNAMENT_SETTINGS } from '@dascade/shared/games/bricks';
import { CLASSICS } from '@dascade/shared/games/classics';
import { bootTestServer, waitFor } from './helpers.ts';
import { admin, participantOf, setupField, useTournamentServer, type Viewer } from './tournament-helpers.ts';
import { gameLive, gamesOf, matchById, matchWithRoom, playGame, seatFor, useBracketServer } from './tournament-bracket.ts';
import { DRIVERS, stateOf } from './tournament-drivers.ts';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['tournament', 'blocks', 'bricks']));
  useTournamentServer(colyseus);
  useBracketServer(colyseus);
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

const CASES = [
  { gameId: 'blocks', pinned: BLOCKS_TOURNAMENT_SETTINGS, raw: { mode: 'marathon', startLevel: 7 } },
  { gameId: 'bricks', pinned: BRICKS_TOURNAMENT_SETTINGS, raw: { mode: 'arcade', blitzSeconds: 300 } },
] as const;

describe('Tournament score races (Block Drop, Brick Blitz)', () => {
  for (const { gameId, pinned, raw } of CASES) {
    it(`${gameId}: a fixed 3-minute Blitz whatever the organizer sent; the lobby can't change it; the higher score wins`, async () => {
      const driver = DRIVERS[gameId]!;
      // Settings the wizard doesn't offer, sent raw: the room ignores them.
      const { org, players } = await setupField(2, { gameId, gameSettings: raw });
      expect((await admin(org, 'begin')).ok).toBe(true);
      const [p1, p2] = players as [Viewer, Viewer];
      const match = await matchWithRoom(org, () => true, 'match room');
      const a = await seatFor(driver, p1, match.id);
      const b = await seatFor(driver, p2, match.id);
      await gameLive(driver, a, 1);
      expect(JSON.parse(stateOf(a.room).settingsJson as string)).toEqual(pinned);
      const meta = stateOf(a.room).classics as { mode: string; board: string; endsAt: number; startAt: number };
      expect(meta).toMatchObject({ mode: 'blitz', board: 'blitz-3' });
      expect(meta.endsAt - meta.startAt).toBe(180_000);
      for (const seat of [a, b]) expect(seat.tickets.at(-1)).toMatchObject({ limitTicks: 180 * CLASSICS.tickHz, board: 'blitz-3' });
      // Nobody can switch the format from the lobby.
      const errors = a.errors.length;
      a.room.send('lobby:settings', { settings: { mode: gameId === 'blocks' ? 'marathon' : 'arcade' } });
      await waitFor(() => a.errors.length > errors, 3000, 'settings refused');
      expect(a.errors.at(-1)).toMatchObject({ code: 'not_allowed' });
      await playGame(driver, org, match.id, [a, b], a);
      await waitFor(() => org.view().status === 'COMPLETE', 8000, 'champion');
      expect(org.view().championId).toBe(participantOf(p1));
      expect(gamesOf(matchById(org, match.id))[0]!.winnerId).toBe(participantOf(p1));
    }, 60_000);
  }
});
