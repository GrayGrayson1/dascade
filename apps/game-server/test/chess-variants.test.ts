/**
 * DAS Chess variants through the real room: the lobby board follows the variant, the variant locks
 * when the game starts, Chess960 draws its start from the room RNG, drops/explosions/variant wins
 * travel through the normal move message, only Standard is rated, and a tournament can run a variant.
 */
process.env.DASCADE_TOURNAMENT_START_DELAY_MS = '30';
process.env.DASCADE_TOURNAMENT_INTERMISSION_MS = '150';
process.env.DASCADE_TOURNAMENT_CLOSE_DELAY_MS = '80';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, WelcomePayload } from '@dascade/shared';
import type { ChessPublicState, ChessVariant } from '@dascade/shared/games/chess';
import { chess960BackRank, createChessGame } from '@dascade/game-core/chess';
import { bootTestServer, collect, quiet, waitFor } from './helpers.ts';
import type { ChessRoom } from '../src/rooms/chess/ChessRoom.ts';
import { onOutcome, type OutcomeContext } from '../src/platform/hub.ts';
import { getRating, resetRatings } from '../src/platform/ratings.ts';
import { admin, setupField, takeSeat, useTournamentServer, waitPhase } from './tournament-helpers.ts';

let colyseus: ColyseusTestServer;
const outcomes: Array<{ outcome: GameOutcome; ctx: OutcomeContext }> = [];
let unsubscribe: () => void = () => undefined;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['tournament', 'chess']));
  useTournamentServer(colyseus);
  unsubscribe = onOutcome((outcome, ctx) => {
    if (ctx.gameId === 'chess') outcomes.push({ outcome, ctx });
  });
});
afterEach(async () => {
  await colyseus.cleanup();
  outcomes.length = 0;
  resetRatings();
});
afterAll(async () => {
  unsubscribe();
  await colyseus.shutdown();
});

type ErrorPayload = { type?: string; code: string; message: string };

interface Client {
  room: SdkRoom;
  errors: ErrorPayload[];
  me: () => WelcomePayload;
}

async function wire(room: SdkRoom): Promise<Client> {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<ErrorPayload>(room, 'sys:error');
  quiet(room);
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, 'welcome');
  return { room, errors, me: () => welcomes[welcomes.length - 1]! };
}

const st = (c: Client) => (c.room.state as any).toJSON() as ChessPublicState;

async function createRoom(settings: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const host = await wire(await colyseus.sdk.create('chess', { name: 'Hera', settings, ...extra }));
  const server = colyseus.getRoomById(host.room.roomId) as unknown as ChessRoom;
  (server as any).countdownMs = 0;
  return { host, server };
}

async function startGame(settings: Record<string, unknown>, opts: { guestIds?: boolean; before?: (server: ChessRoom) => void } = {}) {
  const { host, server } = await createRoom({ sides: 'host_first', ...settings }, opts.guestIds ? { guestId: 'guest-hera-0001' } : {});
  const guest = await wire(
    await colyseus.sdk.joinById(host.room.roomId, { name: 'Gus', ...(opts.guestIds ? { guestId: 'guest-gus-00002' } : {}) }),
  );
  opts.before?.(server);
  host.room.send('lobby:start', {});
  await waitFor(() => st(host).phase === 'PLAYING' && st(guest).phase === 'PLAYING', 3000, 'playing');
  return { server, white: host, black: guest };
}

async function send(c: Client, payload: Record<string, unknown>, expectOk = true) {
  const before = st(c).ply;
  const errs = c.errors.length;
  c.room.send('chess:move', { ...payload, ply: before });
  if (expectOk)
    await waitFor(() => st(c).ply > before, 3000, `move ${JSON.stringify(payload)} (errors: ${JSON.stringify(c.errors.slice(errs))})`);
  else await waitFor(() => c.errors.length > errs, 3000, `rejection of ${JSON.stringify(payload)}`);
}

const uci = (u: string) => ({ from: u.slice(0, 2), to: u.slice(2, 4), ...(u[4] ? { promotion: u[4] } : {}) });

async function playLine(white: Client, black: Client, line: string[]) {
  const firstIsWhite = st(white).turn === 'first';
  for (let i = 0; i < line.length; i++) await send((i % 2 === 0) === firstIsWhite ? white : black, uci(line[i]!));
}

