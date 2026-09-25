/**
 * DASino adversarial / conservation tests: rejoin-to-reset, leaving with chips
 * on the felt, double spends in one tick, dice stakes that could never profit,
 * and a chip-conservation invariant over a burst of mixed actions.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import { createSeededRng, type Rng, type WelcomePayload } from '@dascade/shared';
import { DASINO_MSG, type DasinoPublicState } from '@dascade/shared/games/dasino';
import { collect, freePort, quiet, sleep, waitFor } from './helpers.ts';
import { createDascadeServer } from '../src/server.ts';
import type { DasinoRoom } from '../src/rooms/dasino/DasinoRoom.ts';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  const server = await createDascadeServer({ games: ['dasino'] });
  await server.listen(await freePort());
  colyseus = new ColyseusTestServer(server);
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

const FAST = { rouletteClosedMs: 40, rouletteSpinMs: 150, rouletteResultMs: 200, diceRollMs: 80, diceResultMs: 200, slotSpinMs: 50, slotRevealMs: 50 };

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

const view = (c: Client) => (c.room.state as any).toJSON() as DasinoPublicState;
const seatOf = (c: Client) => view(c).seats[c.me().playerId]!;

function scripted(queue: number[]): Rng {
  const fallback = createSeededRng('dasino-audit');
  return { next: () => fallback.next(), int: (n: number) => (queue.length ? (queue.shift() as number) % n : fallback.int(n)) };
}

async function startSession(settings: Record<string, unknown> = {}) {
  const room = await colyseus.sdk.create('dasino', { name: 'Host', settings, guestId: 'guest-host' });
  const host = await ready(wire(room));
  const server = colyseus.getRoomById(room.roomId) as unknown as DasinoRoom;
  server.timing = { ...FAST };
  (server as any).countdownMs = 20;
  const guest = await ready(wire(await colyseus.sdk.joinById(room.roomId, { name: 'Guest', guestId: 'guest-g1' })));
  host.room.send('lobby:start', {});
  await waitFor(() => view(host).phase === 'PLAYING' && view(host).roulette.phase === 'BETTING', 3000, 'playing');
  await waitFor(() => Boolean(view(host).seats[guest.me().playerId]), 3000, 'guest seat');
  return { host, guest, server };
}

async function errorFor(c: Client, type: string, code: string, from = 0) {
  await waitFor(() => c.errors.slice(from).some((e) => e.type === type && e.code === code), 3000, `${type} ${code}`);
}

/** balance = credited − wagered + returned for every seat, and inPlay = that seat's chips on the felt. */
function assertConserved(server: DasinoRoom) {
  const s = server.state;
  for (const seat of s.seats.values()) {
    expect(seat.balance, `balance ${seat.id}`).toBe(seat.credited - seat.wagered + seat.returned);
    expect(seat.balance).toBeGreaterThanOrEqual(0);
    const felt =
      [...s.roulette.bets].filter((b) => b.playerId === seat.id && ['BETTING', 'CLOSED', 'SPINNING'].includes(s.roulette.phase)).reduce((a, b) => a + b.amount, 0) +
      [...s.dice.bets].filter((b) => b.playerId === seat.id && ['BETTING', 'ROLLING'].includes(s.dice.phase)).reduce((a, b) => a + b.amount, 0);
    expect(seat.inPlay, `inPlay ${seat.id}`).toBe(felt);
  }
}

