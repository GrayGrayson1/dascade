import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { WelcomePayload } from '@dascade/shared';
import { DEFAULT_WHEEL_SETTINGS, WHEEL_MSG, type WheelSpinSnapshot } from '@dascade/shared/games/wheel';
import { computeArcs, segmentAtPointer, pointerAngle } from '@dascade/game-core/wheel';
import { bootTestServer, collect, quiet, sleep, waitFor } from './helpers.ts';
import type { WheelRoom } from '../src/rooms/wheel/WheelRoom.ts';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['wheel']));
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

type ErrorPayload = { type?: string; code: string; message: string };

const st = (room: SdkRoom) => room.state as any;
const settingsOf = (room: SdkRoom) => JSON.parse(st(room).settingsJson);
const spinOf = (room: SdkRoom) => {
  const s = st(room).spin;
  return {
    spinId: s.spinId,
    status: s.status,
    startAt: s.startAt,
    durationMs: s.durationMs,
    fromRotation: s.fromRotation,
    toRotation: s.toRotation,
    winnerId: s.winnerId,
    winnerIndex: s.winnerIndex,
    spunById: s.spunById,
    snapshotJson: s.snapshotJson,
  };
};

const seg = (id: string, label: string, weight = 1, extra: Record<string, unknown> = {}) => ({
  id,
  label,
  weight,
  color: '#ffb020',
  emoji: '',
  enabled: true,
  ...extra,
});

async function wire(room: SdkRoom) {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<ErrorPayload>(room, 'sys:error');
  quiet(room);
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, 'welcome');
  return { room, welcomes, errors, me: () => welcomes[welcomes.length - 1]! };
}

async function createWheel(name = 'Host', options: Record<string, unknown> = {}) {
  const room = await colyseus.sdk.create('wheel', { name, ...options });
  const wired = await wire(room);
  const server = colyseus.getRoomById(room.roomId) as unknown as WheelRoom;
  // Keep tests quick: shorter lead-in, no cooldown between spins.
  (server as any).spinLeadMs = 40;
  (server as any).spinCooldownMs = 0;
  return { ...wired, server };
}

async function join(code: string, name: string, extra: Record<string, unknown> = {}) {
  return wire(await colyseus.sdk.joinById(code, { name, ...extra }));
}

async function setSettings(host: { room: SdkRoom }, patch: Record<string, unknown>) {
  const rev = st(host.room).settingsRev;
  host.room.send('lobby:settings', { settings: patch });
  await waitFor(() => st(host.room).settingsRev !== rev, 3000, 'settings echo');
}

async function start(host: { room: SdkRoom }) {
  host.room.send('lobby:start', {});
  await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'PLAYING');
}

/** Replace the room's crypto RNG with a constant stub so outcomes are predictable in tests. */
function stubRng(server: WheelRoom, value: number) {
  (server as any).rng = { next: () => value, int: (max: number) => Math.min(max - 1, Math.floor(value * max)) };
}

const landed = (room: SdkRoom, spinId: number) => () => st(room).spin.spinId === spinId && st(room).spin.status === 'landed';

