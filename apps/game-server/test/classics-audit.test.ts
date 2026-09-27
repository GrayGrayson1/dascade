/**
 * Adversarial audit of the DAScade Classics rooms (review R4): fabricated / mis-filed scores,
 * tampered verified-run logs, solo pause/settings abuse and stalls.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import { CLASSICS, CLASSICS_MSG, type RunAck, type RunTicket, type RunVerdict } from '@dascade/shared/games/classics';
import { FACE_X, type PaddleMatch } from '@dascade/game-core/paddle';
import { CODE as BLOCK, createBlocksSim } from '@dascade/game-core/blocks';
import { InputRecorder } from '@dascade/game-core/classics/shared';
import { bootTestServer, collect, quiet, sleep, waitFor } from './helpers.ts';
import { highScores } from '../src/rooms/classics/highScores.ts';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['paddle', 'snake', 'asteroids', 'memory', 'bricks', 'blocks']));
});
afterEach(async () => {
  await colyseus.cleanup();
  highScores.reset();
});
afterAll(async () => {
  await colyseus.shutdown();
});

const st = (room: SdkRoom) => room.state as any;

async function solo(gameId: string) {
  const room = await colyseus.sdk.create(gameId, { name: 'Solo', solo: true });
  const welcomes = collect<{ playerId: string }>(room, 'sys:welcome');
  const verdicts = collect<RunVerdict>(room, CLASSICS_MSG.verdict);
  const tickets = collect<RunTicket>(room, CLASSICS_MSG.run);
  const acks = collect<RunAck>(room, CLASSICS_MSG.ack);
  const errors = collect<{ code: string; type?: string }>(room, 'sys:error');
  room.onMessage('*', () => undefined);
  quiet(room);
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, 'welcome');
  const me = welcomes[0]!.playerId;
  const server = colyseus.getRoomById(room.roomId) as any;
  await waitFor(() => st(room).standings.get(me)?.status === 'ready', 3000, 'ready');
  return { room, me, server, verdicts, tickets, acks, errors };
}

async function settings(room: SdkRoom, next: Record<string, unknown>) {
  room.send('lobby:settings', { settings: next });
  await waitFor(() => Object.entries(next).every(([k, v]) => JSON.parse(st(room).settingsJson)[k] === v), 3000, 'settings');
}

describe('Classics — solo settings cannot be switched mid-run (board spoofing)', () => {
  it('paddle: a game started vs the rookie house cannot be filed on the legend board', async () => {
    const c = await solo('paddle');
    await settings(c.room, { target: 3, winBy2: false, ai: 'rookie', speed: 'classic' });
    c.room.send(CLASSICS_MSG.start, {});
    await waitFor(() => st(c.room).standings.get(c.me)?.status === 'playing', 3000, 'run');
    // Mid-game: try to re-file the run under the hardest board.
    c.room.send('lobby:settings', { settings: { ai: 'legend', target: 21, speed: 'turbo' } });
    await sleep(200);
    expect(c.errors.some((e) => e.type === 'lobby:settings' && e.code === 'wrong_phase')).toBe(true);
    const m = c.server.match as PaddleMatch;
    m.sides[0].score = 2;
    m.status = 'play';
    m.ball.x = FACE_X[1] - 40;
    m.ball.y = m.sides[1].y > 450 ? 60 : 840;
    m.ball.vx = 30;
    m.ball.vy = 0;
    m.ball.speed = 30;
    await waitFor(() => c.verdicts.length > 0, 8000, 'verdict');
    expect(c.verdicts[0]!.board).toBe('rookie-classic-to3');
    expect(highScores.top('paddle', 'legend-turbo-to21').entries).toHaveLength(0);
  });

  const modes: Array<[string, Record<string, unknown>]> = [
    ['snake', { speed: 'fast', wrap: false, powerUps: false }],
    ['asteroids', { difficulty: 'ace', lives: 1 }],
    ['memory', { rule: 'sudden' }],
    ['bricks', { mode: 'blitz' }],
    ['blocks', { mode: 'blitz' }],
  ];
  for (const [gameId, change] of modes) {
    it(`${gameId}: settings are locked while a solo run is live and unlock after quitting`, async () => {
      const c = await solo(gameId);
      const before = st(c.room).settingsJson;
      c.room.send(CLASSICS_MSG.start, {});
      await waitFor(() => st(c.room).standings.get(c.me)?.status === 'playing', 3000, 'run');
      c.room.send('lobby:settings', { settings: change });
      await waitFor(() => c.errors.some((e) => e.type === 'lobby:settings'), 2000, 'refused');
      expect(st(c.room).settingsJson).toBe(before);
      c.room.send(CLASSICS_MSG.quit, {});
      await waitFor(() => st(c.room).standings.get(c.me)?.status === 'ready', 3000, 'back to ready');
      await settings(c.room, change);
    });
  }
});

describe('Classics — solo pause cannot be used to freeze-frame through a run', () => {
  const games: Array<[string, string, (room: SdkRoom) => boolean]> = [
    ['paddle', 'paddle:pause', (room) => st(room).match.paused === true],
    ['snake', 'snake:pause', (room) => st(room).match.paused === true],
    ['asteroids', 'asteroids:pause', (room) => st(room).run.paused === true],
  ];
  for (const [gameId, pauseMsg, isPaused] of games) {
    it(`${gameId}: pausing right after a resume is refused, and a run has a pause budget`, async () => {
      const c = await solo(gameId);
      c.room.send(CLASSICS_MSG.start, {});
      await waitFor(() => st(c.room).standings.get(c.me)?.status === 'playing', 3000, 'run');
      c.room.send(pauseMsg, { paused: true });
      await waitFor(() => isPaused(c.room), 2000, 'first pause');
      c.room.send(pauseMsg, { paused: false });
      await waitFor(() => !isPaused(c.room), 2000, 'resumed');
      // Pause-stepping: pause again before any real play happened → refused, the game runs on.
      c.room.send(pauseMsg, { paused: true });
      await waitFor(() => c.errors.some((e) => e.type === pauseMsg && e.code === 'not_allowed'), 2000, 'cooldown refusal');
      expect(isPaused(c.room)).toBe(false);
      // After the cooldown pausing works again, until the run's budget is spent.
      c.server.soloPauseCooldownMs = 0;
      c.server.soloPauseBudget = 3;
      await sleep(1_100);
      for (let i = 0; i < 2; i++) {
        c.room.send(pauseMsg, { paused: true });
        await waitFor(() => isPaused(c.room), 2000, `pause ${i + 2}`);
        c.room.send(pauseMsg, { paused: false });
        await waitFor(() => !isPaused(c.room), 2000, `resume ${i + 2}`);
        await sleep(1_100); // the resume lead-in (no pausing before play is live again)
      }
      const refusals = c.errors.length;
      c.room.send(pauseMsg, { paused: true });
      await waitFor(() => c.errors.length > refusals, 2000, 'budget refusal');
      expect(isPaused(c.room)).toBe(false);
      // A new run gets a fresh budget.
      c.room.send(CLASSICS_MSG.quit, {});
      await waitFor(() => st(c.room).standings.get(c.me)?.status === 'ready', 3000, 'ready');
      c.room.send(CLASSICS_MSG.start, {});
      await waitFor(() => st(c.room).standings.get(c.me)?.status === 'playing', 3000, 'run 2');
      c.room.send(pauseMsg, { paused: true });
      await waitFor(() => isPaused(c.room), 2000, 'pause in new run');
    });
  }
});

describe('Classics — dropping the connection is not an unlimited pause button', () => {
  it('snake: disconnect auto-pauses spend the run’s pause budget', async () => {
    const c = await solo('snake');
    await settings(c.room, { speed: 'relaxed', wrap: true });
    c.room.send(CLASSICS_MSG.start, {});
    await waitFor(() => st(c.room).standings.get(c.me)?.status === 'playing', 3000, 'run');
    c.server.soloPauseBudget = 1;
    const drop = async () => {
      c.room.reconnection.minUptime = 0;
      const back = new Promise<void>((r) => c.room.onReconnect(() => r()));
      (c.room as any).connection.transport.ws.close(4010);
      await back;
      await waitFor(() => st(c.room).players.get(c.me)?.connected === true, 3000, 'reconnected');
    };
    await drop();
    // First drop: the game froze while the player was away (budget 1 → 0).
    await waitFor(() => st(c.room).match.paused === true, 2000, 'frozen while away');
    c.room.send('snake:pause', { paused: false });
    await waitFor(() => st(c.room).match.paused === false, 2000, 'resumed');
    await sleep(1_100);
    // Second drop: no budget left — the run is not frozen.
    await drop();
    await sleep(200);
    expect(c.server.finished).toBe(false);
    expect(c.server.state.match.paused).toBe(false);
    expect(st(c.room).match.paused).toBe(false);
  });
});

describe('Classics — tampered verified-run logs (Block Drop)', () => {
  /** Starts a solo run and lets the test client run up to 30 min ahead of real time. */
  async function run() {
    const c = await solo('blocks');
    c.server.soloLeadMs = 0;
    c.room.send(CLASSICS_MSG.start, {});
    await waitFor(() => c.tickets.length > 0, 3000, 'ticket');
    const ticket = c.tickets[c.tickets.length - 1]!;
    c.server.runs.get(c.me).startAt = Date.now() - 30 * 60_000;
    const send = (b: Record<string, unknown>) => c.room.send(CLASSICS_MSG.input, { runId: ticket.runId, ...b });
    const serverRun = () => c.server.runs.get(c.me);
    return { ...c, ticket, send, serverRun };
  }

  it('reordered batches: a gap asks for a resync and nothing is applied out of order', async () => {
    const c = await run();
    c.send({ seq: 2, upTo: 40, events: [5, BLOCK.hardDrop] });
    await waitFor(() => c.acks.some((a) => a.resync), 2000, 'gap resync');
    expect(c.serverRun().upTo).toBe(0);
    c.send({ seq: 1, upTo: 20, events: [3, BLOCK.hardDrop] });
    c.send({ seq: 2, upTo: 40, events: [5, BLOCK.hardDrop] });
    await waitFor(() => c.serverRun().ackSeq === 2, 2000, 'in order');
    // The server's replay equals a local replay of exactly that log.
    const sim = createBlocksSim(c.ticket.seed, c.ticket.options, false);
    while (sim.tick < 40) {
      if (sim.tick === 3 || sim.tick === 25) sim.input(BLOCK.hardDrop);
      sim.step();
    }
    expect(c.serverRun().sim.summary()).toEqual(sim.summary());
  });

  it('a batch that rewinds upTo, overlaps or is replayed later is never applied twice', async () => {
    const c = await run();
    c.send({ seq: 1, upTo: 30, events: [2, BLOCK.hardDrop] });
    await waitFor(() => c.serverRun().ackSeq === 1, 2000, 'first');
    const score = c.serverRun().sim.summary().score;
    // Same seq again (replay), then a "next" batch that pretends to start earlier (upTo backwards).
    c.send({ seq: 1, upTo: 30, events: [2, BLOCK.hardDrop] });
    c.send({ seq: 2, upTo: 10, events: [] });
    await waitFor(() => c.acks.some((a) => a.resync), 2000, 'backwards resync');
    await sleep(100);
    expect(c.serverRun().ackSeq).toBe(1);
    expect(c.serverRun().upTo).toBe(30);
    expect(c.serverRun().sim.summary().score).toBe(score);
  });

  it('a flood of inputs on one tick is a tampered log: the run is rejected and never recorded', async () => {
    const c = await run();
    const flood: number[] = [4, BLOCK.leftDown];
    for (let i = 0; i < CLASSICS.maxEventsPerTick; i++) flood.push(0, i % 2 ? BLOCK.leftDown : BLOCK.leftUp);
    c.send({ seq: 1, upTo: 20, events: flood });
    await waitFor(() => c.verdicts.length > 0, 2000, 'verdict');
    expect(c.verdicts[0]!.reason).toBe('rejected');
    expect(c.verdicts[0]!.rank).toBeNull();
    expect(highScores.top('blocks', 'marathon').entries).toHaveLength(0);
  });

  it('oversized and malformed batches are dropped without touching the run', async () => {
    const c = await run();
    const huge = new Array(CLASSICS.maxBatchEvents * 2 + 2).fill(0).map((_, i) => (i % 2 ? BLOCK.rotateCW : 1));
    c.send({ seq: 1, upTo: 2_000, events: huge });
    c.send({ seq: 1, upTo: 20, events: [1] });
    c.send({ seq: 1, upTo: 20, events: [-1, BLOCK.hardDrop] });
    c.send({ seq: 1, upTo: 20.5, events: [] });
    await sleep(200);
    expect(c.serverRun().ackSeq).toBe(0);
    expect(c.serverRun().ended).toBe(false);
    expect(c.room.connection.isOpen).toBe(true);
  });

  it('a log from an earlier run (other seed) cannot be replayed into a new run', async () => {
    const c = await run();
    const oldRunId = c.ticket.runId;
    c.room.send(CLASSICS_MSG.quit, {});
    await waitFor(() => st(c.room).standings.get(c.me)?.status === 'ready', 3000, 'ready');
    c.room.send(CLASSICS_MSG.start, {});
    await waitFor(() => c.tickets.length > 1, 3000, 'second ticket');
    c.server.runs.get(c.me).startAt = Date.now() - 30 * 60_000;
    c.room.send(CLASSICS_MSG.input, { runId: oldRunId, seq: 1, upTo: 60, events: [5, BLOCK.hardDrop] });
    await sleep(150);
    expect(c.server.runs.get(c.me).ackSeq).toBe(0);
    expect(c.server.runs.get(c.me).runId).not.toBe(oldRunId);
  });

  it('a client racing ahead of the wall clock is throttled, however it splits its batches', async () => {
    const c = await solo('blocks');
    c.server.soloLeadMs = 0;
    c.room.send(CLASSICS_MSG.start, {});
    await waitFor(() => c.tickets.length > 0, 3000, 'ticket');
    const ticket = c.tickets[0]!;
    // Simulate 20 s of play instantly and stream it in small legit-looking batches.
    const sim = createBlocksSim(ticket.seed, ticket.options, false);
    const rec = new InputRecorder();
    while (!sim.over && sim.tick < 20 * CLASSICS.tickHz) {
      if (sim.tick % 40 === 0 && sim.input(BLOCK.hardDrop)) rec.record(sim.tick, BLOCK.hardDrop);
      sim.step();
    }
    for (let i = 0; i < 12; i++) {
      const b = rec.take(Math.min(sim.tick, (i + 1) * CLASSICS.batchEveryTicks * 10));
      if (b) c.room.send(CLASSICS_MSG.input, { runId: ticket.runId, ...b });
    }
    await sleep(300);
    // Accepted progress never exceeds real time since the start (+ the small jitter allowance).
    const run = c.server.runs.get(c.me);
    const wall = Math.floor((Date.now() - run.startAt) / (1000 / CLASSICS.tickHz));
    expect(run.upTo).toBeLessThanOrEqual(wall + CLASSICS.aheadSlackTicks);
    expect(c.acks.some((a) => a.resync)).toBe(true);
  });
});
