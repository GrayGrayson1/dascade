/**
 * DASjack 21 room integration tests: real server, real SDK clients.
 * Animation pacing is compressed with DASCADE_BJ_PACE (honoured only outside production)
 * and rounds are made deterministic by stacking the shoe through the room's test hook.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, WelcomePayload } from '@dascade/shared';
import {
  BLACKJACK_MSG,
  type BlackjackHandView,
  type BlackjackPublicState,
  type BlackjackSettings,
  type BlackjackStage,
} from '@dascade/shared/games/blackjack';
import { readTestHooks } from '../src/rooms/blackjack/testHooks.ts';
import { onOutcome, type OutcomeContext } from '../src/platform/hub.ts';
import { bootTestServer, collect, quiet, sleep, waitFor } from './helpers.ts';

// Compress animation pacing (read by the room at creation; ignored in production).
process.env.DASCADE_BJ_PACE = '0.05';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['blackjack']));
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
  me: () => WelcomePayload;
  id: () => string;
  state: () => BlackjackPublicState;
}

async function wrap(room: SdkRoom): Promise<Client> {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<{ type?: string; code: string; message: string }>(room, 'sys:error');
  quiet(room);
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, 'welcome');
  return {
    room,
    errors,
    me: () => welcomes[welcomes.length - 1]!,
    id: () => welcomes[welcomes.length - 1]!.playerId,
    state: () => (room.state as { toJSON(): BlackjackPublicState }).toJSON(),
  };
}

type ServerTable = any;

async function createTable(opts: { name?: string; settings?: Partial<BlackjackSettings>; solo?: boolean } = {}) {
  const room = await colyseus.sdk.create('blackjack', { name: opts.name ?? 'Alice', settings: opts.settings, solo: opts.solo });
  const client = await wrap(room);
  const server: ServerTable = colyseus.getRoomById(room.roomId);
  return { ...client, server };
}

async function joinTable(code: string, name: string, extra: Record<string, unknown> = {}): Promise<Client> {
  return wrap(await colyseus.sdk.joinById(code, { name, ...extra }));
}

const stageOf = (c: Client) => c.state().stage;
const seatOf = (c: Client, id = c.id()) => c.state().seats[id];

async function waitStage(c: Client, stage: BlackjackStage, timeout = 5000) {
  await waitFor(() => c.state().phase === 'PLAYING' && stageOf(c) === stage, timeout, `stage ${stage} (now ${stageOf(c)})`);
}

async function start(host: Client) {
  host.room.send('lobby:start', {});
  await waitStage(host, 'BETTING');
}

async function bet(c: Client, amount: number) {
  c.room.send(BLACKJACK_MSG.bet, { amount });
  await waitFor(() => seatOf(c)?.bet === amount, 3000, `bet ${amount}`);
  c.room.send(BLACKJACK_MSG.lock, { locked: true });
  await waitFor(() => seatOf(c)?.locked === true, 3000, 'lock');
}

async function sitOut(c: Client) {
  c.room.send(BLACKJACK_MSG.lock, { locked: true });
  await waitFor(() => seatOf(c)?.sittingOut === true, 3000, 'sit out');
}

async function act(c: Client, action: string, hand = seatOf(c)!.activeHand) {
  const before = JSON.stringify(seatOf(c)!.hands) + seatOf(c)!.activeHand + seatOf(c)!.done;
  c.room.send(BLACKJACK_MSG.action, { action, hand });
  await waitFor(() => JSON.stringify(seatOf(c)!.hands) + seatOf(c)!.activeHand + seatOf(c)!.done !== before, 3000, `${action} applied`);
}

/** Waits for the next sys:error on this client and returns it. */
async function nextError(c: Client) {
  const count = c.errors.length + 1;
  await waitFor(() => c.errors.length >= count, 3000, `error #${count}`);
  return c.errors[count - 1]!;
}

/** Records a seat's hands every time they carry settled results (the settle window is short in tests). */
function recordResults(c: Client, id: () => string = c.id): BlackjackHandView[][] {
  const seen: BlackjackHandView[][] = [];
  c.room.onStateChange(() => {
    const seat = c.state().seats[id()];
    if (!seat || seat.hands.length === 0 || !seat.hands.every((h) => h.result !== '')) return;
    if (JSON.stringify(seen.at(-1)) !== JSON.stringify(seat.hands)) seen.push(seat.hands);
  });
  return seen;
}

async function nextRound(c: Client, round: number) {
  await waitFor(() => c.state().round === round && stageOf(c) === 'BETTING', 6000, `betting for round ${round + 1}`);
}