describe('WheelRoom settings', () => {
  it('publishes the default wheel and lets only the host edit it', async () => {
    const host = await createWheel();
    const guest = await join(host.room.roomId, 'Guest');
    expect(settingsOf(guest.room)).toEqual(DEFAULT_WHEEL_SETTINGS);

    guest.room.send('lobby:settings', { settings: { title: 'Mine now' } });
    await waitFor(() => guest.errors.some((e) => e.code === 'not_host'));

    await setSettings(host, { title: '  Who presents?\u0000 ', segments: [seg('a', ' Alice‮ '), seg('b', 'Bob', 2, { color: '#FF4F81', emoji: '🎤🎤🎤' })] });
    await waitFor(() => settingsOf(guest.room).title === 'Who presents?');
    const segs = settingsOf(guest.room).segments;
    expect(segs[0].label).toBe('Alice');
    expect(segs[1]).toMatchObject({ color: '#ff4f81', emoji: '🎤🎤', weight: 2 });
  });

  it('rejects invalid wheels without changing anything', async () => {
    const host = await createWheel();
    const before = st(host.room).settingsJson;
    const invalid = [
      { segments: [seg('a', 'A', -1)] },
      { segments: [seg('a', 'A', 5000)] },
      { segments: [seg('a', 'A', 1, { color: 'red' })] },
      { segments: [seg('a', 'A'), seg('a', 'B')] },
      { segments: Array.from({ length: 201 }, (_, i) => seg(`s${i}`, `S${i}`)) },
      { spinDurationMs: 500 },
      { sliceMode: 'spiral' },
    ];
    for (const settings of invalid) host.room.send('lobby:settings', { settings });
    await waitFor(() => host.errors.filter((e) => e.code === 'invalid_payload').length === invalid.length, 3000, 'all rejected');
    expect(st(host.room).settingsJson).toBe(before);
  });

  it('refuses to start with nothing on the wheel', async () => {
    const host = await createWheel();
    await setSettings(host, { segments: [seg('a', 'Off', 1, { enabled: false }), seg('b', 'Zero', 0)] });
    host.room.send('lobby:start', {});
    await waitFor(() => host.errors.some((e) => e.type === 'lobby:start' && /at least one option/.test(e.message)));
    expect(st(host.room).phase).toBe('LOBBY');
  });

  it('refuses to start a host-only wheel while the host is spectating (nobody could ever spin)', async () => {
    const host = await createWheel();
    const guest = await join(host.room.roomId, 'Guest');
    host.room.send('lobby:spectate', { spectator: true });
    await waitFor(() => st(host.room).players.get(host.me().playerId)?.spectator === true);
    expect(st(host.room).hostId).toBe(host.me().playerId);

    host.room.send('lobby:start', {});
    await waitFor(() => host.errors.some((e) => e.type === 'lobby:start' && /spectating/i.test(e.message)), 3000, 'start refused');
    expect(st(host.room).phase).toBe('LOBBY');

    // Letting anyone spin makes it playable: the seated guest can spin.
    await setSettings(host, { spinPermission: 'anyone', spinDurationMs: 2000 });
    await start(host);
    guest.room.send(WHEEL_MSG.spin, {});
    await waitFor(() => st(host.room).spin.status === 'spinning');
  });

  it('solo rooms go straight to the stage', async () => {
    const solo = await createWheel('Solo', { solo: true });
    await waitFor(() => st(solo.room).phase === 'PLAYING');
  });
});

