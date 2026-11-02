/**
 * Solo Classics runs reach Profile → Stats: a solo room stays in PLAYING across Start / Retry, so each
 * finished run opens its own outcome window (BaseGameRoom.beginSoloOutcome) and reports one unrated
 * game. Quit runs aren't results. Outside solo rooms the window never reopens, so a match still
 * reports exactly one outcome.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, WelcomePayload } from '@dascade/shared';
import { CLASSICS_MSG, type RunVerdict } from '@dascade/shared/games/classics';
import { SNAKE_MSG } from '@dascade/shared/games/snake';
import { onOutcome, type OutcomeContext } from '../src/platform/hub.ts';
import { getStatLine, resetStats } from '../src/platform/stats.ts';
import { bootTestServer, collect, quiet, waitFor } from './helpers.ts';

let colyseus: ColyseusTestServer;
const outcomes: Array<{ outcome: GameOutcome; ctx: OutcomeContext }> = [];
let unsubscribe: () => void = () => undefined;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['snake']));
  unsubscribe = onOutcome((outcome, ctx) => outcomes.push({ outcome, ctx }));
});
beforeEach(() => resetStats());
afterEach(async () => {
  await colyseus.cleanup();
  outcomes.length = 0;
});
afterAll(async () => {
  unsubscribe();
  await colyseus.shutdown();
});

const GUEST = `g_${'7'.repeat(24)}`;
const st = (room: SdkRoom) => room.state as any;

async function soloSnake() {
  const room = await colyseus.sdk.create('snake', { name: 'Solo', solo: true, guestId: GUEST });
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const verdicts = collect<RunVerdict>(room, CLASSICS_MSG.verdict);
  room.onMessage(SNAKE_MSG.snap, () => undefined);
  room.onMessage(SNAKE_MSG.event, () => undefined);
  room.onMessage(CLASSICS_MSG.event, () => undefined);
  quiet(room);
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, 'welcome');
  const me = welcomes[0]!.playerId;
  await waitFor(() => st(room).standings.get(me)?.status === 'ready', 3000, 'instructions');
  return { room, me, verdicts };
}

/** Start (or retry) a run and steer straight up into the wall. */
async function crashRun(c: Awaited<ReturnType<typeof soloSnake>>): Promise<RunVerdict> {
  const before = c.verdicts.length;
  c.room.send(CLASSICS_MSG.start, {});
  await waitFor(() => st(c.room).standings.get(c.me)?.status === 'playing', 3000, 'run started');
  c.room.send(SNAKE_MSG.turn, { dir: 0 });
  await waitFor(() => c.verdicts.length > before, 15_000, 'verdict');
  return c.verdicts.at(-1)!;
}

const snakeOutcomes = () => outcomes.filter((o) => o.ctx.gameId === 'snake');

describe('Classics — solo runs are reported to stats', () => {
  it('reports every finished run as one unrated game, never a quit run', async () => {
    const c = await soloSnake();
    const first = await crashRun(c);
    expect(first.reason).toBe('over');
    await waitFor(() => snakeOutcomes().length === 1, 2000, 'first outcome');
    const { outcome, ctx } = snakeOutcomes()[0]!;
    expect(outcome.placements).toEqual([[c.me]]);
    expect(outcome.scores).toEqual({ [c.me]: first.score });
    expect(outcome.details).toMatchObject({ board: first.board, mode: 'solo' });
    expect((outcome.details as any).playerStats[c.me]).toEqual({ maxLevel: expect.any(Number), maxLength: expect.any(Number) });
    expect(ctx).toMatchObject({ rated: false, tournament: null });
    expect(ctx.startedAt).toBeGreaterThan(0);

    // Retry: the next run is its own game.
    const second = await crashRun(c);
    await waitFor(() => snakeOutcomes().length === 2, 2000, 'second outcome');
    expect(snakeOutcomes()[1]!.outcome.scores).toEqual({ [c.me]: second.score });
    expect(snakeOutcomes()[1]!.ctx.startedAt).toBeGreaterThanOrEqual(ctx.endedAt);

    // A run the player quits isn't a result.
    c.room.send(CLASSICS_MSG.start, {});
    await waitFor(() => st(c.room).standings.get(c.me)?.status === 'playing', 3000, 'third run');
    c.room.send(CLASSICS_MSG.quit, {});
    await waitFor(() => st(c.room).standings.get(c.me)?.status === 'ready', 3000, 'quit');

    const line = getStatLine(`g:${GUEST}`, 'snake');
    expect(line).toMatchObject({ games: 2, wins: 0, losses: 0, draws: 0, scoredGames: 2, totalScore: first.score + second.score });
    expect(line!.bestScore).toBe(Math.max(first.score, second.score));
    expect(line!.extras).toHaveProperty('maxLength');
    expect(snakeOutcomes()).toHaveLength(2);
  }, 60_000);
});

describe('BaseGameRoom.beginSoloOutcome', () => {
  it('never reopens the outcome window outside solo rooms', async () => {
    const room = await colyseus.sdk.create('test', { name: 'Host', guestId: GUEST });
    const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
    quiet(room);
    await room.waitForInitialState();
    await waitFor(() => welcomes.length > 0, 3000, 'welcome');
    // The TestRoom fixture, reaching its protected outcome API directly.
    const server = colyseus.getRoomById(room.roomId) as unknown as { reportOutcome(o: GameOutcome): void; beginSoloOutcome(): void };
    room.send('lobby:start', {});
    await waitFor(() => st(room).phase === 'PLAYING', 3000, 'playing');
    const me = welcomes[0]!.playerId;
    const before = outcomes.length;
    server.reportOutcome({ placements: [[me]], reason: 'first' });
    server.beginSoloOutcome();
    server.reportOutcome({ placements: [[me]], reason: 'second' });
    expect(outcomes.slice(before).map((o) => o.outcome.reason)).toEqual(['first']);
  });
});
