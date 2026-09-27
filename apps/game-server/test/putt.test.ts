import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, WelcomePayload } from '@dascade/shared';
import { PUTT_MSG, PuttStrokeSchema, type PuttEvent, type PuttShotView } from '@dascade/shared/games/putt';
import { decodePath, getHole, searchShots, simulateShot } from '@dascade/game-core/putt';
import { bootTestServer, collect, quiet, sleep, waitFor } from './helpers.ts';
import { onOutcome, type OutcomeContext } from '../src/platform/hub.ts';
import type { PuttRoom } from '../src/rooms/putt/PuttRoom.ts';

let colyseus: ColyseusTestServer;
const outcomes: Array<{ outcome: GameOutcome; ctx: OutcomeContext }> = [];
let stopListening: (() => void) | null = null;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['putt']));
  stopListening = onOutcome((outcome, ctx) => {
    if (ctx.gameId === 'putt') outcomes.push({ outcome, ctx });
  });
});
afterEach(async () => {
  await colyseus.cleanup();
  outcomes.length = 0;
});
afterAll(async () => {
  stopListening?.();
  await colyseus.shutdown();
});

type ErrorPayload = { type?: string; code: string; message: string };
const st = (room: SdkRoom) => room.state as any;

interface Client {
  room: SdkRoom;
  me: () => WelcomePayload;
  errors: ErrorPayload[];
  shots: PuttShotView[];
  events: PuttEvent[];
  aims: Array<{ playerId: string }>;
  replays: PuttShotView[][];
}

function wire(room: SdkRoom): Client {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<ErrorPayload>(room, 'sys:error');
  const shots = collect<PuttShotView>(room, PUTT_MSG.shot);
  const events = collect<PuttEvent>(room, PUTT_MSG.event);
  const aims = collect<{ playerId: string }>(room, PUTT_MSG.aim);
  const replays = collect<PuttShotView[]>(room, PUTT_MSG.replay);
  quiet(room);
  return { room, me: () => welcomes[welcomes.length - 1]!, errors, shots, events, aims, replays };
}

/** Compress every animation-driven wait so a hole plays in well under a second. */
function fast(server: PuttRoom): void {
  const s = server as any;
  s.countdownMs = 40;
  s.introMs = 40;
  s.intermissionMs = 80;
  s.resultsDelayMs = 40;
  s.restPadMs = 0;
  s.playbackScale = 0.02;
}

async function createHost(name = 'Host', extra: Record<string, unknown> = {}) {
  const room = await colyseus.sdk.create('putt', { name, ...extra });
  const client = wire(room);
  await room.waitForInitialState();
  await waitFor(() => Boolean(client.me()), 3000, 'welcome');
  const server = colyseus.getRoomById(room.roomId) as unknown as PuttRoom;
  fast(server);
  return { ...client, server };
}

async function join(code: string, name: string, extra: Record<string, unknown> = {}): Promise<Client> {
  const room = await colyseus.sdk.joinById(code, { name, ...extra });
  const client = wire(room);
  await room.waitForInitialState();
  await waitFor(() => Boolean(client.me()), 3000, 'welcome');
  return client;
}

const golfer = (c: Client, id = c.me().playerId) => st(c.room).golfers.get(id);
const holeNo = (c: Client) => st(c.room).route[st(c.room).holeIndex] as number;

async function waitForPlay(c: Client, holeIndex = 0): Promise<void> {
  await waitFor(() => st(c.room).phase === 'PLAYING' && st(c.room).holeStatus === 'play' && st(c.room).holeIndex === holeIndex, 5000, `hole ${holeIndex} open`);
}

/** Best searched intent from the golfer's current lie (what a perfect player would do). */
function bestShot(c: Client, id = c.me().playerId) {
  const g = golfer(c, id);
  const hole = getHole(holeNo(c));
  return searchShots(hole, { x: g.x, y: g.y }, { angleStep: 100, keep: 1 })[0]!;
}

