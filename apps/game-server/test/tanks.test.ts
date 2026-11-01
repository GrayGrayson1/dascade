import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, WelcomePayload } from '@dascade/shared';
import { ITEMS, STOCKED_LOADOUT, TANKS_MSG, WEAPONS, type ShotScript, type TanksEvent } from '@dascade/shared/games/tanks';
import {
  cloneTerrain,
  createTerrain,
  decodeTerrain,
  resolveShot,
  restHeight,
  settleResult,
  tankById,
  type Battle,
} from '@dascade/game-core/tanks';
import { bootTestServer, collect, quiet, sleep, waitFor } from './helpers.ts';
import { onOutcome } from '../src/platform/hub.ts';
import { getStatLine } from '../src/platform/stats.ts';
import type { TanksRoom } from '../src/rooms/tanks/TanksRoom.ts';

let colyseus: ColyseusTestServer;
const outcomes: GameOutcome[] = [];
let unsubscribe: () => void = () => undefined;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['tanks']));
  unsubscribe = onOutcome((o) => outcomes.push(o));
});
afterEach(async () => {
  await colyseus.cleanup();
  outcomes.length = 0;
});
afterAll(async () => {
  unsubscribe();
  await colyseus.shutdown();
});

const st = (room: SdkRoom) => room.state as any;

interface Client {
  room: SdkRoom;
  me: () => WelcomePayload;
  id: () => string;
  shots: ShotScript[];
  events: TanksEvent[];
  errors: Array<{ code: string; type?: string; message?: string }>;
}

function wire(room: SdkRoom): Client {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<{ code: string; type?: string }>(room, 'sys:error');
  const shots = collect<ShotScript>(room, TANKS_MSG.shot);
  const events = collect<TanksEvent>(room, TANKS_MSG.event);
  quiet(room);
  const me = () => welcomes[welcomes.length - 1]!;
  return { room, me, id: () => me().playerId, shots, events, errors };
}

/** Test hooks into the room's protected internals. */
interface Server {
  countdownMs: number;
  reconnectGraceSeconds: number;
  timing: Record<string, number>;
  botThinkMs: [number, number];
  botFireDelayMs: number;
  resolveDelayMs: () => number;
  turnMs: () => number;
  hazardChance: number;
  battle: Battle | null;
  syncTerrain(): void;
  syncTanks(): void;
  state: TanksRoom['state'];
}

function speedUp(server: Server): void {
  server.countdownMs = 80;
  server.timing = {
    ...server.timing,
    afterShotMs: 40,
    afterSkipMs: 40,
    victoryMs: 120,
    absentSkipMs: 120,
    disconnectedTurnMs: 400,
    introMs: 60,
    battleOverMs: 120,
    hazardWarnMs: 60,
  };
  server.hazardChance = 0;
  server.botThinkMs = [40, 60];
  server.botFireDelayMs = 40;
  server.resolveDelayMs = () => 120;
}

async function createHost(name = 'Host', extra: Record<string, unknown> = {}) {
  const room = await colyseus.sdk.create('tanks', { name, ...extra });
  const client = wire(room);
  await room.waitForInitialState();
  await waitFor(() => Boolean(client.me()), 3000, 'welcome');
  const server = colyseus.getRoomById(room.roomId) as unknown as Server;
  speedUp(server);
  return { ...client, server };
}

async function join(code: string, name: string, extra: Record<string, unknown> = {}): Promise<Client> {
  const room = await colyseus.sdk.joinById(code, { name, ...extra });
  const client = wire(room);
  await room.waitForInitialState();
  await waitFor(() => Boolean(client.me()), 3000, 'welcome');
  return client;
}

async function settings(host: Client, patch: Record<string, unknown>) {
  host.room.send('lobby:settings', { settings: patch });
  await waitFor(() => Object.entries(patch).every(([k, v]) => JSON.parse(st(host.room).settingsJson)[k] === v), 3000, 'settings');
}

/** One battle, stocked loadout (no shop): the classic quick game most tests want. */
const QUICK = { battles: 1, economy: 'stocked' } as const;

async function start(host: Client, opts: Record<string, unknown> = QUICK) {
  await settings(host, opts);
  host.room.send('lobby:start', {});
  await waitFor(() => st(host.room).phase === 'PLAYING' && st(host.room).battle.stage === 'aim', 5000, 'first turn');
}

const battle = (server: Server) => server.battle!;
const tankState = (c: Client, id: string) => st(c.room).tanks.get(id);
const active = (c: Client) => st(c.room).battle.activeId as string;

