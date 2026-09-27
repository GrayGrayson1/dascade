/**
 * Tournament Center × real DAS Chess room: the kiosk launches chess rooms, tickets seat the two
 * participants on the sides the tournament chose, the game is rated, and a resignation advances
 * the bracket to a champion.
 */
process.env.DASCADE_TOURNAMENT_START_DELAY_MS = '30';
process.env.DASCADE_TOURNAMENT_INTERMISSION_MS = '150';
process.env.DASCADE_TOURNAMENT_CLOSE_DELAY_MS = '80';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import { getRating } from '../src/platform/ratings.ts';
import { bootTestServer, waitFor } from './helpers.ts';
import { admin, participantOf, setupField, takeSeat, useTournamentServer, waitPhase } from './tournament-helpers.ts';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['tournament', 'chess']));
  useTournamentServer(colyseus);
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

interface ChessSeat {
  side: string;
  playerId: string;
}

describe('Tournament Center — chess', () => {
  it('launches real chess rooms, seats players on the tournament sides, rates the game and crowns a champion', async () => {
    const { org, players } = await setupField(2, {
      gameId: 'chess',
      format: 'single_elimination',
      bestOf: 1,
      gameSettings: { timeControl: { baseMinutes: 3, incrementSeconds: 2 } },
    });
    await admin(org, 'begin');
    const [a, b] = players as [(typeof players)[number], (typeof players)[number]];
    await waitFor(() => Boolean(a.me().activeMatch && b.me().activeMatch), 3000, 'tickets');
    expect(a.me().activeMatch!.gameId).toBe('chess');
    const aSide = a.me().activeMatch!.side;
    expect(aSide === 'first' || aSide === 'second').toBe(true);
    expect(b.me().activeMatch!.side).toBe(aSide === 'first' ? 'second' : 'first');

    const sa = await takeSeat(a, 'Player1');
    const sb = await takeSeat(b, 'Player2');
    await waitPhase(sa.room, 'PLAYING', 8000);
    // The chess room seated each participant on the side the tournament assigned.
    const seats = (sa.room.state as unknown as { toJSON(): { seats: ChessSeat[] } }).toJSON().seats;
    const aSeat = seats.find((s) => s.playerId === sa.playerId())!;
    expect(aSeat.side).toBe(aSide);
    // The clock preset came from the tournament's game settings; lobby settings are locked.
    const settings = JSON.parse((sa.room.state as unknown as { settingsJson: string }).settingsJson) as { timeControl: { baseMinutes: number } };
    expect(settings.timeControl.baseMinutes).toBe(3);

    // The second side resigns.
    const loser = aSide === 'second' ? sa : sb;
    const winnerViewer = aSide === 'second' ? b : a;
    loser.room.send('chess:resign', {});
    await waitFor(() => org.view().status === 'COMPLETE', 4000, 'tournament complete');
    const view = org.view();
    expect(view.championId).toBe(participantOf(winnerViewer));
    expect(view.matches[0]).toMatchObject({ status: 'COMPLETE', resultKind: 'played' });
    expect(JSON.parse(view.matches[0]!.gamesJson)[0]).toMatchObject({ reason: 'resign' });
    await waitFor(() => sa.info().seriesStatus === 'decided', 3000, 'decided in the chess room');
    // Tournament games are rated.
    expect(getRating('g:guest-Player1', 'chess').games).toBe(1);
    expect(getRating('g:guest-Player2', 'chess').games).toBe(1);
  });
});
