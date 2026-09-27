import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, WelcomePayload } from '@dascade/shared';
import type { BoardEvent } from '@dascade/shared/games/boardroom';
import type { CheckersMoveEvent, CheckersPublicState } from '@dascade/shared/games/checkers';
import { INITIAL_BOARD, fromFen, newGame, FORTY_MOVE_PLIES } from '@dascade/game-core/checkers';
import { onOutcome, type OutcomeContext } from '../src/platform/hub.ts';
import type { CheckersRoom } from '../src/rooms/checkers/CheckersRoom.ts';
import { bootTestServer, collect, quiet, sleep, waitFor } from './helpers.ts';

let colyseus: ColyseusTestServer;
const outcomes: Array<{ outcome: GameOutcome; ctx: OutcomeContext }> = [];
let unsubscribe: () => void = () => undefined;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['checkers']));
  unsubscribe = onOutcome((outcome, ctx) => {
    if (ctx.gameId === 'checkers') outcomes.push({ outcome, ctx });
  });
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  unsubscribe();
  await colyseus.shutdown();
});

interface Client {
  room: SdkRoom;
  errors: Array<{ type?: string; code: string; message: string }>;
  moves: CheckersMoveEvent[];
  events: BoardEvent[];
  me: () => WelcomePayload;
}

function wire(room: SdkRoom): Client {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<{ type?: string; code: string; message: string }>(room, 'sys:error');
  const moves = collect<CheckersMoveEvent>(room, 'checkers:moved');
  const events = collect<BoardEvent>(room, 'checkers:boardEvent');
  quiet(room);
  return { room, errors, moves, events, me: () => welcomes[welcomes.length - 1]! };
}

async function ready(c: Client): Promise<Client> {
  await c.room.waitForInitialState();
  await waitFor(() => Boolean(c.me()), 3000, 'welcome');
  return c;
}

const st = (c: Client) => (c.room.state as any).toJSON() as CheckersPublicState;
const serverOf = (c: Client) => colyseus.getRoomById(c.room.roomId) as unknown as CheckersRoom;

async function createRoom(settings: Record<string, unknown> = {}) {
  const host = await ready(wire(await colyseus.sdk.create('checkers', { name: 'Ada', settings: { timeControl: { baseMinutes: 0, incrementSeconds: 0 }, ...settings } })));
  const server = serverOf(host);
  (server as any).countdownMs = 0;
  return { host, server };
}

async function join(code: string, name: string, extra: Record<string, unknown> = {}) {
  return ready(wire(await colyseus.sdk.joinById(code, { name, ...extra })));
}

/** Creates a room with two players and starts the game. Returns them as dark/light. */
async function startGame(settings: Record<string, unknown> = {}, before?: (server: CheckersRoom) => void) {
  const { host, server } = await createRoom(settings);
  const guest = await join(host.room.roomId, 'Bo');
  before?.(server);
  host.room.send('lobby:start', {});
  await waitFor(() => st(host).phase === 'PLAYING' && st(guest).phase === 'PLAYING', 4000, 'playing');
  await waitFor(() => st(host).seats.every((s) => s.playerId), 3000, 'seats');
  const firstId = st(host).seats[0]!.playerId;
  const dark = host.me().playerId === firstId ? host : guest;
  const light = dark === host ? guest : host;
  return { host, guest, dark, light, server };
}

/** Replace the live position (tests only) — dark to move at ply 0. */
function setPosition(server: CheckersRoom, fen: string, extra: Partial<ReturnType<typeof newGame>> = {}) {
  (server as any).records = [{ ...newGame(fromFen(fen)), ...extra }];
  (server as any).publish();
}

async function move(c: Client, path: number[], expectAccepted = true) {
  const ply = st(c).ply;
  const errors = c.errors.length;
  c.room.send('checkers:move', { path, ply });
  if (expectAccepted) await waitFor(() => st(c).ply > ply || st(c).result.over, 3000, `move ${path.join('-')}`);
  else await waitFor(() => c.errors.length > errors, 3000, `rejection of ${path.join('-')}`);
}

