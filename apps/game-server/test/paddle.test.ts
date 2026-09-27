import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, WelcomePayload } from '@dascade/shared';
import { CLASSICS_MSG, type RunVerdict } from '@dascade/shared/games/classics';
import { PADDLE_MSG, type PaddleEventPayload } from '@dascade/shared/games/paddle';
import { FACE_X, PADDLE, decodePaddleSnapshot, type PaddleMatch, type PaddleSnapshot } from '@dascade/game-core/paddle';
import { onOutcome } from '../src/platform/hub.ts';
import type { PaddleRoom } from '../src/rooms/paddle/PaddleRoom.ts';
import { bootTestServer, collect, sleep, waitFor, quiet } from './helpers.ts';

let colyseus: ColyseusTestServer;
const outcomes: Array<{ outcome: GameOutcome; game: string }> = [];
let unsubscribe: () => void = () => undefined;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['paddle']));
  unsubscribe = onOutcome((outcome, ctx) => outcomes.push({ outcome, game: ctx.gameId }));
});
afterEach(async () => {
  await colyseus.cleanup();
  outcomes.length = 0;
});
afterAll(async () => {
  unsubscribe();
  await colyseus.shutdown();
});

const st = (room: SdkRoom) => room.state as any;

interface Client {
  room: SdkRoom;
  me: () => WelcomePayload;
  snaps: PaddleSnapshot[];
  events: PaddleEventPayload[];
  verdicts: RunVerdict[];
  errors: Array<{ code: string; type?: string }>;
}

function wire(room: SdkRoom): Client {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<{ code: string; type?: string }>(room, 'sys:error');
  const events = collect<PaddleEventPayload>(room, PADDLE_MSG.event);
  const verdicts = collect<RunVerdict>(room, CLASSICS_MSG.verdict);
  const snaps: PaddleSnapshot[] = [];
  room.onMessage(PADDLE_MSG.snap, (bytes: Uint8Array) => {
    const snap = decodePaddleSnapshot(bytes);
    if (snap) snaps.push(snap);
  });
  room.onMessage(CLASSICS_MSG.event, () => undefined);
  quiet(room);
  return { room, me: () => welcomes[welcomes.length - 1]!, snaps, events, verdicts, errors };
}

async function create(name = 'Host', extra: Record<string, unknown> = {}) {
  const room = await colyseus.sdk.create('paddle', { name, ...extra });
  const client = wire(room);
  await room.waitForInitialState();
  await waitFor(() => Boolean(client.me()), 3000, 'welcome');
  const server = colyseus.getRoomById(room.roomId) as unknown as PaddleRoom;
  (server as any).countdownMs = 200;
  (server as any).resultsDelayMs = 100;
  return { ...client, server };
}

async function join(code: string, name: string, extra: Record<string, unknown> = {}): Promise<Client> {
  const room = await colyseus.sdk.joinById(code, { name, ...extra });
  const client = wire(room);
  await room.waitForInitialState();
  await waitFor(() => Boolean(client.me()), 3000, 'welcome');
  return client;
}

const match = (server: PaddleRoom) => (server as any).match as PaddleMatch;
const latest = (c: Client) => c.snaps[c.snaps.length - 1];

/** Input bot: every ~33 ms steer towards `target(snapshot)` and keep asking to serve. */
function bot(c: Client, target: (s: PaddleSnapshot | undefined) => number): () => void {
  let on = true;
  void (async () => {
    while (on) {
      if (c.room.connection.isOpen) c.room.send(PADDLE_MSG.input, { y: Math.max(0, Math.min(900, target(latest(c)))), serve: true, rtt: 30 });
      await sleep(33);
    }
  })();
  return () => {
    on = false;
  };
}

async function settle(host: Awaited<ReturnType<typeof create>>, settings: Record<string, unknown>) {
  host.room.send('lobby:settings', { settings });
  await waitFor(() => Object.entries(settings).every(([k, v]) => JSON.parse(st(host.room).settingsJson)[k] === v), 3000, 'settings');
}

