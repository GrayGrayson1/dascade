import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, WelcomePayload } from '@dascade/shared';
import type { BoardEvent } from '@dascade/shared/games/boardroom';
import type { TicTacToePublicState, TttMoveEvent, TttMovePayload } from '@dascade/shared/games/tictactoe';
import { onOutcome, type OutcomeContext } from '../src/platform/hub.ts';
import type { TicTacToeRoom } from '../src/rooms/tictactoe/TicTacToeRoom.ts';
import { bootTestServer, collect, quiet, sleep, waitFor } from './helpers.ts';

let colyseus: ColyseusTestServer;
const outcomes: Array<{ outcome: GameOutcome; ctx: OutcomeContext }> = [];
let unsubscribe: () => void = () => undefined;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['tictactoe']));
  unsubscribe = onOutcome((outcome, ctx) => {
    if (ctx.gameId === 'tictactoe') outcomes.push({ outcome, ctx });
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
  moves: TttMoveEvent[];
  events: BoardEvent[];
  me: () => WelcomePayload;
}

function wire(room: SdkRoom): Client {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<{ type?: string; code: string; message: string }>(room, 'sys:error');
  const moves = collect<TttMoveEvent>(room, 'tictactoe:moved');
  const events = collect<BoardEvent>(room, 'tictactoe:boardEvent');
  quiet(room);
  return { room, errors, moves, events, me: () => welcomes[welcomes.length - 1]! };
}

async function ready(c: Client): Promise<Client> {
  await c.room.waitForInitialState();
  await waitFor(() => Boolean(c.me()), 3000, 'welcome');
  return c;
}

const st = (c: Client) => (c.room.state as any).toJSON() as TicTacToePublicState;
const settingsOf = (c: Client) => JSON.parse((c.room.state as any).settingsJson) as Record<string, unknown>;
const serverOf = (c: Client) => colyseus.getRoomById(c.room.roomId) as unknown as TicTacToeRoom;

async function createRoom(settings: Record<string, unknown> = {}) {
  const host = await ready(wire(await colyseus.sdk.create('tictactoe', { name: 'Ada', settings })));
  const server = serverOf(host);
  (server as any).countdownMs = 0;
  return { host, server };
}

async function join(code: string, name: string, extra: Record<string, unknown> = {}) {
  return ready(wire(await colyseus.sdk.joinById(code, { name, ...extra })));
}

async function begin(host: Client, guest: Client) {
  host.room.send('lobby:start', {});
  await waitFor(() => st(host).phase === 'PLAYING' && st(guest).phase === 'PLAYING', 4000, 'playing');
  await waitFor(() => st(host).seats.every((s) => s.playerId), 3000, 'seats');
  const firstId = st(host).seats[0]!.playerId;
  const x = host.me().playerId === firstId ? host : guest;
  const o = x === host ? guest : host;
  return { x, o };
}

/** Creates a room with two players and starts the game. Returns them as x (first) / o (second). */
async function startGame(settings: Record<string, unknown> = {}) {
  const { host, server } = await createRoom(settings);
  const guest = await join(host.room.roomId, 'Bo');
  const { x, o } = await begin(host, guest);
  return { host, guest, x, o, server };
}

async function move(c: Client, payload: Omit<TttMovePayload, 'ply'>, expectAccepted = true) {
  const ply = st(c).ply;
  const errors = c.errors.length;
  c.room.send('tictactoe:move', { ...payload, ply });
  if (expectAccepted) await waitFor(() => st(c).ply > ply || st(c).result.over, 3000, `move ${JSON.stringify(payload)}`);
  else await waitFor(() => c.errors.length > errors, 3000, `rejection of ${JSON.stringify(payload)}`);
}

/** Alternate moves between the two players, X first (from the current turn). */
async function playCells(x: Client, o: Client, list: number[]) {
  for (const cell of list) {
    const mover = st(x).turn === 'first' ? x : o;
    await move(mover, { cell });
  }
}

const lastError = (c: Client) => c.errors[c.errors.length - 1]!;
const outcomesFor = (c: Client) => outcomes.filter((o) => o.ctx.roomCode === c.room.roomId);

/** Refill every player's rate-limit buckets (tests that fire many rejected messages back to back). */
function calm(server: TicTacToeRoom) {
  for (const p of (server as any).players.values()) p.buckets.clear();
}

describe('DAS Tic-Tac-Toe room', () => {
  it('opens on Classic, untimed, with X (first side) to move on an empty 3×3 board', async () => {
    const { host, x, o } = await startGame();
    const s = st(host);
    expect(s.variant).toBe('classic');
    expect(s.cells).toEqual(Array(9).fill(''));
    expect(s.boards).toBe('');
    expect(s.active).toBe(-1);
    expect(s.hands).toEqual([]);
    expect(s.fading).toEqual([]);
    expect(s.winLine).toEqual([]);
    expect(s.lastCell).toBe(-1);
    expect(s.turn).toBe('first');
    expect(s.clock.enabled).toBe(false);
    expect(s.rated).toBe(false);
    expect(new Set(s.seats.map((seat) => seat.playerId))).toEqual(new Set([x.me().playerId, o.me().playerId]));
  });

  it('plays a Classic game to three in a row and reports the outcome once', async () => {
    const { host, x, o } = await startGame();
    await playCells(x, o, [0, 3, 1, 4, 2]);
    await waitFor(() => st(host).phase === 'RESULTS');
    const s = st(host);
    expect(s.result).toMatchObject({ over: true, winner: 'first', reason: 'line', text: 'X wins — three in a row' });
    expect(s.winLine).toEqual([0, 1, 2]);
    expect(s.cells).toEqual(['x', 'x', 'x', 'o', 'o', '', '', '', '']);
    expect(s.history.map((h) => h.notation)).toEqual(['a3', 'a2', 'b3', 'b2', 'c3']);
    expect(s.lastCell).toBe(2);
    await waitFor(() => host.moves.length === 5);
    expect(host.moves[4]).toMatchObject({
      ply: 5,
      side: 'first',
      notation: 'c3',
      cell: 2,
      from: -1,
      removed: -1,
      board: -1,
      line: [0, 1, 2],
    });
    expect(host.moves[0]!.line).toEqual([]);
    await waitFor(() => outcomesFor(host).length === 1, 3000, 'outcome');
    const { outcome } = outcomesFor(host)[0]!;
    expect(outcome.placements).toEqual([[x.me().playerId], [o.me().playerId]]);
    expect(outcome.reason).toBe('line');
    expect(outcome.details).toMatchObject({ winnerSide: 'first', plies: 5, variant: 'classic', moves: 'a3 a2 b3 b2 c3' });
    await sleep(150);
    expect(outcomesFor(host)).toHaveLength(1);
  });

  it('draws on a full board', async () => {
    const { host, x, o } = await startGame();
    await playCells(x, o, [0, 1, 2, 4, 3, 5, 7, 6, 8]);
    await waitFor(() => st(host).phase === 'RESULTS');
    expect(st(host).result).toMatchObject({ winner: 'draw', reason: 'full', text: 'Draw — the board is full' });
    expect(st(host).winLine).toEqual([]);
    await waitFor(() => outcomesFor(host).length === 1, 3000, 'outcome');
    expect(outcomesFor(host)[0]!.outcome.placements).toEqual([[st(host).seats[0]!.playerId, st(host).seats[1]!.playerId]]);
  });

  it('enforces turns and refuses taken squares with a reason', async () => {
    const { host, x, o, server } = await startGame();
    await move(o, { cell: 4 }, false);
    expect(lastError(o).code).toBe('not_your_turn');
    await move(x, { cell: 4 });
    calm(server);
    await move(o, { cell: 4 }, false);
    expect(lastError(o)).toMatchObject({ code: 'not_allowed', message: 'That square is taken.' });
    calm(server);
    await move(o, { cell: 9 }, false);
    expect(lastError(o)).toMatchObject({ code: 'not_allowed', message: 'That square is not on this board.' });
    expect(st(host).ply).toBe(1);
  });

  it('rejects malformed payloads', async () => {
    const { host, x, server } = await startGame();
    for (const bad of [
      { cell: 225, ply: 0 },
      { cell: -1, ply: 0 },
      { cell: 1.5, ply: 0 },
      { cell: 0 },
      { cell: 0, ply: 0, mark: 'z' },
      { cell: 0, ply: 0, num: 10 },
      { cell: 0, ply: 0, size: 4 },
      { cell: 0, ply: 0, extra: true },
      { cell: '0', ply: 0 },
    ]) {
      calm(server);
      const n = x.errors.length;
      x.room.send('tictactoe:move', bad);
      await waitFor(() => x.errors.length > n);
      expect(lastError(x).code).toBe('invalid_payload');
    }
    expect(st(host).ply).toBe(0);
  });

  it('ignores duplicate and stale submissions of the same move', async () => {
    const { host, x, o } = await startGame();
    for (let i = 0; i < 3; i++) x.room.send('tictactoe:move', { cell: 0, ply: 0 });
    await waitFor(() => st(host).ply === 1);
    await sleep(150);
    expect(st(host).ply).toBe(1);
    expect(st(host).history).toHaveLength(1);
    expect(x.errors.some((e) => e.code === 'not_your_turn')).toBe(true);
    const n = o.errors.length;
    o.room.send('tictactoe:move', { cell: 4, ply: 0 });
    await waitFor(() => o.errors.length > n);
    expect(lastError(o).code).toBe('not_allowed');
    expect(st(host).ply).toBe(1);
  });

  it('spectators cannot move, resign or offer draws, but see every move', async () => {
    const { host, x } = await startGame();
    const rail = await join(host.room.roomId, 'Rail', { spectator: true });
    for (const [type, payload] of [
      ['tictactoe:move', { cell: 4, ply: 0 }],
      ['tictactoe:resign', {}],
      ['tictactoe:draw', { action: 'offer' }],
    ] as const) {
      const n = rail.errors.length;
      rail.room.send(type, payload);
      await waitFor(() => rail.errors.length > n);
      expect(lastError(rail).code).toBe('not_allowed');
    }
    expect(st(host).ply).toBe(0);
    await move(x, { cell: 4 });
    await waitFor(() => st(rail).ply === 1 && rail.moves.length === 1);
    expect(st(rail).cells[4]).toBe('x');
  });

  it('follows the lobby variant and refuses an unknown one', async () => {
    const { host, server } = await createRoom();
    host.room.send('lobby:settings', { settings: { variant: 'ultimate' } });
    await waitFor(() => st(host).variant === 'ultimate', 3000, 'variant');
    expect(st(host).cells).toHaveLength(81);
    expect(st(host).boards).toBe('.........');
    calm(server);
    const n = host.errors.length;
    host.room.send('lobby:settings', { settings: { variant: 'chess' } });
    await waitFor(() => host.errors.length > n);
    expect(lastError(host).code).toBe('invalid_payload');
    expect(settingsOf(host).variant).toBe('ultimate');
    expect(st(host).variant).toBe('ultimate');
    host.room.send('lobby:settings', { settings: { variant: 'gomoku' } });
    await waitFor(() => st(host).cells.length === 225, 3000, 'gomoku board');
  });

  it('Ultimate: sends the opponent to the matching small board', async () => {
    const { host, x, o, server } = await startGame({ variant: 'ultimate' });
    await move(x, { cell: 4 }); // board 0, centre → O plays in board 4
    expect(st(host).active).toBe(4);
    await move(o, { cell: 0 }, false);
    expect(lastError(o)).toMatchObject({ code: 'not_allowed', message: 'Play in the highlighted board.' });
    calm(server);
    await move(o, { cell: 36 });
    expect(st(host).active).toBe(0);
    expect(st(host).history.map((h) => h.notation)).toEqual(['b8', 'd6']);
  });

  it('Gravity: drops the mark to the bottom of the column', async () => {
    const { host, x, o, server } = await startGame({ variant: 'gravity' });
    await move(x, { cell: 3 });
    await move(o, { cell: 10 }); // any cell of column 3
    const s = st(host);
    expect(s.cells[38]).toBe('x');
    expect(s.cells[31]).toBe('o');
    expect(s.lastCell).toBe(31);
    expect(s.history.map((h) => h.notation)).toEqual(['d1', 'd2']);
    await waitFor(() => host.moves.length === 2);
    expect(host.moves.map((m) => m.cell)).toEqual([38, 31]);
    for (let i = 0; i < 4; i++) await move(st(host).turn === 'first' ? x : o, { cell: 3 });
    calm(server);
    const mover = st(host).turn === 'first' ? x : o;
    await move(mover, { cell: 3 }, false);
    expect(lastError(mover)).toMatchObject({ code: 'not_allowed', message: 'That column is full.' });
  });

  it('Wild and Numbers explain what is missing, and Numbers wins with a 15', async () => {
    const wild = await startGame({ variant: 'wild' });
    await move(wild.x, { cell: 0 }, false);
    expect(lastError(wild.x)).toMatchObject({ code: 'not_allowed', message: 'Choose X or O first.' });
    calm(wild.server);
    await move(wild.x, { cell: 0, mark: 'o' });
    expect(st(wild.host).cells[0]).toBe('o');
    expect(st(wild.host).history[0]!.notation).toBe('Oa3');

    const { host, x, o, server } = await startGame({ variant: 'numbers' });
    await move(x, { cell: 4, num: 2 }, false);
    expect(lastError(x)).toMatchObject({ code: 'not_allowed', message: 'Pick one of your numbers first.' });
    calm(server);
    await move(x, { cell: 4, num: 5 });
    await move(o, { cell: 0, num: 4 });
    await move(x, { cell: 1, num: 1 });
    await move(o, { cell: 8, num: 6 });
    await waitFor(() => st(host).phase === 'RESULTS');
    expect(st(host).result).toMatchObject({ winner: 'second', reason: 'sum', text: 'Evens win — a line adding up to 15' });
    expect(st(host).winLine).toEqual([0, 4, 8]);
    expect(st(host).seats.map((seat) => seat.side)).toEqual(['first', 'second']);

    // The kit's own sentences take the plural too.
    const again = await startGame({ variant: 'numbers' });
    again.x.room.send('tictactoe:resign', {});
    await waitFor(() => st(again.host).phase === 'RESULTS');
    expect(st(again.host).result).toMatchObject({ winner: 'second', reason: 'resign', text: 'Evens win — Odds resigned' });
  });

  it('Misère: completing a line loses', async () => {
    const { host, x, o } = await startGame({ variant: 'misere' });
    await playCells(x, o, [0, 3, 1, 4, 2]);
    await waitFor(() => st(host).phase === 'RESULTS');
    expect(st(host).result).toMatchObject({ winner: 'second', reason: 'misere', text: 'O wins — X made three in a row' });
  });

  it('Nesting: publishes stacks and hands, and refuses moving the opponent’s piece', async () => {
    const { host, x, o, server } = await startGame({ variant: 'nesting' });
    expect(st(host).hands).toEqual([2, 2, 2, 2, 2, 2]);
    await move(x, { cell: 0, size: 1 });
    await move(o, { cell: 0, size: 3 });
    expect(st(host).cells[0]).toBe('x1o3');
    expect(st(host).hands).toEqual([1, 2, 2, 2, 2, 1]);
    await move(x, { cell: 4, from: 0 }, false);
    expect(lastError(x)).toMatchObject({ code: 'not_allowed', message: 'Move one of your own pieces.' });
    calm(server);
    await move(x, { cell: 0, size: 2 }, false);
    expect(lastError(x)).toMatchObject({ code: 'not_allowed', message: 'That piece can’t go there.' });
    calm(server);
    await move(x, { cell: 4, size: 3 });
    await move(o, { cell: 8, from: 0 });
    const s = st(host);
    expect(s.cells[0]).toBe('x1');
    expect(s.cells[8]).toBe('o3');
    expect(s.lastFrom).toBe(0);
    expect(s.lastCell).toBe(8);
    expect(s.history.map((h) => h.notation)).toEqual(['Sa3', 'La3', 'Lb2', 'La3-c1']);
  });

  it('Vanishing: fades the oldest mark, and a take-back brings it back', async () => {
    const { host, x, o } = await startGame({ variant: 'vanishing' });
    await playCells(x, o, [0, 4, 8, 2, 6, 3]);
    expect(st(host).fading).toEqual([0, 4]);
    await move(x, { cell: 5 });
    let s = st(host);
    expect(s.cells[0]).toBe('');
    expect(s.cells[5]).toBe('x');
    expect(s.lastRemoved).toBe(0);
    expect(s.fading).toEqual([8, 4]);
    await waitFor(() => host.moves.length === 7);
    expect(host.moves[6]!.removed).toBe(0);
    x.room.send('tictactoe:undo', { action: 'offer' });
    await waitFor(() => st(host).offers.undoBy === 'first');
    o.room.send('tictactoe:undo', { action: 'accept' });
    await waitFor(() => st(host).ply === 6);
    s = st(host);
    expect(s.cells[0]).toBe('x');
    expect(s.cells[5]).toBe('');
    expect(s.fading).toEqual([0, 4]);
    expect(s.lastRemoved).toBe(-1);
    expect(s.history).toHaveLength(6);
  });

  it('takes back a Classic move when the opponent accepts', async () => {
    const { host, x, o } = await startGame();
    expect(st(host).undoAllowed).toBe(true);
    await move(x, { cell: 4 });
    x.room.send('tictactoe:undo', { action: 'offer' });
    await waitFor(() => st(host).offers.undoBy === 'first');
    o.room.send('tictactoe:undo', { action: 'accept' });
    await waitFor(() => st(host).ply === 0);
    const s = st(host);
    expect(s.cells).toEqual(Array(9).fill(''));
    expect(s.history).toEqual([]);
    expect(s.lastCell).toBe(-1);
    expect(s.turn).toBe('first');
    await move(x, { cell: 0 });
    expect(st(host).history.map((h) => h.notation)).toEqual(['a3']);
  });

  it('rematches in the same variant with sides swapped', async () => {
    const { host, x, o } = await startGame({ variant: 'wild' });
    const xId = x.me().playerId;
    await move(x, { cell: 4, mark: 'x' });
    o.room.send('tictactoe:resign', {});
    await waitFor(() => st(host).phase === 'RESULTS');
    expect(st(host).result).toMatchObject({ winner: 'first', reason: 'resign', text: 'First wins — Second resigned' });
    x.room.send('tictactoe:rematch', { action: 'offer' });
    await waitFor(() => st(host).offers.rematch.length === 1);
    o.room.send('tictactoe:rematch', { action: 'accept' });
    await waitFor(() => st(host).gameNumber === 2 && st(host).phase === 'PLAYING', 6000, 'rematch playing');
    const s = st(host);
    expect(s.variant).toBe('wild');
    expect(s.seats[1]!.playerId).toBe(xId);
    expect(s.cells).toEqual(Array(9).fill(''));
    expect(s.history).toEqual([]);
    expect(s.result.over).toBe(false);
  });

  it('goes back to the lobby on the chosen variant’s empty board', async () => {
    const { host, x, o } = await startGame({ variant: 'cube' });
    expect(st(host).cells).toHaveLength(64);
    await move(x, { cell: 21 });
    o.room.send('tictactoe:resign', {});
    await waitFor(() => st(host).phase === 'RESULTS');
    host.room.send('lobby:toLobby', {});
    await waitFor(() => st(host).phase === 'LOBBY', 3000, 'lobby');
    expect(st(host).cells).toEqual(Array(64).fill(''));
    expect(st(host).history).toEqual([]);
  });

  it('is never rated, even with the Rated setting on', async () => {
    const { host } = await startGame({ rated: true });
    expect(st(host).rated).toBe(false);
    expect(st(host).undoAllowed).toBe(true);
  });

  it('forfeits a player who leaves mid-game', async () => {
    const { x, o } = await startGame();
    const oId = o.me().playerId;
    await move(x, { cell: 4 });
    await o.room.leave(true);
    await waitFor(() => st(x).phase === 'RESULTS', 3000, 'forfeit');
    expect(st(x).result).toMatchObject({ winner: 'first', reason: 'forfeit', text: 'X wins — O left the game' });
    await waitFor(() => outcomesFor(x).length === 1, 3000, 'outcome');
    expect(outcomesFor(x)[0]!.outcome.placements).toEqual([[x.me().playerId], [oId]]);
  });

  it('follows tournament sides and the organizer’s variant, without take-backs', async () => {
    const { host, server } = await createRoom({ variant: 'gravity' });
    const guest = await join(host.room.roomId, 'Bo');
    (server as any).tournamentInfo = {
      tournamentCode: 'TTTTT',
      tournamentName: 'Cup',
      matchId: 'm1',
      roundLabel: 'Final',
      bestOf: 3,
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
    expect(st(host).variant).toBe('gravity');
    expect(st(host).undoAllowed).toBe(false);
    expect(st(host).rated).toBe(false);
  });
});
