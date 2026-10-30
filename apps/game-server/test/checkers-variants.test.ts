import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, WelcomePayload } from '@dascade/shared';
import type { CheckersPublicState } from '@dascade/shared/games/checkers';
import { checkersEngine, rcSquare, geometryFor, type DraughtsGame } from '@dascade/game-core/checkers';
import { onOutcome, type OutcomeContext } from '../src/platform/hub.ts';
import type { CheckersRoom } from '../src/rooms/checkers/CheckersRoom.ts';
import { bootTestServer, collect, quiet, waitFor } from './helpers.ts';

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
  me: () => WelcomePayload;
}

function wire(room: SdkRoom): Client {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<{ type?: string; code: string; message: string }>(room, 'sys:error');
  quiet(room);
  return { room, errors, me: () => welcomes[welcomes.length - 1]! };
}

async function ready(c: Client): Promise<Client> {
  await c.room.waitForInitialState();
  await waitFor(() => Boolean(c.me()), 3000, 'welcome');
  return c;
}

const st = (c: Client) => (c.room.state as any).toJSON() as CheckersPublicState;
const settingsOf = (c: Client) => JSON.parse((c.room.state as any).settingsJson) as Record<string, unknown>;
const serverOf = (c: Client) => colyseus.getRoomById(c.room.roomId) as unknown as CheckersRoom;
const lastError = (c: Client) => c.errors[c.errors.length - 1]!;
const outcomesFor = (c: Client) => outcomes.filter((o) => o.ctx.roomCode === c.room.roomId);
const sq = (size: number, r: number, c: number) => rcSquare(geometryFor(size), r, c);

async function createRoom(settings: Record<string, unknown> = {}) {
  const host = await ready(
    wire(
      await colyseus.sdk.create('checkers', {
        name: 'Ada',
        settings: { timeControl: { baseMinutes: 0, incrementSeconds: 0 }, ...settings },
      }),
    ),
  );
  const server = serverOf(host);
  (server as any).countdownMs = 0;
  return { host, server };
}

async function join(code: string, name: string) {
  return ready(wire(await colyseus.sdk.joinById(code, { name })));
}

/** Two players, game started. `first` moves first (Light in most variants). */
async function startGame(settings: Record<string, unknown> = {}) {
  const { host, server } = await createRoom(settings);
  const guest = await join(host.room.roomId, 'Bo');
  host.room.send('lobby:start', {});
  await waitFor(() => st(host).phase === 'PLAYING' && st(guest).phase === 'PLAYING', 4000, 'playing');
  await waitFor(() => st(host).seats.every((s) => s.playerId), 3000, 'seats');
  const firstId = st(host).seats[0]!.playerId;
  const first = host.me().playerId === firstId ? host : guest;
  const second = first === host ? guest : host;
  return { host, guest, first, second, server };
}

/** Replace the live position (tests only), keeping the side to move. */
function setBoard(server: CheckersRoom, board: string, turn: 'dark' | 'light') {
  const variant = (server as any).variant;
  const game: DraughtsGame = checkersEngine(variant).newGame({ board, turn });
  (server as any).records = [game];
  (server as any).publish();
}

function boardOf(size: number, pieces: Partial<Record<'d' | 'D' | 'l' | 'L', Array<[number, number]>>>): string {
  const cells = Array.from({ length: (size * size) / 2 }, () => '.');
  for (const [piece, list] of Object.entries(pieces)) for (const [r, c] of list!) cells[sq(size, r, c) - 1] = piece;
  return cells.join('');
}

async function move(c: Client, path: number[], expectAccepted = true) {
  const ply = st(c).ply;
  const errors = c.errors.length;
  c.room.send('checkers:move', { path, ply });
  if (expectAccepted) await waitFor(() => st(c).ply > ply || st(c).result.over, 3000, `move ${path.join('-')}`);
  else await waitFor(() => c.errors.length > errors, 3000, `rejection of ${path.join('-')}`);
}

