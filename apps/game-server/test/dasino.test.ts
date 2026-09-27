import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import { createSeededRng, type GameOutcome, type Rng, type WelcomePayload } from '@dascade/shared';
import { DASINO_MSG, type DasinoPrivatePayload, type DasinoPublicState, type SlotResultPayload } from '@dascade/shared/games/dasino';
import { SLOT_REELS, settleRouletteBets } from '@dascade/game-core/dasino';
import { collect, freePort, quiet, sleep, waitFor } from './helpers.ts';
import { createDascadeServer } from '../src/server.ts';
import type { DasinoRoom } from '../src/rooms/dasino/DasinoRoom.ts';
import { onOutcome, type OutcomeContext } from '../src/platform/hub.ts';

let colyseus: ColyseusTestServer;

/**
 * Same as helpers.bootTestServer(['dasino']) but listens on a free port: @colyseus/testing's
 * boot() always binds 2568 for Server instances, which collides with parallel test runs.
 */
async function bootOnFreePort(): Promise<ColyseusTestServer> {
  const server = await createDascadeServer({ games: ['dasino'] });
  await server.listen(await freePort());
  return new ColyseusTestServer(server);
}

beforeAll(async () => {
  colyseus = await bootOnFreePort();
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

const FAST = { rouletteClosedMs: 40, rouletteSpinMs: 120, rouletteResultMs: 200, diceRollMs: 80, diceResultMs: 200, slotSpinMs: 400, slotRevealMs: 400 };

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

async function createRoom(settings: Record<string, unknown> = {}) {
  const room = await colyseus.sdk.create('dasino', { name: 'Host', settings });
  const host = await ready(wire(room));
  const server = colyseus.getRoomById(room.roomId) as unknown as DasinoRoom;
  server.timing = { ...FAST };
  (server as any).countdownMs = 20;
  return { host, server };
}

async function join(code: string, name: string, extra: Record<string, unknown> = {}) {
  return ready(wire(await colyseus.sdk.joinById(code, { name, ...extra })));
}

const view = (c: Client) => (c.room.state as any).toJSON() as DasinoPublicState;
const seatOf = (c: Client) => view(c).seats[c.me().playerId]!;

/** Scripted RNG: serves queued ints (mod range) first, then falls back to a seeded RNG. */
function scripted(queue: number[]): Rng {
  const fallback = createSeededRng('dasino-fallback');
  return {
    next: () => fallback.next(),
    int: (n: number) => (queue.length ? (queue.shift() as number) % n : fallback.int(n)),
  };
}

async function startSession(settings: Record<string, unknown> = {}) {
  const { host, server } = await createRoom(settings);
  const guest = await join(host.room.roomId, 'Guest');
  host.room.send('lobby:start', {});
  await waitFor(() => view(host).phase === 'PLAYING' && view(host).roulette.phase === 'BETTING', 3000, 'playing');
  await waitFor(() => Boolean(view(guest).seats[guest.me().playerId]), 3000, 'guest seat');
  return { host, guest, server };
}

/** Skips the rest of the roulette betting window (server-side, like the timer firing). */
function closeRouletteNow(server: DasinoRoom) {
  (server as any).closeRouletteBetting();
}

function rollDiceNow(server: DasinoRoom) {
  (server as any).rollDiceRound();
}

/** Starts a fresh dice round whose point is drawn from the RNG (not carried over). */
function freshDiceRound(server: DasinoRoom) {
  server['cancel']('dice');
  server.state.dice.rollA = 0;
  server.state.dice.rollB = 0;
  (server as any).startDiceRound();
}

async function errorFor(c: Client, type: string, code: string, from = 0) {
  await waitFor(() => c.errors.slice(from).some((e) => e.type === type && e.code === code), 3000, `${type} ${code}`);
}

describe('DASino room', () => {
  it('seats every player with the starting balance and runs both shared tables', async () => {
    const { host, guest } = await startSession();
    const s = view(host);
    expect(Object.keys(s.seats)).toHaveLength(2);
    for (const seat of Object.values(s.seats)) {
      expect(seat).toMatchObject({ balance: 10_000, credited: 10_000, inPlay: 0, table: 'floor', refills: 0 });
    }
    expect(s.roulette.phase).toBe('BETTING');
    expect(s.roulette.endsAt).toBeGreaterThan(Date.now());
    expect(s.dice.phase).toBe('BETTING');
    expect(s.dice.pointA + s.dice.pointB).toBeGreaterThanOrEqual(2);
    expect(s.dice.pointA + s.dice.pointB).toBeLessThanOrEqual(12);

    guest.room.send(DASINO_MSG.table, { table: 'slots' });
    await waitFor(() => seatOf(guest).table === 'slots');
    guest.room.send(DASINO_MSG.table, { table: 'casino-cage' });
    await errorFor(guest, DASINO_MSG.table, 'invalid_payload');
  });

  it('validates roulette bets and credits the exact European payouts', async () => {
    const { host, guest, server } = await startSession({ startingBalance: 1_000, minBet: 5, maxBet: 5_000 });
    host.room.send(DASINO_MSG.rouletteBet, { spot: 'straight:17', amount: 100 });
    host.room.send(DASINO_MSG.rouletteBet, { spot: 'red', amount: 200 });
    host.room.send(DASINO_MSG.rouletteBet, { spot: 'split:17-20', amount: 50 });
    await waitFor(() => seatOf(host).balance === 650);
    expect(seatOf(host).inPlay).toBe(350);
    expect(view(guest).roulette.bets.filter((b) => b.playerId === host.me().playerId)).toHaveLength(3);

    // Over balance.
    host.room.send(DASINO_MSG.rouletteBet, { spot: 'black', amount: 700 });
    await errorFor(host, DASINO_MSG.rouletteBet, 'insufficient_chips');
    // Non-adjacent split, unknown number, malformed key and smuggled fields.
    host.room.send(DASINO_MSG.rouletteBet, { spot: 'split:1-5', amount: 10 });
    host.room.send(DASINO_MSG.rouletteBet, { spot: 'straight:37', amount: 10 });
    host.room.send(DASINO_MSG.rouletteBet, { spot: 'RED; DROP', amount: 10 });
    host.room.send(DASINO_MSG.rouletteBet, { spot: 'red', amount: 10, result: 17 });
    await waitFor(() => host.errors.filter((e) => e.type === DASINO_MSG.rouletteBet && e.code === 'invalid_payload').length === 4);
    // Below the table minimum and fractional chips.
    host.room.send(DASINO_MSG.rouletteBet, { spot: 'red', amount: 1 });
    await errorFor(host, DASINO_MSG.rouletteBet, 'not_allowed');
    host.room.send(DASINO_MSG.rouletteBet, { spot: 'red', amount: 12.5 });
    await waitFor(() => host.errors.filter((e) => e.code === 'invalid_payload').length === 5);
    await sleep(50);
    expect(seatOf(host).balance).toBe(650);

    // The server — not the client — decides the number.
    (server as any).rng = scripted([17]);
    closeRouletteNow(server);
    await waitFor(() => view(host).roulette.phase !== 'BETTING');
    const before = host.errors.length;
    host.room.send(DASINO_MSG.rouletteBet, { spot: 'straight:0', amount: 10 });
    await errorFor(host, DASINO_MSG.rouletteBet, 'wrong_phase', before);

    await waitFor(() => view(host).roulette.phase === 'RESULT', 3000, 'roulette result');
    const s = view(host);
    expect(s.roulette.result).toBe(17);
    expect(s.roulette.history.at(-1)).toBe(17);
    // 17 is black: straight 100×36 + split 50×18 win, red 200 loses.
    const expected = settleRouletteBets(
      [
        { spot: 'straight:17', amount: 100 },
        { spot: 'red', amount: 200 },
        { spot: 'split:17-20', amount: 50 },
      ],
      17,
    );
    expect(expected.returned).toBe(4_500);
    expect(seatOf(host)).toMatchObject({ balance: 650 + 4_500, inPlay: 0, wagered: 350, returned: 4_500 });
    expect(s.roulette.payouts).toEqual([{ playerId: host.me().playerId, staked: 350, returned: 4_500 }]);
    expect(seatOf(guest).balance).toBe(1_000);
    expect(s.players[host.me().playerId]!.score).toBe(4_150);
    // A 12.9× round makes the big-win ticker.
    expect(s.ticker.some((t) => t.playerId === host.me().playerId && t.game === 'roulette')).toBe(true);
    // The next round opens automatically.
    await waitFor(() => view(host).roulette.phase === 'BETTING' && view(host).roulette.bets.length === 0, 3000, 'next round');
  });

  it('zero loses every outside bet', async () => {
    const { host, server } = await startSession();
    for (const spot of ['red', 'black', 'odd', 'even', 'low', 'high', 'dozen:1', 'column:2']) host.room.send(DASINO_MSG.rouletteBet, { spot, amount: 100 });
    host.room.send(DASINO_MSG.rouletteBet, { spot: 'split:0-2', amount: 10 });
    await waitFor(() => seatOf(host).inPlay === 810);
    (server as any).rng = scripted([0]);
    closeRouletteNow(server);
    await waitFor(() => view(host).roulette.phase === 'RESULT', 3000);
    expect(seatOf(host).balance).toBe(10_000 - 810 + 180);
  });

  it('supports undo, clear, double and rebet within the betting window', async () => {
    const { host, server } = await startSession();
    host.room.send(DASINO_MSG.rouletteBet, { spot: 'red', amount: 25 });
    host.room.send(DASINO_MSG.rouletteBet, { spot: 'straight:7', amount: 5 });
    await waitFor(() => seatOf(host).inPlay === 30);
    host.room.send(DASINO_MSG.undo, { table: 'roulette' });
    await waitFor(() => seatOf(host).inPlay === 25);
    expect(view(host).roulette.bets.map((b) => b.spot)).toEqual(['red']);
    host.room.send(DASINO_MSG.double, { table: 'roulette' });
    await waitFor(() => seatOf(host).inPlay === 50);
    host.room.send(DASINO_MSG.undo, { table: 'roulette' }); // undoes the whole double
    await waitFor(() => seatOf(host).inPlay === 25);
    host.room.send(DASINO_MSG.rouletteBet, { spot: 'dozen:3', amount: 100 });
    await waitFor(() => seatOf(host).inPlay === 125);
    host.room.send(DASINO_MSG.clear, { table: 'roulette' });
    await waitFor(() => seatOf(host).inPlay === 0 && seatOf(host).balance === 10_000);
    host.room.send(DASINO_MSG.rebet, { table: 'roulette' });
    await errorFor(host, DASINO_MSG.rebet, 'not_allowed'); // nothing played yet

    host.room.send(DASINO_MSG.rouletteBet, { spot: 'black', amount: 40 });
    await waitFor(() => seatOf(host).inPlay === 40);
    (server as any).rng = scripted([2]); // black wins
    closeRouletteNow(server);
    const privates = collect<DasinoPrivatePayload>(host.room, DASINO_MSG.private);
    await waitFor(() => view(host).roulette.phase === 'RESULT');
    expect(seatOf(host).balance).toBe(10_040);
    await waitFor(() => privates.some((p) => p.lastRoulette.length === 1));
    expect(privates.at(-1)!.lastRoulette).toEqual([{ spot: 'black', amount: 40 }]);
    host.room.send(DASINO_MSG.undo, { table: 'roulette' });
    await errorFor(host, DASINO_MSG.undo, 'wrong_phase');

    await waitFor(() => view(host).roulette.phase === 'BETTING', 3000, 'next round');
    host.room.send(DASINO_MSG.undo, { table: 'roulette' }); // last round's chips can't be undone
    await errorFor(host, DASINO_MSG.undo, 'not_allowed');
    host.room.send(DASINO_MSG.rebet, { table: 'roulette' });
    await waitFor(() => seatOf(host).inPlay === 40);
    expect(view(host).roulette.bets).toEqual([{ playerId: host.me().playerId, spot: 'black', amount: 40 }]);
  });

  it('enforces the per-spot table maximum and the spot cap', async () => {
    const { host } = await startSession({ maxBet: 100 });
    host.room.send(DASINO_MSG.rouletteBet, { spot: 'red', amount: 100 });
    await waitFor(() => seatOf(host).inPlay === 100);
    host.room.send(DASINO_MSG.rouletteBet, { spot: 'red', amount: 5 });
    await errorFor(host, DASINO_MSG.rouletteBet, 'not_allowed');
    expect(seatOf(host).inPlay).toBe(100);
  });

  it('runs dice rounds with true-odds multipliers, closed picks and settlement', async () => {
    const { host, guest, server } = await startSession();
    // Point 12 (6+6): HIGHER is impossible and LOWER can't pay more than the stake.
    (server as any).rng = scripted([5, 5]);
    freshDiceRound(server);
    await waitFor(() => view(host).dice.pointA + view(host).dice.pointB === 12);
    host.room.send(DASINO_MSG.diceBet, { pick: 'higher', amount: 50 });
    host.room.send(DASINO_MSG.diceBet, { pick: 'lower', amount: 50 });
    await waitFor(() => host.errors.filter((e) => e.type === DASINO_MSG.diceBet && e.code === 'not_allowed').length === 2);
    host.room.send(DASINO_MSG.diceBet, { pick: 'sideways', amount: 50 });
    await errorFor(host, DASINO_MSG.diceBet, 'invalid_payload');

    // Point 7 (3+4). Host bets HIGHER 100 + SAME 50, guest bets LOWER 200.
    (server as any).rng = scripted([2, 3]);
    freshDiceRound(server);
    await waitFor(() => view(host).dice.pointA + view(host).dice.pointB === 7 && view(host).dice.phase === 'BETTING');
    host.room.send(DASINO_MSG.diceBet, { pick: 'higher', amount: 100 });
    host.room.send(DASINO_MSG.diceBet, { pick: 'same', amount: 50 });
    guest.room.send(DASINO_MSG.diceBet, { pick: 'lower', amount: 200 });
    await waitFor(() => seatOf(host).inPlay === 150 && seatOf(guest).inPlay === 200);
    guest.room.send(DASINO_MSG.diceBet, { pick: 'lower', amount: 20_000 });
    await errorFor(guest, DASINO_MSG.diceBet, 'not_allowed'); // over the table max

    (server as any).rng = scripted([4, 3]); // 5 + 4 = 9 → HIGHER
    rollDiceNow(server);
    const before = host.errors.length;
    host.room.send(DASINO_MSG.diceBet, { pick: 'same', amount: 50 });
    await errorFor(host, DASINO_MSG.diceBet, 'wrong_phase', before);
    await waitFor(() => view(host).dice.phase === 'RESULT', 3000, 'dice result');
    const s = view(host);
    expect(s.dice.rollA + s.dice.rollB).toBe(9);
    expect(s.dice.history.at(-1)).toMatchObject({ point: 7, a: 5, b: 4, outcome: 'higher' });
    expect(seatOf(host).balance).toBe(10_000 - 150 + 232); // 100 × 2.32
    expect(seatOf(guest).balance).toBe(10_000 - 200);
    // The next point is the last roll.
    await waitFor(() => view(host).dice.phase === 'BETTING', 3000, 'next dice round');
    expect(view(host).dice.pointA + view(host).dice.pointB).toBe(9);
  });

  it('decides and settles slot spins on the server, one spin at a time', async () => {
    const { host, guest, server } = await startSession();
    const hostResults = collect<SlotResultPayload>(host.room, DASINO_MSG.slotResult);
    const guestResults = collect<SlotResultPayload>(guest.room, DASINO_MSG.slotResult);
    const sevens = SLOT_REELS.map((strip) => strip.indexOf('seven'));
    (server as any).rng = scripted([...sevens]);
    host.room.send(DASINO_MSG.spin, { lineBet: 10, lines: 1 });
    host.room.send(DASINO_MSG.spin, { lineBet: 10, lines: 1 }); // still spinning → blocked
    await waitFor(() => hostResults.length === 1);
    await errorFor(host, DASINO_MSG.spin, 'not_allowed');
    const r = hostResults[0]!;
    expect(r.stops).toEqual(sevens);
    expect(r.totalBet).toBe(10);
    expect(r.wins[0]).toMatchObject({ line: 0, symbol: 'seven', count: 3, multiplier: 100, pay: 1_000 });
    expect(r.totalWin).toBe(1_000);
    expect(r.balance).toBe(10_990);
    await waitFor(() => seatOf(host).balance === 10_990);
    expect(seatOf(host)).toMatchObject({ spins: 1, wagered: 10, returned: 1_000 });
    await sleep(100);
    expect(hostResults).toHaveLength(1);
    expect(guestResults).toHaveLength(0); // results are private to the spinner

    // A client can't pick its own stops or an unsupported line count.
    await sleep(1_800);
    host.room.send(DASINO_MSG.spin, { lineBet: 10, lines: 1, stops: [3, 8, 14] });
    await errorFor(host, DASINO_MSG.spin, 'invalid_payload');
    host.room.send(DASINO_MSG.spin, { lineBet: 10, lines: 2 });
    await waitFor(() => host.errors.filter((e) => e.type === DASINO_MSG.spin && e.code === 'invalid_payload').length === 2);
    expect(hostResults).toHaveLength(1);

    // After the reels stop (and a spin token refills), the next spin is accepted.
    await sleep(3_400);
    host.room.send(DASINO_MSG.spin, { lineBet: 1, lines: 5 });
    await waitFor(() => hostResults.length === 2);
    expect(hostResults[1]!.totalBet).toBe(5);
    expect(hostResults[1]!.balance).toBe(10_990 - 5 + hostResults[1]!.totalWin);
    await waitFor(() => seatOf(host).balance === hostResults[1]!.balance, 3000, 'balance patch');

    // Over the table max (wait for a spin token: spins are rate limited to ~0.6/s).
    await sleep(1_800);
    host.room.send(DASINO_MSG.spin, { lineBet: 2_000, lines: 5 });
    await errorFor(host, DASINO_MSG.spin, 'not_allowed'); // 10,000 > max bet
  });

  it('rejects slot spins over balance', async () => {
    const { host } = await startSession({ startingBalance: 100, minBet: 1, maxBet: 1_000 });
    host.room.send(DASINO_MSG.spin, { lineBet: 50, lines: 3 });
    await errorFor(host, DASINO_MSG.spin, 'insufficient_chips');
    expect(seatOf(host).balance).toBe(100);
  });

  it('rate-limits betting spam', async () => {
    const { host } = await startSession();
    for (let i = 0; i < 40; i++) host.room.send(DASINO_MSG.rouletteBet, { spot: 'red', amount: 5 });
    await errorFor(host, DASINO_MSG.rouletteBet, 'rate_limited');
    await sleep(100);
    expect(seatOf(host).inPlay).toBeLessThan(40 * 5);
    expect(seatOf(host).inPlay).toBeGreaterThan(0);
  });

  it('keeps spectators off the felt and only refills broke players', async () => {
    const { host, server } = await startSession({ startingBalance: 100, minBet: 5, maxBet: 100 });
    const spectator = await join(host.room.roomId, 'Watcher', { spectator: true });
    spectator.room.send(DASINO_MSG.rouletteBet, { spot: 'red', amount: 10 });
    await errorFor(spectator, DASINO_MSG.rouletteBet, 'not_allowed');
    expect(view(host).seats[spectator.me().playerId]).toBeUndefined();

    host.room.send(DASINO_MSG.refill, {});
    await errorFor(host, DASINO_MSG.refill, 'not_allowed');
    host.room.send(DASINO_MSG.rouletteBet, { spot: 'straight:5', amount: 98 });
    await waitFor(() => seatOf(host).balance === 2);
    host.room.send(DASINO_MSG.refill, {}); // chips still on the felt
    await waitFor(() => host.errors.filter((e) => e.type === DASINO_MSG.refill).length === 2);
    (server as any).rng = scripted([6]);
    closeRouletteNow(server);
    await waitFor(() => view(host).roulette.phase === 'RESULT');
    expect(seatOf(host).balance).toBe(2);
    host.room.send(DASINO_MSG.refill, {});
    await waitFor(() => seatOf(host).balance === 100);
    expect(seatOf(host)).toMatchObject({ credited: 198, refills: 1 });
    expect(view(host).players[host.me().playerId]!.score).toBe(-98);
  });

  it('refuses refills when the host turned them off', async () => {
    const { host, server } = await startSession({ startingBalance: 100, minBet: 5, maxBet: 100, allowRefills: false });
    host.room.send(DASINO_MSG.rouletteBet, { spot: 'straight:5', amount: 100 });
    await waitFor(() => seatOf(host).balance === 0);
    (server as any).rng = scripted([6]);
    closeRouletteNow(server);
    await waitFor(() => view(host).roulette.phase === 'RESULT');
    host.room.send(DASINO_MSG.refill, {});
    await errorFor(host, DASINO_MSG.refill, 'not_allowed');
    expect(seatOf(host).balance).toBe(0);
  });

  it('seats late joiners immediately and restores private state on rejoin', async () => {
    const { host, server } = await startSession();
    const late = await join(host.room.roomId, 'Late');
    await waitFor(() => Boolean(view(host).seats[late.me().playerId]));
    expect(seatOf(late).balance).toBe(10_000);
    const results = collect<SlotResultPayload>(late.room, DASINO_MSG.slotResult);
    late.room.send(DASINO_MSG.spin, { lineBet: 2, lines: 5 });
    await waitFor(() => results.length === 1);
    const { seatToken, playerId } = late.me();
    await late.room.leave(false);
    await sleep(50);
    const again = wire(await colyseus.sdk.joinById(host.room.roomId, { name: 'Late', seatToken }));
    const privates = collect<DasinoPrivatePayload>(again.room, DASINO_MSG.private);
    await ready(again);
    expect(again.me().playerId).toBe(playerId);
    await waitFor(() => privates.length > 0);
    expect(privates.at(-1)!.lastSlot?.id).toBe(results[0]!.id);
    expect(privates.at(-1)!.lastSlot?.stops).toEqual(results[0]!.stops);
    expect(server.state.seats.get(playerId)?.spins).toBe(1);
  });

  it('only the host can close the floor; open bets are refunded and the leaderboard ranks net winnings', async () => {
    const { host, guest, server } = await startSession();
    guest.room.send(DASINO_MSG.endSession, {});
    await errorFor(guest, DASINO_MSG.endSession, 'not_host');

    // Host wins a roulette round, guest loses one.
    host.room.send(DASINO_MSG.rouletteBet, { spot: 'red', amount: 500 });
    guest.room.send(DASINO_MSG.rouletteBet, { spot: 'black', amount: 300 });
    await waitFor(() => seatOf(host).inPlay === 500 && seatOf(guest).inPlay === 300);
    (server as any).rng = scripted([1]);
    closeRouletteNow(server);
    await waitFor(() => view(host).roulette.phase === 'RESULT');
    await waitFor(() => view(host).roulette.phase === 'BETTING', 3000, 'next round');
    // Chips left on the felt when the floor closes are handed back.
    guest.room.send(DASINO_MSG.rouletteBet, { spot: 'odd', amount: 100 });
    await waitFor(() => seatOf(guest).inPlay === 100);

    host.room.send(DASINO_MSG.endSession, {});
    await waitFor(() => view(host).phase === 'RESULTS', 3000, 'results');
    const s = view(host);
    expect(s.results.map((r) => [r.name, r.net, r.placement])).toEqual([
      ['Host', 500, 1],
      ['Guest', -300, 2],
    ]);
    expect(seatOf(guest)).toMatchObject({ inPlay: 0, balance: 9_700 });
    expect(s.roulette.phase).toBe('IDLE');
    expect(s.dice.phase).toBe('IDLE');

    host.room.send('lobby:toLobby', {});
    await waitFor(() => view(host).phase === 'LOBBY');
    expect(Object.keys(view(host).seats)).toHaveLength(0);
    expect(view(host).results).toHaveLength(0);
  });

  it('ignores forged server messages from clients', async () => {
    const { host } = await startSession();
    host.room.send(DASINO_MSG.rouletteSettled, { round: 1, result: 17, payouts: [{ playerId: host.me().playerId, staked: 0, returned: 99_999 }] });
    host.room.send(DASINO_MSG.slotResult, { totalWin: 99_999 });
    await sleep(150);
    expect(seatOf(host).balance).toBe(10_000);
  });

  it('starts instantly in solo mode', async () => {
    const room = await colyseus.sdk.create('dasino', { name: 'Solo', solo: true });
    const solo = await ready(wire(room));
    await waitFor(() => view(solo).phase === 'PLAYING', 3000, 'solo start');
    expect(seatOf(solo).balance).toBe(10_000);
    expect(view(solo).roulette.phase).toBe('BETTING');
  });
});

describe('DASino room: DASCADE outcomes', () => {
  let outcomes: Array<{ outcome: GameOutcome; ctx: OutcomeContext }> = [];
  let stop: () => void = () => undefined;
  beforeEach(() => {
    outcomes = [];
    stop = onOutcome((outcome, ctx) => outcomes.push({ outcome, ctx }));
  });
  afterEach(() => stop());
  const forRoom = (code: string) => outcomes.filter((o) => o.ctx.roomCode === code);
  type Extras = { playerStats: Record<string, Record<string, number>> };

  it('reports the closed floor by the leaderboard with balances and wager stats; a leaver is last', async () => {
    const { host, server } = await createRoom();
    const guest = await join(host.room.roomId, 'Guest');
    const leaver = await join(host.room.roomId, 'Leaver');
    const leaverId = leaver.me().playerId;
    host.room.send('lobby:start', {});
    await waitFor(() => view(host).phase === 'PLAYING' && view(host).roulette.phase === 'BETTING', 3000, 'playing');
    await leaver.room.leave(true);
    await waitFor(() => !view(host).seats[leaverId], 3000, 'leaver gone');
    host.room.send(DASINO_MSG.rouletteBet, { spot: 'red', amount: 500 });
    guest.room.send(DASINO_MSG.rouletteBet, { spot: 'black', amount: 300 });
    await waitFor(() => seatOf(host).inPlay === 500 && seatOf(guest).inPlay === 300);
    (server as any).rng = scripted([1]);
    closeRouletteNow(server);
    await waitFor(() => view(host).roulette.phase === 'RESULT');
    host.room.send(DASINO_MSG.endSession, {});
    await waitFor(() => view(host).phase === 'RESULTS', 3000, 'results');

    const mine = forRoom(host.room.roomId);
    expect(mine).toHaveLength(1);
    const { outcome } = mine[0]!;
    const h = host.me().playerId;
    const g = guest.me().playerId;
    expect(outcome.placements).toEqual([[h], [g], [leaverId]]);
    expect(outcome.scores).toEqual({ [h]: 10_500, [g]: 9_700 });
    expect(outcome.reason).toBe('session_closed');
    expect((outcome.details as Extras).playerStats).toEqual({
      [h]: { chipsWagered: 500, bestWin: 500 },
      [g]: { chipsWagered: 300, bestWin: 0 },
    });
  });

  it('records a solo session', async () => {
    const room = await colyseus.sdk.create('dasino', { name: 'Solo', solo: true });
    const solo = await ready(wire(room));
    const server = colyseus.getRoomById(room.roomId) as unknown as DasinoRoom;
    server.timing = { ...FAST };
    await waitFor(() => view(solo).phase === 'PLAYING', 3000, 'solo start');
    solo.room.send(DASINO_MSG.spin, { lineBet: 10, lines: 1 });
    await waitFor(() => seatOf(solo).spins === 1, 3000, 'spin');
    solo.room.send(DASINO_MSG.endSession, {});
    await waitFor(() => view(solo).phase === 'RESULTS', 3000, 'results');
    const mine = forRoom(room.roomId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.outcome.placements).toEqual([[solo.me().playerId]]);
    expect(mine[0]!.outcome.scores).toEqual({ [solo.me().playerId]: seatOf(solo).balance });
  });

  it('reports nothing for a floor closed before anyone bet, or sent back to the lobby', async () => {
    const idle = await startSession();
    idle.host.room.send(DASINO_MSG.endSession, {});
    await waitFor(() => view(idle.host).phase === 'RESULTS', 3000, 'results');

    const lobby = await startSession();
    lobby.host.room.send(DASINO_MSG.rouletteBet, { spot: 'red', amount: 500 });
    await waitFor(() => seatOf(lobby.host).inPlay === 500);
    lobby.host.room.send('lobby:toLobby', {});
    await waitFor(() => view(lobby.host).phase === 'LOBBY', 3000, 'lobby');
    await sleep(80);
    expect(forRoom(idle.host.room.roomId)).toHaveLength(0);
    expect(forRoom(lobby.host.room.roomId)).toHaveLength(0);
  });
});
