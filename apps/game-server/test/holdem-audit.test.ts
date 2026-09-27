/**
 * DAS Hold'em adversarial room tests: host powers that must never decide a pot,
 * and seat balances that must survive a leave → rejoin.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, WelcomePayload } from '@dascade/shared';
import type { HoldemPrivatePayload, HoldemPublicState } from '@dascade/shared/games/holdem';
import { cardToCode, createDeck } from '@dascade/game-core/cards';
import type { HandState } from '@dascade/game-core/holdem';
import type { HoldemRoom } from '../src/rooms/holdem/HoldemRoom.ts';
import { onOutcome, type OutcomeContext } from '../src/platform/hub.ts';
import { bootTestServer, collect, quiet, waitFor } from './helpers.ts';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['holdem']));
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

interface Client {
  room: SdkRoom;
  errors: Array<{ type?: string; code: string; message: string }>;
  privates: HoldemPrivatePayload[];
  me: () => WelcomePayload;
}

function wire(room: SdkRoom): Client {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<{ type?: string; code: string; message: string }>(room, 'sys:error');
  const privates = collect<HoldemPrivatePayload>(room, 'holdem:private');
  quiet(room);
  return { room, errors, privates, me: () => welcomes[welcomes.length - 1]! };
}

async function ready(c: Client): Promise<Client> {
  await c.room.waitForInitialState();
  await waitFor(() => Boolean(c.me()), 3000, 'welcome');
  return c;
}

const FAST = {
  firstHand: 20,
  street: 20,
  runout: 20,
  showdown: 20,
  intermission: 150,
  intermissionUncontested: 120,
  waitingPoll: 80,
  disconnectGrace: 400,
  actionMs: 0,
};

async function createTable(settings: Record<string, unknown> = {}, guestId = 'g-host') {
  const host = await ready(wire(await colyseus.sdk.create('holdem', { name: 'Hero', guestId, settings })));
  const server = colyseus.getRoomById(host.room.roomId) as unknown as HoldemRoom;
  (server as unknown as { countdownMs: number }).countdownMs = 0;
  server.timing = { ...FAST };
  return { host, server };
}

async function join(code: string, name: string, extra: Record<string, unknown> = {}) {
  return ready(wire(await colyseus.sdk.joinById(code, { name, ...extra })));
}

const st = (c: Client) => (c.room.state as unknown as { toJSON(): HoldemPublicState }).toJSON();
const engine = (server: HoldemRoom) => (server as unknown as { hand: HandState | null }).hand;
const seatOf = (c: Client, s = st(c)) => s.seats.find((x) => x.playerId === c.me().playerId)?.index ?? -1;

async function start(host: Client) {
  host.room.send('lobby:start', {});
  await waitFor(() => st(host).handNumber >= 1 && st(host).toActSeat >= 0, 4000, 'first hand');
}

async function act(c: Client, action: string, amount?: number) {
  const seq = st(c).actionSeq;
  c.room.send('holdem:act', { action, amount, seq });
  await waitFor(() => st(c).actionSeq > seq, 3000, `${action} accepted`);
}

async function actor(clients: Client[]): Promise<Client> {
  await waitFor(() => clients.some((c) => seatOf(c) >= 0 && seatOf(c) === st(c).toActSeat), 4000, 'someone to act');
  return clients.find((c) => seatOf(c) === st(c).toActSeat)!;
}

/** Re-deals the engine's current hand from a known deck (server-side test hook; nothing is re-sent). */
function rig(server: HoldemRoom, holes: Map<string, [string, string]>, board: string[]) {
  const h = engine(server)!;
  const used = new Set([...[...holes.values()].flat(), ...board]);
  const spare = createDeck()
    .map(cardToCode)
    .filter((c) => !used.has(c));
  for (const p of h.players) p.hole = holes.get(p.id) ?? [spare.shift()!, spare.shift()!];
  h.deck = [spare.shift()!, board[0]!, board[1]!, board[2]!, spare.shift()!, board[3]!, spare.shift()!, board[4]!, ...spare];
}

// ---------------------------------------------------------------------------