const lastError = (c: Client) => c.errors[c.errors.length - 1]!;
const outcomesFor = (c: Client) => outcomes.filter((o) => o.ctx.roomCode === c.room.roomId);

/** Refill every player's rate-limit buckets (tests that fire many rejected messages back to back). */
function calm(server: CheckersRoom) {
  for (const p of (server as any).players.values()) p.buckets.clear();
}

describe('DAS Checkers room', () => {
  it('starts from the standard position with Dark (first side) to move', async () => {
    const { host, dark, light } = await startGame();
    const s = st(host);
    expect(s.board).toBe(INITIAL_BOARD);
    expect(s.turn).toBe('first');
    expect(s.ply).toBe(0);
    expect(s.history).toEqual([]);
    expect(s.seats.map((seat) => seat.side)).toEqual(['first', 'second']);
    expect(new Set(s.seats.map((seat) => seat.playerId))).toEqual(new Set([dark.me().playerId, light.me().playerId]));
    expect(s.quietPlies).toBe(0);
    expect(s.repetitions).toBe(1);
  });

  it('plays legal moves for both sides and publishes board, history and last move', async () => {
    const { host, dark, light } = await startGame();
    await move(dark, [11, 15]);
    await move(light, [22, 18]);
    await move(dark, [15, 22]);
    await waitFor(() => st(host).ply === 3);
    const s = st(host);
    expect(s.history.map((h) => h.notation)).toEqual(['11-15', '22-18', '15x22']);
    expect(s.history[2]).toEqual({ notation: '15x22', captures: 1, crowned: false });
    expect(s.lastPath).toEqual([15, 22]);
    expect(s.lastCaptures).toEqual([18]);
    expect(s.board[17]).toBe('.'); // 18 captured
    expect(s.board[21]).toBe('d'); // dark man on 22
    expect(s.turn).toBe('second');
    // Everyone (spectators included) gets the move events for animation.
    await waitFor(() => host.moves.length === 3);
    expect(host.moves.map((m) => m.notation)).toEqual(['11-15', '22-18', '15x22']);
    expect(host.moves[2]).toMatchObject({ ply: 3, side: 'first', path: [15, 22], captures: [18], crowned: false });
  });

  it('enforces turns: out-of-turn moves and moving the opponent’s pieces are rejected', async () => {
    const { host, dark, light } = await startGame();
    await move(light, [22, 18], false);
    expect(lastError(light).code).toBe('not_your_turn');
    await move(dark, [22, 18], false); // Light's piece on Dark's turn
    expect(lastError(dark).code).toBe('not_allowed');
    expect(st(host).ply).toBe(0);
    expect(st(host).board).toBe(INITIAL_BOARD);
  });

  it('rejects illegal diagonals and malformed payloads', async () => {
    const { host, dark, server } = await startGame();
    for (const path of [
      [11, 18], // not adjacent
      [11, 12], // sideways
      [11, 7], // backwards / occupied
      [13, 17], // empty origin
      [11, 15, 19], // not a jump
    ]) {
      calm(server);
      await move(dark, path, false);
      expect(lastError(dark).code).toBe('not_allowed');
    }
    for (const bad of [{ path: [11] }, { path: [0, 15], ply: 0 }, { path: [11, 33], ply: 0 }, { path: 'x', ply: 0 }, { path: [11, 15], ply: -1 }, { path: [11, 15], ply: 0, extra: 1 }]) {
      calm(server);
      const n = dark.errors.length;
      dark.room.send('checkers:move', bad);
      await waitFor(() => dark.errors.length > n);
      expect(lastError(dark).code).toBe('invalid_payload');
    }
    calm(server);
    const n = dark.errors.length;
    dark.room.send('checkers:move', { path: Array.from({ length: 14 }, () => 1), ply: 0 });
    await waitFor(() => dark.errors.length > n);
    expect(lastError(dark).code).toBe('invalid_payload');
    expect(st(host).ply).toBe(0);
  });

  it('forces captures and explains why a quiet move was refused', async () => {
    const { host, dark, light } = await startGame();
    await move(dark, [11, 15]);
    await move(light, [22, 18]);
    await move(dark, [9, 13], false);
    expect(lastError(dark)).toMatchObject({ code: 'not_allowed', message: expect.stringMatching(/capture/i) });
    await move(dark, [15, 22]);
    expect(st(host).ply).toBe(3);
  });

  it('plays a whole multi-jump as one turn (full path or unambiguous shortcut) and refuses a partial chain', async () => {
    const { host, dark, server } = await startGame();
    setPosition(server, 'B:W10,19,32:B6');
    await waitFor(() => st(host).board === fromFen('B:W10,19,32:B6').board);
    await move(dark, [6, 15], false);
    expect(lastError(dark).code).toBe('not_allowed');
    await move(dark, [6, 24]);
    const s = st(host);
    expect(s.history.at(-1)).toEqual({ notation: '6x15x24', captures: 2, crowned: false });
    expect(s.lastPath).toEqual([6, 15, 24]);
    expect(s.lastCaptures).toEqual([10, 19]);
    expect(s.turn).toBe('second');
  });

  it('crowns a man on the far row and ends the move there', async () => {
    const { host, dark, server } = await startGame();
    setPosition(server, 'B:W26,27,5:B22');
    await move(dark, [22, 31]);
    const s = st(host);
    expect(s.board[30]).toBe('D');
    expect(s.board[26]).toBe('l'); // 27 survives: the chain stopped on crowning
    expect(s.history.at(-1)).toEqual({ notation: '22x31', captures: 1, crowned: true });
    expect(s.turn).toBe('second');
  });

  it('spectators cannot move, resign or offer draws', async () => {
    const { host, dark } = await startGame();
    const rail = await join(host.room.roomId, 'Rail', { spectator: true });
    for (const [type, payload] of [
      ['checkers:move', { path: [11, 15], ply: 0 }],
      ['checkers:resign', {}],
      ['checkers:draw', { action: 'offer' }],
    ] as const) {
      const n = rail.errors.length;
      rail.room.send(type, payload);
      await waitFor(() => rail.errors.length > n);
      expect(lastError(rail).code).toBe('not_allowed');
    }
    expect(st(host).ply).toBe(0);
    expect(st(host).result.over).toBe(false);
    // The spectator still sees the game.
    await move(dark, [11, 15]);
    await waitFor(() => st(rail).ply === 1 && rail.moves.length === 1);
  });

  it('ignores duplicate and stale submissions of the same move (idempotent)', async () => {
    const { host, dark, light } = await startGame();
    dark.room.send('checkers:move', { path: [11, 15], ply: 0 });
    dark.room.send('checkers:move', { path: [11, 15], ply: 0 });
    dark.room.send('checkers:move', { path: [11, 15], ply: 0 });
    await waitFor(() => st(host).ply === 1);
    await sleep(150);
    expect(st(host).ply).toBe(1);
    expect(st(host).history).toHaveLength(1);
    expect(dark.errors.some((e) => e.code === 'not_your_turn')).toBe(true);
    // A stale ply from Light (it saw ply 0) is refused even on its turn.
    const n = light.errors.length;
    light.room.send('checkers:move', { path: [22, 18], ply: 0 });
    await waitFor(() => light.errors.length > n);
    expect(lastError(light).code).toBe('not_allowed');
    expect(st(host).ply).toBe(1);
  });

  it('wins by capturing the last piece and reports the outcome once', async () => {
    const { host, dark, light, server } = await startGame();
    setPosition(server, 'B:W18:B15');
    await move(dark, [15, 22]);
    await waitFor(() => st(host).phase === 'RESULTS');
    const s = st(host);
    expect(s.result).toMatchObject({ over: true, winner: 'first', reason: 'no_pieces' });
    expect(s.result.text).toBe('Dark wins — Light has no pieces left');
    await waitFor(() => outcomesFor(host).length === 1, 3000, 'outcome');
    const { outcome } = outcomesFor(host)[0]!;
    expect(outcome.placements).toEqual([[dark.me().playerId], [light.me().playerId]]);
    expect(outcome.reason).toBe('no_pieces');
    expect(outcome.details).toMatchObject({ winnerSide: 'first', plies: 1, moves: '15x22' });
    expect((outcome.details as any).playerStats[dark.me().playerId]).toEqual({ kings: 0, captures: 1 });
    await sleep(150);
    expect(outcomesFor(host)).toHaveLength(1);
  });

  it('wins when the opponent is left without a legal move', async () => {
    const { host, dark, server } = await startGame();
    setPosition(server, 'B:W5:B1,K32');
    await move(dark, [32, 28]);
    await waitFor(() => st(host).phase === 'RESULTS');
    expect(st(host).result).toMatchObject({ winner: 'first', reason: 'no_moves', text: 'Dark wins — Light has no legal move' });
  });

  it('draws automatically under the 40-move rule and by threefold repetition', async () => {
    const { host, dark, server } = await startGame();
    setPosition(server, 'B:WK32:BK1', { quietPlies: FORTY_MOVE_PLIES - 1 });
    await move(dark, [1, 6]);
    await waitFor(() => st(host).phase === 'RESULTS');
    expect(st(host).result).toMatchObject({ winner: 'draw', reason: 'forty_moves' });
    await waitFor(() => outcomesFor(host).length === 1, 3000, 'outcome');
    expect(outcomesFor(host)[0]!.outcome.placements).toEqual([[st(host).seats[0]!.playerId, st(host).seats[1]!.playerId]]);

    const second = await startGame();
    setPosition(second.server, 'B:WK32:BK1');
    for (let i = 0; i < 2; i++) {
      await move(second.dark, [1, 5]);
      await move(second.light, [32, 28]);
      await move(second.dark, [5, 1]);
      await move(second.light, [28, 32]);
    }
    await waitFor(() => st(second.host).phase === 'RESULTS');
    expect(st(second.host).result).toMatchObject({ winner: 'draw', reason: 'repetition', text: 'Draw by threefold repetition' });
  });

  it('resigns and agrees draws through the kit', async () => {
    const { host, dark, light } = await startGame();
    await move(dark, [11, 15]);
    light.room.send('checkers:resign', {});
    await waitFor(() => st(host).phase === 'RESULTS');
    expect(st(host).result).toMatchObject({ winner: 'first', reason: 'resign' });

    const g = await startGame();
    await move(g.dark, [11, 15]);
    g.dark.room.send('checkers:draw', { action: 'offer' });
    await waitFor(() => st(g.host).offers.drawBy === 'first');
    g.light.room.send('checkers:draw', { action: 'accept' });
    await waitFor(() => st(g.host).phase === 'RESULTS');
    expect(st(g.host).result).toMatchObject({ winner: 'draw', reason: 'agreement' });
  });

  it('flags a player who runs out of time on the server clock', async () => {
    const { host, server } = await startGame({}, (s) => {
      s.clockOverride = { baseMs: 400, incrementMs: 0 };
    });
    expect(server).toBeTruthy();
    await waitFor(() => st(host).phase === 'RESULTS', 4000, 'flag');
    expect(st(host).result).toMatchObject({ winner: 'second', reason: 'timeout', text: 'Light wins on time' });
  });

  it('takes back a move when the opponent accepts (casual rooms)', async () => {
    const { host, dark, light } = await startGame();
    expect(st(host).undoAllowed).toBe(true);
    await move(dark, [11, 15]);
    dark.room.send('checkers:undo', { action: 'offer' });
    await waitFor(() => st(host).offers.undoBy === 'first');
    light.room.send('checkers:undo', { action: 'accept' });
    await waitFor(() => st(host).ply === 0);
    const s = st(host);
    expect(s.board).toBe(INITIAL_BOARD);
    expect(s.history).toEqual([]);
    expect(s.lastPath).toEqual([]);
    expect(s.turn).toBe('first');
    await move(dark, [9, 14]);
    expect(st(host).history.map((h) => h.notation)).toEqual(['9-14']);
  });

  it('keeps a bounded take-back stack and still takes back two plies deep into a game', async () => {
    const { host, dark, light, server } = await startGame();
    const line = [[11, 15], [22, 18], [15, 22], [25, 18], [12, 16], [18, 14], [9, 18], [23, 14]];
    for (let i = 0; i < line.length; i++) await move(i % 2 === 0 ? dark : light, line[i]!);
    await waitFor(() => st(host).ply === 8);
    expect((server as any).records.length).toBeLessThanOrEqual(4);
    const boardAfter6 = st(host).history.slice(0, 6).map((h) => h.notation);
    // Dark (to move) asks: its last move and Light's reply are taken back (2 plies).
    dark.room.send('checkers:undo', { action: 'offer' });
    await waitFor(() => st(host).offers.undoBy === 'first');
    expect(st(host).offers.undoPlies).toBe(2);
    light.room.send('checkers:undo', { action: 'accept' });
    await waitFor(() => st(host).ply === 6);
    expect(st(host).history.map((h) => h.notation)).toEqual(boardAfter6);
    expect(st(host).turn).toBe('first');
    // Captures are still mandatory in the restored position: a quiet move is refused, a jump is played.
    await move(dark, [10, 15], false);
    await move(dark, [10, 17]);
    expect(st(host).history.at(-1)!.notation).toBe('10x17');
  });

  it('takes back again and again past the kept records (the position is replayed, draw counters included)', async () => {
    const { host, dark, light } = await startGame();
    const line = [[11, 15], [22, 18], [15, 22], [25, 18], [12, 16], [18, 14], [9, 18], [23, 14]];
    for (let i = 0; i < line.length; i++) await move(i % 2 === 0 ? dark : light, line[i]!);
    await waitFor(() => st(host).ply === 8);
    const notations = st(host).history.map((h) => h.notation);
    const takeBack = async (to: number) => {
      dark.room.send('checkers:undo', { action: 'offer' });
      await waitFor(() => st(host).offers.undoBy === 'first', 3000, 'undo offered');
      light.room.send('checkers:undo', { action: 'accept' });
      await waitFor(() => st(host).ply === to, 3000, `take back to ply ${to}`);
    };
    await takeBack(6);
    await takeBack(4);
    await takeBack(2);
    expect(light.errors.filter((e) => /no longer be taken back/.test(e.message))).toEqual([]);
    const s = st(host);
    expect(s.history.map((h) => h.notation)).toEqual(notations.slice(0, 2));
    expect(s.lastPath).toEqual([22, 18]);
    expect(s.turn).toBe('first');
    // The replayed record is a real game: Dark must capture 15x22 again, and play continues.
    await move(dark, [15, 22]);
    expect(st(host).history.map((h) => h.notation)).toEqual(notations.slice(0, 3));
  });

  it('starts a rematch with colours swapped when both players ask', async () => {
    const { host, dark, light } = await startGame();
    const darkId = dark.me().playerId;
    dark.room.send('checkers:resign', {});
    await waitFor(() => st(host).phase === 'RESULTS');
    dark.room.send('checkers:rematch', { action: 'offer' });
    await waitFor(() => st(host).offers.rematch.length === 1);
    light.room.send('checkers:rematch', { action: 'accept' });
    await waitFor(() => st(host).gameNumber === 2 && st(host).phase !== 'RESULTS', 4000, 'rematch');
    await waitFor(() => st(host).phase === 'PLAYING', 6000, 'rematch playing');
    const s = st(host);
    expect(s.seats[1]!.playerId).toBe(darkId); // the old Dark now plays Light
    expect(s.board).toBe(INITIAL_BOARD);
    expect(s.history).toEqual([]);
    expect(s.result.over).toBe(false);
  });

  it('forfeits a player who leaves mid-game', async () => {
    const { dark, light } = await startGame();
    const lightId = light.me().playerId;
    await move(dark, [11, 15]);
    await light.room.leave(true);
    await waitFor(() => st(dark).phase === 'RESULTS', 3000, 'forfeit');
    expect(st(dark).result).toMatchObject({ winner: 'first', reason: 'forfeit' });
    await waitFor(() => outcomesFor(dark).length === 1, 3000, 'outcome');
    expect(outcomesFor(dark)[0]!.outcome.placements).toEqual([[dark.me().playerId], [lightId]]);
  });

  it('keeps the game through a reconnect and restores the seat', async () => {
    const { dark, light } = await startGame();
    await move(dark, [11, 15]);
    const lightId = light.me().playerId;
    light.room.reconnection.minUptime = 0;
    light.room.reconnection.delay = 300;
    light.room.reconnection.minDelay = 300;
    light.room.reconnection.maxDelay = 300;
    const reconnected = new Promise<void>((r) => light.room.onReconnect(() => r()));
    (light.room as any).connection.transport.ws.close(4010);
    // Observe from Dark: the dropped client's own state is frozen while it is offline.
    await waitFor(() => st(dark).players[lightId]?.connected === false, 3000, 'dropped');
    await waitFor(() => st(dark).seats[1]!.awayDeadline > Date.now(), 3000, 'away deadline');
    await reconnected;
    await waitFor(() => st(dark).players[lightId]?.connected === true, 3000, 'reconnected');
    await waitFor(() => st(dark).seats.every((s) => s.awayDeadline === 0), 3000, 'deadline cleared');
    await waitFor(() => st(light).ply === 1, 3000, 'light resynced');
    expect(st(light).board).toBe(st(dark).board);
    expect(st(light).seats[1]!.playerId).toBe(lightId);
    await move(light, [22, 18]);
    await waitFor(() => st(dark).ply === 2, 3000, 'light moved');
    expect(st(dark).history.map((h) => h.notation)).toEqual(['11-15', '22-18']);
  });

  it('awards the game to the opponent when a player stays away past the grace period', async () => {
    const { dark, light, server } = await startGame();
    (server as any).reconnectGraceSeconds = 0.3;
    await move(dark, [11, 15]);
    light.room.reconnection.enabled = false;
    (light.room as any).connection.transport.ws.close(4010);
    await waitFor(() => st(dark).phase === 'RESULTS', 4000, 'abandonment');
    expect(st(dark).result).toMatchObject({ winner: 'first', reason: 'abandoned' });
    await waitFor(() => outcomesFor(dark).length === 1, 3000, 'outcome');
    expect(outcomesFor(dark)[0]!.outcome.placements).toEqual([[dark.me().playerId], [light.me().playerId]]);
  });

  it('follows tournament sides and disables take-backs in tournament matches', async () => {
    const { host, server } = await createRoom();
    const guest = await join(host.room.roomId, 'Bo');
    (server as any).tournamentInfo = {
      tournamentCode: 'TTTTT',
      tournamentName: 'Cup',
      matchId: 'm1',
      roundLabel: 'Final',
      bestOf: 1,
      gameNumber: 1,
      seriesScore: {},
      participants: [
        { participantId: 'a', name: 'Ada', seed: 1, playerId: host.me().playerId, side: 'second' },
        { participantId: 'b', name: 'Bo', seed: 2, playerId: guest.me().playerId, side: 'first' },
      ],
    };
    host.room.send('lobby:start', {});
    await waitFor(() => st(host).phase === 'PLAYING');
    expect(st(host).seats[0]!.playerId).toBe(guest.me().playerId);
    expect(st(host).seats[1]!.playerId).toBe(host.me().playerId);
    expect(st(host).undoAllowed).toBe(false);
  });
});