describe('DASjack 21 room', () => {
  it('supports instant solo play: bet, deal, act, settle and deal again', async () => {
    const solo = await createTable({ solo: true });
    await waitStage(solo, 'BETTING');
    expect(solo.state().seats[solo.id()]).toMatchObject({ balance: 1000, bought: 1000, seat: 3 });

    // Round 1: player 17 v dealer 17 → push.
    solo.server.testStacks = [
      ['Ts', '9h', '7d', '8c'],
      ['Ts', '6h', 'Ks', 'Tc', 'Kd'],
    ];
    await bet(solo, 100);
    await waitStage(solo, 'PLAYING');
    expect(seatOf(solo)!.hands[0]).toMatchObject({ cards: ['Ts', '7d'], total: 17, label: '17', bet: 100 });
    expect(seatOf(solo)!.actions).toEqual(['hit', 'stand', 'double', 'surrender']);
    expect(seatOf(solo)!.balance).toBe(900);
    await act(solo, 'stand');
    await nextRound(solo, 1);
    expect(seatOf(solo)).toMatchObject({ balance: 1000, net: 0, handsPlayed: 1, lastBet: 100 });

    // Round 2: player 20 v dealer 16 → dealer draws K and busts.
    await bet(solo, 100);
    await waitStage(solo, 'PLAYING');
    await act(solo, 'stand');
    await waitFor(() => solo.state().dealer.revealed, 3000, 'reveal');
    await nextRound(solo, 2);
    expect(seatOf(solo)).toMatchObject({ balance: 1100, net: 100, handsPlayed: 2, handsWon: 1 });
  });

  it('never exposes the dealer hole card in any state patch or message before the reveal', async () => {
    const host = await createTable({ settings: { decks: 1 } });
    const bob = await joinTable(host.room.roomId, 'Bob');
    const spec = await joinTable(host.room.roomId, 'Spec', { spectator: true });
    const clients = [host, bob, spec];

    // Capture every raw frame (state patches + messages) and every decoded message on every client.
    const frames = clients.map(() => [] as Array<{ bytes: Uint8Array; revealedAfter: boolean }>);
    const messages = clients.map(() => [] as Array<{ json: string; revealedAtArrival: boolean }>);
    const stateLeaks: string[] = [];
    let holeCode: string | null = null;
    clients.forEach((c, i) => {
      const events = (c.room as any).connection.events;
      const original = events.onmessage;
      events.onmessage = (event: MessageEvent) => {
        const bytes = new Uint8Array(event.data as ArrayBuffer).slice();
        original(event);
        frames[i]!.push({ bytes, revealedAfter: c.state().dealer?.revealed === true });
      };
      c.room.onMessage('*', (type: unknown, payload: unknown) => {
        messages[i]!.push({ json: JSON.stringify({ type, payload }), revealedAtArrival: c.state().dealer?.revealed === true });
      });
      c.room.onStateChange(() => {
        const s = c.state();
        const hole = holeCode ?? currentHole();
        if (hole && s.dealer && !s.dealer.revealed && JSON.stringify(s).includes(`"${hole}"`)) stateLeaks.push(`client ${i}`);
      });
    });
    const currentHole = (): string | null => {
      const h = host.server.round?.hole;
      return h ? `${'23456789TJQKA'[h.rank - 2]}${h.suit}` : null;
    };

    host.room.send('lobby:start', {});
    await waitStage(host, 'BETTING');
    // Deal order is by seat: Bob (seat 2) then Alice (seat 3). Bob 5c 6c (11), Alice 9s 8s (17),
    // dealer Th up / 7h hole (peek, no blackjack); Bob hits Kd.
    host.server.testStacks = [['5c', '9s', 'Th', '6c', '8s', '7h', 'Kd']];
    await bet(host, 50);
    await bet(bob, 50);
    await waitFor(() => host.server.round?.hole !== undefined && host.server.round?.hole !== null, 3000, 'deal');
    holeCode = currentHole();
    expect(holeCode).toBe('7h');
    await waitStage(host, 'PLAYING');
    expect(host.state().dealer).toMatchObject({ cards: ['Th'], hasHole: true, revealed: false, total: 10, label: 'Showing 10', peeked: true });
    await act(bob, 'hit');
    await act(host, 'stand');
    await waitFor(() => host.state().dealer.revealed, 3000, 'reveal');
    expect(host.state().dealer.cards.slice(0, 2)).toEqual(['Th', '7h']);
    await nextRound(host, 1);

    const sig = [0xa2, holeCode!.charCodeAt(0), holeCode!.charCodeAt(1)];
    const contains = (b: Uint8Array) => {
      for (let i = 0; i + 2 < b.length; i++) if (b[i] === sig[0] && b[i + 1] === sig[1] && b[i + 2] === sig[2]) return true;
      return false;
    };
    for (let i = 0; i < clients.length; i++) {
      const leaked = frames[i]!.filter((f) => !f.revealedAfter && contains(f.bytes));
      expect(leaked, `client ${i} received the hole card in a frame before the reveal`).toEqual([]);
      // Sanity: the scanner does see the card once it is legally revealed.
      expect(frames[i]!.some((f) => f.revealedAfter && contains(f.bytes))).toBe(true);
      const early = messages[i]!.filter((m) => !m.revealedAtArrival && m.json.includes(`"${holeCode}"`));
      expect(early).toEqual([]);
    }
    expect(stateLeaks).toEqual([]);
    expect(seatOf(host)).toMatchObject({ net: 0, balance: 1000 }); // 17 v 17
    expect(seatOf(bob)).toMatchObject({ net: 50, balance: 1050 }); // 21 v 17
  });

  it('rejects over-balance, over-limit and under-minimum bets and malformed payloads', async () => {
    const host = await createTable({ settings: { startingBalance: 1000, minBet: 10, maxBet: 2000 } });
    await start(host);
    host.room.send(BLACKJACK_MSG.bet, { amount: 1500 });
    expect(await nextError(host)).toMatchObject({ code: 'insufficient_chips' });
    host.room.send(BLACKJACK_MSG.bet, { amount: 2500 });
    expect(await nextError(host)).toMatchObject({ code: 'not_allowed', message: 'The table maximum is 2,000.' });
    host.room.send(BLACKJACK_MSG.bet, { amount: -5 });
    expect(await nextError(host)).toMatchObject({ code: 'invalid_payload' });
    host.room.send(BLACKJACK_MSG.bet, { amount: 10.5 });
    expect(await nextError(host)).toMatchObject({ code: 'invalid_payload' });
    host.room.send(BLACKJACK_MSG.bet, { amount: 5 });
    await waitFor(() => seatOf(host)!.bet === 5);
    expect(seatOf(host)!.balance).toBe(995);
    host.room.send(BLACKJACK_MSG.lock, { locked: true });
    expect(await nextError(host)).toMatchObject({ code: 'not_allowed', message: 'The table minimum is 10.' });
    host.room.send(BLACKJACK_MSG.bet, { amount: 1000 });
    await waitFor(() => seatOf(host)!.bet === 1000);
    expect(seatOf(host)!.balance).toBe(0);
    host.room.send(BLACKJACK_MSG.bet, { amount: 1001 });
    expect(await nextError(host)).toMatchObject({ code: 'insufficient_chips' });
    host.room.send(BLACKJACK_MSG.bet, { amount: 0 });
    await waitFor(() => seatOf(host)!.bet === 0);
    expect(seatOf(host)!.balance).toBe(1000);
    host.room.send(BLACKJACK_MSG.refill, {});
    expect(await nextError(host)).toMatchObject({ code: 'not_allowed' });
    host.room.send(BLACKJACK_MSG.action, { action: 'hit', hand: 0 });
    expect(await nextError(host)).toMatchObject({ code: 'wrong_phase' });
    expect(seatOf(host)!.balance).toBe(1000);
  });

  it('only lets players act on their own hands and rejects illegal actions', async () => {
    const host = await createTable();
    const bob = await joinTable(host.room.roomId, 'Bob');
    const spec = await joinTable(host.room.roomId, 'Spec', { spectator: true });
    await start(host);
    // Alice 9s 8d (17, no pair), dealer 6h / Tc. Bob sits out. Alice hits 4c (21); dealer draws Ts and busts.
    host.server.testStacks = [['9s', '6h', '8d', 'Tc', '4c', 'Ts']];
    await sitOut(bob);
    await bet(host, 100);
    await waitStage(host, 'PLAYING');
    const aliceHand = JSON.stringify(seatOf(host)!.hands);

    bob.room.send(BLACKJACK_MSG.action, { action: 'hit', hand: 0 });
    expect(await nextError(bob)).toMatchObject({ code: 'not_your_turn' });
    bob.room.send(BLACKJACK_MSG.action, { action: 'hit', hand: 0, playerId: host.id() });
    expect(await nextError(bob)).toMatchObject({ code: 'invalid_payload' });
    bob.room.send(BLACKJACK_MSG.insurance, { take: true });
    expect(await nextError(bob)).toMatchObject({ code: 'wrong_phase' });
    spec.room.send(BLACKJACK_MSG.action, { action: 'stand', hand: 0 });
    expect(await nextError(spec)).toMatchObject({ code: 'not_allowed' });
    spec.room.send(BLACKJACK_MSG.bet, { amount: 10 });
    expect(await nextError(spec)).toMatchObject({ code: 'not_allowed' });
    await sleep(80);
    expect(JSON.stringify(seatOf(host)!.hands)).toBe(aliceHand);

    host.room.send(BLACKJACK_MSG.action, { action: 'split', hand: 0 });
    expect(await nextError(host)).toMatchObject({ code: 'not_allowed' });
    host.room.send(BLACKJACK_MSG.action, { action: 'hit', hand: 1 });
    expect(await nextError(host)).toMatchObject({ code: 'not_your_turn' });
    host.room.send(BLACKJACK_MSG.action, { action: 'fold', hand: 0 });
    expect(await nextError(host)).toMatchObject({ code: 'invalid_payload' });
    host.room.send(BLACKJACK_MSG.bet, { amount: 50 });
    expect(await nextError(host)).toMatchObject({ code: 'wrong_phase' });
    await act(host, 'hit'); // 21 → auto-stand
    expect(seatOf(host)!.hands[0]).toMatchObject({ total: 21, status: 'stood' });
    await nextRound(host, 1);
    expect(seatOf(host)!.net).toBe(100);
    expect(seatOf(bob)).toMatchObject({ net: 0, balance: 1000, handsPlayed: 0 });
  });

  it('accounts for splits and doubles to the chip', async () => {
    const host = await createTable({ solo: true });
    await waitStage(host, 'BETTING');
    // 8,8 v 6 up / T hole. Split: 8+3 → double → T (21). Second hand 8+K stands. Dealer 16 + 9 busts.
    host.server.testStacks = [['8s', '6h', '8d', 'Tc', '3c', 'Ts', 'Kd', '9h']];
    const results = recordResults(host);
    await bet(host, 10);
    await waitStage(host, 'PLAYING');
    expect(seatOf(host)!.actions).toContain('split');
    await act(host, 'split');
    expect(seatOf(host)!.hands.map((h) => h.cards)).toEqual([['8s', '3c'], ['8d']]);
    expect(seatOf(host)!.balance).toBe(980);
    await act(host, 'double', 0);
    expect(seatOf(host)!.hands[0]).toMatchObject({ bet: 20, doubled: true, split: true, total: 21, label: '21' });
    expect(seatOf(host)!.activeHand).toBe(1);
    expect(seatOf(host)!.balance).toBe(970);
    await act(host, 'stand', 1);
    await nextRound(host, 1);
    expect(results.at(-1)!.map((h) => [h.result, h.net])).toEqual([
      ['win', 20],
      ['win', 10],
    ]);
    expect(seatOf(host)).toMatchObject({ balance: 1030, net: 30 });
  });

  it('honours late surrender when enabled and an H17 dealer drawing to soft 17', async () => {
    const solo = await createTable({ solo: true, settings: { dealerHitsSoft17: true, surrender: true } });
    await waitStage(solo, 'BETTING');
    // Round 1: 16 v dealer K (peek, no blackjack) → surrender returns half.
    // Round 2: 17 v dealer A,6 (soft 17) → H17 draws a 4 to 21.
    solo.server.testStacks = [
      ['Ts', 'Kh', '6d', '7c'],
      ['Ts', 'Ah', '7d', '6c', '4d'],
    ];
    await bet(solo, 10);
    await waitStage(solo, 'PLAYING');
    expect(seatOf(solo)!.actions).toContain('surrender');
    await act(solo, 'surrender');
    await nextRound(solo, 1);
    expect(seatOf(solo)).toMatchObject({ balance: 995, net: -5 });

    const dealerCards: string[][] = [];
    solo.room.onStateChange(() => dealerCards.push(solo.state().dealer.cards));
    await bet(solo, 10);
    await waitStage(solo, 'INSURANCE');
    solo.room.send(BLACKJACK_MSG.insurance, { take: false });
    await waitStage(solo, 'PLAYING');
    await act(solo, 'stand');
    await nextRound(solo, 2);
    expect(dealerCards.some((c) => c.join() === 'Ah,6c,4d')).toBe(true);
    expect(seatOf(solo)).toMatchObject({ balance: 985, net: -10 });
  });

  it('refuses surrender when the table disables it', async () => {
    const solo = await createTable({ solo: true, settings: { surrender: false } });
    await waitStage(solo, 'BETTING');
    solo.server.testStacks = [['Ts', 'Kh', '6d', '7c']];
    await bet(solo, 10);
    await waitStage(solo, 'PLAYING');
    expect(seatOf(solo)!.actions).toEqual(['hit', 'stand', 'double']);
    solo.room.send(BLACKJACK_MSG.action, { action: 'surrender', hand: 0 });
    expect(await nextError(solo)).toMatchObject({ code: 'not_allowed', message: 'Surrender is not offered at this table.' });
    await act(solo, 'stand');
    await nextRound(solo, 1);
    expect(seatOf(solo)).toMatchObject({ balance: 990, net: -10 });
  });

  it('offers insurance / even money and settles a dealer natural found by the peek', async () => {
    const host = await createTable();
    const bob = await joinTable(host.room.roomId, 'Bob');
    await start(host);
    // Seats: Alice 3, Bob 2 → Bob is dealt first. Bob As Kd (natural), Alice 9s 8d, dealer Ah / Kc.
    host.server.testStacks = [['As', '9s', 'Ah', 'Kd', '8d', 'Kc']];
    const aliceResults = recordResults(host);
    const insuranceStates = new Set<string>();
    host.room.onStateChange(() => insuranceStates.add(host.state().seats[host.id()]?.insuranceState ?? ''));
    const bobResults = recordResults(host, () => bob.id());
    await bet(host, 100);
    await bet(bob, 100);
    await waitStage(host, 'INSURANCE');
    expect(seatOf(host)!.insuranceState).toBe('offered');
    host.room.send(BLACKJACK_MSG.insurance, { take: true });
    await waitFor(() => seatOf(host)!.insuranceState === 'taken');
    expect(seatOf(host)).toMatchObject({ insurance: 50, balance: 850 });
    bob.room.send(BLACKJACK_MSG.insurance, { take: true }); // Bob holds a natural: this is even money
    await waitFor(() => seatOf(bob)!.insuranceState === 'even', 3000, 'even money');
    expect(seatOf(bob)).toMatchObject({ insurance: 0, balance: 900 });
    await waitFor(() => host.state().dealer.revealed, 3000, 'dealer blackjack revealed');
    expect(host.state().dealer).toMatchObject({ blackjack: true, cards: ['Ah', 'Kc'] });
    await waitFor(() => aliceResults.length > 0 && bobResults.length > 0, 3000, 'settled');
    expect(host.state().stage).toMatch(/SETTLING|BETTING/);
    expect(aliceResults.at(-1)![0]).toMatchObject({ result: 'lose', net: -100 });
    expect(insuranceStates.has('won')).toBe(true);
    expect(bobResults.at(-1)![0]).toMatchObject({ result: 'blackjack', label: 'Blackjack', net: 100 });
    await nextRound(host, 1);
    expect(seatOf(host)).toMatchObject({ net: 0, balance: 1000 });
    expect(seatOf(bob)).toMatchObject({ net: 100, balance: 1100 });
  });

  it('restores the full table view after a reconnect and lets the player continue', async () => {
    const host = await createTable();
    const bob = await joinTable(host.room.roomId, 'Bob');
    await start(host);
    host.server.testStacks = [['9s', '5c', '7h', '8s', '6c', 'Th']];
    await bet(host, 40);
    await bet(bob, 40);
    await waitStage(host, 'PLAYING');
    const snapshot = JSON.stringify(bob.state().seats);

    bob.room.reconnection.minUptime = 0;
    const reconnected = new Promise<void>((r) => bob.room.onReconnect(() => r()));
    (bob.room as any).connection.transport.ws.close(4010);
    await waitFor(() => host.state().players[bob.id()]?.connected === false, 3000, 'drop');
    await reconnected;
    await waitFor(() => host.state().players[bob.id()]?.connected === true, 3000, 'back');
    expect(JSON.stringify(bob.state().seats)).toBe(snapshot);
    expect(bob.state().dealer).toMatchObject({ cards: ['7h'], hasHole: true, revealed: false });
    await act(bob, 'stand');

    // A second tab with the seat token takes the seat over with the same view.
    const tab = await joinTable(host.room.roomId, 'Bob', { seatToken: bob.me().seatToken });
    expect(tab.id()).toBe(bob.id());
    await waitFor(() => tab.state().seats[bob.id()]?.hands.length === 1, 3000);
    expect(tab.state().seats[bob.id()]!.hands[0]).toMatchObject({ cards: ['9s', '8s'], status: 'stood' });
    await act(host, 'stand');
    await nextRound(tab, 1);
    expect(tab.state().seats[bob.id()]!.handsPlayed).toBe(1);
  });

  it('auto-stands a player whose decision timer runs out', async () => {
    const host = await createTable({ settings: { decisionSeconds: 5 } });
    const bob = await joinTable(host.room.roomId, 'Bob');
    await start(host);
    host.server.testStacks = [['9s', '5c', '7h', '8s', '6c', 'Th']];
    await bet(host, 10);
    await bet(bob, 10);
    await waitStage(host, 'PLAYING');
    const deadline = seatOf(bob)!.deadline;
    expect(deadline).toBeGreaterThan(Date.now() + 3000);
    await act(host, 'stand');
    expect(stageOf(host)).toBe('PLAYING');
    await waitFor(() => seatOf(bob)!.done, 7000, 'timeout stand');
    expect(seatOf(bob)!.hands[0]!.status).toBe('stood');
    await nextRound(host, 1);
  }, 15_000);

  it('a dropped player only gets a short decision clock, not the table’s full one', async () => {
    const host = await createTable({ settings: { decisionSeconds: 60 } });
    const bob = await joinTable(host.room.roomId, 'Bob');
    await start(host);
    host.server.testStacks = [['9s', '5c', '7h', '8s', '6c', 'Th']];
    await bet(host, 10);
    await bet(bob, 10);
    await waitStage(host, 'PLAYING');
    expect(seatOf(host, bob.id())!.deadline).toBeGreaterThan(Date.now() + 50_000);
    bob.room.reconnection.enabled = false;
    (bob.room as any).connection.transport.ws.close(4010);
    await waitFor(() => host.state().players[bob.id()]?.connected === false, 3000, 'drop');
    // Still in the reconnect grace (seat kept), but the clock is capped (8 s × the test pace), not 60 s.
    await waitFor(() => seatOf(host, bob.id())!.done, 3000, 'dropped player stands');
    expect(seatOf(host, bob.id())!.hands[0]!.status).toBe('stood');
    expect(host.state().players[bob.id()]).toBeDefined();
    expect(seatOf(host)!.deadline).toBeGreaterThan(Date.now() + 50_000);
    await act(host, 'stand');
    await nextRound(host, 1);
  });

  it('a repeated decision (same action sequence) never applies twice', async () => {
    const solo = await createTable({ solo: true });
    await waitStage(solo, 'BETTING');
    // 2 3 (5) v dealer 7 / T: hit, hit.
    solo.server.testStacks = [['2s', '7h', '3d', 'Tc', '4c', '5d', '9s']];
    await bet(solo, 10);
    await waitStage(solo, 'PLAYING');
    const seq = seatOf(solo)!.actionSeq;
    solo.room.send(BLACKJACK_MSG.action, { action: 'hit', hand: 0, seq });
    solo.room.send(BLACKJACK_MSG.action, { action: 'hit', hand: 0, seq });
    expect(await nextError(solo)).toMatchObject({ code: 'not_allowed' });
    await waitFor(() => seatOf(solo)!.hands[0]!.cards.length === 3, 3000, 'one hit');
    await sleep(60);
    expect(seatOf(solo)!.hands[0]!.cards).toEqual(['2s', '3d', '4c']);
    expect(seatOf(solo)!.actionSeq).toBe(seq + 1);
    // The next decision, sent with the new sequence, goes through.
    solo.room.send(BLACKJACK_MSG.action, { action: 'hit', hand: 0, seq: seq + 1 });
    await waitFor(() => seatOf(solo)!.hands[0]!.cards.length === 4, 3000, 'second hit');
    expect(seatOf(solo)!.hands[0]!.cards).toEqual(['2s', '3d', '4c', '5d']);
  });

  it('the host cannot remove a seated player who has chips while the table runs', async () => {
    const host = await createTable();
    const bob = await joinTable(host.room.roomId, 'Bob');
    await start(host);
    host.room.send('lobby:kick', { playerId: bob.id() });
    expect(await nextError(host)).toMatchObject({ type: 'lobby:kick', code: 'not_allowed' });
    expect(host.state().players[bob.id()]).toBeDefined();
    expect(seatOf(host, bob.id())).toBeDefined();
    host.room.send(BLACKJACK_MSG.end, {});
    await waitFor(() => host.state().phase === 'RESULTS', 3000, 'results');
    host.room.send('lobby:kick', { playerId: bob.id() });
    await waitFor(() => host.state().players[bob.id()] === undefined, 3000, 'kicked after the game');
  });

  it('seats late joiners next round and settles then removes players who leave mid-round', async () => {
    const host = await createTable();
    const bob = await joinTable(host.room.roomId, 'Bob');
    await start(host);
    host.server.testStacks = [['9s', '5c', '7h', '8s', '6c', 'Th']];
    await bet(host, 10);
    await bet(bob, 10);
    await waitStage(host, 'PLAYING');
    const late = await joinTable(host.room.roomId, 'Late');
    await waitFor(() => host.state().players[late.id()] !== undefined, 3000, 'late joiner visible');
    expect(host.state().players[late.id()]).toMatchObject({ spectator: true, queued: true });
    expect(host.state().seats[late.id()]).toBeUndefined();
    const bobId = bob.id();
    await bob.room.leave(true);
    await waitFor(() => host.state().seats[bobId]?.left === true, 3000, 'bob left');
    expect(host.state().seats[bobId]!.hands[0]!.status).toBe('stood');
    await act(host, 'stand');
    await waitFor(() => host.state().seats[bobId]?.hands[0]?.result !== '', 3000, 'bob settled');
    await nextRound(host, 1);
    expect(host.state().seats[bobId]).toBeUndefined();
    expect(host.state().seats[late.id()]).toMatchObject({ balance: 1000 });
    expect(host.state().players[late.id()]).toMatchObject({ spectator: false, queued: false });
  });

  it('refills broke players only, applies rule edits between rounds, and ends into a results leaderboard', async () => {
    const host = await createTable({ settings: { startingBalance: 100, minBet: 100, maxBet: 100 } });
    const bob = await joinTable(host.room.roomId, 'Bob');
    await start(host);
    // Bob 9s 9c (18), Alice Ts 6d (16), dealer Th / 8h (18).
    host.server.testStacks = [['9s', 'Ts', 'Th', '9c', '6d', '8h']];
    await bet(host, 100);
    await bet(bob, 100);
    await waitStage(host, 'PLAYING');
    host.room.send('lobby:settings', { settings: { blackjackPayout: '6:5' } });
    await waitFor(() => JSON.parse(host.state().settingsJson).blackjackPayout === '6:5');
    expect(JSON.parse(host.state().rulesJson).blackjackPayout).toBe('3:2');
    await act(host, 'stand'); // 16 v 18 → lose
    await act(bob, 'stand'); // 18 v 18 → push
    await nextRound(host, 1);
    expect(JSON.parse(host.state().rulesJson).blackjackPayout).toBe('6:5');
    expect(seatOf(host)).toMatchObject({ balance: 0, net: -100 });
    bob.room.send(BLACKJACK_MSG.refill, {});
    expect(await nextError(bob)).toMatchObject({ code: 'not_allowed' });
    host.room.send(BLACKJACK_MSG.refill, {});
    await waitFor(() => seatOf(host)!.refills === 1);
    expect(seatOf(host)).toMatchObject({ balance: 100, bought: 200 });

    bob.room.send(BLACKJACK_MSG.end, {});
    expect(await nextError(bob)).toMatchObject({ code: 'not_host' });
    host.room.send(BLACKJACK_MSG.end, {});
    await waitFor(() => host.state().phase === 'RESULTS', 3000, 'results');
    expect(host.state().players[bob.id()]!.score).toBe(0);
    expect(host.state().players[host.id()]!.score).toBe(-100);
    host.room.send('lobby:toLobby', {});
    await waitFor(() => host.state().phase === 'LOBBY');
    expect(Object.keys(host.state().seats)).toHaveLength(0);
  });

  it('freezes bets once "No more bets" is called, so lock spam cannot hold up the deal', async () => {
    const host = await createTable();
    const bob = await joinTable(host.room.roomId, 'Bob');
    await start(host);
    host.server.pace = 1; // the real 700 ms "No more bets" pause
    await bet(host, 10);
    bob.room.send(BLACKJACK_MSG.bet, { amount: 10 });
    await waitFor(() => seatOf(bob)?.bet === 10);
    bob.room.send(BLACKJACK_MSG.lock, { locked: true });
    await waitFor(() => host.state().betsClosed === true, 3000, 'no more bets');
    expect(host.state().statusText).toBe('No more bets');
    const calledAt = Date.now();
    // Once called, nothing about the bets can change any more.
    bob.room.send(BLACKJACK_MSG.lock, { locked: false });
    expect(await nextError(bob)).toMatchObject({ code: 'wrong_phase' });
    host.room.send(BLACKJACK_MSG.sit, { seat: 0 });
    expect(await nextError(host)).toMatchObject({ code: 'wrong_phase' });
    // A client re-sending "lock" must not keep pushing the deal back.
    const spam = setInterval(() => bob.room.send(BLACKJACK_MSG.lock, { locked: true }), 120);
    try {
      await waitFor(() => stageOf(host) !== 'BETTING', 3000, 'deal despite lock spam');
    } finally {
      clearInterval(spam);
    }
    expect(Date.now() - calledAt).toBeLessThan(1500);
    expect(seatOf(bob)).toMatchObject({ inRound: true, bet: 10 });
    expect(seatOf(host)).toMatchObject({ inRound: true, bet: 10 });
    expect(host.state().betsClosed).toBe(false);
  });

  it('keeps a leaving player\'s stack for the same browser, so leave + rejoin cannot reset a balance', async () => {
    const host = await createTable();
    const bob = await joinTable(host.room.roomId, 'Bob', { guestId: 'guest-bob-1' });
    await start(host);
    // Bob 9s 7c (16) v dealer Th / 8h (18): Bob stands and loses 200. Alice sits out.
    host.server.testStacks = [['9s', 'Th', '7c', '8h']];
    await sitOut(host);
    await bet(bob, 200);
    await waitStage(host, 'PLAYING');
    await act(bob, 'stand');
    await nextRound(host, 1);
    expect(seatOf(bob)).toMatchObject({ balance: 800, bought: 1000, handsPlayed: 1 });

    await bob.room.leave(true);
    await waitFor(() => Object.keys(host.state().seats).length === 1, 3000, 'bob seat released');
    // Rejoining while bets are open deals Bob straight back in — with the stack he left with.
    const back = await joinTable(host.room.roomId, 'Bob', { guestId: 'guest-bob-1' });
    await waitFor(() => seatOf(back) !== undefined, 3000, 'rejoiner seated');
    expect(seatOf(back)).toMatchObject({ balance: 800, bought: 1000, handsPlayed: 1 });
    await waitFor(() => back.state().players[back.id()]?.score === -200, 3000, 'score restored');
    expect(back.state().players[back.id()]).toMatchObject({ spectator: false, queued: false, score: -200 });
    // A different browser is a different player with a fresh stack.
    const carol = await joinTable(host.room.roomId, 'Carol', { guestId: 'guest-carol' });
    await waitFor(() => seatOf(carol) !== undefined, 3000, 'carol seated');
    expect(seatOf(carol)).toMatchObject({ balance: 1000, bought: 1000 });
  });

  it('only honours the shoe-stacking hook in explicit test/development runs, never in production or when NODE_ENV is unset', () => {
    const env = { DASCADE_BJ_STACK: 'As,Kd|9h,zz,8c', DASCADE_BJ_PACE: '0.05' };
    expect(readTestHooks({ ...env, NODE_ENV: 'production' })).toEqual({ pace: 1, stacking: false, stacks: [] });
    // `pnpm start` does not set NODE_ENV and loads ../../.env: a stray stack there must stay inert.
    expect(readTestHooks({ ...env })).toMatchObject({ stacking: false, stacks: [] });
    expect(readTestHooks({ ...env, NODE_ENV: 'staging' })).toMatchObject({ stacking: false, stacks: [] });
    expect(readTestHooks({ ...env, NODE_ENV: 'test' })).toEqual({ pace: 0.05, stacking: true, stacks: [['As', 'Kd'], ['9h', '8c']] });
    expect(readTestHooks({ ...env, NODE_ENV: 'development' }).stacking).toBe(true);
    expect(readTestHooks({ NODE_ENV: 'test', DASCADE_BJ_PACE: '-1' }).pace).toBe(1);
  });

  it('ignores stacked cards on a table whose hooks are disabled (production)', async () => {
    const solo = await createTable({ solo: true });
    await waitStage(solo, 'BETTING');
    solo.server.hooks = { pace: 0.05, stacking: false, stacks: [] };
    // Four aces in a row (player A-A, dealer shows an A) would be unmistakable if honoured.
    solo.server.testStacks = [['As', 'Ah', 'Ad', 'Ac']];
    await bet(solo, 10);
    await waitFor(() => (seatOf(solo)?.hands[0]?.cards.length ?? 0) >= 2 && solo.state().dealer.cards.length >= 1, 5000, 'dealt');
    const dealt = [...seatOf(solo)!.hands[0]!.cards, solo.state().dealer.cards[0]];
    expect(dealt.join()).not.toBe('As,Ad,Ah');
    expect(solo.server.testStacks).toEqual([]);
  });

  it('survives the host leaving mid-insurance: migrates host, declines + stands the leaver, settles, then ends on request', async () => {
    const host = await createTable({ settings: { decisionSeconds: 30 } });
    const bob = await joinTable(host.room.roomId, 'Bob');
    await start(host);
    // Bob (seat 2) 9s 7c = 16, Alice (seat 3) Ts 8d = 18, dealer Ah / 6h (soft 17, S17 stands).
    host.server.testStacks = [['9s', 'Ts', 'Ah', '7c', '8d', '6h']];
    const aliceId = host.id();
    const aliceResults = recordResults(bob, () => aliceId);
    await bet(host, 10);
    await bet(bob, 10);
    await waitStage(bob, 'INSURANCE');
    bob.room.send(BLACKJACK_MSG.insurance, { take: false });
    await waitFor(() => seatOf(bob)!.insuranceState === 'declined');
    const leftAt = Date.now();
    await host.room.leave(true);
    // The 10 s insurance window does not have to run out: the leaver is declined at once.
    await waitStage(bob, 'PLAYING', 3000);
    expect(Date.now() - leftAt).toBeLessThan(2500);
    expect(bob.state().hostId).toBe(bob.id());
    expect(bob.state().seats[aliceId]).toMatchObject({ left: true, done: true, insuranceState: 'declined' });
    bob.room.send(BLACKJACK_MSG.end, {}); // new host: end after this round
    await waitFor(() => bob.state().endRequested === true);
    await act(bob, 'stand');
    await waitFor(() => bob.state().phase === 'RESULTS', 5000, 'results');
    expect(aliceResults.at(-1)![0]).toMatchObject({ result: 'win', net: 10 });
    expect(bob.state().seats[aliceId]).toBeUndefined();
    expect(seatOf(bob)).toMatchObject({ balance: 990, bought: 1000, handsPlayed: 1 });
    expect(bob.state().players[bob.id()]!.score).toBe(-10);
  });
});