/** Test-only shortcut: put a variant position on the server board (sides/turn kept consistent). */
function loadFen(server: ChessRoom, variant: ChessVariant, fen: string) {
  (server as any).game = createChessGame(variant, fen);
  server.state.moves.clear();
  server.state.turn = fen.split(' ')[1] === 'b' ? 'second' : 'first';
  (server as any).publishPosition();
}

const setSettings = (c: Client, patch: Record<string, unknown>) => c.room.send('lobby:settings', { settings: patch });

describe('DAS Chess variants — lobby', () => {
  it('the lobby board follows the chosen variant', async () => {
    const { host } = await createRoom();
    expect(st(host).variant).toBe('standard');
    setSettings(host, { variant: 'horde' });
    await waitFor(() => st(host).variant === 'horde', 3000, 'horde');
    expect(st(host).fen).toBe('rnbqkbnr/pppppppp/8/1PP2PP1/PPPPPPPP/PPPPPPPP/PPPPPPPP/PPPPPPPP w kq - 0 1');
    setSettings(host, { variant: 'racingkings' });
    await waitFor(() => st(host).variant === 'racingkings', 3000, 'racing kings');
    expect(st(host).fen.startsWith('8/8/8/8/8/8/krbnNBRK/qrbnNBRQ w')).toBe(true);
    setSettings(host, { variant: 'nope' });
    await waitFor(() => host.errors.length > 0, 3000, 'bad variant refused');
    expect(st(host).variant).toBe('racingkings');
  });

  it('locks the variant when the game starts', async () => {
    const { white } = await startGame({ variant: 'kingofthehill' });
    setSettings(white, { variant: 'atomic' });
    await waitFor(() => white.errors.length > 0, 3000, 'settings refused mid-game');
    expect(st(white).variant).toBe('kingofthehill');
  });
});

describe('DAS Chess variants — play', () => {
  it('Chess960 draws its start from the room RNG', async () => {
    const { white } = await startGame({ variant: 'chess960' }, { before: (s) => ((s as any).rng = { next: () => 0, int: () => 0 }) });
    expect(chess960BackRank(0)).toBe('BBQNNRKR');
    expect(st(white).startFen).toBe('bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w KQkq - 0 1');
    expect(st(white).fen).toBe(st(white).startFen);
  });

  it('Crazyhouse: captures fill the pocket and drops travel as moves', async () => {
    const { white, black } = await startGame({ variant: 'crazyhouse' });
    await playLine(white, black, ['e2e4', 'd7d5', 'e4d5', 'd8d5']);
    expect(st(white).fen.split(' ')[0].endsWith('[Pp]')).toBe(true);
    await send(white, { to: 'e8', drop: 'n' }, false);
    expect(white.errors.at(-1)?.message).toMatch(/can’t drop/);
    await send(white, { to: 'e4', drop: 'p' });
    expect(st(black).moves.at(-1)).toMatchObject({ san: 'P@e4', drop: 'p', to: 'e4', uci: 'P@e4' });
    // A drop needs no origin and takes no promotion piece.
    await send(black, { from: 'd5', to: 'e4', drop: 'p' }, false);
  });

  it('Atomic: a capture explodes and blowing up the king wins', async () => {
    const { white, black } = await startGame({ variant: 'atomic' });
    await playLine(white, black, ['g1f3', 'a7a6', 'f3e5', 'a6a5']);
    await send(white, uci('e5f7'));
    const s = st(black);
    expect(s.moves.at(-1)!.exploded.split(' ').sort()).toEqual(['e8', 'f7', 'f8', 'g8']);
    await waitFor(() => st(white).phase === 'RESULTS', 3000, 'results');
    expect(st(white).result).toMatchObject({ winner: 'first', reason: 'explosion', text: 'White wins — the enemy king exploded' });
    expect(outcomes.at(-1)!.outcome.details).toMatchObject({ variant: 'atomic' });
  });

  it('King of the Hill: reaching the centre wins', async () => {
    const { white, server } = await startGame({ variant: 'kingofthehill' });
    loadFen(server, 'kingofthehill', '4k3/8/8/8/8/4K3/8/8 w - - 0 1');
    await send(white, uci('e3e4'));
    await waitFor(() => st(white).phase === 'RESULTS', 3000, 'results');
    expect(st(white).result).toMatchObject({ winner: 'first', reason: 'hill', text: 'White wins — king reached the hill' });
  });

  it('Antichess: the refusal says a capture is compulsory; the king can promote', async () => {
    const { white, black, server } = await startGame({ variant: 'antichess' });
    await playLine(white, black, ['e2e3', 'b7b5']);
    await send(white, uci('a2a3'), false);
    expect(white.errors.at(-1)?.message).toBe('You must capture.');
    loadFen(server, 'antichess', '8/P7/8/8/8/8/8/7k w - - 0 1');
    await send(white, uci('a7a8k'));
    expect(st(white).moves.at(-1)).toMatchObject({ san: 'a8=K', promotion: 'k' });
  });

  it('a king promotion is refused outside Antichess', async () => {
    const { white, server } = await startGame({ variant: 'threecheck' });
    loadFen(server, 'threecheck', '7k/P7/8/8/8/8/8/K7 w - - 3+3 0 1');
    await send(white, uci('a7a8k'), false);
    await send(white, uci('a7a8q'));
  });

  it('the PGN carries the variant (and the Chess960 start)', async () => {
    const { white, black } = await startGame({ variant: 'chess960' });
    await playLine(white, black, ['a2a3']);
    black.room.send('chess:resign', {});
    await waitFor(() => st(white).phase === 'RESULTS', 3000, 'results');
    const pgn = st(white).pgn;
    expect(pgn).toContain('[Variant "Chess960"]');
    expect(pgn).toContain('[SetUp "1"]');
    expect(pgn).toContain(`[FEN "${st(white).startFen}"]`);
    expect(pgn).toContain('1. a3');
  });

  it('a timeout in Three-Check against a lone king is a draw', async () => {
    const { white, server } = await startGame({ variant: 'threecheck', timeControl: { baseMinutes: 1, incrementSeconds: 0 } });
    loadFen(server, 'threecheck', '7k/8/8/8/8/8/8/K6Q b - - 3+3 0 1');
    expect((server as any).canWinOnTime('second')).toBe(false);
    expect((server as any).canWinOnTime('first')).toBe(true);
    void white;
  });
});