describe('DASino audit', () => {
  it('refuses dice stakes whose win could not pay more than the stake', async () => {
    const { host, server } = await startSession();
    // Point 3 (1+2): HIGHER pays 1.05×, so 5 chips would win back only 5.
    server['cancel']('dice');
    server.state.dice.rollA = 0;
    server.state.dice.rollB = 0;
    (server as any).rng = scripted([0, 1]);
    (server as any).startDiceRound();
    await waitFor(() => view(host).dice.pointA + view(host).dice.pointB === 3 && view(host).dice.phase === 'BETTING');
    host.room.send(DASINO_MSG.diceBet, { pick: 'higher', amount: 5 });
    await errorFor(host, DASINO_MSG.diceBet, 'not_allowed');
    expect(host.errors.at(-1)!.message).toMatch(/20/);
    expect(seatOf(host).inPlay).toBe(0);
    host.room.send(DASINO_MSG.diceBet, { pick: 'higher', amount: 20 });
    await waitFor(() => seatOf(host).inPlay === 20);
    // Adding to an accepted stake is fine; SAME (34.92×) takes any chip.
    host.room.send(DASINO_MSG.diceBet, { pick: 'higher', amount: 5 });
    host.room.send(DASINO_MSG.diceBet, { pick: 'same', amount: 5 });
    await waitFor(() => seatOf(host).inPlay === 30);
    (server as any).rng = scripted([5, 5]); // 12 → HIGHER
    (server as any).rollDiceRound();
    await waitFor(() => view(host).dice.phase === 'RESULT');
    expect(seatOf(host).balance).toBe(10_000 - 30 + 26); // floor(25 × 1.05)
    assertConserved(server);
  });

  it('never spends the same chips twice when many bets arrive in one tick', async () => {
    const { host, server } = await startSession({ startingBalance: 100, minBet: 5, maxBet: 100 });
    for (let i = 0; i < 8; i++) host.room.send(DASINO_MSG.rouletteBet, { spot: `straight:${i}`, amount: 15 });
    for (let i = 0; i < 6; i++) host.room.send(DASINO_MSG.diceBet, { pick: 'same', amount: 15 });
    host.room.send(DASINO_MSG.spin, { lineBet: 5, lines: 5 });
    await sleep(300);
    const seat = seatOf(host);
    expect(seat.balance).toBeGreaterThanOrEqual(0);
    expect(seat.balance + seat.inPlay).toBeLessThanOrEqual(100 + seat.returned);
    expect(host.errors.some((e) => e.code === 'insufficient_chips')).toBe(true);
    assertConserved(server);
  });

  it('keeps the seat of a player who leaves and rejoins (no free reset), handing back open bets', async () => {
    const { host, guest, server } = await startSession({ startingBalance: 1_000, minBet: 5, maxBet: 1_000, allowRefills: false });
    const code = host.room.roomId;
    // Guest loses 400 on a settled spin, then leaves with 100 on the open felt.
    guest.room.send(DASINO_MSG.rouletteBet, { spot: 'straight:1', amount: 400 });
    await waitFor(() => seatOf(guest).inPlay === 400);
    (server as any).rng = scripted([2]);
    (server as any).closeRouletteBetting();
    await waitFor(() => view(host).roulette.phase === 'RESULT');
    await waitFor(() => view(host).roulette.phase === 'BETTING', 3000, 'next round');
    guest.room.send(DASINO_MSG.rouletteBet, { spot: 'red', amount: 100 });
    await waitFor(() => seatOf(guest).inPlay === 100);
    await guest.room.leave(true);
    await waitFor(() => Object.keys(view(host).seats).length === 1, 3000, 'guest removed');
    expect(view(host).roulette.bets.some((b) => b.spot === 'red')).toBe(false);

    const back = await ready(wire(await colyseus.sdk.joinById(code, { name: 'Guest', guestId: 'guest-g1' })));
    await waitFor(() => Boolean(view(host).seats[back.me().playerId]), 3000, 'rejoined seat');
    expect(seatOf(back)).toMatchObject({ balance: 600, inPlay: 0, credited: 1_000, wagered: 400, refills: 0 });
    expect(view(host).players[back.me().playerId]!.score).toBe(-400);
    assertConserved(server);

    // A different guest id is a different player.
    const other = await ready(wire(await colyseus.sdk.joinById(code, { name: 'Other', guestId: 'guest-other' })));
    await waitFor(() => Boolean(view(host).seats[other.me().playerId]));
    expect(seatOf(other).balance).toBe(1_000);
  });

  it('settles a leaver’s bets that are already spinning, exactly once', async () => {
    const { host, guest, server } = await startSession({ startingBalance: 1_000, minBet: 5, maxBet: 1_000 });
    const code = host.room.roomId;
    server.timing = { ...FAST, rouletteSpinMs: 600 };
    guest.room.send(DASINO_MSG.rouletteBet, { spot: 'straight:17', amount: 10 });
    guest.room.send(DASINO_MSG.rouletteBet, { spot: 'black', amount: 50 });
    await waitFor(() => seatOf(guest).inPlay === 60);
    (server as any).rng = scripted([17]);
    (server as any).closeRouletteBetting();
    await waitFor(() => view(host).roulette.phase === 'SPINNING');
    await guest.room.leave(true);
    await waitFor(() => Object.keys(view(host).seats).length === 1, 3000, 'guest removed');
    const back = await ready(wire(await colyseus.sdk.joinById(code, { name: 'Guest', guestId: 'guest-g1' })));
    await waitFor(() => Boolean(view(host).seats[back.me().playerId]), 3000, 'rejoined seat');
    await waitFor(() => view(host).roulette.phase === 'RESULT', 3000, 'result');
    await sleep(50);
    // 17 black: 10 × 36 + 50 × 2 = 460 back on 60.
    expect(seatOf(back)).toMatchObject({ balance: 1_000 - 60 + 460, inPlay: 0, returned: 460 });
    assertConserved(server);
  });

  it('conserves chips over a burst of mixed actions from several players', async () => {
    const { host, guest, server } = await startSession({ startingBalance: 2_000, minBet: 5, maxBet: 500 });
    const third = await ready(wire(await colyseus.sdk.joinById(host.room.roomId, { name: 'Third', guestId: 'guest-3' })));
    await waitFor(() => Boolean(view(host).seats[third.me().playerId]));
    const rng = createSeededRng('burst');
    const spots = ['red', 'black', 'straight:0', 'split:0-1', 'street:0-2-3', 'corner:0-1-2-3', 'line:1-2-3-4-5-6', 'dozen:2', 'column:3', 'odd'];
    const players = [host, guest, third];
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 30; i++) {
        const c = players[rng.int(players.length)]!;
        const r = rng.int(10);
        if (r < 4) c.room.send(DASINO_MSG.rouletteBet, { spot: spots[rng.int(spots.length)]!, amount: [5, 25, 100][rng.int(3)]! });
        else if (r < 6) c.room.send(DASINO_MSG.diceBet, { pick: (['higher', 'same', 'lower'] as const)[rng.int(3)]!, amount: [5, 25, 100][rng.int(3)]! });
        else if (r === 6) c.room.send(DASINO_MSG.undo, { table: rng.int(2) ? 'roulette' : 'dice' });
        else if (r === 7) c.room.send(DASINO_MSG.double, { table: rng.int(2) ? 'roulette' : 'dice' });
        else if (r === 8) c.room.send(DASINO_MSG.clear, { table: rng.int(2) ? 'roulette' : 'dice' });
        else c.room.send(DASINO_MSG.spin, { lineBet: 1, lines: 5 });
      }
      await sleep(120);
      assertConserved(server);
      (server as any).closeRouletteBetting();
      (server as any).rollDiceRound();
      await waitFor(() => view(host).roulette.phase === 'RESULT' && view(host).dice.phase === 'RESULT', 3000, 'settle');
      assertConserved(server);
      await waitFor(() => view(host).roulette.phase === 'BETTING' && view(host).dice.phase === 'BETTING', 3000, 'next rounds');
    }
    host.room.send(DASINO_MSG.endSession, {});
    await waitFor(() => view(host).phase === 'RESULTS');
    assertConserved(server);
    for (const r of view(host).results) {
      const seat = view(host).seats[r.playerId]!;
      expect(r.net).toBe(seat.balance - seat.credited);
    }
  });
});
