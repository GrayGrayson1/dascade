import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import { createSeededRng, type GameOutcome, type TournamentMatchInfo, type WelcomePayload } from '@dascade/shared';
import type { BoardEvent, BoardSide } from '@dascade/shared/games/boardroom';
import type { ChessPublicState } from '@dascade/shared/games/chess';
import { ChessGame, sansFromPgn } from '@dascade/game-core/chess';
import { bootTestServer, collect, quiet, sleep, waitFor } from './helpers.ts';
import type { ChessRoom } from '../src/rooms/chess/ChessRoom.ts';
import { onOutcome, type OutcomeContext } from '../src/platform/hub.ts';
import { getRating, resetRatings } from '../src/platform/ratings.ts';

let colyseus: ColyseusTestServer;
const outcomes: Array<{ outcome: GameOutcome; ctx: OutcomeContext }> = [];
let unsubscribe: () => void = () => undefined;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['chess']));
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
  events: BoardEvent[];
  me: () => WelcomePayload;
}

async function wire(room: SdkRoom): Promise<Client> {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<ErrorPayload>(room, 'sys:error');
  const events = collect<BoardEvent>(room, 'chess:boardEvent');
  quiet(room);
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, 'welcome');
  return { room, errors, events, me: () => welcomes[welcomes.length - 1]! };
}

const st = (c: Client) => (c.room.state as any).toJSON() as ChessPublicState;

async function createRoom(settings: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const host = await wire(await colyseus.sdk.create('chess', { name: 'Hera', settings, ...extra }));
  const server = colyseus.getRoomById(host.room.roomId) as unknown as ChessRoom;
  (server as any).countdownMs = 0;
  return { host, server };
}

async function join(code: string, name: string, extra: Record<string, unknown> = {}) {
  return wire(await colyseus.sdk.joinById(code, { name, ...extra }));
}

/** Two players, host White, started. */
async function startGame(settings: Record<string, unknown> = {}, opts: { guestIds?: boolean; before?: (server: ChessRoom) => void } = {}) {
  const { host, server } = await createRoom({ sides: 'host_first', ...settings }, opts.guestIds ? { guestId: 'guest-hera-0001' } : {});
  const guest = await join(host.room.roomId, 'Gus', opts.guestIds ? { guestId: 'guest-gus-00002' } : {});
  opts.before?.(server);
  host.room.send('lobby:start', {});
  await waitFor(() => st(host).phase === 'PLAYING' && st(guest).phase === 'PLAYING', 3000, 'playing');
  return { host, guest, server, white: host, black: guest };
}

async function move(c: Client, uci: string, expectOk = true) {
  const before = st(c).ply;
  const errs = c.errors.length;
  c.room.send('chess:move', { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4], ply: before });
  if (expectOk) await waitFor(() => st(c).ply > before, 3000, `move ${uci} (errors: ${JSON.stringify(c.errors.slice(errs))})`);
  else await waitFor(() => c.errors.length > errs, 3000, `rejection of ${uci}`);
}

/** Plays alternating moves starting with whoever is to move. */
async function playLine(white: Client, black: Client, line: string[]) {
  const firstIsWhite = st(white).turn === 'first';
  for (let i = 0; i < line.length; i++) await move((i % 2 === 0) === firstIsWhite ? white : black, line[i]!);
}

/** Load a position into the server (test-only shortcut; sides/turn are kept consistent). */
function loadFen(server: ChessRoom, fen: string) {
  (server as any).game = new ChessGame(fen);
  server.state.moves.clear();
  server.state.turn = fen.split(' ')[1] === 'b' ? 'second' : 'first';
  (server as any).publishPosition();
}

// ---------------------------------------------------------------------------

