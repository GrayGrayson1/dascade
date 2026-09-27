import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, WelcomePayload } from '@dascade/shared';
import {
  SHIPS_MSG,
  type ShipsEvent,
  type ShipsPlacement,
  type ShipsPrivatePayload,
  type ShipsPublicState,
  type ShipsSideView,
} from '@dascade/shared/games/ships';
import { placementCells, validateLayout, rulesFromSettings } from '@dascade/game-core/ships';
import { onOutcome, type OutcomeContext } from '../src/platform/hub.ts';
import type { ShipsRoom } from '../src/rooms/ships/ShipsRoom.ts';
import { bootTestServer, sleep, waitFor } from './helpers.ts';

let colyseus: ColyseusTestServer;
const outcomes: Array<{ outcome: GameOutcome; ctx: OutcomeContext }> = [];
let unsubscribe: () => void = () => undefined;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['ships']));
  unsubscribe = onOutcome((outcome, ctx) => {
    if (ctx.gameId === 'ships') outcomes.push({ outcome, ctx });
  });
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  unsubscribe();
  await colyseus.shutdown();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Rows 0/2/4/6/8, bows on column A. */
const LAYOUT_A: ShipsPlacement[] = [
  { id: 'arcology', x: 0, y: 0, dir: 'h' },
  { id: 'tidebreaker', x: 0, y: 2, dir: 'h' },
  { id: 'lanternfish', x: 0, y: 4, dir: 'h' },
  { id: 'riptide', x: 0, y: 6, dir: 'h' },
  { id: 'glowdart', x: 0, y: 8, dir: 'h' },
];
/** Columns J/H/F/D/B, bows on row 1. */
const LAYOUT_B: ShipsPlacement[] = [
  { id: 'arcology', x: 9, y: 0, dir: 'v' },
  { id: 'tidebreaker', x: 7, y: 0, dir: 'v' },
  { id: 'lanternfish', x: 5, y: 0, dir: 'v' },
  { id: 'riptide', x: 3, y: 0, dir: 'v' },
  { id: 'glowdart', x: 1, y: 0, dir: 'v' },
];
const squares = (layout: ShipsPlacement[]) => layout.flatMap((p) => placementCells(p));
const water = (layout: ShipsPlacement[], size = 10) => {
  const taken = new Set(squares(layout).map((c) => c.y * size + c.x));
  const out: Array<{ x: number; y: number }> = [];
  for (let y = size - 1; y >= 0; y--) for (let x = size - 1; x >= 0; x--) if (!taken.has(y * size + x)) out.push({ x, y });
  return out;
};

interface Captain {
  room: SdkRoom;
  errors: Array<{ type?: string; code: string; message: string }>;
  privates: ShipsPrivatePayload[];
  events: ShipsEvent[];
  /** Every message this client received, in order (for leak checks). */
  inbox: Array<{ type: string; payload: unknown }>;
  me: () => WelcomePayload;
}

const KNOWN = [
  'sys:welcome',
  'sys:toast',
  'sys:error',
  'sys:removed',
  'sys:time',
  'chat:msg',
  'chat:history',
  SHIPS_MSG.private,
  SHIPS_MSG.event,
];

function wire(room: SdkRoom): Captain {
  const c: Captain = { room, errors: [], privates: [], events: [], inbox: [], me: () => welcomes[welcomes.length - 1]! };
  const welcomes: WelcomePayload[] = [];
  for (const type of KNOWN) {
    room.onMessage(type, (payload: unknown) => {
      c.inbox.push({ type, payload });
      if (type === 'sys:welcome') welcomes.push(payload as WelcomePayload);
      if (type === 'sys:error') c.errors.push(payload as Captain['errors'][number]);
      if (type === SHIPS_MSG.private) c.privates.push(payload as ShipsPrivatePayload);
      if (type === SHIPS_MSG.event) c.events.push(payload as ShipsEvent);
    });
  }
  room.onMessage('*', (type: string | number, payload: unknown) => c.inbox.push({ type: String(type), payload }));
  return c;
}

async function ready(c: Captain): Promise<Captain> {
  await c.room.waitForInitialState();
  await waitFor(() => Boolean(c.me()), 3000, 'welcome');
  return c;
}

const st = (c: Captain) => (c.room.state as { toJSON(): ShipsPublicState }).toJSON();
const sideOf = (c: Captain, of: Captain = c): ShipsSideView => st(c).sides.find((s) => s.playerId === of.me().playerId)!;
const lastError = (c: Captain) => c.errors.at(-1);