/** Test-only: flat ground, fixed positions, no wind. */
function rig(server: Server, xs: Record<string, number>, hp: Record<string, number> = {}): void {
  const b = battle(server);
  b.terrain = createTerrain(1600, 900, 200);
  for (const t of b.tanks) {
    if (xs[t.id] !== undefined) t.x = xs[t.id]!;
    t.y = restHeight(b.terrain, t.x);
    if (hp[t.id] !== undefined) t.hp = hp[t.id]!;
  }
  b.wind = 0;
  server.state.battle.wind = 0;
  server.syncTerrain();
  server.syncTanks();
}

/** A power that lands a direct hit from shooter on target (angle 45 / 135). */
function solve(server: Server, shooterId: string, targetId: string): { angle: number; power: number } {
  const b = battle(server);
  const shooter = b.tanks.find((t) => t.id === shooterId)!;
  const target = b.tanks.find((t) => t.id === targetId)!;
  const angle = target.x > shooter.x ? 45 : 135;
  for (let power = 10; power <= 100; power++) {
    const tanks = b.tanks.map((t) => ({
      id: t.id,
      team: t.team,
      x: t.x,
      y: t.y,
      hp: t.hp,
      alive: t.alive,
      shield: t.shield,
      shieldKind: t.shieldKind,
      chutes: 0,
    }));
    const s = resolveShot(
      { terrain: cloneTerrain(b.terrain), tanks, wind: 0, walls: 'open', gravity: 1 },
      { shooterId, angle, power, weapon: 'shell' },
      { teams: false, friendlyFire: true },
    );
    if (s.events.some((e) => e.k === 'boom' && e.direct === targetId)) return { angle, power };
  }
  throw new Error('no firing solution');
}

async function duel(opts: Record<string, unknown> = QUICK) {
  const host = await createHost('Alice');
  const guest = await join(host.room.roomId, 'Bob');
  await start(host, opts);
  const byId = (id: string) => (host.id() === id ? host : guest);
  return { host, guest, server: host.server, byId };
}