async function putt(c: Client, angle: number, power: number): Promise<PuttShotView> {
  const before = c.shots.length;
  c.room.send(PUTT_MSG.stroke, { angle, power });
  await waitFor(() => c.shots.length > before, 3000, 'shot broadcast').catch((err: Error) => {
    throw new Error(`${err.message}: ${JSON.stringify(c.errors.slice(-3))}`);
  });
  const shot = c.shots.at(-1)!;
  await waitFor(() => golfer(c, shot.playerId)?.moving === false && golfer(c, shot.playerId)?.lastSeq === shot.seq, 4000, 'ball at rest');
  return shot;
}

/** Hole the golfer out with searched shots (only on their turn). */
async function holeOut(c: Client, observer: Client = c): Promise<number> {
  for (let i = 0; i < 8; i++) {
    const me = c.me().playerId;
    await waitFor(() => (st(observer.room).turnId === me || st(observer.room).mode === 'ghost') && !golfer(observer, me)?.moving, 4000, 'my turn');
    const best = bestShot(c);
    const shot = await putt(c, best.angle, best.power);
    if (shot.holed) return shot.strokes;
  }
  throw new Error('did not hole out');
}

describe('DAS Putt room', () => {
  it('two players complete a hole in turn; scores and the next hole update', async () => {
    const host = await createHost('Ada', { settings: { course: 'front' } });
    const guest = await join(host.room.roomId, 'Bo');
    (host.server as any).countdownMs = 400;
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'COUNTDOWN', 3000, 'countdown');
    // The course is visible during the countdown.
    expect(st(host.room).golfers.size).toBe(2);
    expect([...st(host.room).route]).toEqual([1, 2, 3]);
    await waitForPlay(host);
    const hostId = host.me().playerId;
    const guestId = guest.me().playerId;
    expect(st(host.room).turnId).toBe(hostId);
    const tee = getHole(1).tee;
    expect(golfer(host).x).toBe(tee[0]);

    // Host putts; the guest sees the same shot and the server's simulation matches the engine.
    const best = bestShot(host);
    const shot = await putt(host, best.angle, best.power);
    await waitFor(() => guest.shots.some((s) => s.seq === shot.seq), 2000, 'guest shot');
    const replay = simulateShot(getHole(1), { x: tee[0], y: tee[1] }, best.angle, best.power, shot.obstacleMs);
    expect(shot.ticks).toBe(replay.ticks);
    expect(shot.result).toBe(replay.result);
    const pos = decodePath(shot.path);
    expect(Math.abs(pos[pos.length - 2]! - replay.end.x)).toBeLessThan(0.06);
    expect(shot.playerId).toBe(hostId);
    expect(golfer(host).strokes).toBe(shot.strokes);

    const hostStrokes = shot.holed ? shot.strokes : await holeOut(host);
    const guestStrokes = await holeOut(guest, host);
    await waitFor(() => st(host.room).phase === 'INTERMISSION' || st(host.room).holeIndex === 1, 3000, 'hole end');
    await waitFor(() => golfer(host, hostId).card[0] > 0 && golfer(host, guestId).card[0] > 0, 3000, 'cards');
    expect(golfer(host, hostId).card[0]).toBe(hostStrokes);
    expect(golfer(host, guestId).card[0]).toBe(guestStrokes);
    expect(golfer(host, hostId).total).toBe(hostStrokes);
    expect(golfer(host, hostId).parPlayed).toBe(getHole(1).par);
    const holed = host.events.filter((e): e is Extract<PuttEvent, { kind: 'holed' }> => e.kind === 'holed');
    expect(holed.map((e) => e.playerId).sort()).toEqual([hostId, guestId].sort());
    expect(host.events.some((e) => e.kind === 'hole-end')).toBe(true);
    await waitForPlay(host, 1);
    expect(holeNo(host)).toBe(2);
    expect(golfer(host).strokes).toBe(0);
    expect(golfer(host).x).toBe(getHole(2).tee[0]);
  });

  it('rejects out-of-turn, malformed, spectator, early and duplicate strokes', async () => {
    const host = await createHost('Ada', { settings: { course: 'single', hole: 1 } });
    const guest = await join(host.room.roomId, 'Bo');
    const spec = await join(host.room.roomId, 'Spec', { spectator: true });
    const server = host.server as any;
    server.introMs = 400;
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    // During the hole intro nobody may putt.
    host.room.send(PUTT_MSG.stroke, { angle: 0, power: 500 });
    await waitFor(() => host.errors.some((e) => e.code === 'wrong_phase'), 2000, 'intro rejection');
    await waitForPlay(host);
    // Not the guest's turn.
    guest.room.send(PUTT_MSG.stroke, { angle: 0, power: 500 });
    await waitFor(() => guest.errors.some((e) => e.code === 'not_your_turn'), 2000, 'out of turn');
    // Spectators can't putt.
    spec.room.send(PUTT_MSG.stroke, { angle: 0, power: 500 });
    await waitFor(() => spec.errors.some((e) => e.code === 'not_allowed'), 2000, 'spectator');
    // Malformed intents (schema) — a few over the wire (rate limited), all of them against the schema.
    const bad = [{ angle: 36000, power: 500 }, { angle: -1, power: 500 }, { angle: 0, power: 0 }, { angle: 0, power: 1001 }, { angle: 1.5, power: 500 }, { angle: '0', power: 500 }, { power: 500 }, { angle: 0, power: 500, at: -5 }, { angle: 0, power: 500, at: Infinity }];
    for (const b of bad) expect(PuttStrokeSchema.safeParse(b).success).toBe(false);
    expect(PuttStrokeSchema.safeParse({ angle: 35999, power: 1000, at: Date.now() }).success).toBe(true);
    await sleep(1600); // refill the stroke rate bucket
    for (const b of bad.slice(0, 3)) host.room.send(PUTT_MSG.stroke, b);
    await waitFor(() => host.errors.filter((e) => e.code === 'invalid_payload').length >= 3, 3000, 'invalid payloads');
    expect(host.shots.length).toBe(0);
    expect(golfer(host).strokes).toBe(0);
    await sleep(2100); // refill again before the duplicate burst
    // A burst of duplicate strokes counts once (the ball is rolling after the first).
    server.playbackScale = 1;
    host.room.send(PUTT_MSG.stroke, { angle: 0, power: 600 });
    host.room.send(PUTT_MSG.stroke, { angle: 0, power: 600 });
    host.room.send(PUTT_MSG.stroke, { angle: 0, power: 600 });
    await waitFor(() => host.shots.length === 1, 2000, 'one shot');
    await waitFor(() => host.errors.some((e) => e.code === 'not_allowed' && e.type === PUTT_MSG.stroke), 2000, 'rolling rejection');
    await sleep(150);
    expect(host.shots.length).toBe(1);
    expect(spec.shots.length).toBe(1);
    // The guest can't putt while the host's ball rolls either.
    guest.room.send(PUTT_MSG.stroke, { angle: 0, power: 500 });
    await waitFor(() => guest.errors.filter((e) => e.code === 'not_your_turn').length >= 2, 2000, 'still not guest turn');
    server.playbackScale = 0.02;
    await waitFor(() => golfer(host).moving === false, 6000, 'rest');
    expect(golfer(host).strokes).toBe(1);
  });

  it('relays live aim of the active golfer to everyone else, but not from others', async () => {
    const host = await createHost('Ada', { settings: { course: 'single', hole: 1 } });
    const guest = await join(host.room.roomId, 'Bo');
    host.room.send('lobby:start', {});
    await waitForPlay(host);
    host.room.send(PUTT_MSG.aim, { angle: 1200, power: 400 });
    await waitFor(() => guest.aims.length > 0, 2000, 'aim relay');
    expect(guest.aims[0]!.playerId).toBe(host.me().playerId);
    expect(host.aims.length).toBe(0);
    guest.room.send(PUTT_MSG.aim, { angle: 1200, power: 400 });
    await sleep(150);
    expect(host.aims.length).toBe(0);
  });

  it('shot clock: a timeout costs a stroke and passes the turn; two in a row pick the ball up', async () => {
    const host = await createHost('Ada', { settings: { course: 'single', hole: 2, shotClock: 10 } });
    const guest = await join(host.room.roomId, 'Bo');
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    (host.server as any).config.shotClock = 0.25;
    await waitForPlay(host);
    const hostId = host.me().playerId;
    const guestId = guest.me().playerId;
    expect(golfer(host, hostId).deadline).toBeGreaterThan(0);
    await waitFor(() => host.events.some((e) => e.kind === 'timeout' && e.playerId === hostId), 3000, 'host timeout');
    await waitFor(() => st(host.room).turnId === guestId, 2000, 'turn passes');
    expect(golfer(host, hostId).strokes).toBe(1);
    await waitFor(() => host.events.some((e) => e.kind === 'pickup' && e.playerId === hostId), 4000, 'host picked up');
    expect(golfer(host, hostId).pickedUp).toBe(true);
    expect(golfer(host, hostId).card[0]).toBe(getHole(2).par + 4);
    // Everyone idles → the hole (and the single-hole match) still finishes.
    await waitFor(() => st(host.room).phase === 'RESULTS', 6000, 'results');
    expect(outcomes.length).toBe(1);
    expect(outcomes[0]!.outcome.lowerIsBetter).toBe(true);
    expect(outcomes[0]!.outcome.placements).toEqual([[hostId, guestId]]);
  });

  it('a disconnected golfer is put on a short clock and the room keeps moving; reconnect restores the seat', async () => {
    const host = await createHost('Ada', { settings: { course: 'single', hole: 1, shotClock: 60 } });
    const guest = await join(host.room.roomId, 'Bo');
    const server = host.server as any;
    server.disconnectedClockMs = 300;
    host.room.send('lobby:start', {});
    await waitForPlay(host);
    const hostId = host.me().playerId;
    const guestId = guest.me().playerId;
    // Host putts (a short tap), then it's the guest's turn with a 60 s clock.
    await putt(host, 0, 200);
    await waitFor(() => st(host.room).turnId === guestId, 2000, 'guest turn');
    expect(golfer(host, guestId).deadline - Date.now()).toBeGreaterThan(30_000);
    const { seatToken } = guest.me();
    guest.room.reconnection.enabled = false;
    (guest.room as any).connection.transport.ws.close(4010);
    await waitFor(() => st(host.room).players.get(guestId)?.connected === false, 3000, 'dropped');
    // The clock shortens and the turn comes back to the host.
    await waitFor(() => host.events.some((e) => e.kind === 'timeout' && e.playerId === guestId), 3000, 'short clock');
    await waitFor(() => st(host.room).turnId === hostId, 2000, 'turn back');
    // Guest comes back with their seat token mid-roll and gets the rolling shot replayed.
    server.playbackScale = 1;
    host.room.send(PUTT_MSG.stroke, { angle: 0, power: 900 });
    await waitFor(() => golfer(host, hostId).moving === true, 2000, 'rolling');
    const back = await join(host.room.roomId, 'Bo', { seatToken });
    expect(back.me().playerId).toBe(guestId);
    expect(back.me().rejoined).toBe(true);
    await waitFor(() => back.replays.length > 0, 2000, 'replay');
    expect(back.replays.at(-1)![0]!.playerId).toBe(hostId);
    expect(golfer(back, guestId).strokes).toBe(1);
    server.playbackScale = 0.02;
  });

  it('a golfer whose grace expires is picked up; one who leaves retires and is ranked last', async () => {
    const host = await createHost('Ada', { settings: { course: 'front' } });
    const guest = await join(host.room.roomId, 'Bo');
    const third = await join(host.room.roomId, 'Cy');
    const server = host.server as any;
    server.reconnectGraceSeconds = 0.2;
    host.room.send('lobby:start', {});
    await waitForPlay(host);
    const guestId = guest.me().playerId;
    const thirdId = third.me().playerId;
    guest.room.reconnection.enabled = false;
    (guest.room as any).connection.transport.ws.close(4010);
    await waitFor(() => host.events.some((e) => e.kind === 'pickup' && e.playerId === guestId && e.reason === 'away'), 4000, 'away pickup');
    await waitFor(() => golfer(host, guestId).pickedUp === true, 2000, 'picked up in state');
    // Cy leaves for good mid-hole: retired, never on the clock again.
    await third.room.leave(true);
    await waitFor(() => golfer(host, thirdId)?.retired === true, 3000, 'retired');
    // The host plays on alone and finishes all three holes.
    for (let h = 0; h < 3; h++) {
      await waitForPlay(host, h);
      await holeOut(host);
    }
    await waitFor(() => st(host.room).phase === 'RESULTS', 5000, 'results');
    const placements = outcomes[0]!.outcome.placements;
    expect(placements[0]).toEqual([host.me().playerId]);
    expect(placements.at(-1)).toEqual([thirdId]);
    expect([...st(host.room).winners]).toEqual([host.me().playerId]);
  });

  it('ghost mode: everyone putts at once and balls never collide', async () => {
    const host = await createHost('Ada', { settings: { course: 'single', hole: 1, mode: 'ghost' } });
    const guest = await join(host.room.roomId, 'Bo');
    host.room.send('lobby:start', {});
    await waitForPlay(host);
    expect(st(host.room).turnId).toBe('');
    host.room.send(PUTT_MSG.stroke, { angle: 0, power: 600 });
    guest.room.send(PUTT_MSG.stroke, { angle: 0, power: 600 });
    await waitFor(() => host.shots.length === 2, 2000, 'two shots');
    // Identical intents from the same lie → identical paths (no ball-ball collisions).
    const [a, b] = host.shots;
    expect(a!.path).toEqual(b!.path);
    expect(a!.playerId).not.toBe(b!.playerId);
    const rested = (v: PuttShotView) => golfer(host, v.playerId).lastSeq === v.seq && !golfer(host, v.playerId).moving;
    await waitFor(() => rested(a!) && rested(b!), 3000, 'both at rest');
    await holeOut(host);
    await holeOut(guest);
    await waitFor(() => st(host.room).phase === 'RESULTS', 5000, 'results');
  });

  it('solo practice starts at once without a shot clock and reports the outcome', async () => {
    const solo = await createHost('Solo', { solo: true, settings: { course: 'single', hole: 3 } });
    await waitForPlay(solo);
    expect(st(solo.room).solo).toBe(true);
    expect(golfer(solo).deadline).toBe(0);
    const strokes = await holeOut(solo);
    await waitFor(() => st(solo.room).phase === 'RESULTS', 5000, 'results');
    expect(golfer(solo).card[0]).toBe(strokes);
    expect(outcomes[0]!.outcome.scores).toEqual({ [solo.me().playerId]: strokes });
    expect([...st(solo.room).winners]).toEqual([solo.me().playerId]);
  });

  it('host can concede a hole and rematch from results', async () => {
    const host = await createHost('Ada', { settings: { course: 'single', hole: 4 } });
    const guest = await join(host.room.roomId, 'Bo');
    host.room.send('lobby:start', {});
    await waitForPlay(host);
    host.room.send(PUTT_MSG.pickup, {});
    await waitFor(() => golfer(host).pickedUp === true, 2000, 'pickup');
    expect(golfer(host).card[0]).toBe(getHole(4).par + 4);
    guest.room.send(PUTT_MSG.pickup, {});
    await waitFor(() => st(host.room).phase === 'RESULTS', 4000, 'results');
    guest.room.send(PUTT_MSG.rematch, {});
    await waitFor(() => guest.errors.some((e) => e.code === 'not_host'), 2000, 'guest cannot rematch');
    host.room.send(PUTT_MSG.rematch, {});
    await waitForPlay(host);
    expect(golfer(host).strokes).toBe(0);
    expect(golfer(host).card[0]).toBe(0);
  });

  it('tournament match: fixed format, first side tees off, tie → sudden-death playoff', async () => {
    const host = await createHost('Ada', { settings: { course: 'single', hole: 2, mode: 'ghost' } });
    const guest = await join(host.room.roomId, 'Bo');
    const hostId = host.me().playerId;
    const guestId = guest.me().playerId;
    const server = host.server as any;
    server.tournamentInfo = {
      tournamentCode: 'TTTTT',
      tournamentName: 'Cup',
      matchId: 'm1',
      roundLabel: 'Final',
      bestOf: 1,
      gameNumber: 1,
      seriesScore: {},
      participants: [
        { participantId: 'p1', name: 'Ada', seed: 1, playerId: hostId, side: 'second' },
        { participantId: 'p2', name: 'Bo', seed: 2, playerId: guestId, side: 'first' },
      ],
    };
    host.room.send('lobby:start', {});
    await waitForPlay(host);
    // Lobby settings are ignored: stroke play (turns) over all nine holes, 'first' side tees off.
    expect(st(host.room).mode).toBe('turns');
    expect([...st(host.room).route]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(st(host.room).tournament).toBe(true);
    expect(st(host.room).turnId).toBe(guestId);
    // Both concede every hole → tied after nine → playoff holes.
    for (let h = 0; h < 9; h++) {
      await waitForPlay(host, h);
      guest.room.send(PUTT_MSG.pickup, {});
      host.room.send(PUTT_MSG.pickup, {});
    }
    await waitFor(() => host.events.some((e) => e.kind === 'playoff'), 5000, 'playoff');
    await waitForPlay(host, 9);
    expect([...st(host.room).playoffIds].sort()).toEqual([hostId, guestId].sort());
    expect(holeNo(host)).toBe(9);
    // Playoff hole 9: Ada holes out, Bo picks up → Ada wins.
    await waitFor(() => st(host.room).turnId !== '', 2000, 'turn');
    if (st(host.room).turnId === guestId) guest.room.send(PUTT_MSG.pickup, {});
    await holeOut(host);
    if (!golfer(host, guestId).pickedUp) guest.room.send(PUTT_MSG.pickup, {});
    await waitFor(() => st(host.room).phase === 'RESULTS', 5000, 'results');
    const out = outcomes[0]!.outcome;
    expect(out.placements).toEqual([[hostId], [guestId]]);
    expect(out.reason).toBe('playoff');
    expect(out.scores).toEqual({ [hostId]: out.scores![guestId], [guestId]: out.scores![hostId] });
  });

  it('tournament forfeit: the remaining golfer wins when the opponent leaves', async () => {
    const host = await createHost('Ada');
    const guest = await join(host.room.roomId, 'Bo');
    const hostId = host.me().playerId;
    const guestId = guest.me().playerId;
    (host.server as any).tournamentInfo = {
      tournamentCode: 'TTTTT',
      tournamentName: 'Cup',
      matchId: 'm2',
      roundLabel: 'Round 1',
      bestOf: 1,
      gameNumber: 1,
      seriesScore: {},
      participants: [
        { participantId: 'p1', name: 'Ada', seed: 1, playerId: hostId },
        { participantId: 'p2', name: 'Bo', seed: 2, playerId: guestId },
      ],
    };
    host.room.send('lobby:start', {});
    await waitForPlay(host);
    await guest.room.leave(true);
    await waitFor(() => st(host.room).phase === 'RESULTS', 4000, 'results');
    expect(outcomes[0]!.outcome.placements).toEqual([[hostId], [guestId]]);
    expect(outcomes[0]!.outcome.reason).toBe('forfeit');
  });
});