describe('DASjack 21 room: DASCADE outcomes', () => {
  let outcomes: Array<{ outcome: GameOutcome; ctx: OutcomeContext }> = [];
  let stop: () => void = () => undefined;
  beforeEach(() => {
    outcomes = [];
    stop = onOutcome((outcome, ctx) => outcomes.push({ outcome, ctx }));
  });
  afterEach(() => stop());
  const forRoom = (code: string) => outcomes.filter((o) => o.ctx.roomCode === code);
  type Extras = { playerStats: Record<string, Record<string, number>> };

  it('reports the closed table by balance with blackjack stats, and lists a player who left last', async () => {
    const host = await createTable();
    const bob = await joinTable(host.room.roomId, 'Bob');
    const cy = await joinTable(host.room.roomId, 'Cy');
    const cyId = cy.id();
    await start(host);
    await cy.room.leave(true);
    await waitFor(() => host.state().seats[cyId] === undefined, 3000, 'cy gone');
    // Bob A♠ K♦ (blackjack), Alice T♠ 9♦ (19), dealer 7♥ / T♣ (17).
    host.server.testStacks = [['As', 'Ts', '7h', 'Kd', '9d', 'Tc']];
    await bet(host, 100);
    await bet(bob, 100);
    await waitStage(host, 'PLAYING');
    await act(host, 'stand');
    await nextRound(host, 1);
    expect(seatOf(bob)).toMatchObject({ balance: 1150, blackjacks: 1 });
    expect(seatOf(host)).toMatchObject({ balance: 1100 });
    host.room.send(BLACKJACK_MSG.end, {});
    await waitFor(() => host.state().phase === 'RESULTS', 3000, 'results');
    await sleep(30);

    const mine = forRoom(host.room.roomId);
    expect(mine).toHaveLength(1);
    const { outcome } = mine[0]!;
    expect(outcome.placements).toEqual([[bob.id()], [host.id()], [cyId]]);
    expect(outcome.scores).toEqual({ [bob.id()]: 1150, [host.id()]: 1100 });
    expect(outcome.reason).toBe('table_closed');
    const stats = (outcome.details as Extras).playerStats;
    expect(stats[bob.id()]).toMatchObject({ handsPlayed: 1, handsWon: 1, blackjacks: 1, bestWin: 150 });
    expect(stats[host.id()]).toMatchObject({ handsPlayed: 1, handsWon: 1, blackjacks: 0, bestWin: 100 });
  });

  it('ranks by the leaderboard (net of refills) and shares a place only on identical rows', async () => {
    const host = await createTable({ settings: { startingBalance: 100, minBet: 100, maxBet: 100 } });
    const bob = await joinTable(host.room.roomId, 'Bob');
    await start(host);
    host.server.testStacks = [['9s', 'Ts', 'Th', '9c', '6d', '8h']];
    await bet(host, 100);
    await bet(bob, 100);
    await waitStage(host, 'PLAYING');
    await act(host, 'stand'); // 16 v 18 → lose
    await act(bob, 'stand'); // 18 v 18 → push
    await nextRound(host, 1);
    host.room.send(BLACKJACK_MSG.refill, {});
    await waitFor(() => seatOf(host)!.refills === 1);
    host.room.send(BLACKJACK_MSG.end, {});
    await waitFor(() => host.state().phase === 'RESULTS', 3000, 'results');
    const [only] = forRoom(host.room.roomId);
    // Both hold 100 chips, but Alice needed a refill to get there.
    expect(only!.outcome.placements).toEqual([[bob.id()], [host.id()]]);
    expect(only!.outcome.scores).toEqual({ [bob.id()]: 100, [host.id()]: 100 });
  });

  it('records a solo session (the house is the opponent)', async () => {
    const solo = await createTable({ solo: true });
    await waitStage(solo, 'BETTING');
    solo.server.testStacks = [['Ts', '9h', '7d', '8c']];
    await bet(solo, 100);
    await waitStage(solo, 'PLAYING');
    await act(solo, 'stand');
    await nextRound(solo, 1);
    solo.room.send(BLACKJACK_MSG.end, {});
    await waitFor(() => solo.state().phase === 'RESULTS', 3000, 'results');
    const mine = forRoom(solo.room.roomId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.outcome.placements).toEqual([[solo.id()]]);
    expect(mine[0]!.outcome.scores).toEqual({ [solo.id()]: seatOf(solo)!.balance });
  });

  it('reports nothing for a table closed (or sent back to the lobby) before the first deal', async () => {
    const early = await createTable();
    await joinTable(early.room.roomId, 'Bob');
    await start(early);
    early.room.send(BLACKJACK_MSG.end, {});
    await waitFor(() => early.state().phase === 'RESULTS', 3000, 'results');

    const lobby = await createTable();
    await joinTable(lobby.room.roomId, 'Bob');
    await start(lobby);
    lobby.room.send('lobby:toLobby', {});
    await waitFor(() => lobby.state().phase === 'LOBBY', 3000, 'lobby');
    await sleep(80);
    expect(forRoom(early.room.roomId)).toHaveLength(0);
    expect(forRoom(lobby.room.roomId)).toHaveLength(0);
  });

  it('"Back to lobby" mid-session closes the table with a result — after the round in play, never voiding it', async () => {
    const host = await createTable();
    const bob = await joinTable(host.room.roomId, 'Bob');
    await start(host);
    // Bob 9 9 (18) beats dealer 17; Alice T 6 (16) loses.
    host.server.testStacks = [['9s', 'Ts', '7h', '9c', '6d', 'Th']];
    await bet(host, 10);
    await bet(bob, 10);
    await waitStage(host, 'PLAYING');
    host.room.send('lobby:toLobby', {});
    expect(await nextError(host)).toMatchObject({ type: 'lobby:toLobby', code: 'not_allowed' });
    await waitFor(() => host.state().endRequested, 3000, 'end requested');
    await act(host, 'stand');
    await act(bob, 'stand');
    await waitFor(() => host.state().phase === 'RESULTS', 5000, 'results');
    expect(forRoom(host.room.roomId)).toHaveLength(1);
    expect(forRoom(host.room.roomId)[0]!.outcome.placements).toEqual([[bob.id()], [host.id()]]);

    // Between rounds it settles right away: the session is reported, then the lobby.
    host.room.send('lobby:toLobby', {});
    await waitFor(() => host.state().phase === 'LOBBY', 3000, 'lobby');
    await start(host);
    host.server.testStacks = [['9s', 'Ts', '7h', '9c', '6d', 'Th']];
    await bet(host, 10);
    await bet(bob, 10);
    await waitStage(host, 'PLAYING');
    await act(host, 'stand');
    await act(bob, 'stand');
    await nextRound(host, 1);
    host.room.send('lobby:toLobby', {});
    await waitFor(() => host.state().phase === 'LOBBY', 3000, 'lobby again');
    await sleep(50);
    const mine = forRoom(host.room.roomId);
    expect(mine).toHaveLength(2);
    expect(mine[1]!.outcome.placements).toEqual([[bob.id()], [host.id()]]);
    expect(mine[1]!.outcome.scores).toEqual({ [bob.id()]: 1010, [host.id()]: 990 });
  });
});
