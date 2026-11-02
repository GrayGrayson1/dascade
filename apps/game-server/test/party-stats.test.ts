/**
 * Party and Reversi rooms report per-player Profile stats (`details.playerStats`, aggregated by
 * packages/shared/src/stats.ts), built only from numbers that are public once revealed:
 *  - DASwords: words found, longest word, only-one finds (or chain links);
 *  - DASterpiece: votes received, showdowns won, sweeps, audience picks;
 *  - DAS Survey: predictions on target and bonus calls (a real one-question game);
 *  - DASception: survived, games as a Glitch, awards won (from the final report);
 *  - DAS Reversi: discs flipped and the biggest flip (from the move record).
 * Words, DASterpiece and DASception already counted these during play; the tests give the room's
 * counters known values and run its end-of-match code.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameId, GameOutcome, WelcomePayload } from '@dascade/shared';
import { getStatLine, resetStats } from '../src/platform/stats.ts';
import { SURVEY_MSG } from '@dascade/shared/games/survey';
import { roleTeam, type DeceptionRole } from '@dascade/shared/games/deception';
import { legalMoves } from '@dascade/game-core/reversi';
import { onOutcome } from '../src/platform/hub.ts';
import { bootTestServer, collect, quiet, waitFor } from './helpers.ts';

let colyseus: ColyseusTestServer;
const outcomes: Array<{ outcome: GameOutcome; game: GameId }> = [];
let unsubscribe: () => void = () => undefined;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['words', 'masterpiece', 'survey', 'deception', 'reversi']));
  unsubscribe = onOutcome((outcome, ctx) => outcomes.push({ outcome, game: ctx.gameId }));
});
afterEach(async () => {
  await colyseus.cleanup();
  outcomes.length = 0;
  resetStats();
});
afterAll(async () => {
  unsubscribe();
  await colyseus.shutdown();
});

type Server = Record<string, any>;
interface Client {
  room: SdkRoom;
  id: string;
}

const guest = (n: number) => `g_${String(n).padStart(24, '0')}`;

async function wire(room: SdkRoom): Promise<Client> {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  quiet(room);
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, 'welcome');
  return { room, id: welcomes[0]!.playerId };
}

/** A room with `n` seated players (guest ids 1…n), host first. */
async function table(gameId: GameId, n: number, options: Record<string, unknown> = {}) {
  const host = await wire(await colyseus.sdk.create(gameId, { name: 'P1', guestId: guest(1), ...options }));
  const server = colyseus.getRoomById(host.room.roomId) as unknown as Server;
  server.countdownMs = 0;
  const clients = [host];
  for (let i = 2; i <= n; i++)
    clients.push(await wire(await colyseus.sdk.joinById(host.room.roomId, { name: `P${i}`, guestId: guest(i) })));
  return { server, host, clients };
}

async function start(t: Awaited<ReturnType<typeof table>>): Promise<void> {
  t.host.room.send('lobby:start', {});
  await waitFor(() => t.server.phase === 'PLAYING', 4000, 'playing');
}

async function outcomeOf(game: GameId): Promise<GameOutcome> {
  await waitFor(() => outcomes.some((o) => o.game === game), 4000, `${game} outcome`);
  const mine = outcomes.filter((o) => o.game === game);
  expect(mine).toHaveLength(1);
  return mine[0]!.outcome;
}

const statsOf = (o: GameOutcome) => (o.details as { playerStats: Record<string, Record<string, number>> }).playerStats;