describe('PaddleRoom — solo practice', () => {
  it('starts instantly, runs a verified game vs the house and supports retry', async () => {
    const host = await create('Solo', { solo: true });
    const me = host.me().playerId;
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    await waitFor(() => st(host.room).standings.get(me)?.status === 'ready', 3000, 'instructions');
    await settle(host, { target: 3, winBy2: false, ai: 'rookie' });
    host.room.send(CLASSICS_MSG.start, {});
    await waitFor(() => st(host.room).standings.get(me)?.status === 'playing', 3000, 'run');
    expect(st(host.room).left.playerId).toBe(me);
    expect(st(host.room).right.ai).toBe(true);
    expect(st(host.room).match.startAt).toBeGreaterThan(0);
    // Steer the paddle: the server moves it towards the target at the capped speed.
    await waitFor(() => host.snaps.length > 0, 3000, 'snapshot');
    host.room.send(PADDLE_MSG.input, { y: 100 });
    await waitFor(() => (latest(host)?.paddles[0].y ?? 450) < 200, 5000, 'paddle moved');
    // Fast-forward: one point from victory, ball flying into the house goal.
    const m = match(host.server);
    m.sides[0].score = 2;
    m.status = 'play';
    m.ball.x = FACE_X[1] - 40;
    m.ball.y = m.sides[1].y > 450 ? 60 : 840;
    m.ball.vx = 30;
    m.ball.vy = 0;
    m.ball.speed = 30;
    await waitFor(() => host.verdicts.length > 0, 8000, 'verdict');
    const v = host.verdicts[0]!;
    expect(v.reason).toBe('over');
    expect(v.score).toBe(3 * 100 + 500 + m.longestRally * 10);
    expect(v.board).toBe('rookie-classic-to3');
    expect(v.rank).toBe(1);
    await waitFor(() => st(host.room).standings.get(me)?.status === 'over', 2000, 'standing over');
    expect(st(host.room).match.winner).toBe(0);
    expect(host.events.some((e) => e.kind === 'over' && e.winner === 0)).toBe(true);
    // Solo runs never report outcomes to ratings/tournaments.
    expect(outcomes.filter((o) => o.game === 'paddle')).toHaveLength(0);
    // Retry → a brand new game.
    host.room.send(CLASSICS_MSG.start, {});
    await waitFor(() => st(host.room).standings.get(me)?.status === 'playing', 3000, 'retry');
    expect(match(host.server).sides[0].score).toBe(0);
    expect(st(host.room).match.matchId).toBe(2);
  });

  it('pauses and resumes a solo game (network games refuse to pause)', async () => {
    const host = await create('Solo', { solo: true });
    await waitFor(() => st(host.room).standings.get(host.me().playerId)?.status === 'ready', 3000, 'ready');
    host.room.send(CLASSICS_MSG.start, {});
    await waitFor(() => Boolean(match(host.server)), 2000, 'match');
    await sleep(1600);
    host.room.send(PADDLE_MSG.pause, { paused: true });
    await waitFor(() => st(host.room).match.paused === true, 2000, 'paused');
    const tick = match(host.server).tick;
    await sleep(300);
    expect(match(host.server).tick).toBe(tick);
    host.room.send(PADDLE_MSG.pause, { paused: false });
    await waitFor(() => match(host.server).tick > tick, 3000, 'resumed');

    const duel = await create('Duel');
    duel.room.send('lobby:start', {});
    await waitFor(() => st(duel.room).phase === 'PLAYING', 3000, 'duel playing');
    duel.room.send(PADDLE_MSG.pause, { paused: true });
    await waitFor(() => duel.errors.some((e) => e.type === PADDLE_MSG.pause && e.code === 'not_allowed'), 2000, 'refused');
    expect(st(duel.room).match.paused).toBe(false);
  });
});

