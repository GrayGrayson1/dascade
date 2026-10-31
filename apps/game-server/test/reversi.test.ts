import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, WelcomePayload } from '@dascade/shared';
import type { BoardEvent } from '@dascade/shared/games/boardroom';
import type { ReversiMoveEvent, ReversiPublicState, ReversiVariant } from '@dascade/shared/games/reversi';
import { cellIndex, legalMoves, newGame, startPosition } from '@dascade/game-core/reversi';
import { onOutcome, type OutcomeContext } from '../src/platform/hub.ts';
import type { ReversiRoom } from '../src/rooms/reversi/ReversiRoom.ts';
import { bootTestServer, collect, quiet, sleep, waitFor } from './helpers.ts';

let colyseus: ColyseusTestServer;
const outcomes: Array<{ outcome: GameOutcome; ctx: OutcomeContext }> = [];
let unsubscribe: () => void = () => undefined;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['reversi']));
  unsubscribe = onOutcome((outcome, ctx) => {
    if (ctx.gameId === 'reversi') outcomes.push({ outcome, ctx });
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
  moves: ReversiMoveEvent[];
  events: BoardEvent[];
  me: () => WelcomePayload;
}

function wire(room: SdkRoom): Client {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<{ type?: string; code: string; message: string }>(room, 'sys:error');
  const moves = collect<ReversiMoveEvent>(room, 'reversi:moved');
  const events = collect<BoardEvent>(room, 'reversi:boardEvent');
  quiet(room);
  return { room, errors, moves, events, me: () => welcomes[welcomes.length - 1]! };
}

async function ready(c: Client): Promise<Client> {
  await c.room.waitForInitialState();
  await waitFor(() => Boolean(c.me()), 3000, 'welcome');
  return c;
}

const st = (c: Client) => (c.room.state as any).toJSON() as ReversiPublicState;
const settingsOf = (c: Client) => JSON.parse((c.room.state as any).settingsJson) as Record<string, unknown>;
const serverOf = (c: Client) => colyseus.getRoomById(c.room.roomId) as unknown as ReversiRoom;
const sq = (name: string, size = 8) => cellIndex(size, name);

async function createRoom(settings: Record<string, unknown> = {}) {
  const host = await ready(wire(await colyseus.sdk.create('reversi', { name: 'Ada', settings })));
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
  const black = host.me().playerId === firstId ? host : guest;
  const white = black === host ? guest : host;
  return { black, white };
}

/** Creates a room with two players and starts the game. Returns them as black (first) / white (second). */
async function startGame(settings: Record<string, unknown> = {}) {
  const { host, server } = await createRoom(settings);
  const guest = await join(host.room.roomId, 'Bo');
  const { black, white } = await begin(host, guest);
  return { host, guest, black, white, server };
}

/** Swap in a hand-made position (Black to move) before the first move. */
async function setPosition(server: ReversiRoom, host: Client, variant: ReversiVariant, rows: string[]) {
  (server as any).game = newGame(variant, rows.join(''));
  (server as any).publish();
  await waitFor(() => st(host).board === rows.join(''), 3000, 'position');
}

async function move(c: Client, cell: number, expectAccepted = true) {
  const ply = st(c).ply;
  const errors = c.errors.length;
  c.room.send('reversi:move', { cell, ply });
  if (expectAccepted) await waitFor(() => st(c).ply > ply || st(c).result.over, 3000, `move ${cell}`);
  else await waitFor(() => c.errors.length > errors, 3000, `rejection of ${cell}`);
}

/** Play squares by name, whoever is to move. */
async function play(black: Client, white: Client, list: string[], size = 8) {
  for (const name of list) await move(st(black).turn === 'first' ? black : white, sq(name, size));
}

const lastError = (c: Client) => c.errors[c.errors.length - 1]!;
const outcomesFor = (c: Client) => outcomes.filter((o) => o.ctx.roomCode === c.room.roomId);
const count = (board: string, ch: string) => [...board].filter((x) => x === ch).length;
/** The first square the side to move may play (any variant and start). */
const legalFirst = (s: ReversiPublicState) => legalMoves({ ...startPosition(s.variant, s.board), turn: s.turn })[0]!;

/** Refill every player's rate-limit buckets (tests that fire many rejected messages back to back). */
function calm(server: ReversiRoom) {
  for (const p of (server as any).players.values()) p.buckets.clear();
}

/** Black plays c1 here, White then has no move (skipped), and Black's f8 ends it 6–0. */
const PASS_ROWS = ['bw......', '........', '........', '........', '........', '........', '........', '......wb'];

describe('DAS Reversi room', () => {
  it('opens on Classic with a 10+0 clock and Black to move from the crosswise centre', async () => {
    const { host, black, white } = await startGame();
    const s = st(host);
    expect(s.variant).toBe('classic');
    expect(s.size).toBe(8);
    expect(s.board).toBe(newGame('classic').position.board);
    expect(s.board[sq('d4')]).toBe('w');
    expect(s.board[sq('e4')]).toBe('b');
    expect(s.lastCell).toBe(-1);
    expect(s.lastFlips).toEqual([]);
    expect(s.lastPassed).toBe('');
    expect(s.supply).toEqual([]);
    expect(s.turn).toBe('first');
    expect(s.clock).toMatchObject({ enabled: true, baseMs: 600_000, incrementMs: 0 });
    expect(s.rated).toBe(false);
    expect(new Set(s.seats.map((seat) => seat.playerId))).toEqual(new Set([black.me().playerId, white.me().playerId]));
  });

  it('places a disc, flips the trapped line and records the move', async () => {
    const { host, black, white } = await startGame();
    await move(black, sq('d3'));
    let s = st(host);
    expect(s.board[sq('d3')]).toBe('b');
    expect(s.board[sq('d4')]).toBe('b');
    expect(count(s.board, 'b')).toBe(4);
    expect(count(s.board, 'w')).toBe(1);
    expect(s.lastCell).toBe(sq('d3'));
    expect(s.lastFlips).toEqual([sq('d4')]);
    expect(s.turn).toBe('second');
    await move(white, sq('c3'));
    s = st(host);
    expect(s.history.map((h) => h.notation)).toEqual(['d3', 'c3']);
    await waitFor(() => host.moves.length === 2);
    expect(host.moves[0]).toEqual({ ply: 1, side: 'first', notation: 'd3', cell: sq('d3'), flips: [sq('d4')], passed: '' });
    expect(host.moves[1]).toMatchObject({ ply: 2, side: 'second', notation: 'c3', flips: [sq('d4')] });
  });

  it('enforces turns and explains refused squares', async () => {
    const { host, black, white, server } = await startGame();
    await move(white, sq('c4'), false);
    expect(lastError(white).code).toBe('not_your_turn');
    calm(server);
    await move(black, sq('d4'), false);
    expect(lastError(black)).toMatchObject({ code: 'not_allowed', message: 'That square is taken.' });
    calm(server);
    await move(black, sq('a1'), false);
    expect(lastError(black)).toMatchObject({
      code: 'not_allowed',
      message: 'That move flips nothing — trap at least one of your opponent’s discs.',
    });
    calm(server);
    await move(black, 64, false);
    expect(lastError(black)).toMatchObject({ code: 'not_allowed', message: 'That square is not on this board.' });
    expect(st(host).ply).toBe(0);
  });

  it('rejects malformed payloads', async () => {
    const { host, black, server } = await startGame();
    for (const bad of [
      { cell: 100, ply: 0 },
      { cell: -1, ply: 0 },
      { cell: 1.5, ply: 0 },
      { cell: 19 },
      { cell: 19, ply: -1 },
      { cell: 19, ply: 0, extra: true },
      { cell: '19', ply: 0 },
    ]) {
      calm(server);
      const n = black.errors.length;
      black.room.send('reversi:move', bad);
      await waitFor(() => black.errors.length > n);
      expect(lastError(black).code).toBe('invalid_payload');
    }
    expect(st(host).ply).toBe(0);
  });

  it('ignores duplicate and stale submissions of the same move', async () => {
    const { host, black, white } = await startGame();
    for (let i = 0; i < 3; i++) black.room.send('reversi:move', { cell: sq('d3'), ply: 0 });
    await waitFor(() => st(host).ply === 1);
    await sleep(150);
    expect(st(host).ply).toBe(1);
    expect(st(host).history).toHaveLength(1);
    const n = white.errors.length;
    white.room.send('reversi:move', { cell: sq('c3'), ply: 0 });
    await waitFor(() => white.errors.length > n);
    expect(lastError(white).code).toBe('not_allowed');
    expect(st(host).ply).toBe(1);
  });

  it('spectators cannot move, resign or offer draws, but see every move', async () => {
    const { host, black } = await startGame();
    const rail = await join(host.room.roomId, 'Rail', { spectator: true });
    for (const [type, payload] of [
      ['reversi:move', { cell: sq('d3'), ply: 0 }],
      ['reversi:resign', {}],
      ['reversi:draw', { action: 'offer' }],
    ] as const) {
      const n = rail.errors.length;
      rail.room.send(type, payload);
      await waitFor(() => rail.errors.length > n);
      expect(lastError(rail).code).toBe('not_allowed');
    }
    expect(st(host).ply).toBe(0);
    await move(black, sq('d3'));
    await waitFor(() => st(rail).ply === 1 && rail.moves.length === 1);
    expect(st(rail).board[sq('d3')]).toBe('b');
  });

  it('follows the lobby variant’s board and refuses an unknown one', async () => {
    const { host, server } = await createRoom();
    host.room.send('lobby:settings', { settings: { variant: 'grand' } });
    await waitFor(() => st(host).variant === 'grand', 3000, 'variant');
    expect(st(host).size).toBe(10);
    expect(st(host).board).toHaveLength(100);
    calm(server);
    const n = host.errors.length;
    host.room.send('lobby:settings', { settings: { variant: 'othello' } });
    await waitFor(() => host.errors.length > n);
    expect(lastError(host).code).toBe('invalid_payload');
    expect(settingsOf(host).variant).toBe('grand');
    host.room.send('lobby:settings', { settings: { variant: 'mini' } });
    await waitFor(() => st(host).size === 6 && st(host).board.length === 36, 3000, 'mini board');
    host.room.send('lobby:settings', { settings: { variant: 'octagon' } });
    await waitFor(() => count(st(host).board, '#') === 12, 3000, 'octagon board');
  });

  it('skips a player with no move (two plies), keeping a standing draw offer, then ends on the count', async () => {
    const { host, black, white, server } = await startGame();
    await setPosition(server, host, 'classic', PASS_ROWS);
    black.room.send('reversi:draw', { action: 'offer' });
    await waitFor(() => st(host).offers.drawBy === 'first');
    await move(black, sq('c1'));
    let s = st(host);
    expect(s.ply).toBe(2);
    expect(s.turn).toBe('first');
    expect(s.lastCell).toBe(sq('c1'));
    expect(s.lastFlips).toEqual([sq('b1')]);
    expect(s.lastPassed).toBe('second');
    expect(s.history.map((h) => h.notation)).toEqual(['c1', 'pass']);
    expect(s.offers.drawBy).toBe('first');
    await waitFor(() => host.moves.length === 1);
    expect(host.moves[0]).toMatchObject({ ply: 2, side: 'first', notation: 'c1', passed: 'second' });
    await move(white, sq('f8'), false);
    expect(lastError(white).code).toBe('not_your_turn');
    await move(black, sq('f8'));
    await waitFor(() => st(host).phase === 'RESULTS');
    s = st(host);
    expect(s.result).toMatchObject({ over: true, winner: 'first', reason: 'discs', text: 'Black wins 6–0 — a wipeout' });
    expect(s.lastPassed).toBe('');
    await waitFor(() => outcomesFor(host).length === 1, 3000, 'outcome');
    const { outcome } = outcomesFor(host)[0]!;
    expect(outcome.placements).toEqual([[black.me().playerId], [white.me().playerId]]);
    expect(outcome.details).toMatchObject({ winnerSide: 'first', plies: 3, variant: 'classic', black: 6, white: 0, moves: 'c1 pass f8' });
    await sleep(150);
    expect(outcomesFor(host)).toHaveLength(1);
  });

  it('takes back over a skipped turn, but never into a position that has to pass', async () => {
    const { host, black, white, server } = await startGame();
    await setPosition(server, host, 'classic', PASS_ROWS);
    await move(black, sq('c1'));
    // White asks: one ply back would leave White to move with no move — refused when accepted.
    white.room.send('reversi:undo', { action: 'offer' });
    await waitFor(() => st(host).offers.undoBy === 'second');
    const n = black.errors.length;
    black.room.send('reversi:undo', { action: 'accept' });
    await waitFor(() => black.errors.length > n);
    expect(lastError(black)).toMatchObject({ code: 'not_allowed', message: 'That move can no longer be taken back.' });
    expect(st(host).ply).toBe(2);
    // Black asks on their own turn: the skipped turn and Black's move go back.
    calm(server);
    black.room.send('reversi:undo', { action: 'offer' });
    await waitFor(() => st(host).offers.undoBy === 'first');
    white.room.send('reversi:undo', { action: 'accept' });
    await waitFor(() => st(host).ply === 0);
    const s = st(host);
    expect(s.board).toBe(PASS_ROWS.join(''));
    expect(s.history).toEqual([]);
    expect(s.lastCell).toBe(-1);
    expect(s.lastPassed).toBe('');
    expect(s.turn).toBe('first');
  });

  it('draws when the counts are equal and nobody can move', async () => {
    const { host, black, server } = await startGame();
    await setPosition(server, host, 'classic', [
      'bw......',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      'www.....',
    ]);
    await move(black, sq('c1'));
    await waitFor(() => st(host).phase === 'RESULTS');
    expect(st(host).result).toMatchObject({ winner: 'draw', reason: 'tie', text: 'Draw — 3 discs each' });
    await waitFor(() => outcomesFor(host).length === 1, 3000, 'outcome');
    expect(outcomesFor(host)[0]!.outcome.placements).toEqual([[st(host).seats[0]!.playerId, st(host).seats[1]!.playerId]]);
  });

  it('Anti: the fewest discs wins', async () => {
    const { host, black, server } = await startGame({ variant: 'anti' });
    await setPosition(server, host, 'anti', ['bw......', ...Array<string>(7).fill('........')]);
    await move(black, sq('c1'));
    await waitFor(() => st(host).phase === 'RESULTS');
    expect(st(host).result).toMatchObject({ winner: 'second', reason: 'discs', text: 'White wins with fewer discs, 0–3' });
  });

  it('Original: the first four discs go on the centre squares, from 32 each', async () => {
    const { host, black, white, server } = await startGame({ variant: 'original' });
    expect(count(st(host).board, '.')).toBe(64);
    expect(st(host).supply).toEqual([32, 32]);
    await move(black, sq('c3'), false);
    expect(lastError(black)).toMatchObject({ code: 'not_allowed', message: 'The first four discs go on the four centre squares.' });
    calm(server);
    await play(black, white, ['d4', 'e4', 'd5', 'e5']);
    const s = st(host);
    expect(s.supply).toEqual([30, 30]);
    expect(s.lastFlips).toEqual([]);
    expect([s.board[sq('d4')], s.board[sq('e4')], s.board[sq('d5')], s.board[sq('e5')]]).toEqual(['b', 'w', 'b', 'w']);
    expect(s.turn).toBe('first');
  });

  it('Blockers and Random Start draw their setup when the game starts', async () => {
    const blockers = await createRoom({ variant: 'blockers' });
    expect(count(st(blockers.host).board, '#')).toBe(0);
    const guest = await join(blockers.host.room.roomId, 'Bo');
    await begin(blockers.host, guest);
    const board = st(blockers.host).board;
    expect(count(board, '#')).toBe(4);
    for (let i = 0; i < 64; i++) if (board[i] === '#') expect(board[63 - i]).toBe('#');

    const random = await startGame({ variant: 'random' });
    const s = st(random.host);
    expect(count(s.board, 'b') + count(s.board, 'w')).toBe(8);
    expect(s.turn).toBe('first');
    expect(s.history).toEqual([]);
  });

  it('rates Classic games only', async () => {
    const classic = await startGame({ rated: true });
    expect(st(classic.host).rated).toBe(true);
    expect(st(classic.host).undoAllowed).toBe(false);
    const anti = await startGame({ variant: 'anti', rated: true });
    expect(st(anti.host).rated).toBe(false);
    expect(st(anti.host).undoAllowed).toBe(true);
  });

  it('rematches in the same variant with colours swapped', async () => {
    const { host, black, white } = await startGame({ variant: 'mini' });
    const blackId = black.me().playerId;
    await move(black, legalFirst(st(host)));
    white.room.send('reversi:resign', {});
    await waitFor(() => st(host).phase === 'RESULTS');
    expect(st(host).result).toMatchObject({ winner: 'first', reason: 'resign', text: 'Black wins — White resigned' });
    black.room.send('reversi:rematch', { action: 'offer' });
    await waitFor(() => st(host).offers.rematch.length === 1);
    white.room.send('reversi:rematch', { action: 'accept' });
    await waitFor(() => st(host).gameNumber === 2 && st(host).phase === 'PLAYING', 6000, 'rematch playing');
    const s = st(host);
    expect(s.variant).toBe('mini');
    expect(s.seats[1]!.playerId).toBe(blackId);
    expect(s.board).toBe(newGame('mini').position.board);
    expect(s.history).toEqual([]);
    expect(s.result.over).toBe(false);
  });

  it('goes back to the lobby on the variant’s start', async () => {
    const { host, black, white } = await startGame({ variant: 'blockers' });
    await move(black, legalFirst(st(host)));
    white.room.send('reversi:resign', {});
    await waitFor(() => st(host).phase === 'RESULTS');
    host.room.send('lobby:toLobby', {});
    await waitFor(() => st(host).phase === 'LOBBY', 3000, 'lobby');
    expect(st(host).board).toBe(newGame('blockers').position.board);
    expect(st(host).history).toEqual([]);
  });

  it('forfeits a player who leaves mid-game', async () => {
    const { black, white } = await startGame();
    const whiteId = white.me().playerId;
    await move(black, sq('d3'));
    await white.room.leave(true);
    await waitFor(() => st(black).phase === 'RESULTS', 3000, 'forfeit');
    expect(st(black).result).toMatchObject({ winner: 'first', reason: 'forfeit', text: 'Black wins — White left the game' });
    await waitFor(() => outcomesFor(black).length === 1, 3000, 'outcome');
    expect(outcomesFor(black)[0]!.outcome.placements).toEqual([[black.me().playerId], [whiteId]]);
  });

  it('loses on time', async () => {
    const { host, server } = await createRoom();
    (server as any).clockOverride = { baseMs: 300, incrementMs: 0 };
    const guest = await join(host.room.roomId, 'Bo');
    await begin(host, guest);
    await waitFor(() => st(host).phase === 'RESULTS', 4000, 'flag');
    expect(st(host).result).toMatchObject({ winner: 'second', reason: 'timeout', text: 'White wins on time' });
  });

  it('follows tournament sides and the organizer’s variant, without take-backs', async () => {
    const { host, server } = await createRoom({ variant: 'torus' });
    const guest = await join(host.room.roomId, 'Bo');
    (server as any).tournamentInfo = {
      tournamentCode: 'RVRSI',
      tournamentName: 'Cup',
      matchId: 'm1',
      roundLabel: 'Final',
      bestOf: 2,
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
    expect(st(host).variant).toBe('torus');
    expect(st(host).undoAllowed).toBe(false);
    expect(st(host).rated).toBe(false);
  });
});