describe('party stats reach Profile → Stats', () => {
  it('DASwords: words found, longest word and only-one finds', async () => {
    const t = await table('words', 2);
    await start(t);
    const [a, b] = t.clients as [Client, Client];
    Object.assign(t.server.statsOf(a.id), { words: 7, unique: 2, longest: 'PLANETS' });
    Object.assign(t.server.statsOf(b.id), { words: 3, unique: 0, longest: 'ICE CUBE' });
    t.server.finishMatch();
    const stats = statsOf(await outcomeOf('words'));
    expect(stats[a.id]).toEqual({ wordsFound: 7, maxWordLength: 7, uniqueWords: 2 });
    expect(stats[b.id]).toEqual({ wordsFound: 3, maxWordLength: 7, uniqueWords: 0 });
    expect(getStatLine(`g:${guest(1)}`, 'words')?.extras).toEqual({ wordsFound: 7, maxWordLength: 7, uniqueWords: 2 });
  });

  it('DASterpiece: votes received, showdowns won, sweeps and audience picks', async () => {
    const t = await table('masterpiece', 3);
    await start(t);
    const [a, b, c] = t.clients as [Client, Client, Client];
    const record = (id: string) => t.server.players.get(id);
    Object.assign(t.server.statsOf(record(a.id)), { votes: 5, wins: 2, sweeps: 1, audiencePicks: 1 });
    Object.assign(t.server.statsOf(record(b.id)), { votes: 1, wins: 0, sweeps: 0, audiencePicks: 0 });
    t.server.statsOf(record(c.id));
    t.server.finish('completed');
    const stats = statsOf(await outcomeOf('masterpiece'));
    expect(stats[a.id]).toEqual({ votesReceived: 5, showdownsWon: 2, sweeps: 1, audiencePicks: 1 });
    expect(stats[b.id]).toEqual({ votesReceived: 1, showdownsWon: 0, sweeps: 0, audiencePicks: 0 });
    expect(stats[c.id]).toEqual({ votesReceived: 0, showdownsWon: 0, sweeps: 0, audiencePicks: 0 });
  });

  it('DAS Survey: revealed predictions on target and bonus calls', async () => {
    const t = await table('survey', 3);
    const s = t.server;
    s.answerMsOverride = 6000;
    s.predictMsOverride = 6000;
    s.revealMsOverride = 100;
    s.allAnsweredDelayMs = 30;
    t.host.room.send(SURVEY_MSG.custom, { questions: [{ mode: 'majority', prompt: 'Coffee or tea?', options: ['Coffee', 'Tea'] }] });
    await waitFor(() => s.state.customCount === 1, 2000, 'custom stored');
    t.host.room.send('lobby:settings', { settings: { mode: 'custom' } });
    await waitFor(() => JSON.parse(s.state.settingsJson).mode === 'custom', 2000, 'custom mode');
    t.host.room.send('lobby:start', {});
    await waitFor(() => s.state.stage === 'answer', 4000, 'answer stage');
    const [a, b, c] = t.clients as [Client, Client, Client];
    const q = s.state.q as number;
    // Coffee wins 2–1; A and B call it, C doesn't.
    a.room.send(SURVEY_MSG.answer, { q, option: 0 });
    b.room.send(SURVEY_MSG.answer, { q, option: 0 });
    c.room.send(SURVEY_MSG.answer, { q, option: 1 });
    await waitFor(() => s.state.stage === 'predict', 4000, 'predict stage');
    a.room.send(SURVEY_MSG.predict, { q, kind: 'majority', option: 0 });
    b.room.send(SURVEY_MSG.predict, { q, kind: 'majority', option: 0 });
    c.room.send(SURVEY_MSG.predict, { q, kind: 'majority', option: 1 });
    const outcome = await outcomeOf('survey');
    const result = JSON.parse(s.state.resultJson || '{}');
    const stats = statsOf(outcome);
    expect(stats[a.id]?.predictionsHit).toBe(1);
    expect(stats[b.id]?.predictionsHit).toBe(1);
    expect(stats[c.id]?.predictionsHit).toBe(0);
    // Bonus calls follow the revealed scores exactly.
    for (const id of [a.id, b.id, c.id]) {
      const score = (result.scores ?? []).find((x: { playerId: string }) => x.playerId === id);
      if (score) expect(stats[id]?.bonusCalls).toBe(score.bonus > 0 ? 1 : 0);
    }
  });

  it('DASception: survived, games as a Glitch and awards won, from the final report', async () => {
    const t = await table('deception', 4);
    await start(t);
    await waitFor(() => Boolean(t.server.game), 4000, 'dealt');
    t.server.finish({ team: 'sysops', reason: 'purged' });
    const outcome = await outcomeOf('deception');
    const report = JSON.parse(t.server.state.finalJson) as {
      roles: Array<{ playerId: string; role: string; alive: boolean }>;
      awards: Array<{ playerId: string }>;
    };
    const roles = (outcome.details as { roles: Record<string, DeceptionRole> }).roles;
    const stats = statsOf(outcome);
    for (const row of report.roles) {
      const glitch = roleTeam(roles[row.playerId]!) === 'glitches' ? 1 : 0;
      expect(stats[row.playerId]).toEqual({
        survived: row.alive ? 1 : 0,
        glitchGames: glitch,
        awardsWon: report.awards.filter((w) => w.playerId === row.playerId).length,
      });
    }
    expect(Object.values(stats).reduce((n, s) => n + s.glitchGames!, 0)).toBeGreaterThan(0);
  });

  it('DAS Reversi: discs flipped and the biggest flip', async () => {
    const t = await table('reversi', 2);
    await start(t);
    await waitFor(() => (t.server.state.seats as any[]).every((seat) => seat.playerId), 3000, 'seats');
    const firstId = t.server.state.seats[0].playerId as string;
    const black = t.clients.find((c) => c.id === firstId)!;
    const white = t.clients.find((c) => c.id !== firstId)!;
    const cell = legalMoves(t.server.game.position)[0]!;
    black.room.send('reversi:move', { cell, ply: t.server.state.ply });
    await waitFor(() => t.server.state.ply > 0, 3000, 'move');
    const flipped = t.server.game.plies[0].flips.length as number;
    expect(flipped).toBeGreaterThan(0);
    white.room.send('reversi:resign', {});
    const stats = statsOf(await outcomeOf('reversi'));
    expect(stats[black.id]).toEqual({ discsFlipped: flipped, maxFlip: flipped });
    expect(stats[white.id]).toEqual({ discsFlipped: 0, maxFlip: 0 });
  });
});
