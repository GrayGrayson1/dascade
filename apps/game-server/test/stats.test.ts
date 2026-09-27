/**
 * Platform stats & ratings: the outcome listener, the pure stat-line reducer and GET /api/stats/me.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { GameId, GameOutcome, TournamentMatchInfo } from '@dascade/shared';
import type { PlayerStatsResponse } from '@dascade/shared/stats';
import type { ColyseusTestServer } from '@colyseus/testing';
import { emitOutcome, type OutcomeContext, type OutcomePlayer } from '../src/platform/hub.ts';
import { getRating, resetRatings } from '../src/platform/ratings.ts';
import { applyGameToLine, emptyStatLine, getStatLine, resetStats } from '../src/platform/stats.ts';
import { bootTestServer } from './helpers.ts';

let colyseus: ColyseusTestServer;
let port: number;

beforeAll(async () => {
  ({ colyseus, port } = await bootTestServer([]));
});
afterAll(async () => {
  await colyseus.shutdown();
});
beforeEach(() => {
  resetRatings();
  resetStats();
});

const G = (n: number) => `g_${String(n).padStart(24, '0')}`;

function player(id: string, guest?: string, extra: Partial<OutcomePlayer> = {}): OutcomePlayer {
  return { playerId: id, name: id, guestId: guest, spectator: false, ...extra };
}

function ctx(
  gameId: GameId,
  players: OutcomePlayer[],
  opts: { rated?: boolean; tournament?: TournamentMatchInfo | null; endedAt?: number } = {},
): OutcomeContext {
  return {
    gameId,
    roomCode: 'ABCDE',
    rated: opts.rated ?? false,
    players: new Map(players.map((p) => [p.playerId, p])),
    tournament: opts.tournament ?? null,
    startedAt: 1000,
    endedAt: opts.endedAt ?? 2000,
  };
}

async function fetchStats(query: string, headers: Record<string, string> = {}): Promise<{ status: number; body: PlayerStatsResponse }> {
  const res = await fetch(`http://localhost:${port}/api/stats/me${query}`, { headers });
  return { status: res.status, body: (await res.json()) as PlayerStatsResponse };
}

const tournament: TournamentMatchInfo = {
  tournamentCode: 'TOURN',
  tournamentName: 'Friday Cup',
  matchId: 'm1',
  roundLabel: 'Final',
  format: 'single_elimination',
  bestOf: 1,
  gameNumber: 1,
  seriesScore: {},
  participants: [],
};

describe('stat line reducer', () => {
  const base = emptyStatLine('chess');
  it('counts a head-to-head win, loss and draw', () => {
    const win = applyGameToLine(base, { placements: [['a'], ['b']] }, 'a', 0, 2, false, 5);
    expect(win).toMatchObject({ games: 1, wins: 1, losses: 0, draws: 0, podiums: 0, lastPlayedAt: 5 });
    const loss = applyGameToLine(base, { placements: [['a'], ['b']] }, 'b', 1, 2, false, 5);
    expect(loss).toMatchObject({ games: 1, wins: 0, losses: 1 });
    const draw = applyGameToLine(base, { placements: [['a', 'b']] }, 'b', 0, 2, false, 5);
    expect(draw).toMatchObject({ games: 1, wins: 0, losses: 0, draws: 1 });
  });

  it('counts podiums only in fields of three or more', () => {
    const o: GameOutcome = { placements: [['a'], ['b'], ['c'], ['d']] };
    expect(applyGameToLine(base, o, 'c', 2, 4, false, 1).podiums).toBe(1);
    expect(applyGameToLine(base, o, 'd', 3, 4, false, 1).podiums).toBe(0);
  });

  it('solo games count games and best score but no wins or losses', () => {
    const line = applyGameToLine(emptyStatLine('bricks'), { placements: [['a']], scores: { a: 4200 } }, 'a', 0, 1, false, 1);
    expect(line).toMatchObject({ games: 1, wins: 0, losses: 0, draws: 0, bestScore: 4200, totalScore: 4200, scoredGames: 1 });
    const next = applyGameToLine(line, { placements: [['a']], scores: { a: 3900 } }, 'a', 0, 1, false, 2);
    expect(next.bestScore).toBe(4200);
    expect(next.totalScore).toBe(8100);
  });

  it('keeps the lowest score when lower is better (golf)', () => {
    let line = applyGameToLine(
      emptyStatLine('putt'),
      { placements: [['a'], ['b']], scores: { a: 30, b: 34 }, lowerIsBetter: true },
      'a',
      0,
      2,
      false,
      1,
    );
    line = applyGameToLine(line, { placements: [['b'], ['a']], scores: { a: 36, b: 29 }, lowerIsBetter: true }, 'a', 1, 2, false, 2);
    expect(line).toMatchObject({ bestScore: 30, lowerIsBetter: true, wins: 1, losses: 1 });
  });

  it('merges game extras from details.playerStats', () => {
    const o = (n: number, combo: number): GameOutcome => ({
      placements: [['a'], ['b']],
      details: { playerStats: { a: { correctAnswers: n, maxCombo: combo }, b: { correctAnswers: 1 } } },
    });
    let line = applyGameToLine(base, o(4, 3), 'a', 0, 2, false, 1);
    line = applyGameToLine(line, o(6, 2), 'a', 0, 2, false, 2);
    expect(line.extras).toEqual({ correctAnswers: 10, maxCombo: 3 });
  });

  it('ignores malformed extras', () => {
    const o = { placements: [['a'], ['b']], details: { playerStats: { a: { ok: 1, bad: 'x', arr: [1] } } } } as unknown as GameOutcome;
    expect(applyGameToLine(base, o, 'a', 0, 2, false, 1).extras).toEqual({ ok: 1 });
    const o2 = { placements: [['a'], ['b']], details: { playerStats: [1, 2] } } as unknown as GameOutcome;
    expect(applyGameToLine(base, o2, 'a', 0, 2, false, 1).extras).toEqual({});
  });

  it('counts tournament games', () => {
    expect(applyGameToLine(base, { placements: [['a'], ['b']] }, 'a', 0, 2, true, 1).tournamentGames).toBe(1);
  });
});

describe('outcome listener', () => {
  it('records stats for every identifiable player and skips anonymous ones', () => {
    emitOutcome({ placements: [['p1'], ['p2'], ['p3']] }, ctx('trivia', [player('p1', G(1)), player('p2', G(2)), player('p3')]));
    expect(getStatLine(`g:${G(1)}`, 'trivia')).toMatchObject({ games: 1, wins: 1, podiums: 1 });
    expect(getStatLine(`g:${G(2)}`, 'trivia')).toMatchObject({ games: 1, losses: 1, podiums: 1 });
  });

  it('prefers the verified account identity over the guest id', () => {
    emitOutcome({ placements: [['p1'], ['p2']] }, ctx('checkers', [player('p1', G(1), { userId: 'user-1' }), player('p2', G(2))]));
    expect(getStatLine('u:user-1', 'checkers')).toMatchObject({ wins: 1 });
    expect(getStatLine(`g:${G(1)}`, 'checkers')).toBeNull();
  });

  it('updates ratings only for rated games, and stats for both', () => {
    emitOutcome({ placements: [['p1'], ['p2']] }, ctx('chess', [player('p1', G(1)), player('p2', G(2))], { rated: false }));
    expect(getRating(`g:${G(1)}`, 'chess').games).toBe(0);
    expect(getStatLine(`g:${G(1)}`, 'chess')?.games).toBe(1);
    emitOutcome({ placements: [['p1'], ['p2']] }, ctx('chess', [player('p1', G(1)), player('p2', G(2))], { rated: true, tournament }));
    const a = getRating(`g:${G(1)}`, 'chess');
    const b = getRating(`g:${G(2)}`, 'chess');
    expect(a).toMatchObject({ games: 1, wins: 1 });
    expect(b).toMatchObject({ games: 1, losses: 1 });
    expect(a.rating).toBeGreaterThan(1200);
    expect(b.rating).toBeLessThan(1200);
    expect(getStatLine(`g:${G(1)}`, 'chess')).toMatchObject({ games: 2, tournamentGames: 1 });
  });

  it('never counts the same identity twice in one game (two seats, one browser)', () => {
    emitOutcome({ placements: [['p1'], ['p2']] }, ctx('chess', [player('p1', G(7)), player('p2', G(7))], { rated: true }));
    expect(getStatLine(`g:${G(7)}`, 'chess')).toMatchObject({ games: 1, wins: 1, losses: 0 });
    // Self-play never moves a rating.
    expect(getRating(`g:${G(7)}`, 'chess').games).toBe(0);
  });
});

describe('GET /api/stats/me', () => {
  it('returns the guest’s stats and ratings, most recent game first', async () => {
    emitOutcome({ placements: [['p1'], ['p2']] }, ctx('chess', [player('p1', G(1)), player('p2', G(2))], { rated: true, endedAt: 10 }));
    emitOutcome(
      { placements: [['p1', 'p2']], scores: { p1: 12, p2: 12 } },
      ctx('trivia', [player('p1', G(1)), player('p2', G(2))], { endedAt: 20 }),
    );
    const { status, body } = await fetchStats(`?guestId=${G(1)}`);
    expect(status).toBe(200);
    expect(body.identity).toBe('guest');
    expect(body.persisted).toBe(false);
    expect(body.games.map((g) => g.gameId)).toEqual(['trivia', 'chess']);
    expect(body.games[0]).toMatchObject({ draws: 1, bestScore: 12 });
    expect(body.ratings).toHaveLength(1);
    expect(body.ratings[0]).toMatchObject({ gameId: 'chess', games: 1, wins: 1, provisional: true });
  });

  it('answers "none" without an identity and rejects malformed ids', async () => {
    const none = await fetchStats('');
    expect(none.status).toBe(200);
    expect(none.body).toMatchObject({ identity: 'none', games: [], ratings: [] });
    const bad = await fetchStats('?guestId=%3Cscript%3E');
    expect(bad.status).toBe(400);
  });

  it('ignores an invalid bearer token (no Supabase): falls back to the guest id', async () => {
    emitOutcome({ placements: [['p1'], ['p2']] }, ctx('checkers', [player('p1', G(3)), player('p2', G(4))]));
    const { body } = await fetchStats(`?guestId=${G(3)}`, { Authorization: 'Bearer not-a-real-token-at-all' });
    expect(body.identity).toBe('guest');
    expect(body.games[0]).toMatchObject({ gameId: 'checkers', wins: 1 });
  });

  it('never leaks another guest’s numbers', async () => {
    emitOutcome({ placements: [['p1'], ['p2']] }, ctx('checkers', [player('p1', G(5)), player('p2', G(6))]));
    const { body } = await fetchStats(`?guestId=${G(9)}`);
    expect(body.games).toEqual([]);
    expect(body.ratings).toEqual([]);
  });
});