describe('PaddleRoom — network duel', () => {
  it('plays a 1v1 to completion with input bots and reports the outcome', async () => {
    const host = await create('Ace');
    const guest = await join(host.room.roomId, 'Rook');
    const spectator = await join(host.room.roomId, 'Watcher', { spectator: true });
    await settle(host, { target: 3, winBy2: false, speed: 'turbo' });
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING', 4000, 'playing');
    const hostId = host.me().playerId;
    const guestId = guest.me().playerId;
    const leftId = st(host.room).left.playerId;
    expect([hostId, guestId]).toContain(leftId);
    expect(st(host.room).left.ai).toBe(false);
    expect(st(host.room).right.ai).toBe(false);
    const hostSide = leftId === hostId ? 0 : 1;
    // Host tracks the ball perfectly; the guest parks in a corner.
    const stopA = bot(host, (s) => (s ? s.ball.y : 450));
    const stopB = bot(guest, (s) => (s && s.ball.y < 450 ? 880 : 20));
    // Spectators may watch but never steer.
    spectator.room.send(PADDLE_MSG.input, { y: 0, serve: true });
    try {
      await waitFor(() => st(host.room).phase === 'RESULTS', 45_000, 'results');
    } finally {
      stopA();
      stopB();
    }
    const m = st(host.room).match;
    expect(m.winner).toBe(hostSide);
    expect(m.reason).toBe('score');
    expect(hostSide === 0 ? st(host.room).left.score : st(host.room).right.score).toBe(3);
    const out = outcomes.find((o) => o.game === 'paddle')!;
    expect(out.outcome.placements).toEqual([[hostId], [guestId]]);
    expect(host.verdicts.at(-1)!.score).toBe(3);
    expect(spectator.snaps.length).toBeGreaterThan(10);
    expect(spectator.errors.filter((e) => e.type === PADDLE_MSG.input)).toEqual([]);
    // Verdicts are private: each player gets only their own, spectators none.
    expect(spectator.verdicts).toEqual([]);
    const guestSide = hostSide === 0 ? 'right' : 'left';
    expect(guest.verdicts.at(-1)!.score).toBe(st(host.room)[guestSide].score);
    expect(st(host.room).standings.get(hostId).rank).toBe(1);
  }, 60_000);

  it('a lone seated player duels the house paddle', async () => {
    const host = await create('Lonely');
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    expect(st(host.room).right.ai).toBe(true);
    expect(st(host.room).right.name).toMatch(/House/);
  });

  it('ignores malformed input and never lets a client teleport its paddle', async () => {
    const host = await create('Host');
    const guest = await join(host.room.roomId, 'Cheat');
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    await sleep(250);
    const side = st(host.room).left.playerId === guest.me().playerId ? 0 : 1;
    const m = match(host.server);
    const y0 = m.sides[side].y;
    for (const bad of [{ y: -5 }, { y: 1e9 }, { y: 'top' }, { y: Number.NaN }, null, 'x'.repeat(5000), { y: 100, rtt: -1 }]) guest.room.send(PADDLE_MSG.input, bad);
    await sleep(120);
    expect(m.sides[side].target).toBe(y0);
    guest.room.send(PADDLE_MSG.input, { y: 0, x: 5, score: 99 });
    await sleep(40);
    // One tick later the paddle has moved at most the speed cap.
    const t0 = m.tick;
    const before = m.sides[side].y;
    await waitFor(() => m.tick >= t0 + 1, 1000, 'tick');
    expect(before - m.sides[side].y).toBeLessThanOrEqual(PADDLE.paddleSpeed * (m.tick - t0) + 1e-6);
    expect(m.sides[side].score).toBe(0);
    expect(guest.room.connection.isOpen).toBe(true);
  });

  it('caps the round trip a client claims by the server’s own measurement (ping frames)', async () => {
    const host = await create('Host');
    const guest = await join(host.room.roomId, 'Laggy');
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const server = host.server as any;
    const id = guest.me().playerId;
    await waitFor(() => server.rttProbe.rtt(id) !== null, 3000, 'server-measured rtt');
    const measured = server.rttProbe.rtt(id) as number;
    expect(measured).toBeLessThan(200);
    // A modified client claims 2 s of latency to get the longest paddle history: it gets what the server measured.
    guest.room.send(PADDLE_MSG.input, { y: 450, rtt: 2000 });
    await waitFor(() => server.sideInputs.get(id) !== undefined, 2000, 'input');
    // (Uncapped, 2000 ms would be 61 ticks — the engine's 7-tick maximum.)
    expect(server.sideInputs.get(id).lag).toBeLessThanOrEqual(3);
    // A lower honest estimate is kept as is.
    guest.room.send(PADDLE_MSG.input, { y: 450, rtt: 0 });
    await waitFor(() => server.sideInputs.get(id).lag === 1, 2000, 'honest estimate');
  });

  it('covers a dropped player with the house paddle, and hands control back on reconnect', async () => {
    const host = await create('Host');
    const guest = await join(host.room.roomId, 'Flaky');
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const guestSide = st(host.room).left.playerId === guest.me().playerId ? 'left' : 'right';
    guest.room.reconnection.minUptime = 0;
    guest.room.reconnection.delay = 500;
    guest.room.reconnection.minDelay = 500;
    guest.room.reconnection.maxDelay = 500;
    const back = new Promise<void>((r) => guest.room.onReconnect(() => r()));
    (guest.room as any).connection.transport.ws.close(4010);
    await waitFor(() => st(host.room)[guestSide].ai === true, 3000, 'house covers');
    await back;
    await waitFor(() => st(host.room)[guestSide].ai === false, 3000, 'control back');
    expect(st(host.room).phase).toBe('PLAYING');
  });

  it('leaving mid-game forfeits: the opponent wins at once', async () => {
    const host = await create('Stayer');
    const guest = await join(host.room.roomId, 'Leaver');
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    await sleep(200);
    const guestId = guest.me().playerId;
    await guest.room.leave(true);
    await waitFor(() => st(host.room).phase === 'RESULTS', 5000, 'results');
    expect(st(host.room).match.reason).toBe('forfeit');
    const out = outcomes.find((o) => o.game === 'paddle')!;
    expect(out.outcome.placements).toEqual([[host.me().playerId], [guestId]]);
    // Rematch is host-only and restarts right away.
    host.room.send(CLASSICS_MSG.rematch, {});
    await waitFor(() => st(host.room).phase === 'COUNTDOWN' || st(host.room).phase === 'PLAYING', 3000, 'rematch');
  });

  it('tournament games use the fixed format, seat the "first" side on the left and refuse casual rematches', async () => {
    const host = await create('Host');
    const guest = await join(host.room.roomId, 'Guest');
    await settle(host, { target: 3, winBy2: false, speed: 'turbo' });
    const hostId = host.me().playerId;
    const guestId = guest.me().playerId;
    // Test-only: bind the room to a (fake) Tournament Center match.
    (host.server as any).tournamentInfo = {
      tournamentCode: 'T1',
      tournamentName: 'Office Cup',
      matchId: 'm1',
      roundLabel: 'Final',
      bestOf: 3,
      gameNumber: 1,
      seriesScore: {},
      participants: [
        { participantId: 'pa', name: 'Host', seed: 1, playerId: hostId, side: 'second' },
        { participantId: 'pb', name: 'Guest', seed: 2, playerId: guestId, side: 'first' },
      ],
    };
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    expect(st(host.room).left.playerId).toBe(guestId);
    expect(st(host.room).match.target).toBe(7);
    expect(st(host.room).match.winBy2).toBe(true);
    expect(st(host.room).match.speed).toBe('classic');
    expect(st(host.room).match.server).toBe(0);
    // Fast-forward to 6–0 for the 'first' player and let the ball through.
    const m = match(host.server);
    m.sides[0].score = 6;
    m.status = 'play';
    m.ball.x = FACE_X[1] - 40;
    m.ball.y = m.sides[1].y > 450 ? 60 : 840;
    m.ball.vx = 30;
    m.ball.vy = 0;
    m.ball.speed = 30;
    await waitFor(() => st(host.room).phase === 'RESULTS', 8000, 'results');
    const out = outcomes.find((o) => o.game === 'paddle')!;
    expect(out.outcome.placements).toEqual([[guestId], [hostId]]);
    host.room.send(CLASSICS_MSG.rematch, {});
    await waitFor(() => host.errors.some((e) => e.type === CLASSICS_MSG.rematch && e.code === 'not_allowed'), 2000, 'rematch refused');
  });
});