async function duel(settings: Record<string, unknown> = {}, opts: { spectator?: boolean } = {}) {
  const host = await ready(wire(await colyseus.sdk.create('ships', { name: 'Ada', settings })));
  const server = colyseus.getRoomById(host.room.roomId) as unknown as ShipsRoom;
  (server as unknown as { countdownMs: number }).countdownMs = 0;
  server.timing = { over: 80, turnMs: 0, placementMs: 0, abandonMs: 0 };
  const guest = await join(host.room.roomId, 'Bo');
  const spec = opts.spectator ? await join(host.room.roomId, 'Eye', { spectator: true }) : null;
  return { host, guest, spec, server };
}

async function join(code: string, name: string, extra: Record<string, unknown> = {}): Promise<Captain> {
  return ready(wire(await colyseus.sdk.joinById(code, { name, ...extra })));
}

async function start(host: Captain) {
  host.room.send('lobby:start', {});
  await waitFor(() => st(host).stage === 'placement', 3000, 'placement');
}

async function deploy(c: Captain, layout: ShipsPlacement[]) {
  c.room.send(SHIPS_MSG.layout, { vessels: layout, ready: true });
  await waitFor(() => sideOf(c).ready, 3000, 'ready');
}

async function toBattle(host: Captain, guest: Captain) {
  await start(host);
  await deploy(host, LAYOUT_A);
  await deploy(guest, LAYOUT_B);
  await waitFor(() => st(host).stage === 'battle' && st(guest).stage === 'battle', 3000, 'battle');
}

const shooterOf = (a: Captain, b: Captain) => (st(a).turnId === a.me().playerId ? a : b);

/** Fire and wait until the server moved on (next turn or game over). */
async function fire(c: Captain, cells: Array<{ x: number; y: number }>) {
  const seq = st(c).turnSeq;
  c.room.send(SHIPS_MSG.fire, { cells, seq });
  await waitFor(() => st(c).turnSeq > seq || st(c).stage !== 'battle', 3000, 'shot resolved');
}

/** The JSON text of everything a client can see publicly (state + all non-private messages). */
function publicText(c: Captain): string {
  return JSON.stringify({ state: st(c), inbox: c.inbox.filter((m) => m.type !== SHIPS_MSG.private) });
}

// ---------------------------------------------------------------------------