describe('DAS Checkers variants', () => {
  it('follows the lobby variant: board size, starting position and side names', async () => {
    const { host } = await createRoom();
    expect(st(host).variant).toBe('american');
    expect(st(host).board).toHaveLength(32);
    host.room.send('lobby:settings', { settings: { variant: 'international' } });
    await waitFor(() => st(host).variant === 'international', 3000, 'variant');
    expect(st(host).board).toBe(checkersEngine('international').start().board);
    expect(st(host).board).toHaveLength(50);
    host.room.send('lobby:settings', { settings: { variant: 'canadian' } });
    await waitFor(() => st(host).board.length === 72, 3000, 'canadian');
    const n = host.errors.length;
    host.room.send('lobby:settings', { settings: { variant: 'turkish' } });
    await waitFor(() => host.errors.length > n);
    expect(lastError(host).code).toBe('invalid_payload');
    expect(settingsOf(host).variant).toBe('canadian');
  });

  it('International: Light moves first, the variant is locked once the game starts', async () => {
    const { host, first, second } = await startGame({ variant: 'international' });
    expect(st(host).variant).toBe('international');
    expect(st(host).turn).toBe('first');
    await move(second, [17, 21], false);
    expect(lastError(second).code).toBe('not_your_turn');
    await move(first, [32, 28]);
    expect(st(host).history.map((h) => h.notation)).toEqual(['32-28']);
    // Off-board squares for this variant are refused as malformed.
    await move(second, [17, 51], false);
    expect(lastError(second).code).toBe('invalid_payload');
    const n = host.errors.length;
    host.room.send('lobby:settings', { settings: { variant: 'american' } });
    await waitFor(() => host.errors.length > n);
    expect(st(host).variant).toBe('international');
  });

  it('International: refuses a smaller capture and plays the maximum one', async () => {
    const { host, first, server } = await startGame({ variant: 'international' });
    // The man on (8,1) can take two; the man on (8,9) only one.
    setBoard(
      server,
      boardOf(10, {
        l: [
          [8, 1],
          [8, 9],
        ],
        d: [
          [7, 2],
          [5, 4],
          [7, 8],
          [0, 9],
        ],
      }),
      'light',
    );
    await move(first, [sq(10, 8, 9), sq(10, 6, 7)], false);
    expect(lastError(first)).toMatchObject({ code: 'not_allowed', message: 'You must take the most pieces you can (2 pieces).' });
    await move(first, [sq(10, 8, 1), sq(10, 4, 5)]);
    expect(st(host).lastCaptures).toEqual([sq(10, 7, 2), sq(10, 5, 4)]);
  });

  it('Russian: a flying king crosses the board and a promoted man keeps capturing', async () => {
    const { host, first, second, server } = await startGame({ variant: 'russian' });
    setBoard(
      server,
      boardOf(8, {
        L: [[7, 0]],
        l: [[2, 1]],
        d: [
          [1, 2],
          [1, 4],
          [0, 7],
          [0, 1],
        ],
      }),
      'light',
    );
    // The man must capture (captures are mandatory) — crowned on the far row, then on as a king.
    await move(first, [sq(8, 7, 0), sq(8, 3, 4)], false);
    expect(lastError(first).message).toMatch(/must jump/);
    await move(first, [sq(8, 2, 1), sq(8, 0, 3), sq(8, 3, 6)]);
    expect(st(host).history.at(-1)).toMatchObject({ captures: 2, crowned: true });
    expect(st(host).board[sq(8, 3, 6) - 1]).toBe('L');
    await move(second, [sq(8, 0, 1), sq(8, 1, 0)]);
    await move(first, [sq(8, 7, 0), sq(8, 2, 5)]);
    expect(st(host).board[sq(8, 2, 5) - 1]).toBe('L');
  });

  it('Breakthrough: the first king wins, unrated, and the outcome names the variant', async () => {
    const { host, first, server } = await startGame({ variant: 'breakthrough', rated: true });
    expect(st(host).rated).toBe(false);
    setBoard(server, boardOf(10, { l: [[1, 0]], d: [[5, 4]] }), 'light');
    await move(first, [sq(10, 1, 0), sq(10, 0, 1)]);
    await waitFor(() => st(host).result.over, 3000, 'result');
    expect(st(host).result).toMatchObject({ winner: 'first', reason: 'breakthrough', text: 'Light wins — first to crown a king' });
    await waitFor(() => outcomesFor(host).length === 1, 3000, 'outcome');
    const { outcome, ctx } = outcomesFor(host)[0]!;
    expect(ctx.rated).toBe(false);
    expect(outcome.placements[0]).toEqual([first.me().playerId]);
    expect(outcome.details?.variant).toBe('breakthrough');
  });

  it('Giveaway: losing every piece wins', async () => {
    const { host, first, second, server } = await startGame({ variant: 'giveaway' });
    // Dark (first) must take Light's last piece — and that hands Light the win.
    setBoard(server, boardOf(8, { d: [[2, 1]], l: [[3, 2]] }), 'dark');
    await move(first, [sq(8, 2, 1), sq(8, 4, 3)]);
    await waitFor(() => st(host).result.over, 3000, 'result');
    expect(st(host).result).toMatchObject({ winner: 'second', reason: 'no_pieces', text: 'Light wins — gave away every piece' });
    expect(second.me().playerId).toBe(st(host).seats[1]!.playerId);
  });

  it('American stays rated; variants never are', async () => {
    const american = await startGame({ rated: true });
    expect(st(american.host).rated).toBe(true);
    await colyseus.cleanup();
    const russian = await startGame({ variant: 'russian', rated: true });
    expect(st(russian.host).rated).toBe(false);
  });

  it('a variant tournament match follows the organizer’s sides and stays unrated', async () => {
    const { host, server } = await createRoom({ variant: 'pool' });
    const guest = await join(host.room.roomId, 'Bo');
    (server as any).tournamentInfo = {
      tournamentCode: 'CKCKC',
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
    expect(st(host).variant).toBe('pool');
    expect(st(host).rated).toBe(false);
    expect(st(host).undoAllowed).toBe(false);
    // Pool: Dark moves first.
    await move(guest, [11, 15]);
    expect(st(host).turn).toBe('second');
  });

  it('take-backs replay the variant exactly', async () => {
    const { host, first, second, server } = await startGame({ variant: 'international' });
    await move(first, [32, 28]);
    await move(second, [19, 23]);
    await move(first, [28, 19]);
    expect(st(host).lastCaptures).toEqual([23]);
    const deep = (server as any).takeBack(3) as boolean;
    expect(deep).toBe(true);
    await waitFor(() => st(host).history.length === 0, 3000, 'take-back');
    expect(st(host).board).toBe(checkersEngine('international').start().board);
  });
});
