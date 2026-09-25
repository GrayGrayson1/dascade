import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { WelcomePayload } from '@dascade/shared';
import type { HoldemPrivatePayload, HoldemPublicState, HoldemEvent } from '@dascade/shared/games/holdem';
import type { HandState } from '@dascade/game-core/holdem';
import { createDascadeServer } from '../src/server.ts';
import { collect, freePort, quiet, sleep, waitFor } from './helpers.ts';
import type { HoldemRoom } from '../src/rooms/holdem/HoldemRoom.ts';

let colyseus: ColyseusTestServer;

/**
 * Like bootTestServer(['holdem']), but on a free port: @colyseus/testing's boot() always
 * listens on 2568 for Server instances, which collides when several suites run at once.
 */
async function bootHoldemServer(): Promise<ColyseusTestServer> {
  const server = await createDascadeServer({ games: ['holdem'] });
  await server.listen(await freePort());
  return new ColyseusTestServer(server);
}

beforeAll(async () => {
  colyseus = await bootHoldemServer();
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
  events: HoldemEvent[];
  me: () => WelcomePayload;
}

function wire(room: SdkRoom): Client {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<{ type?: string; code: string; message: string }>(room, 'sys:error');
  const privates = collect<HoldemPrivatePayload>(room, 'holdem:private');
  const events = collect<HoldemEvent>(room, 'holdem:event');
  quiet(room);
  return { room, errors, privates, events, me: () => welcomes[welcomes.length - 1]! };
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

async function createTable(settings: Record<string, unknown> = {}) {
  const host = await ready(wire(await colyseus.sdk.create('holdem', { name: 'Hero', settings })));
  const server = colyseus.getRoomById(host.room.roomId) as unknown as HoldemRoom;
  (server as any).countdownMs = 0;
  server.timing = { ...FAST };
  return { host, server };
}

async function join(code: string, name: string, extra: Record<string, unknown> = {}) {
  return ready(wire(await colyseus.sdk.joinById(code, { name, ...extra })));
}

const st = (c: Client) => (c.room.state as any).toJSON() as HoldemPublicState;
const engine = (server: HoldemRoom) => (server as any).hand as HandState | null;
const seatOf = (c: Client) => st(c).seats.find((s) => s.playerId === c.me().playerId)?.index ?? -1;

async function start(host: Client) {
  host.room.send('lobby:start', {});
  await waitFor(() => st(host).handNumber >= 1 && st(host).toActSeat >= 0, 4000, 'first hand');
}

/** The client whose turn it is (by public state). */
async function actor(clients: Client[]): Promise<Client> {
  await waitFor(() => clients.some((c) => seatOf(c) >= 0 && seatOf(c) === st(c).toActSeat), 4000, 'someone to act');
  return clients.find((c) => seatOf(c) === st(c).toActSeat)!;
}

async function act(c: Client, action: string, amount?: number) {
  const seq = st(c).actionSeq;
  c.room.send('holdem:act', { action, amount, seq });
  await waitFor(() => st(c).actionSeq > seq, 3000, `${action} accepted`);
}

const chips = (s: HoldemPublicState) => s.seats.reduce((sum, seat) => sum + seat.stack + seat.committed, 0);

// ---------------------------------------------------------------------------

describe("DAS Hold'em room", () => {
  it('deals private hole cards only to their owner — never to other players or spectators, never in state', async () => {
    const { host, server } = await createTable();
    const guest = await join(host.room.roomId, 'Villain');
    const rail = await join(host.room.roomId, 'Rail', { spectator: true });
    await start(host);

    await waitFor(() => host.privates.some((p) => p.cards.length === 2) && guest.privates.some((p) => p.cards.length === 2), 3000, 'hole cards');
    const h = engine(server)!;
    const hostHole = h.players.find((p) => p.id === host.me().playerId)!.hole;
    const guestHole = h.players.find((p) => p.id === guest.me().playerId)!.hole;
    expect(host.privates.at(-1)!.cards).toEqual(hostHole);
    expect(guest.privates.at(-1)!.cards).toEqual(guestHole);
    // Nobody ever received someone else's cards.
    for (const p of host.privates) for (const card of guestHole) expect(p.cards).not.toContain(card);
    for (const p of guest.privates) for (const card of hostHole) expect(p.cards).not.toContain(card);
    for (const p of rail.privates) expect(p.cards).toEqual([]);

    // Public state carries no hole cards and no deck.
    const state = st(rail);
    for (const seat of state.seats) expect(seat.shownCards).toEqual([]);
    expect(state.board).toEqual([]);
    const flat = JSON.stringify({ seats: state.seats, board: state.board, log: state.log, pots: state.pots, winners: state.winners });
    for (const card of [...hostHole, ...guestHole]) expect(flat).not.toContain(`"${card}"`);
    for (const line of state.log) for (const card of [...hostHole, ...guestHole]) expect(line.text).not.toContain(card);
    expect(Object.keys(state)).not.toContain('deck');
    expect(state.seats.filter((s) => s.hasCards)).toHaveLength(2);
  });

  it('rejects out-of-turn actions, over-stack bets, illegal raise sizes and spectator actions', async () => {
    const { host } = await createTable();
    const guest = await join(host.room.roomId, 'Villain');
    const rail = await join(host.room.roomId, 'Rail', { spectator: true });
    await start(host);
    const acting = await actor([host, guest]);
    const waiting = acting === host ? guest : host;
    const s = st(acting);
    const seq = s.actionSeq;

    waiting.room.send('holdem:act', { action: 'call' });
    await waitFor(() => waiting.errors.some((e) => e.code === 'not_your_turn'), 3000, 'out of turn');

    const mySeat = s.seats[seatOf(acting)]!;
    acting.room.send('holdem:act', { action: 'raise', amount: mySeat.stack + mySeat.bet + 1 });
    await waitFor(() => acting.errors.some((e) => e.code === 'insufficient_chips'), 3000, 'over-stack');

    acting.room.send('holdem:act', { action: 'raise', amount: s.legal.minRaiseTo - 1 });
    await waitFor(() => acting.errors.some((e) => e.code === 'not_allowed' && /minimum/i.test(e.message)), 3000, 'min raise');

    acting.room.send('holdem:act', { action: 'check' }); // facing the big blind preflop (heads-up button)
    await waitFor(() => acting.errors.filter((e) => e.code === 'not_allowed').length >= 2, 3000, 'illegal check');

    acting.room.send('holdem:act', { action: 'raise', amount: 1.5 });
    await waitFor(() => acting.errors.some((e) => e.code === 'invalid_payload'), 3000, 'fractional chips');

    acting.room.send('holdem:act', { action: 'call', seq: seq + 7 });
    await waitFor(() => acting.errors.some((e) => /already passed/.test(e.message)), 3000, 'stale seq');

    rail.room.send('holdem:act', { action: 'fold' });
    await waitFor(() => rail.errors.some((e) => e.code === 'not_allowed'), 3000, 'spectator');

    await sleep(50);
    expect(st(host).actionSeq).toBe(seq);
    expect(st(host).toActSeat).toBe(seatOf(acting));
  });

  it('plays a hand to the end, awards the pot, conserves chips and moves the button', async () => {
    const { host } = await createTable({ startingStack: 5000, smallBlind: 25, bigBlind: 50 });
    const guest = await join(host.room.roomId, 'Villain');
    await start(host);
    const first = st(host);
    expect(first.smallBlind).toBe(25);
    expect(first.bigBlind).toBe(50);
    // Heads-up: the button posts the small blind and acts first preflop.
    expect(first.sbSeat).toBe(first.button);
    expect(first.toActSeat).toBe(first.button);
    expect(chips(first)).toBe(10_000);

    // Check / call down to showdown.
    for (let i = 0; i < 12 && st(host).handNumber === 1 && st(host).street !== 'showdown' && st(host).street !== 'complete'; i++) {
      const c = await actor([host, guest]);
      const legal = st(c).legal;
      await act(c, legal.canCheck ? 'check' : 'call');
    }
    await waitFor(() => st(host).winners.length > 0, 4000, 'winners');
    const done = st(host);
    expect(done.phase).toBe('INTERMISSION');
    expect(done.board).toHaveLength(5);
    const total = done.winners.reduce((s, w) => s + w.amount, 0);
    expect(total).toBe(100);
    expect(done.seats.reduce((s, seat) => s + seat.stack, 0)).toBe(10_000);
    const shownSeats = done.seats.filter((s) => s.shownCards.length === 2);
    expect(shownSeats).toHaveLength(2); // policy "all": both live hands tabled
    expect(done.winners[0]!.description).not.toBe('');
    expect(done.log.some((l) => l.kind === 'win')).toBe(true);

    await waitFor(() => st(host).handNumber === 2 && st(host).toActSeat >= 0, 3000, 'second hand');
    expect(st(host).button).not.toBe(first.button);
  });

  it('a fold ends the hand uncontested and nobody has to show', async () => {
    const { host } = await createTable();
    const guest = await join(host.room.roomId, 'Villain');
    await start(host);
    const c = await actor([host, guest]);
    await act(c, 'fold');
    await waitFor(() => st(host).winners.length === 1, 3000, 'winner');
    const s = st(host);
    // Heads-up: the small blind folds, the big blind's uncalled 50 comes back and they collect 100.
    expect(s.winners[0]!.amount).toBe(100);
    expect(s.winners[0]!.description).toBe('');
    expect(s.seats.every((seat) => seat.shownCards.length === 0)).toBe(true);
  });

  it('lets a player table their cards voluntarily only after the hand is over', async () => {
    const { host, server } = await createTable();
    const guest = await join(host.room.roomId, 'Villain');
    await start(host);
    const c = await actor([host, guest]);
    const other = c === host ? guest : host;
    other.room.send('holdem:show', {});
    await waitFor(() => other.errors.some((e) => /after the hand/.test(e.message)), 3000, 'too early');
    const hole = engine(server)!.players.find((p) => p.id === other.me().playerId)!.hole;
    await act(c, 'fold');
    await waitFor(() => st(host).winners.length === 1, 3000, 'hand over');
    expect(st(host).seats[seatOf(other)]!.shownCards).toEqual([]);
    other.room.send('holdem:show', {});
    await waitFor(() => st(host).seats[seatOf(other)]!.shownCards.length === 2, 3000, 'shown');
    expect(st(host).seats[seatOf(other)]!.shownCards).toEqual(hole);
    expect(st(host).log.some((l) => l.kind === 'show')).toBe(true);
  });

  it('sitting out skips you from the next hand; coming back deals you in again', async () => {
    const { host } = await createTable();
    const b = await join(host.room.roomId, 'Villain');
    const c = await join(host.room.roomId, 'Third');
    await start(host);
    c.room.send('holdem:sitOut', { sittingOut: true });
    await waitFor(() => st(host).seats[seatOf(c)]!.sittingOut, 3000, 'sitting out');
    // The current hand continues normally for them; play it out by folding around.
    while (st(host).handNumber === 1) {
      const who = await actor([host, b, c]).catch(() => null);
      if (!who || st(host).handNumber !== 1) break;
      await act(who, st(who).legal.canCheck ? 'check' : 'fold').catch(() => undefined);
    }
    await waitFor(() => st(host).handNumber === 2 && st(host).toActSeat >= 0, 4000, 'hand 2');
    expect(st(host).seats[seatOf(c)]!.inHand).toBe(false);
    expect(st(host).seats.filter((s) => s.inHand)).toHaveLength(2);
    c.room.send('holdem:sitOut', { sittingOut: false });
    await waitFor(() => !st(host).seats[seatOf(c)]!.sittingOut, 3000, 'back');
  });

  it('a player leaving mid-hand folds without breaking the hand; their seat frees up afterwards', async () => {
    const { host, server } = await createTable();
    const b = await join(host.room.roomId, 'Villain');
    const c = await join(host.room.roomId, 'Third');
    await start(host);
    const players = [host, b, c];
    const leaver = players.find((p) => p !== host && seatOf(p) !== st(host).toActSeat)!;
    const leaverSeat = seatOf(leaver);
    const leaverId = leaver.me().playerId;
    await leaver.room.leave(true);
    await waitFor(() => st(host).seats[leaverSeat]!.folded, 3000, 'leaver folded');
    expect(st(host).seats[leaverSeat]!.left).toBe(true);
    const remaining = players.filter((p) => p !== leaver);
    for (let i = 0; i < 20 && st(host).handNumber === 1 && st(host).winners.length === 0; i++) {
      const who = await actor(remaining).catch(() => null);
      if (!who || st(host).handNumber !== 1) break;
      const legal = st(who).legal;
      await act(who, legal.canCheck ? 'check' : 'call');
    }
    await waitFor(() => st(host).handNumber === 2, 5000, 'next hand');
    const s = st(host);
    expect(s.seats[leaverSeat]!.playerId).toBe('');
    expect(s.seats.filter((seat) => seat.inHand)).toHaveLength(2);
    expect(engine(server)!.players.some((p) => p.id === leaverId)).toBe(false);
  });

  it('the player to act leaving immediately passes the action on', async () => {
    const { host } = await createTable();
    const b = await join(host.room.roomId, 'Villain');
    const c = await join(host.room.roomId, 'Third');
    await start(host);
    // Make sure the player to act is not the host (the host stays to observe).
    if ((await actor([b, c, host])) === host) await act(host, 'call');
    const next = await actor([b, c, host]);
    expect(next).not.toBe(host);
    const nextSeat = seatOf(next);
    await next.room.leave(true);
    await waitFor(() => st(host).seats[nextSeat]!.folded && st(host).toActSeat !== nextSeat, 3000, 'action passed');
  });

  it('reconnecting restores your hole cards', async () => {
    const { host, server } = await createTable();
    const guest = await join(host.room.roomId, 'Villain');
    await start(host);
    await waitFor(() => guest.privates.some((p) => p.cards.length === 2), 3000, 'cards');
    const cards = engine(server)!.players.find((p) => p.id === guest.me().playerId)!.hole;
    const before = guest.privates.length;
    guest.room.reconnection.minUptime = 0;
    const reconnected = new Promise<void>((r) => guest.room.onReconnect(() => r()));
    (guest.room as any).connection.transport.ws.close(4010);
    await waitFor(() => st(host).players[guest.me().playerId]?.connected === false, 3000, 'dropped');
    await reconnected;
    await waitFor(() => guest.privates.length > before, 3000, 'private re-sent');
    expect(guest.privates.at(-1)).toMatchObject({ handNumber: 1, cards });
  });

  it('seat-token rejoin after the grace period restores cards; away players are auto-played and sat out', async () => {
    const { host, server } = await createTable();
    (server as any).reconnectGraceSeconds = 0.3;
    const guest = await join(host.room.roomId, 'Villain');
    await start(host);
    const { playerId, seatToken } = guest.me();
    const guestSeat = seatOf(guest);
    const cards = engine(server)!.players.find((p) => p.id === playerId)!.hole;
    guest.room.reconnection.enabled = false;
    (guest.room as any).connection.transport.ws.close(4010);
    // Their turn is auto-played (check or fold) and they are marked sitting out.
    await waitFor(() => st(host).seats[guestSeat]!.sittingOut, 6000, 'sat out');
    expect(st(host).seats[guestSeat]!.sitOutReason).toBe('away');
    const again = await join(host.room.roomId, 'Villain', { seatToken });
    expect(again.me().playerId).toBe(playerId);
    await waitFor(() => again.privates.length > 0, 3000, 'private');
    const last = again.privates.at(-1)!;
    if (last.handNumber === 1) expect(last.cards).toEqual(cards);
    await waitFor(() => st(host).seats[guestSeat]!.sittingOut === false, 3000, 'back from away');
  });

  it('times out slow players (check if free, else fold) and sits them out after repeated timeouts', async () => {
    const { host, server } = await createTable();
    server.timing.actionMs = 250;
    const guest = await join(host.room.roomId, 'Villain');
    await start(host);
    await waitFor(() => st(host).seats.some((s) => s.sitOutReason === 'timeout'), 8000, 'timeout sit-out');
    expect(st(host).log.some((l) => /ran out of time/.test(l.text))).toBe(true);
    const out = st(host).seats.find((s) => s.sitOutReason === 'timeout')!;
    const client = out.playerId === host.me().playerId ? host : guest;
    client.room.send('holdem:sitOut', { sittingOut: false });
    await waitFor(() => st(host).seats[out.index]!.sittingOut === false, 3000, 'back');
  });

  it('lets players pick seats in the lobby and rejects taken or missing seats', async () => {
    const { host } = await createTable();
    const guest = await join(host.room.roomId, 'Villain');
    host.room.send('holdem:sit', { seat: 5 });
    await waitFor(() => st(host).seats[5]!.playerId === host.me().playerId, 3000, 'host seated');
    guest.room.send('holdem:sit', { seat: 5 });
    await waitFor(() => guest.errors.some((e) => /taken/.test(e.message)), 3000, 'taken');
    guest.room.send('holdem:sit', { seat: 9 }); // default table size is 8
    await waitFor(() => guest.errors.some((e) => /not at this table/.test(e.message)), 3000, 'beyond table');
    guest.room.send('holdem:sit', { seat: 2 });
    await waitFor(() => st(host).seats[2]!.playerId === guest.me().playerId, 3000, 'guest seated');
    host.room.send('holdem:sit', { seat: 1 });
    await waitFor(() => st(host).seats[1]!.playerId === host.me().playerId && st(host).seats[5]!.playerId === '', 3000, 'moved');
    await start(host);
    expect(seatOf(host)).toBe(1);
    expect(seatOf(guest)).toBe(2);
    host.room.send('holdem:sit', { seat: 4 });
    await waitFor(() => host.errors.some((e) => /only change seats in the lobby/.test(e.message)), 3000, 'no seat hopping');
  });

  it('seats late joiners at the next hand, and a spectator can take an empty seat', async () => {
    const { host } = await createTable();
    const guest = await join(host.room.roomId, 'Villain');
    await start(host);
    const late = await join(host.room.roomId, 'Latecomer');
    expect(st(late).players[late.me().playerId]!.spectator).toBe(true);
    expect(st(late).players[late.me().playerId]!.queued).toBe(true);
    const c = await actor([host, guest]);
    await act(c, 'fold');
    await waitFor(() => st(host).handNumber === 2, 3000, 'hand 2');
    await waitFor(() => seatOf(late) >= 0, 3000, 'late seated');
    expect(st(host).seats[seatOf(late)]!.inHand).toBe(true);
    expect(late.privates.at(-1)!.cards).toHaveLength(2);

    const rail = await join(host.room.roomId, 'Railbird', { spectator: true });
    const empty = st(host).seats.find((s) => !s.playerId && s.index < st(host).tableSize)!.index;
    rail.room.send('holdem:sit', { seat: empty });
    await waitFor(() => st(host).seats[empty]!.playerId === rail.me().playerId, 3000, 'rail seated');
    expect(st(host).seats[empty]!.stack).toBe(10_000);
    expect(st(host).seats[empty]!.waiting).toBe(true);
  });

  it('busted players can rebuy (virtual chips); without rebuys the last player standing ends the game', async () => {
    const { host } = await createTable({ startingStack: 1000, smallBlind: 5, bigBlind: 10 });
    const guest = await join(host.room.roomId, 'Villain');
    await start(host);
    // Shove until someone busts (a split just deals again).
    for (let attempt = 0; attempt < 12 && !st(host).seats.some((s) => s.busted); attempt++) {
      const hand = st(host).handNumber;
      const first = await actor([host, guest]);
      await act(first, 'allin');
      const second = await actor([host, guest]);
      await act(second, 'call');
      await waitFor(() => st(host).handNumber > hand || st(host).seats.some((s) => s.busted), 5000, 'hand over');
    }
    const busted = st(host).seats.find((s) => s.busted)!;
    const loser = busted.playerId === host.me().playerId ? host : guest;
    loser.room.send('holdem:rebuy', {});
    await waitFor(() => st(host).seats[busted.index]!.stack === 1000, 3000, 'rebuy');
    expect(st(host).seats[busted.index]!.rebuys).toBe(1);
    expect(st(host).seats[busted.index]!.buyIns).toBe(2000);
    const winner = loser === host ? guest : host;
    winner.room.send('holdem:rebuy', {});
    await waitFor(() => winner.errors.some((e) => /out of chips/.test(e.message)), 3000, 'no rebuy with chips');
  });

  it('ends at the last player standing when rebuys are off', async () => {
    const { host } = await createTable({ startingStack: 1000, smallBlind: 5, bigBlind: 10, allowRebuys: false });
    const guest = await join(host.room.roomId, 'Villain');
    await start(host);
    for (let attempt = 0; attempt < 12 && st(host).phase !== 'RESULTS'; attempt++) {
      const hand = st(host).handNumber;
      const first = await actor([host, guest]).catch(() => null);
      if (!first) break;
      await act(first, 'allin');
      const second = await actor([host, guest]).catch(() => null);
      if (!second) break;
      await act(second, 'call');
      await waitFor(() => st(host).handNumber > hand || st(host).phase === 'RESULTS', 5000, 'hand over');
    }
    await waitFor(() => st(host).phase === 'RESULTS', 3000, 'results');
    const standings = st(host).standings;
    expect(standings).toHaveLength(2);
    expect(standings[0]!.stack).toBe(2000);
    expect(standings[0]!.rank).toBe(1);
    expect(standings[0]!.net).toBe(1000);
    expect(standings[0]!.handsWon).toBeGreaterThanOrEqual(1);
    expect(standings[0]!.bestPot).toBeGreaterThanOrEqual(2000);
    expect(standings[1]!.stack).toBe(0);
    expect(standings[1]!.net).toBe(-1000);
  });

  it('host can end the game mid-hand: the hand is cancelled, bets returned, leaderboard shown', async () => {
    const { host } = await createTable();
    const guest = await join(host.room.roomId, 'Villain');
    await start(host);
    const c = await actor([host, guest]);
    await act(c, 'raise', 600);
    guest.room.send('holdem:end', {});
    await waitFor(() => guest.errors.some((e) => e.code === 'not_host'), 3000, 'guest cannot end');
    host.room.send('holdem:end', {});
    await waitFor(() => st(host).phase === 'RESULTS', 3000, 'results');
    const s = st(host);
    expect(s.standings.map((r) => r.stack)).toEqual([10_000, 10_000]);
    expect(s.standings.every((r) => r.net === 0 && r.rank === 1)).toBe(true);
    expect(host.privates.at(-1)!.cards).toEqual([]);

    host.room.send('lobby:toLobby', {});
    await waitFor(() => st(host).phase === 'LOBBY', 3000, 'lobby');
    expect(st(host).standings).toEqual([]);
    expect(st(host).seats.filter((seat) => seat.playerId).length).toBe(2);
  });

  it('validates settings: blinds order and stack depth', async () => {
    const { host } = await createTable();
    host.room.send('lobby:settings', { settings: { smallBlind: 200, bigBlind: 100 } });
    await waitFor(() => host.errors.some((e) => /big blind/i.test(e.message)), 3000, 'blind order');
    host.room.send('lobby:settings', { settings: { startingStack: 1000, bigBlind: 500, smallBlind: 250 } });
    await waitFor(() => host.errors.some((e) => /10 big blinds/.test(e.message)), 3000, 'depth');
    host.room.send('lobby:settings', { settings: { startingStack: 20_000, smallBlind: 100, bigBlind: 200, actionSeconds: 15 } });
    await waitFor(() => st(host).bigBlind === 200, 3000, 'blinds preview');
    expect(JSON.parse(st(host).settingsJson)).toMatchObject({ startingStack: 20_000, actionSeconds: 15 });
  });

  it('seats up to ten players and deals everyone in', async () => {
    const { host } = await createTable();
    host.room.send('lobby:room', { maxPlayers: 10 });
    await waitFor(() => st(host).maxPlayers === 10, 3000, 'max 10');
    const others: Client[] = [];
    for (let i = 0; i < 9; i++) others.push(await join(host.room.roomId, `Seat${i}`));
    await start(host);
    const s = st(host);
    expect(s.tableSize).toBe(10);
    expect(s.seats.filter((seat) => seat.inHand)).toHaveLength(10);
    expect(new Set(s.seats.map((seat) => seat.playerId)).size).toBe(10);
    for (const c of [host, ...others]) await waitFor(() => c.privates.some((p) => p.cards.length === 2), 3000, 'cards');
    const all = [host, ...others].flatMap((c) => c.privates.at(-1)!.cards);
    expect(new Set(all).size).toBe(20);
  });
});