describe("DAS Hold'em — adversarial host and rejoin checks", () => {
  it('the host cannot remove a player who still has chips mid-game (a kick would rewrite the leaderboard)', async () => {
    const { host, server } = await createTable();
    const guest = await join(host.room.roomId, 'Leader', { guestId: 'g-leader' });
    await start(host);
    // Mid-hand: refused, and the guest's hand stays live.
    host.room.send('lobby:kick', { playerId: guest.me().playerId });
    await waitFor(() => host.errors.some((e) => e.type === 'lobby:kick'), 3000, 'kick refused');
    expect(host.errors.find((e) => e.type === 'lobby:kick')!.code).toBe('not_allowed');
    expect(st(host).players[guest.me().playerId]).toBeDefined();
    expect(st(host).seats[seatOf(guest)]!.left).toBe(false);
    expect(engine(server)!.players.find((p) => p.id === guest.me().playerId)!.folded).toBe(false);

    // Between hands too: chips on the table still count on the leaderboard.
    const first = await actor([host, guest]);
    await act(first, 'fold');
    await waitFor(() => st(host).phase === 'INTERMISSION', 3000, 'intermission');
    const before = host.errors.length;
    host.room.send('lobby:kick', { playerId: guest.me().playerId });
    await waitFor(() => host.errors.length > before, 3000, 'kick refused between hands');
    expect(st(host).players[guest.me().playerId]).toBeDefined();

    // Once the game is over, moderation works as usual.
    host.room.send('holdem:end', {});
    await waitFor(() => st(host).phase === 'RESULTS', 3000, 'results');
    host.room.send('lobby:kick', { playerId: guest.me().playerId });
    await waitFor(() => st(host).players[guest.me().playerId] === undefined, 3000, 'kicked after the game');
  });

  it('a busted player (no chips) can still be removed mid-game', async () => {
    const { host, server } = await createTable({ startingStack: 1000, smallBlind: 5, bigBlind: 10, allowRebuys: true });
    const b = await join(host.room.roomId, 'Busted', { guestId: 'g-b' });
    const c = await join(host.room.roomId, 'Third', { guestId: 'g-c' });
    await start(host);
    rig(
      server,
      new Map([
        [host.me().playerId, ['As', 'Ad']],
        [b.me().playerId, ['7c', '2d']],
        [c.me().playerId, ['8c', '3h']],
      ]),
      ['Kh', 'Qh', '9c', '4s', 'Jd'],
    );
    for (let i = 0; i < 6 && !st(host).runout && st(host).winners.length === 0; i++) {
      const who = await actor([host, b, c]);
      if (who === b) await act(b, 'allin');
      else if (who === c) await act(c, 'fold');
      else await act(host, st(host).legal.canCall ? 'call' : 'check');
    }
    await waitFor(() => st(host).seats[seatOf(b)]?.busted === true, 5000, 'b busted');
    host.room.send('lobby:kick', { playerId: b.me().playerId });
    await waitFor(() => st(host).players[b.me().playerId] === undefined, 3000, 'busted player removed');
    expect(host.errors.some((e) => e.type === 'lobby:kick')).toBe(false);
  });

  it('leaving and rejoining does not reset your stack: the same guest gets the same chips back', async () => {
    const { host } = await createTable();
    const b = await join(host.room.roomId, 'Villain', { guestId: 'g-b' });
    const c = await join(host.room.roomId, 'Third', { guestId: 'g-c' });
    await start(host);
    // Whoever posted the big blind leaves mid-hand and forfeits it.
    const bb = st(host).bbSeat;
    const leaver = [host, b, c].find((x) => seatOf(x) === bb && x !== host) ?? null;
    const quitter = leaver ?? [b, c].find((x) => seatOf(x) === st(host).sbSeat)!;
    const quitterSeat = seatOf(quitter);
    const quitterGuest = quitter === b ? 'g-b' : 'g-c';
    const committed = st(host).seats[quitterSeat]!.committed;
    expect(committed).toBeGreaterThan(0);
    await quitter.room.leave(true);
    await waitFor(() => st(host).seats[quitterSeat]!.left, 3000, 'left');

    const back = await join(host.room.roomId, 'Villain again', { guestId: quitterGuest });
    const stayers = [host, b, c].filter((x) => x !== quitter);
    for (let i = 0; i < 30 && st(host).handNumber === 1; i++) {
      const who = await actor(stayers).catch(() => null);
      if (!who || st(host).handNumber !== 1) break;
      const legal = st(who).legal;
      await act(who, legal.canCheck ? 'check' : 'call').catch(() => undefined);
    }
    await waitFor(() => seatOf(back) >= 0, 8000, 'rejoiner seated');
    const seat = st(host).seats[seatOf(back)]!;
    expect(seat.stack + seat.committed).toBe(10_000 - committed);
    expect(seat.buyIns).toBe(10_000);
    expect(seat.rebuys).toBe(0);
  });

  it('with rebuys off, a busted player cannot leave and rejoin for a fresh stack', async () => {
    const { host, server } = await createTable({ startingStack: 1000, smallBlind: 5, bigBlind: 10, allowRebuys: false });
    const b = await join(host.room.roomId, 'Villain', { guestId: 'g-b' });
    const c = await join(host.room.roomId, 'Third', { guestId: 'g-c' });
    await start(host);
    // b holds the worst hand and gets it all in against the host; c folds.
    rig(
      server,
      new Map([
        [host.me().playerId, ['As', 'Ad']],
        [b.me().playerId, ['7c', '2d']],
        [c.me().playerId, ['8c', '3h']],
      ]),
      ['Kh', 'Qh', '9c', '4s', 'Jd'],
    );
    for (let i = 0; i < 6 && !st(host).runout && st(host).winners.length === 0; i++) {
      const who = await actor([host, b, c]);
      if (who === b) await act(b, 'allin');
      else if (who === c) await act(c, 'fold');
      else await act(host, st(host).legal.canCall ? 'call' : 'check');
    }
    await waitFor(() => st(host).seats[seatOf(b)]?.busted === true, 5000, 'b busted');
    await b.room.leave(true);
    await waitFor(() => seatOf(b, st(host)) < 0 || st(host).seats.every((s) => s.playerId !== b.me().playerId), 3000, 'b gone');

    const back = await join(host.room.roomId, 'Villain again', { guestId: 'g-b' });
    await waitFor(() => st(host).handNumber >= 2, 6000, 'next hand');
    await waitFor(() => seatOf(back) >= 0, 6000, 'rejoiner has a seat');
    const seat = st(host).seats[seatOf(back)]!;
    expect(seat.stack).toBe(0);
    expect(seat.busted).toBe(true);
    expect(seat.inHand).toBe(false);
    back.room.send('holdem:rebuy', {});
    await waitFor(() => back.errors.some((e) => e.type === 'holdem:rebuy'), 3000, 'rebuy refused');
  });

  it('the host ending the game during an all-in runout plays the hand out instead of refunding it', async () => {
    const { host, server } = await createTable();
    const guest = await join(host.room.roomId, 'Villain', { guestId: 'g-villain' });
    server.timing = { ...FAST, runout: 800, showdown: 800 };
    await start(host);
    rig(
      server,
      new Map([
        [host.me().playerId, ['7c', '2d']],
        [guest.me().playerId, ['As', 'Ad']],
      ]),
      ['Kh', 'Qh', '9c', '4s', '3d'],
    );
    const first = await actor([host, guest]);
    await act(first, 'allin');
    const second = await actor([host, guest]);
    await act(second, 'call');
    await waitFor(() => st(host).runout, 3000, 'runout');
    host.room.send('holdem:end', {});
    await waitFor(() => st(host).phase === 'RESULTS', 3000, 'results');
    const rows = st(host).standings;
    expect(rows.find((r) => r.playerId === guest.me().playerId)!.stack).toBe(20_000);
    expect(rows.find((r) => r.playerId === host.me().playerId)!.stack).toBe(0);
    expect(rows.find((r) => r.playerId === guest.me().playerId)!.handsWon).toBe(1);
  });
  it('"End game" while a bet is open waits for the hand: the pot is won at the table, never refunded', async () => {
    const outcomes: GameOutcome[] = [];
    const stop = onOutcome((o, ctx: OutcomeContext) => void (ctx.gameId === 'holdem' && outcomes.push(o)));
    try {
      const { host } = await createTable();
      const guest = await join(host.room.roomId, 'Villain', { guestId: 'g-villain' });
      await start(host);
      const first = await actor([host, guest]);
      const second = first === host ? guest : host;
      await act(first, 'raise', 2000);
      // The host ends the game while the second player is facing the raise.
      host.room.send('holdem:end', {});
      await waitFor(() => st(host).endRequested, 3000, 'end requested');
      expect(st(host).phase).toBe('PLAYING');
      expect(st(host).seats[seatOf(first)]!.committed).toBe(2000);
      // The hand plays on: a fold hands the blind to the raiser instead of a refund for both.
      await act(second, 'fold');
      await waitFor(() => st(host).phase === 'RESULTS', 4000, 'results');
      const rows = st(host).standings;
      const blind = 100;
      expect(rows.find((r) => r.playerId === first.me().playerId)!.stack).toBe(10_000 + blind);
      expect(rows.find((r) => r.playerId === second.me().playerId)!.stack).toBe(10_000 - blind);
      expect(st(host).endRequested).toBe(false);
      await waitFor(() => outcomes.length === 1, 2000, 'outcome');
      expect(outcomes[0]!.placements[0]).toEqual([first.me().playerId]);
      expect(outcomes[0]!.reason).toBe('host_ended');
    } finally {
      stop();
    }
  });

  it('"Back to lobby" mid-game settles and reports the game (and waits out an open hand first)', async () => {
    const outcomes: GameOutcome[] = [];
    const stop = onOutcome((o, ctx: OutcomeContext) => void (ctx.gameId === 'holdem' && outcomes.push(o)));
    try {
      const { host } = await createTable();
      const guest = await join(host.room.roomId, 'Villain', { guestId: 'g-villain' });
      await start(host);
      const first = await actor([host, guest]);
      await act(first, 'raise', 1000);
      // Mid-bet: refused (the game ends after this hand instead) — no refund, no silent discard.
      host.room.send('lobby:toLobby', {});
      await waitFor(() => host.errors.some((e) => e.type === 'lobby:toLobby'), 3000, 'back to lobby refused');
      await waitFor(() => st(host).endRequested, 3000, 'end requested');
      expect(st(host).phase).toBe('PLAYING');
      const second = first === host ? guest : host;
      await act(second, 'call');
      // The hand is checked down; the game then ends by itself with a result.
      for (let i = 0; i < 12 && st(host).phase !== 'RESULTS'; i++) {
        const who = await actor([host, guest]).catch(() => null);
        if (!who || st(host).phase === 'RESULTS') break;
        await act(who, 'check').catch(() => undefined);
      }
      await waitFor(() => st(host).phase === 'RESULTS', 5000, 'results');
      await waitFor(() => outcomes.length === 1, 2000, 'outcome');
      host.room.send('lobby:toLobby', {});
      await waitFor(() => st(host).phase === 'LOBBY', 3000, 'lobby');

      // Between hands, "Back to lobby" settles at once: the session is reported, then the lobby.
      host.room.send('lobby:start', {});
      await waitFor(() => st(host).handNumber >= 1 && st(host).toActSeat >= 0, 4000, 'first hand of game 2');
      const opener = await actor([host, guest]);
      await act(opener, 'fold');
      await waitFor(() => st(host).phase === 'INTERMISSION', 3000, 'intermission');
      host.room.send('lobby:toLobby', {});
      await waitFor(() => st(host).phase === 'LOBBY', 3000, 'lobby again');
      await waitFor(() => outcomes.length === 2, 2000, 'second outcome');
      const winner = opener === host ? guest : host;
      expect(outcomes[1]!.placements[0]).toEqual([winner.me().playerId]);
      expect(outcomes[1]!.scores![winner.me().playerId]).toBe(10_050);
    } finally {
      stop();
    }
  });
});