describe('DAS Chess variants — ratings and tournaments', () => {
  it('only Standard is rated', async () => {
    const variant = await startGame({ variant: 'atomic', rated: true }, { guestIds: true });
    expect(st(variant.white).rated).toBe(false);
    expect(st(variant.white).undoAllowed).toBe(true);
    variant.black.room.send('chess:resign', {});
    await waitFor(() => st(variant.white).phase === 'RESULTS', 3000, 'results');
    expect(outcomes.at(-1)!.ctx.rated).toBe(false);
    expect(getRating('g:guest-hera-0001', 'chess').games).toBe(0);
    await colyseus.cleanup();
    const standard = await startGame({ variant: 'standard', rated: true }, { guestIds: true });
    expect(st(standard.white).rated).toBe(true);
  });

  it('a tournament can play a variant (unrated)', async () => {
    const { org, players } = await setupField(2, {
      gameId: 'chess',
      format: 'single_elimination',
      bestOf: 1,
      gameSettings: { timeControl: { baseMinutes: 3, incrementSeconds: 2 }, variant: 'racingkings' },
    });
    await admin(org, 'begin');
    const [a, b] = players as [(typeof players)[number], (typeof players)[number]];
    await waitFor(() => Boolean(a.me().activeMatch && b.me().activeMatch), 3000, 'tickets');
    const sa = await takeSeat(a, 'Player1');
    const sb = await takeSeat(b, 'Player2');
    await waitPhase(sa.room, 'PLAYING', 8000);
    const state = (sa.room.state as unknown as { toJSON(): ChessPublicState }).toJSON();
    expect(state.variant).toBe('racingkings');
    expect(state.fen.startsWith('8/8/8/8/8/8/krbnNBRK/qrbnNBRQ w')).toBe(true);
    expect(state.rated).toBe(false);
    sb.room.send('chess:resign', {});
    await waitFor(() => org.view().status === 'COMPLETE', 4000, 'tournament complete');
    expect(getRating('g:guest-Player1', 'chess').games).toBe(0);
  });
});