describe('DAS Chess room — moves', () => {
  it('seats both players, accepts legal moves in turn and publishes the position to everyone', async () => {
    const { white, black, host } = await startGame();
    const rail = await join(host.room.roomId, 'Rail', { spectator: true });
    const s = st(white);
    expect(s.seats.map((x) => x.playerId)).toEqual([white.me().playerId, black.me().playerId]);
    expect(s.seats.map((x) => x.side)).toEqual(['first', 'second']);
    expect(s.turn).toBe('first');
    expect(s.clock.enabled).toBe(true);
    expect(s.clock.running).toBe('first');
    expect(s.fen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

    await move(white, 'e2e4');
    await waitFor(() => st(rail).ply === 1);
    const after = st(rail);
    expect(after.moves[0]).toMatchObject({ san: 'e4', from: 'e2', to: 'e4', color: 'w', piece: 'p' });
    expect(after.turn).toBe('second');
    expect(after.clock.running).toBe('second');
    expect(after.fen.split(' ')[1]).toBe('b');
    // Increment was added to White's clock (10+5 default).
    expect(after.moves[0]!.clockMs).toBeGreaterThan(600_000);
    await move(black, 'e7e5');
    expect(st(white).moves.map((m) => m.san)).toEqual(['e4', 'e5']);
  });

  it('rejects out-of-turn, illegal, stale and duplicate moves; spectators cannot move', async () => {
    const { white, black, host } = await startGame();
    const rail = await join(host.room.roomId, 'Rail', { spectator: true });
    await move(black, 'e7e5', false);
    expect(black.errors.at(-1)!.code).toBe('not_your_turn');
    await move(white, 'e2e5', false);
    expect(white.errors.at(-1)!.message).toMatch(/not legal/);
    await move(white, 'e1e2', false);
    // Garbage payloads never reach the rules.
    white.room.send('chess:move', { from: 'z9', to: 'e4', ply: 0 });
    white.room.send('chess:move', { from: 'e2', to: 'e4' });
    await waitFor(() => white.errors.filter((e) => e.code === 'invalid_payload').length === 2);
    // Spectator.
    rail.room.send('chess:move', { from: 'e2', to: 'e4', ply: 0 });
    await waitFor(() => rail.errors.length > 0);
    expect(rail.errors.at(-1)!.code).toBe('not_allowed');
    expect(st(white).ply).toBe(0);

    // Duplicate: the same move sent twice only applies once (second one is stale).
    white.room.send('chess:move', { from: 'e2', to: 'e4', ply: 0 });
    white.room.send('chess:move', { from: 'e2', to: 'e4', ply: 0 });
    await waitFor(() => st(white).ply === 1);
    await sleep(150);
    expect(st(white).ply).toBe(1);
    expect(st(white).moves).toHaveLength(1);
    // A stale ply is refused even when it is otherwise legal for the side to move.
    black.room.send('chess:move', { from: 'e7', to: 'e5', ply: 0 });
    await waitFor(() => black.errors.some((e) => /position changed/.test(e.message)));
    expect(st(white).ply).toBe(1);
  });

  it('plays castling, en passant and promotion (piece choice required)', async () => {
    const { white, black, server } = await startGame();
    await playLine(white, black, ['e2e4', 'a7a6', 'e4e5', 'd7d5']);
    await move(white, 'e5d6'); // en passant
    expect(st(white).moves.at(-1)).toMatchObject({ san: 'exd6', enPassant: true, captured: 'p' });
    await playLine(white, black, ['a6a5', 'g1f3', 'a5a4', 'f1e2', 'b7b6']);
    await move(white, 'e1g1');
    expect(st(white).moves.at(-1)).toMatchObject({ san: 'O-O', castle: 'k' });
    const local = new ChessGame();
    for (const m of ['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6', 'a6a5', 'g1f3', 'a5a4', 'f1e2', 'b7b6', 'e1g1']) {
      local.move({ from: m.slice(0, 2), to: m.slice(2, 4) });
    }
    expect(st(white).fen).toBe(local.fen);
    expect(st(white).fen.split(' ')[0]!.endsWith('RNBQ1RK1')).toBe(true);

    loadFen(server, '8/P6k/8/8/8/8/8/K7 w - - 0 1');
    await move(white, 'a7a8', false);
    expect(white.errors.at(-1)!.message).toMatch(/promote/i);
    await move(white, 'a7a8n');
    expect(st(white).moves.at(-1)).toMatchObject({ san: 'a8=N', promotion: 'n' });
  });

  it('keeps turns strictly alternating over seeded random playouts', async () => {
    const { white, black } = await startGame({ timeControl: { baseMinutes: 0, incrementSeconds: 0 } });
    const rng = createSeededRng('room-playout');
    const local = new ChessGame();
    for (let i = 0; i < 30 && !local.status(); i++) {
      const side: BoardSide = i % 2 === 0 ? 'first' : 'second';
      expect(st(white).turn).toBe(side);
      const mover = side === 'first' ? white : black;
      const other = side === 'first' ? black : white;
      const legal = local.legalMoves();
      const pick = legal[rng.int(legal.length)]!;
      // The waiting side can never move (checked every few plies to stay under the move rate limit).
      if (i % 4 === 1) {
        const errs = other.errors.length;
        other.room.send('chess:move', { from: pick.from, to: pick.to, promotion: pick.promotion || undefined, ply: i });
        await waitFor(() => other.errors.length > errs);
        expect(other.errors.at(-1)!.code).toBe('not_your_turn');
      }
      await move(mover, `${pick.from}${pick.to}${pick.promotion}`);
      await sleep(110); // human pace — the move bucket (burst 12, 5/s) rejects floods
      local.move({ from: pick.from, to: pick.to, promotion: pick.promotion || undefined });
      expect(st(white).fen).toBe(local.fen);
    }
  });
});

describe('DAS Chess room — endings', () => {
  it("ends on checkmate with a result, PGN and a reported outcome (fool's mate)", async () => {
    const { white, black } = await startGame();
    await playLine(white, black, ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
    await waitFor(() => st(white).phase === 'RESULTS');
    const s = st(white);
    expect(s.result).toMatchObject({ over: true, winner: 'second', reason: 'checkmate', text: 'Black wins by checkmate' });
    expect(s.clock.running).toBe('');
    expect(s.inCheck).toBe(true);
    expect(s.checkSquare).toBe('e1');
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.outcome.placements).toEqual([[black.me().playerId], [white.me().playerId]]);
    expect(outcomes[0]!.outcome.reason).toBe('checkmate');
    expect((outcomes[0]!.outcome.details as any).playerStats).toEqual({ [black.me().playerId]: { checkmates: 1 } });
    // PGN export.
    expect(s.pgn).toContain('[Event "DASCADE"]');
    expect(s.pgn).toContain('[White "Hera"]');
    expect(s.pgn).toContain('[Black "Gus"]');
    expect(s.pgn).toContain('[Result "0-1"]');
    expect(s.pgn).toContain('[TimeControl "600+5"]');
    expect(s.pgn).toContain('[Termination "normal"]');
    expect(s.pgn).toMatch(/\[%clk 0:1\d:\d\d\]/);
    expect(sansFromPgn(s.pgn)).toEqual(['f3', 'e5', 'g4', 'Qh4#']);
    // No further moves.
    white.room.send('chess:move', { from: 'a2', to: 'a3', ply: 4 });
    await waitFor(() => white.errors.length > 0);
    expect(st(white).ply).toBe(4);
  });

  it('ends on stalemate', async () => {
    const { white, black } = await startGame();
    // Sam Loyd's ten-move stalemate.
    await playLine(white, black, [
      'e2e3',
      'a7a5',
      'd1h5',
      'a8a6',
      'h5a5',
      'h7h5',
      'h2h4',
      'a6h6',
      'a5c7',
      'f7f6',
      'c7d7',
      'e8f7',
      'd7b7',
      'd8d3',
      'b7b8',
      'd3h7',
      'b8c8',
      'f7g6',
      'c8e6',
    ]);
    await waitFor(() => st(white).phase === 'RESULTS');
    expect(st(white).result).toMatchObject({ winner: 'draw', reason: 'stalemate', text: 'Draw by stalemate' });
    expect(outcomes[0]!.outcome.placements).toEqual([[white.me().playerId, black.me().playerId]]);
  });

  it('ends automatically on threefold repetition', async () => {
    const { white, black } = await startGame();
    await playLine(white, black, ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1']);
    expect(st(white).repetition).toBe(2);
    expect(st(white).phase).toBe('PLAYING');
    await move(black, 'f6g8');
    await waitFor(() => st(white).phase === 'RESULTS');
    expect(st(white).result).toMatchObject({ winner: 'draw', reason: 'repetition' });
  });

  it('ends automatically on the fifty-move rule and on insufficient material', async () => {
    const a = await startGame();
    loadFen(a.server, '8/8/8/4k3/8/8/1R6/K6R w - - 99 80');
    await move(a.white, 'h1h2');
    await waitFor(() => st(a.white).phase === 'RESULTS');
    expect(st(a.white).result).toMatchObject({ winner: 'draw', reason: 'fifty_moves', text: 'Draw by the fifty-move rule' });

    const b = await startGame();
    loadFen(b.server, '8/8/8/4k3/8/3q4/4K3/8 w - - 0 1');
    await move(b.white, 'e2d3');
    await waitFor(() => st(b.white).phase === 'RESULTS');
    expect(st(b.white).result).toMatchObject({ winner: 'draw', reason: 'insufficient' });
  });

  it('draw offers: offer → decline, a move declines the pending offer, one offer per move, offer → accept', async () => {
    const { white, black } = await startGame();
    white.room.send('chess:draw', { action: 'offer' });
    await waitFor(() => st(black).offers.drawBy === 'first');
    black.room.send('chess:draw', { action: 'decline' });
    await waitFor(() => st(black).offers.drawBy === '');
    // Same player can't re-offer before moving again.
    white.room.send('chess:draw', { action: 'offer' });
    await waitFor(() => white.errors.some((e) => /after your next move/.test(e.message)));
    await move(white, 'e2e4');
    // Black offers on its own turn and then moves: the offer stands for White to answer…
    black.room.send('chess:draw', { action: 'offer' });
    await waitFor(() => st(white).offers.drawBy === 'second');
    await move(black, 'e7e5');
    expect(st(white).offers.drawBy).toBe('second');
    // …and White moving instead of answering declines it.
    await move(white, 'g1f3');
    expect(st(white).offers.drawBy).toBe('');
    expect(white.events.some((e) => e.type === 'offer' && e.kind === 'draw' && e.action === 'expired')).toBe(true);
    // Offer → accept.
    black.room.send('chess:draw', { action: 'offer' });
    await waitFor(() => st(white).offers.drawBy === 'second');
    white.room.send('chess:draw', { action: 'accept' });
    await waitFor(() => st(white).phase === 'RESULTS');
    expect(st(white).result).toMatchObject({ winner: 'draw', reason: 'agreement', text: 'Draw by agreement' });
    expect(outcomes[0]!.outcome.placements).toEqual([[white.me().playerId, black.me().playerId]]);
  });

  it('resignation ends the game for the opponent; spectators cannot resign', async () => {
    const { white, black, host } = await startGame();
    const rail = await join(host.room.roomId, 'Rail', { spectator: true });
    rail.room.send('chess:resign', {});
    await waitFor(() => rail.errors.length > 0);
    expect(st(white).phase).toBe('PLAYING');
    black.room.send('chess:resign', {});
    await waitFor(() => st(white).phase === 'RESULTS');
    expect(st(white).result).toMatchObject({ winner: 'first', reason: 'resign', text: 'White wins — Black resigned' });
    expect(outcomes[0]!.outcome.placements).toEqual([[white.me().playerId], [black.me().playerId]]);
    expect(st(white).pgn).toContain('[Result "1-0"]');
    // Duplicate resign after the end never reports twice.
    white.room.send('chess:resign', {});
    await sleep(150);
    expect(outcomes).toHaveLength(1);
  });

  it('flags on the server clock (tiny time control) and draws when the winner has no mating material', async () => {
    const a = await startGame({}, { before: (s) => (s.clockOverride = { baseMs: 350, incrementMs: 0 }) });
    await waitFor(() => st(a.white).phase === 'RESULTS', 3000, 'flag');
    expect(st(a.white).result).toMatchObject({ winner: 'second', reason: 'timeout', text: 'Black wins on time' });
    expect(st(a.white).clock.flagged).toBe('first');
    expect(st(a.white).clock.firstMs).toBe(0);
    expect(a.white.events.some((e) => e.type === 'flag' && e.side === 'first')).toBe(true);
    expect(st(a.white).pgn).toContain('[Termination "time forfeit"]');

    // Flag against a lone king: deterministic via the overdue check (no race with a tiny clock).
    const b = await startGame({}, { before: (s) => (s.clockOverride = { baseMs: 60_000, incrementMs: 0 }) });
    loadFen(b.server, '4k3/8/8/8/8/8/8/Q3K3 w - - 0 1'); // White to move; Black has a lone king
    b.server.state.clock.turnStartedAt = Date.now() - 61_000;
    b.white.room.send('chess:move', { from: 'a1', to: 'a2', ply: 0 });
    await waitFor(() => st(b.white).phase === 'RESULTS', 3000, 'flag');
    expect(st(b.white).result).toMatchObject({ winner: 'draw', reason: 'timeout_insufficient' });
  });

  it('untimed games: the waiting player may claim the win after the idle limit; the idle side forfeits at the hard limit', async () => {
    const untimed = { timeControl: { baseMinutes: 0, incrementSeconds: 0 } };
    const a = await startGame(untimed, { before: (s) => ((s.untimedClaimMs = 1_500), (s.untimedForfeitMs = 60_000)) });
    expect(st(a.white).clock.enabled).toBe(false);
    await move(a.white, 'e2e4');
    expect(st(a.white).idleClaimAt).toBeGreaterThan(Date.now());
    // Too early, and the side to move can't claim.
    a.white.room.send('chess:claim', {});
    await waitFor(() => a.white.errors.some((e) => /not moved for a while/.test(e.message)));
    a.black.room.send('chess:claim', {});
    await waitFor(() => a.black.errors.some((e) => /your move/.test(e.message)));
    await waitFor(() => Date.now() > st(a.white).idleClaimAt + 50, 3000, 'claim window');
    a.white.room.send('chess:claim', {});
    await waitFor(() => st(a.white).phase === 'RESULTS');
    expect(st(a.white).result).toMatchObject({ winner: 'first', reason: 'idle', text: 'White wins — Black stopped moving' });

    const b = await startGame(untimed, { before: (s) => ((s.untimedClaimMs = 100), (s.untimedForfeitMs = 300)) });
    await waitFor(() => st(b.white).phase === 'RESULTS', 3000, 'idle forfeit');
    expect(st(b.white).result).toMatchObject({ winner: 'second', reason: 'idle' });

    // Timed games leave it to the clock.
    const c = await startGame();
    expect(st(c.white).idleClaimAt).toBe(0);
    await move(c.white, 'e2e4');
    c.white.room.send('chess:claim', {});
    await waitFor(() => c.white.errors.some((e) => /clock decides/.test(e.message)));
  });

  it('never accepts a move after the flag fell, even before the timer fires', async () => {
    const { white, server } = await startGame({}, { before: (s) => (s.clockOverride = { baseMs: 60_000, incrementMs: 0 }) });
    // Simulate a late timer: rewind the turn start so White is already out of time.
    server.state.clock.turnStartedAt = Date.now() - 61_000;
    white.room.send('chess:move', { from: 'e2', to: 'e4', ply: 0 });
    await waitFor(() => st(white).phase === 'RESULTS');
    expect(st(white).ply).toBe(0);
    expect(st(white).result.reason).toBe('timeout');
  });
});

describe('DAS Chess room — premoves, take-backs, ratings', () => {
  it('validates a premove like any move when it is finally sent', async () => {
    const { white, black } = await startGame();
    await move(white, 'e2e4');
    // Early (out of turn) premove from White is refused by the server.
    await move(white, 'd2d4', false);
    expect(white.errors.at(-1)!.code).toBe('not_your_turn');
    await move(black, 'd7d5');
    // Now the premove is sent at the new ply and accepted.
    await move(white, 'e4d5');
    await move(black, 'd8d5');
    // A premove that the new position made illegal (the e-pawn is gone) is refused, nothing changes.
    const before = st(white).fen;
    await move(white, 'e4e5', false);
    expect(white.errors.at(-1)!.message).toMatch(/not legal/);
    expect(st(white).fen).toBe(before);
  });

  it('take-backs in casual games: request → accept undoes 1 or 2 plies; decline keeps the position', async () => {
    const { white, black } = await startGame();
    await move(white, 'e2e4');
    white.room.send('chess:undo', { action: 'offer' });
    await waitFor(() => st(black).offers.undoBy === 'first');
    expect(st(black).offers.undoPlies).toBe(1);
    black.room.send('chess:undo', { action: 'decline' });
    await waitFor(() => st(black).offers.undoBy === '');
    expect(st(white).ply).toBe(1);
    // Can't ask twice for the same move.
    white.room.send('chess:undo', { action: 'offer' });
    await waitFor(() => white.errors.some((e) => /already asked/.test(e.message)));

    await move(black, 'e7e5');
    // White (to move) asks: takes back Black's reply and White's own move.
    white.room.send('chess:undo', { action: 'offer' });
    await waitFor(() => st(black).offers.undoPlies === 2);
    black.room.send('chess:undo', { action: 'accept' });
    await waitFor(() => st(white).ply === 0);
    const s = st(white);
    expect(s.turn).toBe('first');
    expect(s.moves).toHaveLength(0);
    expect(s.fen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(s.clock.running).toBe('first');
    // Black with no moves can't ask.
    black.room.send('chess:undo', { action: 'offer' });
    await waitFor(() => black.errors.some((e) => /no move to take back/.test(e.message)));
    // The position after a take-back plays on normally.
    await move(white, 'd2d4');
  });

  it('rated games: no take-backs, ratings change; casual games leave ratings untouched', async () => {
    const casual = await startGame({}, { guestIds: true });
    expect(st(casual.white).rated).toBe(false);
    expect(st(casual.white).undoAllowed).toBe(true);
    casual.black.room.send('chess:resign', {});
    await waitFor(() => st(casual.white).phase === 'RESULTS');
    expect(getRating('g:guest-hera-0001', 'chess').games).toBe(0);
    expect(st(casual.white).seats.every((s) => s.ratingDelta === 0)).toBe(true);

    const rated = await startGame({ rated: true }, { guestIds: true });
    const s0 = st(rated.white);
    expect(s0.rated).toBe(true);
    expect(s0.undoAllowed).toBe(false);
    expect(s0.seats[0]).toMatchObject({ rating: 1200, provisional: true, ratingGames: 0 });
    await move(rated.white, 'e2e4');
    rated.white.room.send('chess:undo', { action: 'offer' });
    await waitFor(() => rated.white.errors.some((e) => /Take-backs are off/.test(e.message)));
    rated.black.room.send('chess:resign', {});
    await waitFor(() => st(rated.white).phase === 'RESULTS');
    const s1 = st(rated.white);
    expect(s1.seats[0]!.ratingDelta).toBeGreaterThan(0);
    expect(s1.seats[1]!.ratingDelta).toBeLessThan(0);
    expect(getRating('g:guest-hera-0001', 'chess')).toMatchObject({ games: 1, wins: 1 });
    expect(getRating('g:guest-gus-00002', 'chess')).toMatchObject({ games: 1, losses: 1 });
    expect(outcomes.at(-1)!.ctx.rated).toBe(true);
  });
});

describe('DAS Chess room — rating integrity', () => {
  it('self-play in two tabs (one browser identity on both seats) never moves the rating, even when rated', async () => {
    const host = await wire(await colyseus.sdk.create('chess', { name: 'Tab A', guestId: 'guest-self-0001', settings: { rated: true, sides: 'host_first' } }));
    const server = colyseus.getRoomById(host.room.roomId) as unknown as ChessRoom;
    (server as any).countdownMs = 0;
    const twin = await join(host.room.roomId, 'Tab B', { guestId: 'guest-self-0001' });
    host.room.send('lobby:start', {});
    await waitFor(() => st(host).phase === 'PLAYING', 3000, 'playing');
    expect(st(host).rated).toBe(true);
    twin.room.send('chess:resign', {});
    await waitFor(() => st(host).phase === 'RESULTS', 3000, 'results');
    expect(outcomes.at(-1)!.ctx.rated).toBe(true);
    expect(getRating('g:guest-self-0001', 'chess').games).toBe(0);
    expect(st(host).seats.map((s) => s.ratingDelta)).toEqual([0, 0]);
  });
});

describe('DAS Chess room — connections, rematch, tournaments', () => {
  it('reconnect restores the seat and the full position', async () => {
    const { white, black } = await startGame();
    await move(white, 'e2e4');
    const clockBefore = st(white).clock;
    expect(clockBefore.running).toBe('second');
    black.room.reconnection.minUptime = 0;
    const back = new Promise<void>((r) => black.room.onReconnect(() => r()));
    (black.room as any).connection.transport.ws.close(4010);
    await waitFor(() => st(white).players[black.me().playerId]?.connected === false);
    await waitFor(() => st(white).seats[1]!.awayDeadline > Date.now());
    await back;
    await waitFor(() => st(white).players[black.me().playerId]?.connected === true);
    expect(st(white).seats[1]!.awayDeadline).toBe(0);
    // The clock never pauses or restarts for a disconnect: Black's time kept running the whole while.
    const clockAfter = st(black).clock;
    expect(clockAfter.running).toBe('second');
    expect(clockAfter.turnStartedAt).toBe(clockBefore.turnStartedAt);
    expect(clockAfter.secondMs).toBe(clockBefore.secondMs);
    expect(st(black).moves.map((m) => m.san)).toEqual(['e4']);
    expect(st(black).turn).toBe('second');
    await move(black, 'e7e5');
  });

  it('a player who stays away past the grace period forfeits by abandonment; leaving forfeits at once', async () => {
    const a = await startGame({}, { before: (s) => ((s as any).reconnectGraceSeconds = 0.3) });
    a.black.room.reconnection.enabled = false;
    (a.black.room as any).connection.transport.ws.close(4010);
    await waitFor(() => st(a.white).phase === 'RESULTS', 4000, 'abandonment');
    expect(st(a.white).result).toMatchObject({ winner: 'first', reason: 'abandoned' });

    const b = await startGame();
    await b.white.room.leave(true);
    await waitFor(() => st(b.black).phase === 'RESULTS', 3000, 'forfeit');
    expect(st(b.black).result).toMatchObject({ winner: 'second', reason: 'forfeit' });
    expect(outcomes.at(-1)!.outcome.placements).toEqual([[b.black.me().playerId], [b.white.me().playerId]]);
  });

  it('a host who kicks their opponent concedes the game', async () => {
    const { white, black } = await startGame();
    white.room.send('lobby:kick', { playerId: black.me().playerId });
    await waitFor(() => st(white).phase === 'RESULTS');
    expect(st(white).result).toMatchObject({ winner: 'second', reason: 'forfeit' });
  });

  it('a playing host cannot erase a live game with "back to lobby" or by closing the room — they concede it', async () => {
    // Rated: host (White) is losing and tries to reset the room → White concedes, ratings move.
    const rated = await startGame({ rated: true }, { guestIds: true });
    await move(rated.white, 'e2e4');
    rated.white.room.send('lobby:toLobby', {});
    await waitFor(() => outcomes.length === 1, 3000, 'rated outcome');
    expect(outcomes[0]!.outcome).toMatchObject({ placements: [[rated.black.me().playerId], [rated.white.me().playerId]], reason: 'forfeit' });
    expect(outcomes[0]!.ctx.rated).toBe(true);
    expect(getRating('g:guest-gus-00002', 'chess')).toMatchObject({ games: 1, wins: 1 });
    await waitFor(() => st(rated.black).phase === 'LOBBY', 3000, 'back in the lobby');

    // Casual, nobody has moved yet: the host may simply abandon it (no result).
    const fresh = await startGame();
    fresh.white.room.send('lobby:toLobby', {});
    await waitFor(() => st(fresh.black).phase === 'LOBBY', 3000, 'aborted before the first move');
    expect(outcomes).toHaveLength(1);

    // Casual after a move: closing the room concedes it too.
    const casual = await startGame();
    await move(casual.white, 'e2e4');
    await move(casual.black, 'e7e5');
    casual.white.room.send('lobby:close', {});
    await waitFor(() => outcomes.length === 2, 3000, 'casual outcome on close');
    expect(outcomes[1]!.outcome).toMatchObject({ placements: [[casual.black.me().playerId], [casual.white.me().playerId]], reason: 'forfeit' });
  });

  it('a non-playing host cannot end a live rated game', async () => {
    const host = await wire(await colyseus.sdk.create('chess', { name: 'Ref', spectator: true, settings: { rated: true } }));
    const server = colyseus.getRoomById(host.room.roomId) as unknown as ChessRoom;
    (server as any).countdownMs = 0;
    const a = await join(host.room.roomId, 'Ana', { guestId: 'guest-ana-00001' });
    await join(host.room.roomId, 'Bea', { guestId: 'guest-bea-00001' });
    host.room.send('lobby:start', {});
    await waitFor(() => st(a).phase === 'PLAYING', 3000, 'playing');
    host.room.send('lobby:toLobby', {});
    await waitFor(() => host.errors.some((e) => e.type === 'lobby:toLobby' && /only be ended by its players/.test(e.message)), 3000, 'refused');
    host.room.send('lobby:close', {});
    await waitFor(() => host.errors.some((e) => e.type === 'lobby:close'), 3000, 'close refused');
    await sleep(100);
    expect(st(a).phase).toBe('PLAYING');
    expect(st(a).result.over).toBe(false);
    expect(outcomes).toHaveLength(0);
  });

  it('a non-playing host cannot decide a rated game by kicking a player (casual games keep moderation)', async () => {
    const play = async (rated: boolean) => {
      const host = await wire(
        await colyseus.sdk.create('chess', { name: 'Ref', spectator: true, guestId: 'guest-ref-00001', settings: { rated } }),
      );
      const server = colyseus.getRoomById(host.room.roomId) as unknown as ChessRoom;
      (server as any).countdownMs = 0;
      const a = await join(host.room.roomId, 'Ana', { guestId: 'guest-ana-00001' });
      const b = await join(host.room.roomId, 'Bea', { guestId: 'guest-bea-00001' });
      host.room.send('lobby:start', {});
      await waitFor(() => st(a).phase === 'PLAYING' && st(b).phase === 'PLAYING', 3000, 'playing');
      expect(st(a).rated).toBe(rated);
      expect(st(a).hostId).toBe(host.me().playerId);
      const errs = host.errors.length;
      host.room.send('lobby:kick', { playerId: a.me().playerId });
      return { host, a, b, errs };
    };

    const rated = await play(true);
    await waitFor(() => rated.host.errors.length > rated.errs, 3000, 'kick refused');
    expect(rated.host.errors.at(-1)!.message).toMatch(/rated game/);
    expect(st(rated.b).phase).toBe('PLAYING');
    expect(st(rated.b).result.over).toBe(false);
    expect(st(rated.b).players[rated.a.me().playerId]).toBeDefined();
    expect(outcomes).toHaveLength(0);
    // The players can still finish it themselves.
    rated.a.room.send('chess:resign', {});
    await waitFor(() => st(rated.b).phase === 'RESULTS');
    expect(outcomes).toHaveLength(1);

    const casual = await play(false);
    await waitFor(() => st(casual.b).phase === 'RESULTS', 3000, 'casual kick forfeits');
    const aSide = st(casual.b).seats.find((s) => s.playerId === casual.a.me().playerId)!.side;
    expect(st(casual.b).result).toMatchObject({ winner: aSide === 'first' ? 'second' : 'first', reason: 'forfeit' });
  });

  it('rematch: both players agree → a new game with colours swapped', async () => {
    const { white, black } = await startGame();
    black.room.send('chess:resign', {});
    await waitFor(() => st(white).phase === 'RESULTS');
    // Moves are refused in RESULTS; spectators/outsiders can't vote.
    white.room.send('chess:rematch', { action: 'offer' });
    await waitFor(() => st(black).offers.rematch.includes('first'));
    black.room.send('chess:rematch', { action: 'decline' });
    await waitFor(() => st(black).offers.rematch.length === 0);
    white.room.send('chess:rematch', { action: 'offer' });
    await waitFor(() => st(black).offers.rematch.includes('first'));
    black.room.send('chess:rematch', { action: 'accept' });
    await waitFor(() => st(white).phase === 'PLAYING' && st(white).gameNumber === 2, 4000, 'rematch');
    const s = st(white);
    expect(s.seats[0]!.playerId).toBe(black.me().playerId);
    expect(s.seats[1]!.playerId).toBe(white.me().playerId);
    expect(s.ply).toBe(0);
    expect(s.result.over).toBe(false);
    expect(s.moves).toHaveLength(0);
    await move(black, 'e2e4');
    // Second game reports its own outcome.
    white.room.send('chess:resign', {});
    await waitFor(() => outcomes.length === 2);
    expect(outcomes[1]!.outcome.placements).toEqual([[black.me().playerId], [white.me().playerId]]);
  });

  it('tournament matches take sides from the Tournament Center, are rated, and allow no take-backs or rematches', async () => {
    const { host, server } = await createRoom({ sides: 'host_first' });
    const guest = await join(host.room.roomId, 'Gus');
    const info: TournamentMatchInfo = {
      tournamentCode: 'TOURN',
      tournamentName: 'Friday Blitz',
      matchId: 'm1',
      roundLabel: 'Final',
      format: 'single_elimination',
      bestOf: 1,
      gameNumber: 1,
      seriesScore: {},
      participants: [
        { participantId: 'p1', name: 'Hera', seed: 1, playerId: host.me().playerId, side: 'second' },
        { participantId: 'p2', name: 'Gus', seed: 2, playerId: guest.me().playerId, side: 'first' },
      ],
    };
    (server as any).tournamentInfo = info;
    host.room.send('lobby:start', {});
    await waitFor(() => st(host).phase === 'PLAYING');
    const s = st(host);
    expect(s.seats[0]!.playerId).toBe(guest.me().playerId); // 'first' = White
    expect(s.rated).toBe(true);
    expect(s.undoAllowed).toBe(false);
    await move(guest, 'e2e4');
    guest.room.send('chess:undo', { action: 'offer' });
    await waitFor(() => guest.errors.some((e) => /Take-backs are off/.test(e.message)));
    host.room.send('chess:resign', {});
    await waitFor(() => st(host).phase === 'RESULTS');
    expect(st(host).pgn).toContain('[Event "DASCADE — Friday Blitz"]');
    guest.room.send('chess:rematch', { action: 'offer' });
    await waitFor(() => guest.errors.some((e) => /Tournament Center/.test(e.message)));
  });
});