describe('TanksRoom', () => {
  it('builds a public battlefield: terrain, two tanks, a first turn with a timer', async () => {
    const { host, guest } = await duel();
    const s = st(host.room);
    const terrain = decodeTerrain(s.battle.terrain, s.battle.width, s.battle.height);
    expect(terrain).not.toBeNull();
    expect(s.tanks.size).toBe(2);
    for (const id of [host.id(), guest.id()]) {
      const t = tankState(host, id);
      expect(t.hp).toBe(100);
      expect(t.alive).toBe(true);
      expect(t.y).toBe(restHeight(terrain!, t.x));
      expect(st(host.room).fleet.get(id).ammo.heavy).toBe(STOCKED_LOADOUT.heavy);
    }
    expect(s.battle.battleNo).toBe(1);
    expect(s.battle.battles).toBe(1);
    expect(s.battle.battleSerial).toBeGreaterThan(0);
    expect([host.id(), guest.id()]).toContain(active(host));
    expect(s.battle.turnEndsAt).toBeGreaterThan(Date.now());
    expect(s.battle.turnId).toBe(1);
    expect(host.events.some((e) => e.kind === 'turn')).toBe(true);
    expect(guest.events.some((e) => e.kind === 'turn')).toBe(true);
  });

  it('rejects out-of-turn, stale and spectator shots; ignores their aim and moves', async () => {
    const { host, guest, byId } = await duel();
    const shooter = byId(active(host));
    const idle = shooter === host ? guest : host;
    const spectator = await join(host.room.roomId, 'Watcher');
    await waitFor(() => st(host.room).players.get(spectator.id())?.spectator === true, 3000, 'spectator seated');
    const turnId = st(host.room).battle.turnId;
    const x = tankState(host, idle.id()).x;
    idle.room.send(TANKS_MSG.aim, { angle: 10, power: 10, weapon: 'heavy' });
    idle.room.send(TANKS_MSG.move, { dir: 1 });
    idle.room.send(TANKS_MSG.fire, { turnId, angle: 45, power: 50, weapon: 'shell' });
    spectator.room.send(TANKS_MSG.fire, { turnId, angle: 45, power: 50, weapon: 'shell' });
    shooter.room.send(TANKS_MSG.fire, { turnId: turnId + 7, angle: 45, power: 50, weapon: 'shell' });
    shooter.room.send(TANKS_MSG.fire, { turnId, angle: 45, power: 500, weapon: 'shell' });
    shooter.room.send(TANKS_MSG.fire, { turnId, angle: 45, power: 50, weapon: 'nuke' });
    await waitFor(() => idle.errors.length >= 1 && spectator.errors.length >= 1 && shooter.errors.length >= 3, 3000, 'rejections');
    expect(idle.errors[0]!.code).toBe('not_your_turn');
    expect(spectator.errors[0]!.code).toBe('not_allowed');
    expect(shooter.errors.map((e) => e.code).sort()).toEqual(['invalid_payload', 'not_allowed', 'not_allowed']);
    await sleep(150);
    expect(st(host.room).battle.shotSeq).toBe(0);
    expect(tankState(host, idle.id()).x).toBe(x);
    expect(tankState(host, idle.id()).angle).not.toBe(10);
  });

  it('streams aim and drives for the active tank only, within its fuel', async () => {
    const { host, guest, byId, server } = await duel();
    const shooter = byId(active(host));
    const other = shooter === host ? guest : host;
    rig(server, { [shooter.id()]: 600, [other.id()]: 1200 });
    const me = shooter.id();
    shooter.room.send(TANKS_MSG.aim, { angle: 70, power: 88, weapon: 'cluster' });
    await waitFor(
      () => tankState(host, me).angle === 70 && tankState(host, me).power === 88 && tankState(host, me).weapon === 'cluster',
      3000,
      'aim synced',
    );
    const fuel = tankState(host, me).fuel;
    expect(fuel).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) shooter.room.send(TANKS_MSG.move, { dir: 1 });
    await waitFor(() => tankState(host, me).x === 624, 3000, 'drove 4 steps');
    expect(tankState(host, me).fuel).toBe(fuel - 24);
    for (let i = 0; i < 30; i++) shooter.room.send(TANKS_MSG.move, { dir: 1 });
    await sleep(400);
    expect(tankState(host, me).fuel).toBeGreaterThanOrEqual(0);
    expect(tankState(host, me).x).toBeLessThanOrEqual(600 + fuel);
  });

  it('two players fire turns: shots broadcast to everyone, damage resolves, the turn passes', async () => {
    const { host, guest, server, byId } = await duel();
    const spectator = await join(host.room.roomId, 'Watcher');
    const first = byId(active(host));
    const second = first === host ? guest : host;
    rig(server, { [first.id()]: 300, [second.id()]: 1100 });
    const aim = solve(server, first.id(), second.id());
    const turnId = st(host.room).battle.turnId;
    first.room.send(TANKS_MSG.fire, { turnId, ...aim, weapon: 'shell' });
    // Duplicate (e.g. a double tap): must not fire twice.
    first.room.send(TANKS_MSG.fire, { turnId, ...aim, weapon: 'shell' });
    await waitFor(() => host.shots.length === 1 && guest.shots.length === 1 && spectator.shots.length === 1, 3000, 'shot broadcast');
    const script = host.shots[0]!;
    expect(script.launches.map((l) => l.shooterId)).toEqual([first.id()]);
    expect(script.kind).toBe('shot');
    expect(script.seq).toBe(1);
    expect(script.events.some((e) => e.k === 'boom' && e.direct === second.id())).toBe(true);
    expect(JSON.stringify(guest.shots[0])).toBe(JSON.stringify(script));
    await waitFor(() => tankState(host, second.id()).hp < 100, 3000, 'damage synced');
    expect(tankState(host, second.id()).hp).toBe(script.tanks.find((t) => t.id === second.id())!.hp);
    expect(tankState(host, first.id()).damage).toBe(script.damage[first.id()]);
    expect(tankState(host, first.id()).shots).toBe(1);
    // Next turn goes to the other tank.
    await waitFor(() => active(host) === second.id() && st(host.room).battle.stage === 'aim', 3000, 'turn passed');
    expect(st(host.room).battle.turnId).toBe(turnId + 1);
    expect(st(host.room).battle.shotSeq).toBe(1);
    expect(first.errors.some((e) => e.type === TANKS_MSG.fire)).toBe(true);
    // A stale fire from the previous turn is refused.
    first.room.send(TANKS_MSG.fire, { turnId, ...aim, weapon: 'shell' });
    await sleep(150);
    expect(host.shots).toHaveLength(1);
  });

  it('plays to a winner: RESULTS, placements and a reported outcome', async () => {
    const { host, guest, server, byId } = await duel();
    const first = byId(active(host));
    const second = first === host ? guest : host;
    rig(server, { [first.id()]: 300, [second.id()]: 1100 }, { [second.id()]: 20 });
    const aim = solve(server, first.id(), second.id());
    first.room.send(TANKS_MSG.fire, { turnId: st(host.room).battle.turnId, ...aim, weapon: 'shell' });
    await waitFor(() => host.events.some((e) => e.kind === 'battle_over'), 3000, 'battle decided');
    const over = host.events.find((e) => e.kind === 'battle_over')!;
    expect(over.kind === 'battle_over' && over.winners).toEqual([first.id()]);
    expect(over.kind === 'battle_over' && over.reason).toBe('last_standing');
    expect(tankState(host, second.id()).alive).toBe(false);
    expect(tankState(host, first.id()).place).toBe(1);
    expect(tankState(host, second.id()).place).toBe(2);
    await waitFor(() => st(host.room).phase === 'RESULTS', 3000, 'results');
    // Match score: 20 damage + a kill (50) + the battle win (100); the runner-up gets second place (50).
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.placements).toEqual([[first.id()], [second.id()]]);
    expect(outcomes[0]!.reason).toBe('points');
    expect(outcomes[0]!.scores?.[first.id()]).toBe(170);
    expect(outcomes[0]!.scores?.[second.id()]).toBe(50);
    expect(host.events.some((e) => e.kind === 'victory')).toBe(true);
    expect(st(host.room).players.get(first.id()).score).toBe(170);
    expect(st(host.room).fleet.get(first.id()).place).toBe(1);
  });

  it('times out an idle player and moves on', async () => {
    const host = await createHost('Alice');
    host.server.turnMs = () => 250;
    const guest = await join(host.room.roomId, 'Bob');
    await start(host);
    const firstId = active(host);
    await waitFor(() => active(host) !== firstId && st(host.room).battle.stage === 'aim', 4000, 'skipped');
    expect(host.events.some((e) => e.kind === 'skip' && e.playerId === firstId && e.reason === 'timeout')).toBe(true);
    expect(guest.events.some((e) => e.kind === 'skip')).toBe(true);
  });

  it('a connected but idle player gets short turns after two timeouts in a row, until they act again', async () => {
    const host = await createHost('Alice');
    host.server.turnMs = () => 1_500;
    host.server.timing = { ...host.server.timing, idleTurnMs: 400 };
    const guest = await join(host.room.roomId, 'Bob');
    await start(host);
    const idleId = active(host);
    const idler = idleId === host.id() ? host : guest;
    const turnsOf = () => host.events.filter((e) => e.kind === 'turn' && e.playerId === idleId).length;
    const turnLength = () => st(host.room).battle.turnEndsAt - Date.now();
    // Turns 1 and 2 are full length and time out.
    expect(turnLength()).toBeGreaterThan(1_000);
    await waitFor(() => turnsOf() >= 2 && active(host) === idleId, 8_000, 'second turn');
    expect(turnLength()).toBeGreaterThan(1_000);
    // Two strikes: from the third turn on, the idle player's turns are short.
    await waitFor(() => turnsOf() >= 3 && active(host) === idleId && st(host.room).battle.stage === 'aim', 8_000, 'third turn');
    expect(turnLength()).toBeLessThanOrEqual(450);
    // Acting (aiming counts) clears the strikes: the next turn is full length again.
    idler.room.send(TANKS_MSG.aim, { angle: 60, power: 50, weapon: 'shell' });
    await waitFor(() => turnsOf() >= 4 && active(host) === idleId && st(host.room).battle.stage === 'aim', 8_000, 'fourth turn');
    expect(turnLength()).toBeGreaterThan(1_000);
  });

  it('a disconnected active player gets a short turn, then is skipped; reconnecting restores the battlefield', async () => {
    const { host, guest, byId } = await duel();
    const shooter = byId(active(host));
    const other = shooter === host ? guest : host;
    const shooterId = shooter.id();
    shooter.room.reconnection.minUptime = 0;
    shooter.room.reconnection.delay = 1200;
    shooter.room.reconnection.minDelay = 1200;
    shooter.room.reconnection.maxDelay = 1200;
    const reconnected = new Promise<void>((r) => shooter.room.onReconnect(() => r()));
    (shooter.room as any).connection.transport.ws.close(4010);
    await waitFor(() => st(other.room).players.get(shooterId)?.connected === false, 3000, 'dropped');
    expect(st(other.room).battle.turnEndsAt - Date.now()).toBeLessThanOrEqual(400);
    await waitFor(() => other.events.some((e) => e.kind === 'skip' && e.playerId === shooterId), 3000, 'skipped while away');
    // A turn missed while disconnected is not an idle strike (no short turns once they're back).
    expect((host.server as unknown as { idleStrikes: Map<string, number> }).idleStrikes.has(shooterId)).toBe(false);
    await reconnected;
    await waitFor(() => st(shooter.room).players.get(shooterId)?.connected === true, 3000, 'back');
    expect(st(shooter.room).tanks.size).toBe(2);
    expect(st(shooter.room).battle.terrain).toBe(st(other.room).battle.terrain);
    expect(tankState(shooter, shooterId).alive).toBe(true);
  });

  it('leaving mid-battle scuttles your tank and hands the win to the survivor', async () => {
    const { host, guest } = await duel();
    const guestId = guest.id();
    await guest.room.leave(true);
    await waitFor(() => st(host.room).battle.stage === 'over', 3000, 'forfeit by leaving');
    expect(st(host.room).battle.winners).toBe(host.id());
    expect(tankState(host, guestId).gone).toBe(true);
    expect(st(host.room).fleet.get(guestId).gone).toBe(true);
    await waitFor(() => st(host.room).phase === 'RESULTS', 3000, 'results');
    expect(outcomes[0]!.placements[0]).toEqual([host.id()]);
  });

  it('an away player (grace expired) forfeits when nobody else is left on their side', async () => {
    const host = await createHost('Alice');
    host.server.reconnectGraceSeconds = 0.3;
    const guest = await join(host.room.roomId, 'Bob');
    await start(host);
    guest.room.reconnection.enabled = false;
    (guest.room as any).connection.transport.ws.close(4010);
    await waitFor(() => st(host.room).battle.stage === 'over', 6000, 'forfeit');
    expect(host.events.some((e) => e.kind === 'battle_over' && e.reason === 'forfeit')).toBe(true);
    expect(st(host.room).battle.winners).toBe(host.id());
  });

  it('solo vs a CPU tank: the CPU takes its turns and fires on its own', async () => {
    const host = await createHost('Solo', { solo: true });
    expect(JSON.parse(st(host.room).settingsJson).cpu).toBe(1);
    await settings(host, { cpuSkill: 'ace', ...QUICK });
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    expect(st(host.room).tanks.size).toBe(2);
    const cpu = [...st(host.room).tanks.values()].find((t: any) => t.cpu);
    expect(cpu).toBeTruthy();
    expect(st(host.room).fleet.get(cpu.id).persona).not.toBe('');
    // Whoever starts, within a couple of turns the CPU fires a shot by itself.
    const fired = () => host.shots.some((s) => s.launches.some((l) => l.shooterId === cpu.id));
    const deadline = Date.now() + 8000;
    while (!fired() && Date.now() < deadline) {
      if (st(host.room).battle.stage === 'aim' && active(host) === host.id()) {
        host.room.send(TANKS_MSG.fire, { turnId: st(host.room).battle.turnId, angle: 90, power: 30, weapon: 'tracer' });
      }
      await sleep(60);
    }
    expect(fired()).toBe(true);
  });

  it('a lone player cannot start without a CPU tank; teams need both sides', async () => {
    const host = await createHost('Alice');
    host.room.send('lobby:start', {});
    await waitFor(() => host.errors.some((e) => e.type === 'lobby:start'), 3000, 'start blocked');
    expect(st(host.room).phase).toBe('LOBBY');
    const guest = await join(host.room.roomId, 'Bob');
    await settings(host, { mode: 'teams', ...QUICK });
    host.room.send(TANKS_MSG.team, { team: 1 });
    guest.room.send(TANKS_MSG.team, { team: 1 });
    await waitFor(() => st(host.room).crew.get(guest.id())?.team === 1 && st(host.room).crew.get(host.id())?.team === 1, 3000, 'picks');
    const before = host.errors.length;
    host.room.send('lobby:start', {});
    await waitFor(() => host.errors.length > before, 3000, 'teams blocked');
    expect(host.errors.at(-1)!.message).toMatch(/Both teams/);
    guest.room.send(TANKS_MSG.team, { team: 0 });
    await waitFor(() => st(host.room).crew.get(guest.id())?.team === 0, 3000, 'switched');
    await start(host, { mode: 'teams', ...QUICK });
    expect(tankState(host, host.id()).team).toBe(1);
    expect(tankState(host, guest.id()).team).toBe(0);
    // Picks are lobby-only.
    guest.room.send(TANKS_MSG.team, { team: 1 });
    await waitFor(() => guest.errors.some((e) => e.type === TANKS_MSG.team), 3000, 'team change refused');
  });

  it('CPU tanks keep their places in the outcome: a player behind a CPU is not a winner', async () => {
    const host = await createHost('Alice', { guestId: 'g-tanks-cpu-alice' });
    await settings(host, { cpu: 1 });
    const guest = await join(host.room.roomId, 'Bob', { guestId: 'g-tanks-cpu-bob' });
    await start(host, { cpu: 1, ...QUICK });
    const b = battle(host.server);
    const cpu = b.tanks.find((t) => t.cpu)!;
    // Bob goes down first, then Alice: the CPU is the last tank standing.
    for (const id of [guest.id(), host.id()]) {
      const t = tankById(b, id)!;
      t.alive = false;
      t.hp = 0;
      b.eliminations.push([id]);
    }
    settleResult(b);
    (host.server as unknown as { finishBattle(): void }).finishBattle();
    await waitFor(() => outcomes.length === 1, 3000, 'outcome');
    expect(outcomes[0]!.placements).toEqual([[cpu.id], [host.id()], [guest.id()]]);
    expect(outcomes[0]!.nonPlayerIds).toEqual([cpu.id]);
    const alice = getStatLine('g:g-tanks-cpu-alice', 'tanks')!;
    const bob = getStatLine('g:g-tanks-cpu-bob', 'tanks')!;
    expect([alice.wins, alice.losses, alice.draws]).toEqual([0, 1, 0]);
    expect([bob.wins, bob.losses, bob.draws]).toEqual([0, 1, 0]);
  });

  it('a player leaving during the countdown returns the room to the lobby (no battle is reported)', async () => {
    const host = await createHost('Alice');
    const guest = await join(host.room.roomId, 'Bob');
    host.server.countdownMs = 500;
    await settings(host, QUICK);
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'COUNTDOWN', 3000, 'countdown');
    await guest.room.leave(true);
    await waitFor(() => st(host.room).phase === 'LOBBY', 3000, 'back to the lobby');
    await sleep(150);
    expect(outcomes).toHaveLength(0);
    expect(st(host.room).tanks.size).toBe(0);
  });

  it('host rematch goes straight into a fresh battle', async () => {
    const { host, guest } = await duel();
    await guest.room.leave(true);
    await waitFor(() => st(host.room).phase === 'RESULTS', 4000, 'results');
    // Rematch needs two tanks: add a CPU first.
    host.room.send('tanks:rematch', {});
    await waitFor(
      () => host.errors.some((e) => e.type === 'tanks:rematch' || e.type === 'lobby:start') || st(host.room).phase !== 'RESULTS',
      3000,
      'rematch handled',
    );
    expect(['LOBBY', 'COUNTDOWN', 'PLAYING']).toContain(st(host.room).phase);
  });

  it('a match: shop → intro → battle → payout → shop → battle → final standings', async () => {
    const host = await createHost('Alice');
    const guest = await join(host.room.roomId, 'Bob');
    await settings(host, { battles: 2, economy: 'shop', startCredits: 20_000 });
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING' && st(host.room).battle.stage === 'shop', 5000, 'shop open');
    const s0 = st(host.room);
    expect(s0.battle.battleNo).toBe(1);
    expect(s0.battle.stageEndsAt).toBeGreaterThan(Date.now());
    expect(s0.tanks.size).toBe(2);
    expect(host.events.some((e) => e.kind === 'shop')).toBe(true);
    const fleet = (c: Client, id: string) => st(c.room).fleet.get(id);
    // Buy, sell back, buy again.
    host.room.send(TANKS_MSG.buy, { id: 'heavy' });
    await waitFor(() => fleet(host, host.id()).ammo.heavy === WEAPONS.heavy.bundle, 3000, 'bought');
    expect(fleet(host, host.id()).credits).toBe(20_000 - WEAPONS.heavy.price);
    expect(fleet(host, host.id()).basket).toBe('heavy:1');
    host.room.send(TANKS_MSG.sell, { id: 'heavy' });
    await waitFor(() => fleet(host, host.id()).ammo.heavy === 0, 3000, 'sold');
    expect(fleet(host, host.id()).credits).toBe(20_000);
    host.room.send(TANKS_MSG.buy, { id: 'shield' });
    host.room.send(TANKS_MSG.buy, { id: 'nuke' });
    host.room.send(TANKS_MSG.buy, { id: 'nuke' });
    await waitFor(() => host.errors.some((e) => e.type === TANKS_MSG.buy), 3000, 'too expensive refused');
    await waitFor(() => fleet(host, host.id()).ammo.nuke === 1, 3000, 'one nuke');
    expect(fleet(host, host.id()).items.shield).toBe(1);
    expect(fleet(host, host.id()).credits).toBe(20_000 - ITEMS.shield.price - WEAPONS.nuke.price);
    // Ready: no more shopping until you un-ready; everyone ready → the battle starts.
    host.room.send(TANKS_MSG.ready, { ready: true });
    await waitFor(() => fleet(host, host.id()).ready === true, 3000, 'ready');
    host.room.send(TANKS_MSG.buy, { id: 'tracer' });
    await waitFor(() => host.errors.filter((e) => e.type === TANKS_MSG.buy).length >= 2, 3000, 'ready blocks buying');
    guest.room.send(TANKS_MSG.ready, { ready: true });
    await waitFor(() => st(host.room).battle.stage === 'aim', 5000, 'battle 1 under way');
    expect(host.events.some((e) => e.kind === 'battle' && e.battleNo === 1)).toBe(true);
    expect(fleet(host, host.id()).basket).toBe('');
    // End battle 1 with a direct hit.
    const server = host.server;
    const firstId = active(host);
    const otherId = firstId === host.id() ? guest.id() : host.id();
    rig(server, { [firstId]: 300, [otherId]: 1100 }, { [otherId]: 20 });
    const aim = solve(server, firstId, otherId);
    (firstId === host.id() ? host : guest).room.send(TANKS_MSG.fire, { turnId: st(host.room).battle.turnId, ...aim, weapon: 'shell' });
    await waitFor(() => st(host.room).battle.stage === 'battle_over', 3000, 'battle 1 over');
    expect(fleet(host, firstId).earned).toBeGreaterThan(0);
    expect(fleet(host, firstId).earnKills).toBe(2500);
    expect(fleet(host, firstId).wins).toBe(1);
    expect(fleet(host, firstId).score).toBe(170);
    const serial = st(host.room).battle.battleSerial;
    // Battle 2: a fresh battlefield and the shop again; leftovers carried over.
    await waitFor(() => st(host.room).battle.stage === 'shop', 3000, 'shop 2');
    expect(st(host.room).battle.battleNo).toBe(2);
    expect(st(host.room).battle.battleSerial).toBe(serial + 1);
    expect(st(host.room).battle.shotSeq).toBe(0);
    expect(fleet(host, host.id()).ammo.nuke).toBe(1);
    expect([...st(host.room).tanks.values()].every((t: any) => t.alive && t.hp === 100)).toBe(true);
    host.room.send(TANKS_MSG.ready, { ready: true });
    guest.room.send(TANKS_MSG.ready, { ready: true });
    await waitFor(() => st(host.room).battle.stage === 'aim', 5000, 'battle 2 under way');
    await guest.room.leave(true);
    await waitFor(() => st(host.room).phase === 'RESULTS', 5000, 'match over');
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.reason).toBe('points');
  });

  it('CPU crews do their own shopping and never hold up the shop', async () => {
    const host = await createHost('Solo', { solo: true });
    await settings(host, { battles: 2, economy: 'shop', startCredits: 50_000, cpu: 2 });
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).battle.stage === 'shop', 5000, 'shop open');
    const cpus = [...st(host.room).fleet.values()].filter((f: any) => f.cpu);
    expect(cpus).toHaveLength(2);
    for (const f of cpus) {
      expect(f.ready).toBe(true);
      expect(f.credits).toBeLessThan(50_000);
    }
    host.room.send(TANKS_MSG.ready, { ready: true });
    await waitFor(() => st(host.room).battle.stage === 'aim' || st(host.room).battle.stage === 'resolving', 5000, 'battle starts');
  });

  it('the shop closes on its own when the time is up', async () => {
    const host = await createHost('Alice');
    host.server.timing = { ...host.server.timing, shopMs: 300 };
    await join(host.room.roomId, 'Bob');
    await settings(host, { battles: 1, economy: 'shop' });
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).battle.stage === 'shop', 5000, 'shop open');
    await waitFor(() => st(host.room).battle.stage === 'aim', 5000, 'shop timed out');
  });

  it('volley mode: everyone aims at once, locks in, and every shot flies together', async () => {
    const { host, guest, server } = await duel({ ...QUICK, turnMode: 'volley' });
    expect(active(host)).toBe('');
    const turnId = st(host.room).battle.turnId;
    rig(server, { [host.id()]: 300, [guest.id()]: 1300 });
    // Both crews can aim at the same time.
    host.room.send(TANKS_MSG.aim, { angle: 50, power: 40, weapon: 'shell' });
    guest.room.send(TANKS_MSG.aim, { angle: 130, power: 40, weapon: 'shell' });
    await waitFor(() => tankState(host, host.id()).angle === 50 && tankState(host, guest.id()).angle === 130, 3000, 'both aimed');
    host.room.send(TANKS_MSG.fire, { turnId, angle: 50, power: 40, weapon: 'shell' });
    await waitFor(() => tankState(guest, host.id()).locked === true, 3000, 'locked in');
    expect(guest.events.some((e) => e.kind === 'locked' && e.playerId === host.id())).toBe(true);
    // Locked: no more changes.
    host.room.send(TANKS_MSG.fire, { turnId, angle: 50, power: 40, weapon: 'shell' });
    await waitFor(() => host.errors.some((e) => e.type === TANKS_MSG.fire), 3000, 'second lock refused');
    expect(host.shots).toHaveLength(0);
    guest.room.send(TANKS_MSG.fire, { turnId, angle: 130, power: 40, weapon: 'shell' });
    await waitFor(() => host.shots.length === 1, 3000, 'volley fired');
    const script = host.shots[0]!;
    expect(script.kind).toBe('volley');
    expect(script.launches.map((l) => l.shooterId).sort()).toEqual([host.id(), guest.id()].sort());
    await waitFor(() => st(host.room).battle.stage === 'aim' && st(host.room).battle.turnId === turnId + 1, 3000, 'next volley');
    expect(tankState(host, host.id()).locked).toBe(false);
    expect(host.events.filter((e) => e.kind === 'volley')).toHaveLength(2);
  });

  it('volley mode: when the clock runs out, nobody waits for the crew that never locked in', async () => {
    const host = await createHost('Alice');
    host.server.turnMs = () => 400;
    const guest = await join(host.room.roomId, 'Bob');
    await start(host, { ...QUICK, turnMode: 'volley' });
    const turnId = st(host.room).battle.turnId;
    host.room.send(TANKS_MSG.fire, { turnId, angle: 90, power: 30, weapon: 'tracer' });
    await waitFor(() => host.shots.length === 1, 3000, 'fired at the bell');
    expect(host.shots[0]!.launches.map((l) => l.shooterId)).toEqual([host.id()]);
    expect(guest.errors).toHaveLength(0);
  });

  it('items: a shield and a battery from the crew’s stock, only while you can act', async () => {
    const { host, guest, byId } = await duel();
    const shooter = byId(active(host));
    const other = shooter === host ? guest : host;
    const turnId = st(host.room).battle.turnId;
    other.room.send(TANKS_MSG.item, { item: 'shield', turnId });
    shooter.room.send(TANKS_MSG.item, { item: 'battery', turnId });
    await waitFor(() => other.errors.length >= 1 && shooter.errors.length >= 1, 3000, 'refusals');
    expect(other.errors[0]!.code).toBe('not_your_turn');
    expect(shooter.errors[0]!.message).toMatch(/full/);
    shooter.room.send(TANKS_MSG.item, { item: 'shield', turnId });
    await waitFor(() => tankState(host, shooter.id()).shield === 60, 3000, 'shield up');
    expect(tankState(host, shooter.id()).shieldKind).toBe('shield');
    expect(st(host.room).fleet.get(shooter.id()).items.shield).toBe(STOCKED_LOADOUT.shield! - 1);
    expect(host.events.some((e) => e.kind === 'item' && e.item === 'shield')).toBe(true);
    expect(ITEMS.shield.price).toBeGreaterThan(0);
  });

  it('hazards: a meteor shower or lightning opens a new round when they’re switched on', async () => {
    const host = await createHost('Alice');
    host.server.hazardChance = 1;
    const guest = await join(host.room.roomId, 'Bob');
    await start(host, { ...QUICK, hazards: true });
    // Two turns make a round; the third turn opens round 2 with a hazard first.
    let lastTurn = -1;
    for (let i = 0; i < 2; i++) {
      await waitFor(() => st(host.room).battle.stage === 'aim' && st(host.room).battle.turnId !== lastTurn, 5000, 'turn');
      lastTurn = st(host.room).battle.turnId;
      const c = active(host) === host.id() ? host : guest;
      c.room.send(TANKS_MSG.fire, { turnId: st(host.room).battle.turnId, angle: 90, power: 30, weapon: 'tracer' });
      await waitFor(() => host.shots.length === i + 1, 3000, 'shot');
    }
    await waitFor(() => host.shots.some((s) => s.kind === 'hazard'), 5000, 'hazard');
    expect(host.events.some((e) => e.kind === 'hazard')).toBe(true);
  });
});