describe('WheelRoom spinning', () => {
  it('publishes one deterministic plan that every client shares, then lands and records history', async () => {
    const host = await createWheel();
    const guest = await join(host.room.roomId, 'Guest');
    await setSettings(host, { spinDurationMs: 2000, sliceMode: 'weighted', segments: [seg('a', 'Alpha', 1), seg('b', 'Bravo', 3), seg('c', 'Charlie', 2)] });
    await start(host);
    await waitFor(() => st(guest.room).phase === 'PLAYING');

    const before = Date.now();
    host.room.send(WHEEL_MSG.spin, {});
    await waitFor(() => st(host.room).spin.status === 'spinning' && st(guest.room).spin.status === 'spinning');
    const a = spinOf(host.room);
    const b = spinOf(guest.room);
    expect(b).toEqual(a);
    expect(a.spinId).toBe(1);
    expect(a.startAt).toBeGreaterThanOrEqual(before);
    expect(a.durationMs).toBe(2000);
    expect(a.spunById).toBe(host.me().playerId);
    expect(a.toRotation).toBeGreaterThan(a.fromRotation + 2 * 360);

    const snapshot = JSON.parse(a.snapshotJson) as WheelSpinSnapshot;
    expect(snapshot.sliceMode).toBe('weighted');
    expect(snapshot.segments.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(snapshot.segments[a.winnerIndex]!.id).toBe(a.winnerId);
    // The published end rotation puts the pointer strictly inside the winner's slice.
    const arcs = computeArcs(snapshot.segments, snapshot.sliceMode);
    expect(segmentAtPointer(arcs, a.toRotation)).toBe(a.winnerIndex);
    const arc = arcs[a.winnerIndex]!;
    const under = pointerAngle(a.toRotation);
    expect(under).toBeGreaterThan(arc.start);
    expect(under).toBeLessThan(arc.end);

    await waitFor(landed(host.room, 1), 5000, 'landing');
    await waitFor(landed(guest.room, 1), 2000, 'guest landing');
    const history = st(guest.room).history;
    expect(history.length).toBe(1);
    expect(history[0].segmentId).toBe(a.winnerId);
    expect(history[0].label).toBe(snapshot.segments[a.winnerIndex]!.label);
    expect(history[0].spunByName).toBe('Host');
    // Rotations travel as float64, so clients see exactly the server's plan.
    expect(st(guest.room).restRotation).toBe(((a.toRotation % 360) + 360) % 360);
    expect(st(guest.room).restRotation).toBe(host.server.state.restRotation);
    expect(a.toRotation).toBe(host.server.state.spin.toRotation);
    expect(st(guest.room).totalSpins).toBe(1);
    expect(st(guest.room).lastWinnerId).toBe(a.winnerId);
    expect(st(guest.room).players.get(host.me().playerId).score).toBe(1);
    // Landing the wheel before its time never happens: it took at least the lead + duration.
    expect(Date.now() - before).toBeGreaterThanOrEqual(2000);
  });

  it('ignores any outcome a client tries to supply', async () => {
    const host = await createWheel();
    await setSettings(host, { spinDurationMs: 2000, segments: [seg('a', 'Server pick'), seg('b', 'Client wish'), seg('z', 'Zero', 0)] });
    await start(host);
    stubRng(host.server, 0); // the server's RNG says: first eligible slice
    host.room.send(WHEEL_MSG.spin, { winnerId: 'b', winnerIndex: 1, segmentId: 'z', index: 2, toRotation: 0, rotation: 12, seed: 42 });
    await waitFor(() => st(host.room).spin.status === 'spinning');
    expect(st(host.room).spin.winnerId).toBe('a');
    const snapshot = JSON.parse(st(host.room).spin.snapshotJson) as WheelSpinSnapshot;
    // Zero-weight options are not even on the wheel.
    expect(snapshot.segments.map((s) => s.id)).toEqual(['a', 'b']);
    // Non-object payloads are rejected outright.
    host.room.send(WHEEL_MSG.spin, 'b');
    await waitFor(() => host.errors.some((e) => e.type === WHEEL_MSG.spin && e.code === 'invalid_payload'));
  });

  it('only lets the host spin unless "anyone can spin" is on; spectators never spin', async () => {
    const host = await createWheel();
    const guest = await join(host.room.roomId, 'Guest');
    const watcher = await join(host.room.roomId, 'Watcher', { spectator: true });
    await setSettings(host, { spinDurationMs: 2000 });
    await start(host);

    guest.room.send(WHEEL_MSG.spin, {});
    await waitFor(() => guest.errors.some((e) => e.type === WHEEL_MSG.spin && e.code === 'not_host'));
    expect(st(host.room).spin.spinId).toBe(0);

    await setSettings(host, { spinPermission: 'anyone' });
    watcher.room.send(WHEEL_MSG.spin, {});
    await waitFor(() => watcher.errors.some((e) => e.type === WHEEL_MSG.spin && e.code === 'not_allowed'));
    expect(st(host.room).spin.spinId).toBe(0);

    guest.room.send(WHEEL_MSG.spin, {});
    await waitFor(() => st(host.room).spin.status === 'spinning');
    expect(st(host.room).spin.spunById).toBe(guest.me().playerId);
    expect(st(host.room).spin.spunByName).toBe('Guest');
  });

  it('rate-limits spin spam and refuses spins while one is in flight', async () => {
    const host = await createWheel();
    await setSettings(host, { spinDurationMs: 2000 });
    await start(host);
    for (let i = 0; i < 6; i++) host.room.send(WHEEL_MSG.spin, {});
    await waitFor(() => host.errors.some((e) => e.code === 'rate_limited'), 3000, 'rate limit');
    expect(host.errors.some((e) => e.type === WHEEL_MSG.spin && e.code === 'not_allowed')).toBe(true);
    await sleep(100);
    expect(st(host.room).spin.spinId).toBe(1);
  });

  it('holds new spins during the post-landing cooldown', async () => {
    const host = await createWheel();
    await setSettings(host, { spinDurationMs: 2000 });
    await start(host);
    (host.server as any).spinCooldownMs = 5000;
    host.room.send(WHEEL_MSG.spin, {});
    await waitFor(landed(host.room, 1), 5000, 'landing');
    expect(st(host.room).nextSpinAt).toBeGreaterThan(Date.now());
    host.room.send(WHEEL_MSG.spin, {});
    await waitFor(() => host.errors.some((e) => e.type === WHEEL_MSG.spin && /sink in/.test(e.message)));
    expect(st(host.room).spin.spinId).toBe(1);
  });

  it('late joiners and reconnecting players receive the in-flight spin', async () => {
    const host = await createWheel();
    const guest = await join(host.room.roomId, 'Guest');
    await setSettings(host, { spinDurationMs: 6000 });
    await start(host);
    host.room.send(WHEEL_MSG.spin, {});
    await waitFor(() => st(host.room).spin.status === 'spinning');
    const plan = spinOf(host.room);
    await sleep(300);

    const late = await join(host.room.roomId, 'Latecomer');
    expect(st(late.room).phase).toBe('PLAYING');
    expect(spinOf(late.room)).toEqual(plan);
    expect(st(late.room).players.get(late.me().playerId).spectator).toBe(false);

    const playerId = guest.me().playerId;
    guest.room.reconnection.minUptime = 0;
    const reconnected = new Promise<void>((r) => guest.room.onReconnect(() => r()));
    (guest.room as any).connection.transport.ws.close(4010);
    await waitFor(() => st(host.room).players.get(playerId)?.connected === false);
    await reconnected;
    await waitFor(() => st(guest.room).players.get(playerId)?.connected === true);
    expect(spinOf(guest.room)).toEqual(plan);
  });

  it('locks settings during a spin and unlocks them after the landing', async () => {
    const host = await createWheel();
    await setSettings(host, { spinDurationMs: 2000 });
    await start(host);
    host.room.send(WHEEL_MSG.spin, {});
    await waitFor(() => st(host.room).spin.status === 'spinning');
    host.room.send('lobby:settings', { settings: { title: 'Mid-spin edit' } });
    await waitFor(() => host.errors.some((e) => e.type === 'lobby:settings' && e.code === 'wrong_phase'));
    host.room.send(WHEEL_MSG.end, {});
    await waitFor(() => host.errors.some((e) => e.type === WHEEL_MSG.end && e.code === 'not_allowed'));
    expect(st(host.room).phase).toBe('PLAYING');
    await waitFor(landed(host.room, 1), 5000, 'landing');
    await setSettings(host, { title: 'After the spin' });
    expect(settingsOf(host.room).title).toBe('After the spin');
  });

  it('removes winners after the spin when configured', async () => {
    const host = await createWheel();
    await setSettings(host, { spinDurationMs: 2000, afterSpin: 'remove', segments: [seg('a', 'A'), seg('b', 'B')] });
    await start(host);
    stubRng(host.server, 0);
    host.room.send(WHEEL_MSG.spin, {});
    await waitFor(landed(host.room, 1), 5000, 'first landing');
    expect(st(host.room).spin.winnerId).toBe('a');
    await waitFor(() => settingsOf(host.room).segments[0].enabled === false);
    expect(settingsOf(host.room).segments[1].enabled).toBe(true);

    host.room.send(WHEEL_MSG.spin, {});
    await waitFor(() => st(host.room).spin.spinId === 2);
    expect(st(host.room).spin.winnerId).toBe('b');
    expect(JSON.parse(st(host.room).spin.snapshotJson).segments).toHaveLength(1);
    await waitFor(landed(host.room, 2), 5000, 'second landing');

    // Nothing left: further spins are refused until the host re-enables options.
    host.room.send(WHEEL_MSG.spin, {});
    await waitFor(() => host.errors.some((e) => e.type === WHEEL_MSG.spin && /nothing on the wheel/i.test(e.message)));
  });

  it('prevents immediate repeats when configured', async () => {
    const host = await createWheel();
    await setSettings(host, { spinDurationMs: 2000, repeats: 'prevent', segments: [seg('a', 'A'), seg('b', 'B')] });
    await start(host);
    stubRng(host.server, 0); // would pick A every single time
    const winners: string[] = [];
    for (let i = 1; i <= 3; i++) {
      host.room.send(WHEEL_MSG.spin, {});
      await waitFor(landed(host.room, i), 5000, `landing ${i}`);
      winners.push(st(host.room).spin.winnerId);
    }
    expect(winners).toEqual(['a', 'b', 'a']);
  });

  it('the spin survives the host leaving mid-flight; the new host can edit and spin', async () => {
    const host = await createWheel();
    const guest = await join(host.room.roomId, 'Guest');
    await setSettings(host, { spinDurationMs: 2000, afterSpin: 'remove', segments: [seg('a', 'A'), seg('b', 'B'), seg('c', 'C')] });
    await start(host);
    host.room.send(WHEEL_MSG.spin, {});
    await waitFor(() => st(guest.room).spin.status === 'spinning');
    const plan = spinOf(guest.room);
    await host.room.leave(true);
    await waitFor(() => st(guest.room).hostId === guest.me().playerId, 3000, 'host migrated');
    // Still locked while the wheel is in flight, even for the new host.
    guest.room.send('lobby:settings', { settings: { title: 'Sneaky' } });
    await waitFor(() => guest.errors.some((e) => e.type === 'lobby:settings' && e.code === 'wrong_phase'));

    await waitFor(landed(guest.room, 1), 5000, 'landing without the spinner');
    expect(st(guest.room).history[0].segmentId).toBe(plan.winnerId);
    expect(st(guest.room).history[0].spunByName).toBe('Host');
    await waitFor(() => settingsOf(guest.room).segments.find((s: { id: string }) => s.id === plan.winnerId).enabled === false);

    await setSettings(guest, { title: 'New host wheel' });
    guest.room.send(WHEEL_MSG.spin, {});
    await waitFor(() => st(guest.room).spin.spinId === 2 && st(guest.room).spin.spunById === guest.me().playerId);
    expect(st(guest.room).spin.winnerId).not.toBe(plan.winnerId);
  });

  it('returning to the lobby mid-spin cancels the landing and unlocks settings', async () => {
    const host = await createWheel();
    await setSettings(host, { spinDurationMs: 2000, afterSpin: 'remove' });
    await start(host);
    host.room.send(WHEEL_MSG.spin, {});
    await waitFor(() => st(host.room).spin.status === 'spinning');
    host.room.send('lobby:toLobby', {});
    await waitFor(() => st(host.room).phase === 'LOBBY');
    expect(st(host.room).spin.status).toBe('idle');
    await setSettings(host, { title: 'Editable again' });
    // The cancelled spin never lands: no history, no removed winner, no score.
    await sleep(2300);
    expect(st(host.room).history.length).toBe(0);
    expect(st(host.room).totalSpins).toBe(0);
    expect(settingsOf(host.room).segments.every((s: { enabled: boolean }) => s.enabled)).toBe(true);
    expect(st(host.room).players.get(host.me().playerId).score).toBe(0);
  });

  it('a single-option wheel just confirms that option', async () => {
    const host = await createWheel();
    await setSettings(host, { spinDurationMs: 2000, segments: [seg('only', 'The only way')] });
    await start(host);
    host.room.send(WHEEL_MSG.spin, {});
    await waitFor(() => st(host.room).spin.status === 'spinning');
    expect(st(host.room).spin.winnerId).toBe('only');
    const arcs = computeArcs(JSON.parse(st(host.room).spin.snapshotJson).segments, 'equal');
    expect(segmentAtPointer(arcs, st(host.room).spin.toRotation)).toBe(0);
  });
});

describe('WheelRoom capacity', () => {
  it('40 participants mash SPIN at once: exactly one spin, identical plan everywhere', async () => {
    const host = await createWheel();
    await setSettings(host, { spinDurationMs: 2000, spinPermission: 'anyone' });
    const crowd: Array<Awaited<ReturnType<typeof join>>> = [];
    for (let i = 0; i < 39; i++) crowd.push(await join(host.room.roomId, `Player ${i + 1}`));
    await waitFor(() => st(host.room).players.size === 40, 5000, '40 players');
    await start(host);
    await waitFor(() => crowd.every((c) => st(c.room).phase === 'PLAYING'), 5000, 'everyone playing');

    for (const c of crowd) c.room.send(WHEEL_MSG.spin, {});
    host.room.send(WHEEL_MSG.spin, {});
    await waitFor(() => crowd.every((c) => st(c.room).spin.status === 'spinning'), 5000, 'spin everywhere');
    const plan = spinOf(host.room);
    expect(plan.spinId).toBe(1);
    for (const c of crowd) expect(spinOf(c.room)).toEqual(plan);
    // Everyone else was told the wheel is already spinning.
    await waitFor(() => crowd.filter((c) => c.me().playerId !== plan.spunById).every((c) => c.errors.some((e) => e.type === WHEEL_MSG.spin)), 3000, 'rejections');

    await waitFor(landed(host.room, 1), 5000, 'landing');
    await waitFor(() => crowd.every((c) => st(c.room).history.length === 1), 3000, 'history everywhere');
    expect(st(host.room).spin.spinId).toBe(1);
  }, 30_000);
});

describe('WheelRoom session', () => {
  it('resets history (host only), ends into RESULTS and returns to a clean lobby', async () => {
    const host = await createWheel();
    const guest = await join(host.room.roomId, 'Guest');
    await setSettings(host, { spinDurationMs: 2000 });
    await start(host);
    host.room.send(WHEEL_MSG.spin, {});
    await waitFor(landed(host.room, 1), 5000, 'landing');
    expect(st(host.room).history.length).toBe(1);

    guest.room.send(WHEEL_MSG.resetHistory, {});
    await waitFor(() => guest.errors.some((e) => e.type === WHEEL_MSG.resetHistory && e.code === 'not_host'));
    host.room.send(WHEEL_MSG.resetHistory, {});
    await waitFor(() => st(guest.room).history.length === 0);
    expect(st(guest.room).lastWinnerId).toBe('');
    expect(st(guest.room).totalSpins).toBe(1);

    guest.room.send(WHEEL_MSG.end, {});
    await waitFor(() => guest.errors.some((e) => e.type === WHEEL_MSG.end && e.code === 'not_host'));
    host.room.send(WHEEL_MSG.end, {});
    await waitFor(() => st(guest.room).phase === 'RESULTS');
    host.room.send(WHEEL_MSG.spin, {});
    await waitFor(() => host.errors.some((e) => e.type === WHEEL_MSG.spin && e.code === 'wrong_phase'));

    host.room.send('lobby:toLobby', {});
    await waitFor(() => st(guest.room).phase === 'LOBBY');
    expect(st(guest.room).totalSpins).toBe(0);
    expect(st(guest.room).spin.spinId).toBe(0);
    expect(st(guest.room).spin.status).toBe('idle');
  });
});