describe('DAS Ships room', () => {
  it('plays a full duel: deploy, alternate shots, hit / miss / sunk, final victory, results and outcome', async () => {
    const { host, guest, spec } = await duel({}, { spectator: true });
    await toBattle(host, guest);
    const first = shooterOf(host, guest);
    const second = first === host ? guest : host;
    const firstTargets = squares(first === host ? LAYOUT_B : LAYOUT_A);
    const secondWater = water(second === host ? LAYOUT_B : LAYOUT_A);
    expect(st(spec!).turnId).toBe(first.me().playerId);
    expect(st(host).shotsAllowed).toBe(1);

    // First captain hits every vessel square in turn; the second only ever splashes.
    let turns = 0;
    while (st(host).stage === 'battle') {
      const shooter = shooterOf(host, guest);
      expect(shooter === first ? turns % 2 === 0 : turns % 2 === 1).toBe(true); // strict alternation
      if (shooter === first) await fire(first, [firstTargets.shift()!]);
      else await fire(second, [secondWater.shift()!]);
      turns++;
    }
    await waitFor(() => st(host).stage === 'over' || st(host).phase === 'RESULTS', 3000, 'over');
    const shotEvents = spec!.events.filter((e): e is Extract<ShipsEvent, { type: 'shot' }> => e.type === 'shot');
    expect(shotEvents.length).toBe(turns);
    const results = shotEvents.filter((e) => e.shooterId === first.me().playerId).flatMap((e) => e.shots.map((s) => s.result));
    expect(results.filter((r) => r === 'sunk')).toHaveLength(5);
    expect(results.filter((r) => r === 'hit')).toHaveLength(12);
    expect(shotEvents.filter((e) => e.shooterId === second.me().playerId).every((e) => e.shots[0]!.result === 'miss')).toBe(true);

    await waitFor(() => st(host).phase === 'RESULTS', 3000, 'results');
    const end = st(spec!);
    expect(end.winnerId).toBe(first.me().playerId);
    expect(end.endReason).toBe('fleet_destroyed');
    const loserSide = end.sides.find((s) => s.playerId === second.me().playerId)!;
    const winnerSide = end.sides.find((s) => s.playerId === first.me().playerId)!;
    expect(loserSide.vesselsLeft).toBe(0);
    expect(loserSide.board.split('').filter((ch) => ch === '#')).toHaveLength(17);
    expect(winnerSide.hits).toBe(17);
    expect(winnerSide.sunk).toBe(5);
    expect(winnerSide.shots).toBe(17);
    // Both fleets are revealed once the game is over.
    expect(winnerSide.revealed).toHaveLength(5);
    expect(loserSide.revealed).toHaveLength(5);
    expect(end.sides.find((s) => s.playerId === host.me().playerId)!.revealed).toEqual(LAYOUT_A);
    expect(end.players[first.me().playerId]!.score).toBe(17);

    const reported = outcomes.filter((o) => o.ctx.roomCode === host.room.roomId);
    expect(reported).toHaveLength(1);
    expect(reported[0]!.outcome.placements).toEqual([[first.me().playerId], [second.me().playerId]]);
    expect(reported[0]!.outcome.reason).toBe('fleet_destroyed');
  });

  it('never serialises hidden fleets: state, broadcasts and chat seen by the opponent and spectators carry only public shot results', async () => {
    const { host, guest, spec, server } = await duel({}, { spectator: true });
    await start(host);
    // Deployment: drafts and locked fleets stay private.
    host.room.send(SHIPS_MSG.layout, { vessels: LAYOUT_A.slice(0, 3), ready: false });
    await sleep(80);
    await deploy(host, LAYOUT_A);
    await deploy(guest, LAYOUT_B);
    await waitFor(() => st(spec!).stage === 'battle', 3000, 'battle');

    // Sink the host's Glowdart in stages: after one hit it must still be anonymous.
    const guestFirst = shooterOf(host, guest) === guest;
    if (!guestFirst) await fire(host, [{ x: 9, y: 9 }]);
    await fire(guest, [{ x: 0, y: 8 }]); // hit (Glowdart bow)
    for (const c of [guest, spec!]) {
      const view = st(c);
      const hostSide = view.sides.find((s) => s.playerId === host.me().playerId)!;
      expect(hostSide.board[8 * 10]).toBe('x');
      expect(hostSide.sunkVessels).toEqual([]);
      expect(hostSide.revealed).toEqual([]);
      // No vessel identity or unhit vessel square is visible anywhere public.
      expect(publicText(c)).not.toMatch(/glowdart|arcology|tidebreaker|lanternfish|riptide/i);
    }
    await fire(host, [{ x: 8, y: 9 }]);
    await fire(guest, [{ x: 1, y: 8 }]); // sinks the Glowdart
    for (const c of [guest, spec!]) {
      const hostSide = sideOf(c, host);
      expect(hostSide.sunkVessels).toEqual([{ id: 'glowdart', x: 0, y: 8, dir: 'h' }]);
      expect(hostSide.board.slice(80, 82)).toBe('##');
      // Only the sunk vessel is named; the rest of the fleet is still secret.
      expect(publicText(c)).not.toMatch(/arcology|tidebreaker|lanternfish|riptide/i);
    }

    // Every square nobody has fired at reads as untouched open sea, on both sides, for everyone.
    const fired = new Map<string, Set<number>>();
    for (const e of spec!.events) {
      if (e.type !== 'shot') continue;
      const set = fired.get(e.targetId) ?? new Set<number>();
      for (const s of e.shots) set.add(s.y * 10 + s.x);
      fired.set(e.targetId, set);
    }
    for (const c of [host, guest, spec!]) {
      for (const side of st(c).sides) {
        const shots = fired.get(side.playerId) ?? new Set<number>();
        for (let i = 0; i < 100; i++) if (!shots.has(i)) expect(side.board[i]).toBe('.');
      }
    }

    // Private fleets: each captain only ever received their own; the spectator received none.
    expect(spec!.privates).toEqual([]);
    expect(host.privates.length).toBeGreaterThan(0);
    for (const p of host.privates) {
      expect(p.playerId).toBe(host.me().playerId);
      for (const v of p.vessels) expect(LAYOUT_A).toContainEqual(v);
    }
    for (const p of guest.privates) {
      expect(p.playerId).toBe(guest.me().playerId);
      for (const v of p.vessels) expect(LAYOUT_B).toContainEqual(v);
    }
    expect(guest.privates.at(-1)!.vessels).toEqual(LAYOUT_B);

    // The server's own serialisation is the same public view (no hidden fields on the schema).
    const serverJson = JSON.stringify((server.state as unknown as { toJSON(): unknown }).toJSON());
    expect(serverJson).not.toMatch(/arcology|tidebreaker|lanternfish|riptide/i);
    expect(serverJson).not.toMatch(/draft|layout/i);
  });

  it('rejects invalid deployments: overlap, off-grid, wrong fleet, incomplete, and changes after locking in', async () => {
    const { host, guest } = await duel();
    await start(host);
    const send = (vessels: unknown, ready = true) => host.room.send(SHIPS_MSG.layout, { vessels, ready });
    const expectError = async (pattern: RegExp) => {
      const n = host.errors.length;
      await waitFor(() => host.errors.length > n, 3000, `error ${pattern}`);
      expect(lastError(host)!.message).toMatch(pattern);
    };

    send([...LAYOUT_A.slice(0, 4), { id: 'glowdart', x: 1, y: 0, dir: 'v' }]);
    await expectError(/overlaps/);
    send([...LAYOUT_A.slice(0, 4), { id: 'glowdart', x: 9, y: 8, dir: 'h' }]);
    await expectError(/runs off the grid/);
    send([...LAYOUT_A.slice(0, 4), { id: 'glowdart', x: 12, y: 0, dir: 'h' }]); // schema bound
    await expectError(/could not be understood/);
    send([...LAYOUT_A.slice(0, 4), { id: 'wisp', x: 0, y: 8, dir: 'h' }]);
    await expectError(/not part of this fleet/);
    send([...LAYOUT_A, { id: 'glowdart', x: 5, y: 8, dir: 'h' }]);
    await expectError(/placed twice/);
    send(LAYOUT_A.slice(0, 4));
    await expectError(/Deploy every vessel/);
    send([...LAYOUT_A.slice(0, 4), { id: 'glowdart', x: 0, y: 8, dir: 'x' }]);
    await expectError(/could not be understood/);
    expect(sideOf(host).ready).toBe(false);

    // A partial draft is fine while not ready.
    const errs = host.errors.length;
    send(LAYOUT_A.slice(0, 2), false);
    await sleep(80);
    expect(host.errors.length).toBe(errs);

    await deploy(host, LAYOUT_A);
    // Re-sending the same locked layout is a harmless no-op; a different one is refused until unlocked.
    send(LAYOUT_A);
    await sleep(80);
    expect(host.errors.length).toBe(errs);
    send([...LAYOUT_A.slice(0, 4), { id: 'glowdart', x: 5, y: 8, dir: 'h' }]);
    await expectError(/locked in/);
    // Unlock, move, lock again.
    send(LAYOUT_A, false);
    await waitFor(() => !sideOf(host).ready, 3000, 'unready');
    const moved = [...LAYOUT_A.slice(0, 4), { id: 'glowdart', x: 5, y: 8, dir: 'h' } as ShipsPlacement];
    await deploy(host, moved);
    await waitFor(() => host.privates.at(-1)?.ready === true, 3000, 'private ready');
    expect(host.privates.at(-1)!.vessels).toEqual(moved);
    expect(st(host).stage).toBe('placement'); // guest not ready yet
    expect(guest.privates.every((p) => p.vessels.length === 0)).toBe(true);
  });

  it('enforces the keep-apart spacing rule when the host enables it', async () => {
    const { host } = await duel({ spacing: 'apart' });
    await start(host);
    const touching = [...LAYOUT_A.slice(0, 4), { id: 'glowdart', x: 0, y: 7, dir: 'h' }];
    host.room.send(SHIPS_MSG.layout, { vessels: touching, ready: true });
    await waitFor(() => host.errors.length > 0, 3000, 'touching error');
    expect(lastError(host)!.message).toMatch(/touches/);
    await deploy(host, LAYOUT_A);
  });

  it('enforces turns: out-of-turn, stale and duplicate shots are refused and never double-count', async () => {
    const { host, guest, spec } = await duel({}, { spectator: true });
    await toBattle(host, guest);
    const shooter = shooterOf(host, guest);
    const waiting = shooter === host ? guest : host;
    const seq = st(host).turnSeq;

    waiting.room.send(SHIPS_MSG.fire, { cells: [{ x: 4, y: 4 }], seq });
    await waitFor(() => waiting.errors.length > 0, 3000, 'out of turn');
    expect(lastError(waiting)!.code).toBe('not_your_turn');

    spec!.room.send(SHIPS_MSG.fire, { cells: [{ x: 4, y: 4 }], seq });
    await waitFor(() => spec!.errors.length > 0, 3000, 'spectator');
    expect(lastError(spec!)!.code).toBe('not_allowed');

    // Two copies of the same shot (double tap / network retry): only one lands.
    shooter.room.send(SHIPS_MSG.fire, { cells: [{ x: 4, y: 4 }], seq });
    shooter.room.send(SHIPS_MSG.fire, { cells: [{ x: 4, y: 4 }], seq });
    await waitFor(() => shooter.errors.length > 0, 3000, 'duplicate refused');
    await waitFor(() => st(host).turnSeq === seq + 1, 3000, 'first copy landed');
    await sleep(120); // a few patch intervals: the copy must not land later either
    expect(sideOf(host, shooter).shots).toBe(1);
    expect(st(host).turnSeq).toBe(seq + 1);

    // The opponent fires, then the first shooter can't hit the same square again.
    await fire(waiting, [{ x: 5, y: 5 }]);
    const before = shooter.errors.length;
    shooter.room.send(SHIPS_MSG.fire, { cells: [{ x: 4, y: 4 }], seq: st(shooter).turnSeq });
    await waitFor(() => shooter.errors.length > before, 3000, 'already fired');
    expect(lastError(shooter)!.message).toMatch(/already fired/);
    // Stale sequence numbers are refused too.
    shooter.room.send(SHIPS_MSG.fire, { cells: [{ x: 6, y: 6 }], seq: seq });
    await waitFor(() => shooter.errors.length > before + 1, 3000, 'stale');
    expect(lastError(shooter)!.message).toMatch(/earlier turn/);
    // Wrong shot counts and off-grid squares.
    shooter.room.send(SHIPS_MSG.fire, {
      cells: [
        { x: 6, y: 6 },
        { x: 6, y: 7 },
      ],
      seq: st(shooter).turnSeq,
    });
    await waitFor(() => shooter.errors.length > before + 2, 3000, 'count');
    expect(lastError(shooter)!.message).toMatch(/right number/);
    shooter.room.send(SHIPS_MSG.fire, { cells: [{ x: 11, y: 0 }], seq: st(shooter).turnSeq });
    await waitFor(() => shooter.errors.length > before + 3, 3000, 'off grid');
    expect(lastError(shooter)!.message).toMatch(/off the grid/);
    expect(sideOf(host, shooter).shots).toBe(1);
    // Deployment is over: layouts are refused.
    shooter.room.send(SHIPS_MSG.layout, { vessels: LAYOUT_A, ready: true });
    await waitFor(() => shooter.errors.length > before + 4, 3000, 'layout refused');
    expect(lastError(shooter)!.code).toBe('wrong_phase');
  });

  it('salvo: one shot per surviving vessel, re-counted as vessels sink', async () => {
    const { host, guest } = await duel({ firing: 'salvo' });
    await toBattle(host, guest);
    const shooter = shooterOf(host, guest);
    const other = shooter === host ? guest : host;
    const targetLayout = shooter === host ? LAYOUT_B : LAYOUT_A;
    expect(st(host).shotsAllowed).toBe(5);

    shooter.room.send(SHIPS_MSG.fire, { cells: [{ x: 4, y: 4 }], seq: st(shooter).turnSeq });
    await waitFor(() => shooter.errors.length > 0, 3000, 'too few');
    expect(lastError(shooter)!.message).toMatch(/right number/);

    // Salvo that sinks the opponent's Glowdart (2 squares) + 3 more shots.
    const glow = placementCells(targetLayout.find((v) => v.id === 'glowdart')!);
    const extra = water(targetLayout).slice(0, 3);
    await fire(shooter, [...glow, ...extra]);
    const ev = shooter.events.filter((e) => e.type === 'shot').at(-1) as Extract<ShipsEvent, { type: 'shot' }>;
    expect(ev.shots).toHaveLength(5);
    expect(ev.shots.map((s) => s.result)).toEqual(['hit', 'sunk', 'miss', 'miss', 'miss']);
    // The opponent lost a vessel: four shots on their turn.
    expect(st(host).turnId).toBe(other.me().playerId);
    expect(st(host).shotsAllowed).toBe(4);
    await fire(other, water(shooter === host ? LAYOUT_A : LAYOUT_B).slice(0, 4));
    expect(st(host).shotsAllowed).toBe(5);
  });

  it('hot streak: a hit keeps the turn, a miss passes it', async () => {
    const { host, guest } = await duel({ firing: 'streak' });
    await toBattle(host, guest);
    const shooter = shooterOf(host, guest);
    const targetLayout = shooter === host ? LAYOUT_B : LAYOUT_A;
    const hit = squares(targetLayout)[0]!;
    await fire(shooter, [hit]);
    expect(st(host).turnId).toBe(shooter.me().playerId);
    await fire(shooter, [water(targetLayout)[0]!]);
    expect(st(host).turnId).not.toBe(shooter.me().playerId);
    expect(sideOf(host, shooter).bestStreak).toBe(1);
  });

  it('auto-deploys unready fleets when the deployment clock runs out (keeping placed vessels)', async () => {
    const { host, guest, server } = await duel({ spacing: 'apart' });
    server.timing.placementMs = 250;
    await start(host);
    expect(st(host).deadline).toBeGreaterThan(0);
    host.room.send(SHIPS_MSG.layout, { vessels: LAYOUT_A.slice(0, 2), ready: false });
    await waitFor(() => st(host).stage === 'battle', 3000, 'battle after clock');
    const rules = rulesFromSettings({ gridSize: 10, fleet: 'standard', spacing: 'apart' });
    await waitFor(() => host.privates.at(-1)?.vessels.length === 5 && guest.privates.at(-1)?.vessels.length === 5, 3000, 'fleets');
    const hostFleet = host.privates.at(-1)!.vessels;
    expect(validateLayout(hostFleet, rules, { complete: true })).toBeNull();
    expect(hostFleet).toEqual(expect.arrayContaining(LAYOUT_A.slice(0, 2)));
    expect(validateLayout(guest.privates.at(-1)!.vessels, rules, { complete: true })).toBeNull();
    expect(st(host).log.some((l) => /deployed automatically/.test(l.text))).toBe(true);
    const battle = host.events.find((e) => e.type === 'battle') as Extract<ShipsEvent, { type: 'battle' }>;
    expect(battle.auto.sort()).toEqual([host.me().playerId, guest.me().playerId].sort());
  });

  it('turn clock: auto-fires on timeout and forfeits after repeated timeouts', async () => {
    const { host, guest, server } = await duel({ turnSeconds: 30, onTimeout: 'autofire' });
    await toBattle(host, guest);
    server.timing.turnMs = 400;
    // Re-arm the clock with the short test timing on the next turn.
    const shooter = shooterOf(host, guest);
    await fire(shooter, [{ x: 4, y: 4 }]);
    const afk = shooter === host ? guest : host;
    // The AFK captain never fires: the server fires for them; the active one keeps firing at water.
    const activeWater = water(shooter === host ? LAYOUT_B : LAYOUT_A).filter((c) => !(c.x === 4 && c.y === 4));
    const deadline = Date.now() + 8000;
    while (st(host).stage === 'battle' && Date.now() < deadline) {
      if (st(host).turnId === shooter.me().playerId) await fire(shooter, [activeWater.shift()!]);
      else await sleep(20);
    }
    await waitFor(() => st(host).stage === 'over' || st(host).phase === 'RESULTS', 3000, 'forfeit');
    const view = st(host);
    expect(view.winnerId).toBe(shooter.me().playerId);
    expect(view.endReason).toBe('timeout');
    const autoShots = host.events.filter((e) => e.type === 'shot' && e.auto);
    expect(autoShots.length).toBe(2);
    expect(autoShots.every((e) => e.type === 'shot' && e.shooterId === afk.me().playerId)).toBe(true);
    expect(sideOf(host, afk).timeouts).toBe(3);
    const reported = outcomes.filter((o) => o.ctx.roomCode === host.room.roomId);
    expect(reported.at(-1)!.outcome).toMatchObject({ placements: [[shooter.me().playerId], [afk.me().playerId]], reason: 'timeout' });
  });

  it("turn clock 'skip' passes the turn without firing", async () => {
    const { host, guest, server } = await duel({ turnSeconds: 30, onTimeout: 'skip' });
    server.timing.turnMs = 300;
    await toBattle(host, guest);
    const first = shooterOf(host, guest);
    await waitFor(() => st(host).turnId !== first.me().playerId, 3000, 'skipped');
    expect(host.events.some((e) => e.type === 'skip' && e.playerId === first.me().playerId)).toBe(true);
    expect(sideOf(host, first).shots).toBe(0);
    expect(sideOf(host, first).timeouts).toBe(1);
  });

  it('untimed games: an idle captain auto-fires after the inactivity limit and forfeits after repeated idle turns (no stall)', async () => {
    const { host, guest, server } = await duel({ turnSeconds: 0, onTimeout: 'skip' });
    server.timing.idleMs = 400;
    await toBattle(host, guest);
    // No visible clock in an untimed game.
    expect(st(host).deadline).toBe(0);
    const afk = shooterOf(host, guest);
    const active = afk === host ? guest : host;
    const activeWater = water(afk === host ? LAYOUT_A : LAYOUT_B);
    const deadline = Date.now() + 8000;
    while (st(host).stage === 'battle' && Date.now() < deadline) {
      if (st(host).turnId === active.me().playerId) await fire(active, [activeWater.shift()!]);
      else await sleep(20);
    }
    await waitFor(() => st(host).stage === 'over' || st(host).phase === 'RESULTS', 3000, 'idle forfeit');
    const view = st(host);
    expect(view.winnerId).toBe(active.me().playerId);
    expect(view.endReason).toBe('timeout');
    // Untimed idle turns always auto-fire (the 'skip' rule needs a visible turn clock).
    const autoShots = host.events.filter((e) => e.type === 'shot' && e.auto);
    expect(autoShots.length).toBe(2);
    expect(autoShots.every((e) => e.type === 'shot' && e.shooterId === afk.me().playerId)).toBe(true);
    expect(host.events.some((e) => e.type === 'skip')).toBe(false);
    expect(view.log.some((l) => /idle/.test(l.text))).toBe(true);
    const reported = outcomes.filter((o) => o.ctx.roomCode === host.room.roomId);
    expect(reported.at(-1)!.outcome).toMatchObject({ placements: [[active.me().playerId], [afk.me().playerId]], reason: 'timeout' });
  });

  it('reconnecting restores your own fleet (and only yours)', async () => {
    const { host, guest } = await duel();
    await toBattle(host, guest);
    const before = guest.privates.length;
    guest.room.reconnection.minUptime = 0;
    const reconnected = new Promise<void>((r) => guest.room.onReconnect(() => r()));
    (guest.room as unknown as { connection: { transport: { ws: WebSocket } } }).connection.transport.ws.close(4010);
    await waitFor(() => st(host).players[guest.me().playerId]?.connected === false, 3000, 'dropped');
    await reconnected;
    await waitFor(() => guest.privates.length > before, 3000, 'private re-sent');
    expect(guest.privates.at(-1)).toMatchObject({ playerId: guest.me().playerId, ready: true, vessels: LAYOUT_B });
    expect(st(host).stage).toBe('battle');
  });

  it('seat-token rejoin during deployment restores the saved draft', async () => {
    const { host, guest } = await duel();
    await start(host);
    guest.room.send(SHIPS_MSG.layout, { vessels: LAYOUT_B.slice(0, 3), ready: false });
    await sleep(100);
    const { playerId, seatToken } = guest.me();
    guest.room.reconnection.enabled = false;
    (guest.room as unknown as { connection: { transport: { ws: WebSocket } } }).connection.transport.ws.close(4010);
    await waitFor(() => st(host).players[playerId]?.connected === false, 3000, 'dropped');
    const again = await join(host.room.roomId, 'Bo', { seatToken });
    expect(again.me().playerId).toBe(playerId);
    await waitFor(() => again.privates.length > 0, 3000, 'draft');
    expect(again.privates.at(-1)).toMatchObject({ ready: false, vessels: LAYOUT_B.slice(0, 3) });
  });

  it('a captain who stays disconnected forfeits (abandoned)', async () => {
    const { host, guest, server } = await duel();
    await toBattle(host, guest);
    server.timing.abandonMs = 250;
    guest.room.reconnection.enabled = false;
    (guest.room as unknown as { connection: { transport: { ws: WebSocket } } }).connection.transport.ws.close(4010);
    await waitFor(() => st(host).stage === 'over' || st(host).phase === 'RESULTS', 3000, 'abandoned');
    expect(st(host).winnerId).toBe(host.me().playerId);
    expect(st(host).endReason).toBe('abandoned');
  });

  it('resigning ends the game at once, reveals both fleets and reports the outcome', async () => {
    const { host, guest, spec } = await duel({}, { spectator: true });
    await toBattle(host, guest);
    spec!.room.send(SHIPS_MSG.resign, {});
    await waitFor(() => spec!.errors.length > 0, 3000, 'spectator resign refused');
    guest.room.send(SHIPS_MSG.resign, {});
    await waitFor(() => st(host).phase === 'RESULTS', 3000, 'results');
    const view = st(spec!);
    expect(view.winnerId).toBe(host.me().playerId);
    expect(view.endReason).toBe('resign');
    expect(sideOf(spec!, guest).revealed).toEqual(LAYOUT_B);
    expect(sideOf(spec!, host).revealed).toEqual(LAYOUT_A);
    const reported = outcomes.filter((o) => o.ctx.roomCode === host.room.roomId);
    expect(reported).toHaveLength(1);
    expect(reported[0]!.outcome).toMatchObject({ placements: [[host.me().playerId], [guest.me().playerId]], reason: 'resign' });
    // Resigning again (or after the game) changes nothing.
    guest.room.send(SHIPS_MSG.resign, {});
    await sleep(80);
    expect(outcomes.filter((o) => o.ctx.roomCode === host.room.roomId)).toHaveLength(1);
  });

  it('leaving mid-game forfeits; resigning during deployment works too', async () => {
    const { host, guest } = await duel();
    await start(host);
    host.room.send(SHIPS_MSG.resign, {});
    await waitFor(() => st(guest).winnerId === guest.me().playerId, 3000, 'placement resign');
    expect(st(guest).endReason).toBe('resign');

    const second = await duel();
    await toBattle(second.host, second.guest);
    await second.guest.room.leave(true);
    await waitFor(() => st(second.host).winnerId === second.host.me().playerId, 3000, 'leave forfeit');
    expect(st(second.host).endReason).toBe('forfeit');
    const reported = outcomes.filter((o) => o.ctx.roomCode === second.host.room.roomId);
    expect(reported.at(-1)!.outcome.placements).toEqual([[second.host.me().playerId], [expect.any(String)]]);
  });

  it('a kick never wins: a captain who kicks their opponent concedes the game', async () => {
    const { host, guest } = await duel();
    await toBattle(host, guest);
    const guestId = guest.me().playerId;
    host.room.send('lobby:kick', { playerId: guestId });
    await waitFor(() => st(host).stage === 'over' || st(host).phase === 'RESULTS', 3000, 'kick ends game');
    expect(st(host).winnerId).toBe(guestId);
    expect(st(host).endReason).toBe('forfeit');
    const reported = outcomes.filter((o) => o.ctx.roomCode === host.room.roomId);
    expect(reported.at(-1)!.outcome.placements).toEqual([[guestId], [host.me().playerId]]);
  });

  it('a captain-host who sends the room back to the lobby mid-battle concedes (deployment may be abandoned)', async () => {
    const early = await duel();
    await start(early.host);
    early.host.room.send('lobby:toLobby', {});
    await waitFor(() => st(early.guest).phase === 'LOBBY', 3000, 'deployment abandoned');
    expect(outcomes.filter((o) => o.ctx.roomCode === early.host.room.roomId)).toHaveLength(0);

    const { host, guest } = await duel();
    await toBattle(host, guest);
    host.room.send('lobby:toLobby', {});
    await waitFor(() => st(guest).phase === 'LOBBY', 3000, 'back in the lobby');
    const reported = outcomes.filter((o) => o.ctx.roomCode === host.room.roomId);
    expect(reported).toHaveLength(1);
    expect(reported[0]!.outcome).toMatchObject({ placements: [[guest.me().playerId], [host.me().playerId]], reason: 'forfeit' });
  });

  it('rematch: both captains agree, a fresh match starts and the first shot alternates', async () => {
    const { host, guest } = await duel();
    await toBattle(host, guest);
    const firstShooter = st(host).turnId;
    host.room.send(SHIPS_MSG.resign, {});
    await waitFor(() => st(host).phase === 'RESULTS', 3000, 'results');
    const matchNo = st(host).matchNo;
    host.room.send(SHIPS_MSG.rematch, { want: true });
    await waitFor(() => st(guest).rematch.includes(host.me().playerId), 3000, 'vote');
    expect(st(host).phase).toBe('RESULTS');
    guest.room.send(SHIPS_MSG.rematch, { want: true });
    await waitFor(() => st(host).stage === 'placement' && st(host).matchNo === matchNo + 1, 3000, 'rematch started');
    expect(st(host).rematch).toEqual([]);
    expect(st(host).sides.every((s) => !s.ready && s.board === '.'.repeat(100))).toBe(true);
    await deploy(host, LAYOUT_B);
    await deploy(guest, LAYOUT_A);
    await waitFor(() => st(host).stage === 'battle', 3000, 'battle 2');
    expect(st(host).turnId).not.toBe(firstShooter);
    // Stale privates from game one are superseded.
    expect(host.privates.at(-1)).toMatchObject({ matchNo: matchNo + 1, vessels: LAYOUT_B });
  });

  it("tournament matches: the 'first' side fires first, untimed games get a turn clock, no casual rematch", async () => {
    const { host, guest, server } = await duel({ turnSeconds: 0 });
    const info = {
      tournamentCode: 'TOUR1',
      tournamentName: 'Test Cup',
      matchId: 'W1-1',
      roundLabel: 'Winners round 1',
      bestOf: 3,
      gameNumber: 1,
      seriesScore: {},
      participants: [
        { participantId: 'pa', name: 'Ada', seed: 1, playerId: host.me().playerId, side: 'second' },
        { participantId: 'pb', name: 'Bo', seed: 2, playerId: guest.me().playerId, side: 'first' },
      ],
    };
    (server as unknown as { tournamentInfo: unknown }).tournamentInfo = info;
    await toBattle(host, guest);
    expect(st(host).turnId).toBe(guest.me().playerId);
    expect(st(host).deadline).toBeGreaterThan(0);
    expect(st(host).clockMs).toBe(60_000);
    guest.room.send(SHIPS_MSG.resign, {});
    await waitFor(() => st(host).phase === 'RESULTS', 3000, 'results');
    host.room.send(SHIPS_MSG.rematch, { want: true });
    await waitFor(() => host.errors.length > 0, 3000, 'rematch refused');
    expect(lastError(host)!.message).toMatch(/Tournament Center/);
    const reported = outcomes.filter((o) => o.ctx.roomCode === host.room.roomId);
    expect(reported.at(-1)!.ctx.tournament).toMatchObject({ matchId: 'W1-1' });
  });

  it('the host can only start with exactly two captains; late joiners spectate', async () => {
    const host = await ready(wire(await colyseus.sdk.create('ships', { name: 'Solo' })));
    host.room.send('lobby:start', {});
    await waitFor(() => host.errors.length > 0, 3000, 'blocked');
    expect(st(host).phase).toBe('LOBBY');
    const server = colyseus.getRoomById(host.room.roomId) as unknown as ShipsRoom;
    (server as unknown as { countdownMs: number }).countdownMs = 0;
    const guest = await join(host.room.roomId, 'Two');
    await start(host);
    const late = await join(host.room.roomId, 'Late');
    expect(st(late).players[late.me().playerId]!.spectator).toBe(true);
    late.room.send(SHIPS_MSG.layout, { vessels: LAYOUT_A, ready: true });
    await waitFor(() => late.errors.length > 0, 3000, 'late refused');
    expect(late.privates).toEqual([]);
    expect(st(guest).sides).toHaveLength(2);
  });
});
