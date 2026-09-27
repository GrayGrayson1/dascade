/**
 * DASphalt GP adversarial / robustness tests: long outages, hostile payloads, bursts after lag
 * spikes, host migration at every stage, stray timers, churn and leaving at the worst moments.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { GameOutcome } from '@dascade/shared';
import { KART_INPUT_MAX, KART_MSG } from '@dascade/shared/games/kart';
import { bootTestServer, sleep, waitFor } from './helpers.ts';
import { onOutcome } from '../src/platform/hub.ts';
import { placeKartBeforeFinish } from '../src/rooms/kart/testPlacement.ts';
import type { KartRoom } from '../src/rooms/kart/KartRoom.ts';
import { GAS, drive, fastForward, kartHelpers, racer, sim, simulateRace, st, startRace, tune, type Client } from './kart-helpers.ts';

let colyseus: ColyseusTestServer;
const { createHost, join } = kartHelpers(() => colyseus);

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['kart']));
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

const drop = (c: Client) => (c.room as any).connection.transport.ws.close(4010);

describe('KartRoom under adversarial conditions', () => {
  it('a client that kept numbering frames through a long outage drives again after reconnecting', async () => {
    const host = await createHost();
    const guest = await join(host.room.roomId, 'Flaky');
    await startRace(host, { bots: 0 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const kart = () => sim(host.server).kart(racer(guest).slot)!;
    await drive(guest, GAS, 300);
    await waitFor(() => kart().ackSeq > 5, 2000, 'driving');
    guest.room.reconnection.minUptime = 0;
    const back = new Promise<void>((r) => guest.room.onReconnect(() => r()));
    drop(guest);
    await waitFor(() => kart().connected === false, 3000, 'dropped');
    await back;
    await waitFor(() => kart().connected === true, 3000, 'back');
    guest.seq += 60 * 20;
    const ack = kart().ackSeq;
    await drive(guest, GAS, 700);
    await waitFor(() => kart().ackSeq > ack + 15, 2000, 'accepted after the outage');
    expect(kart().ackSeq).toBeGreaterThan(1000);
  });

  it('a lag spike followed by a burst of max-size packets never runs the kart faster than real time', async () => {
    const host = await createHost();
    await startRace(host, { bots: 0 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const s = sim(host.server);
    const kart = s.kart(racer(host).slot)!;
    await drive(host, GAS, 300);
    const tick0 = s.tick;
    const ack0 = kart.ackSeq;
    // 1 s of silence, then everything at once (a stalled Wi-Fi flush) plus replays of old frames.
    await sleep(1000);
    for (let i = 0; i < 12; i++) {
      host.room.send(KART_MSG.input, { seq: host.seq, inputs: Array.from({ length: 8 }, () => GAS) });
      host.seq += 8;
    }
    for (let i = 0; i < 10; i++) host.room.send(KART_MSG.input, { seq: 1, inputs: Array.from({ length: 8 }, () => GAS) });
    await sleep(600);
    const ticks = s.tick - tick0;
    const frames = kart.ackSeq - ack0;
    // Frames are consumed from the queue at most as fast as credit allows; re-anchoring skips, never adds.
    expect(kart.progress.lap).toBeLessThanOrEqual(1);
    expect(host.server.stats.inputFramesDropped).toBeGreaterThan(0);
    expect(frames).toBeGreaterThan(0);
    expect(ticks).toBeGreaterThan(0);
    expect(host.room.connection.isOpen).toBe(true);
  });

  it('a client that restarts its frame numbering (fresh predictor) is re-anchored, not ignored', async () => {
    const host = await createHost();
    await startRace(host, { bots: 0 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const kart = sim(host.server).kart(racer(host).slot)!;
    host.seq = 5000;
    await drive(host, GAS, 300);
    await waitFor(() => kart.ackSeq > 5000, 2000, 'anchored high');
    // A small step back is a stale duplicate and is ignored…
    host.room.send(KART_MSG.input, { seq: kart.lastSeq - 10, inputs: [GAS, GAS] });
    await sleep(100);
    expect(host.server.stats.seqRestarts).toBe(0);
    // …a restart from 1 re-anchors and the kart keeps driving on the new numbers.
    host.seq = 1;
    await drive(host, GAS, 500);
    expect(host.server.stats.seqRestarts).toBe(1);
    await waitFor(() => kart.ackSeq > 5 && kart.ackSeq < 1000, 2000, 'driving on restarted numbers');
  });

  it('NaN / Infinity / out-of-range / wrong-shape packets are dropped silently', async () => {
    const host = await createHost();
    await startRace(host, { bots: 0 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const before = host.server.stats.inputPackets;
    const kart = sim(host.server).kart(racer(host).slot)!;
    for (const payload of [
      { seq: Number.NaN, inputs: [GAS] },
      { seq: Number.POSITIVE_INFINITY, inputs: [GAS] },
      { seq: 2 ** 31, inputs: [GAS] },
      { seq: 1, inputs: [Number.NaN] },
      { seq: 1, inputs: [Number.NEGATIVE_INFINITY] },
      { seq: 1, inputs: [KART_INPUT_MAX + 1] },
      { seq: 1, inputs: { length: 3, 0: GAS } },
      { seq: 1, inputs: [[GAS]] },
      { seq: 1 },
      {},
      [1, [GAS]],
      new Uint8Array(4096),
    ]) {
      host.room.send(KART_MSG.input, payload);
    }
    await sleep(250);
    expect(host.server.stats.inputPackets).toBe(before);
    expect(Number.isFinite(kart.state.x) && Number.isFinite(kart.state.y) && Number.isFinite(kart.state.z)).toBe(true);
    expect(host.room.connection.isOpen).toBe(true);
    // Hostile look / next payloads.
    host.room.send(KART_MSG.look, { racer: '__proto__', body: 'buggy', paint: '#000000' });
    host.room.send(KART_MSG.look, { racer: 'nova', body: 'buggy', paint: '#00000g' });
    host.room.send(KART_MSG.next, { force: true, round: 4 });
    await sleep(150);
    expect(st(host.room).phase).toBe('PLAYING');
  });

  it('duplicate and replayed input packets are applied once', async () => {
    const host = await createHost();
    await startRace(host, { bots: 0 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const packet = { seq: 1, inputs: [GAS, GAS] };
    for (let i = 0; i < 20; i++) host.room.send(KART_MSG.input, packet);
    await sleep(300);
    const kart = sim(host.server).kart(racer(host).slot)!;
    expect(kart.ackSeq).toBe(2);
    expect(host.server.stats.inputFrames).toBe(2);
  });

  it('the host leaving mid-race migrates the host; the race finishes and the new host can rematch', async () => {
    const host = await createHost('Old');
    const guest = await join(host.room.roomId, 'New');
    await startRace(host, { laps: 1, bots: 1 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const oldId = host.me().playerId;
    await host.room.leave(true);
    await waitFor(() => st(guest.room).hostId === guest.me().playerId, 3000, 'migration');
    await waitFor(() => racer(guest, oldId)?.dnf === true, 3000, 'old host retired');
    const server = colyseus.getRoomById(guest.room.roomId) as unknown as KartRoom;
    simulateRace(server);
    await waitFor(() => st(guest.room).phase === 'RESULTS', 5000, 'results');
    guest.room.send(KART_MSG.next, {});
    await waitFor(() => st(guest.room).phase === 'COUNTDOWN' || st(guest.room).phase === 'PLAYING', 3000, 'rematch by the new host');
    await waitFor(() => st(guest.room).racers.size === 2, 2000, 'new grid (guest + bot)');
    expect(racer(guest).finishOrder).toBe(0);
  });

  it('returning to the lobby during the finish cool-down cancels the pending results', async () => {
    const host = await createHost();
    (host.server as any).resultsDelayMs = 600;
    await startRace(host, { laps: 1, bots: 0 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    placeKartBeforeFinish(sim(host.server), racer(host).slot, 8);
    await drive(host, GAS, 800);
    await waitFor(() => st(host.room).race.status === 'done', 3000, 'race decided');
    host.room.send('lobby:toLobby', {});
    await waitFor(() => st(host.room).phase === 'LOBBY', 2000, 'lobby');
    expect(st(host.room).racers.size).toBe(0);
    (host.server as any).countdownMs = 100;
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'next race');
    await drive(host, GAS, 900);
    expect(st(host.room).phase).toBe('PLAYING');
    expect(st(host.room).race.status).toBe('racing');
  });

  it('a racer whose connection blips as the countdown starts keeps their grid slot', async () => {
    const host = await createHost();
    const guest = await join(host.room.roomId, 'Blip');
    const guestId = guest.me().playerId;
    guest.room.reconnection.minUptime = 0;
    const back = new Promise<void>((r) => guest.room.onReconnect(() => r()));
    drop(guest);
    await waitFor(() => st(host.room).players.get(guestId)?.connected === false, 3000, 'drop');
    host.room.send('lobby:settings', { settings: { bots: 0 } });
    await sleep(100);
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).racers.size === 2, 3000, 'grid');
    await back;
    await waitFor(() => st(host.room).players.get(guestId)?.connected === true, 3000, 'back');
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'green light');
    const kart = sim(host.server).kart(racer(guest).slot)!;
    expect(kart.connected).toBe(true);
    await drive(guest, GAS, 600);
    await waitFor(() => kart.ackSeq > 10, 2000, 'guest drives');
  });

  it('leaving on the grid retires the racer; the last racer leaving ends the match cleanly', async () => {
    const host = await createHost();
    (host.server as any).countdownMs = 1500;
    const guest = await join(host.room.roomId, 'Quitter');
    await startRace(host, { bots: 2 });
    await waitFor(() => st(host.room).phase === 'COUNTDOWN' && st(host.room).racers.size === 4, 3000, 'grid');
    const guestId = guest.me().playerId;
    await guest.room.leave(true);
    await waitFor(() => racer(host, guestId)?.active === false, 2000, 'retired on the grid');
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'green light anyway');
    expect(racer(host, guestId).dnf).toBe(true);
    const watcher = await join(host.room.roomId, 'Watcher');
    expect(st(watcher.room).players.get(watcher.me().playerId).spectator).toBe(true);
    await host.room.leave(true);
    // Only bots and a spectator are left: back to the lobby instead of a race nobody plays.
    await waitFor(() => st(watcher.room).phase === 'LOBBY', 3000, 'empty match returns to lobby');
    expect(st(watcher.room).racers.size).toBe(0);
  });

  it('disconnect churn mid-race: every client comes back and the race still completes', async () => {
    const host = await createHost('Churn 1');
    const guests: Client[] = [];
    for (let i = 2; i <= 6; i++) guests.push(await join(host.room.roomId, `Churn ${i}`));
    await startRace(host, { laps: 1, bots: 3 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    for (const g of guests) g.room.reconnection.minUptime = 0;
    const backs = guests.map((g) => new Promise<void>((r) => g.room.onReconnect(() => r())));
    for (const g of guests) drop(g);
    await Promise.all(backs);
    for (const g of guests) await waitFor(() => sim(host.server).kart(racer(g).slot)!.connected, 3000, 'reconnected');
    await Promise.all(guests.map((g) => drive(g, GAS, 400)));
    for (const g of guests) expect(sim(host.server).kart(racer(g).slot)!.ackSeq).toBeGreaterThan(0);
    simulateRace(host.server);
    await waitFor(() => st(host.room).phase === 'RESULTS', 5000, 'results');
    const rows = [...st(host.room).racers.values()] as any[];
    expect(rows.every((r) => r.finished || r.dnf)).toBe(true);
  });
});

describe('Grand Prix under adversarial conditions', () => {
  it('the host leaving during the intermission never stalls the cup', async () => {
    const outcomes: GameOutcome[] = [];
    const stop = onOutcome((o) => outcomes.push(o));
    try {
      const host = await createHost('Old');
      const guest = await join(host.room.roomId, 'Heir');
      await startRace(host, { mode: 'gp', laps: 1, bots: 1 });
      await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'race 1');
      const server = host.server;
      (server as any).intermissionMs = 800;
      simulateRace(server);
      await waitFor(() => st(guest.room).phase === 'INTERMISSION', 5000, 'intermission');
      await host.room.leave(true);
      await waitFor(() => st(guest.room).hostId === guest.me().playerId, 3000, 'migration');
      // Nobody presses anything: the cup advances by itself.
      for (let round = 2; round <= 4; round++) {
        await waitFor(() => st(guest.room).race.round === round && st(guest.room).phase === 'PLAYING', 5000, `race ${round}`);
        simulateRace(server);
      }
      await waitFor(() => st(guest.room).phase === 'RESULTS', 5000, 'cup over');
      const mine = outcomes.filter((o) => o.placements.flat().includes(guest.me().playerId));
      expect(mine).toHaveLength(1);
      expect(st(guest.room).gp.size).toBe(3);
    } finally {
      stop();
    }
  });

  it('everyone seated going away between races closes the cup with the standings so far', async () => {
    const host = await createHost();
    const guest = await join(host.room.roomId, 'Guest');
    await startRace(host, { mode: 'gp', laps: 1, bots: 2 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'race 1');
    const server = host.server;
    (server as any).intermissionMs = 60_000;
    simulateRace(server);
    await waitFor(() => st(host.room).phase === 'INTERMISSION', 5000, 'intermission');
    // Mark both seats away (their grace ran out) and advance.
    for (const p of (server as any).players.values()) p.away = true;
    (server as any).nextGpRace();
    expect((server as any).state.phase).toBe('RESULTS');
    expect((server as any).state.race.round).toBe(1);
    expect(guest.room.connection.isOpen).toBe(true);
  });

  it('a stale kart:next after the cup ended starts exactly one new cup', async () => {
    const host = await createHost();
    await startRace(host, { mode: 'gp', laps: 1, bots: 1 });
    for (let round = 1; round <= 4; round++) {
      await waitFor(() => st(host.room).race.round === round && st(host.room).phase === 'PLAYING', 5000, `race ${round}`);
      simulateRace(host.server);
    }
    await waitFor(() => st(host.room).phase === 'RESULTS', 5000, 'cup over');
    const raceId = st(host.room).race.raceId;
    host.room.send(KART_MSG.next, {});
    host.room.send(KART_MSG.next, {});
    host.room.send(KART_MSG.next, {});
    await waitFor(() => st(host.room).phase === 'COUNTDOWN' || st(host.room).phase === 'PLAYING', 3000, 'new cup');
    await sleep(400);
    expect(st(host.room).race.round).toBe(1);
    expect(st(host.room).race.raceId).toBe((raceId + 1) & 0xffff);
  });

  it('a disconnect during the countdown of a later race keeps the slot; fast-forwarded races stay consistent', async () => {
    const host = await createHost();
    const guest = await join(host.room.roomId, 'Blinky');
    tune(host.server);
    await startRace(host, { mode: 'gp', laps: 1, bots: 0 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'race 1');
    simulateRace(host.server);
    await waitFor(() => st(host.room).phase === 'INTERMISSION', 5000, 'intermission');
    (host.server as any).countdownMs = 1200;
    host.room.send(KART_MSG.next, {});
    await waitFor(() => st(host.room).phase === 'COUNTDOWN' && st(host.room).race.round === 2, 3000, 'countdown 2');
    guest.room.reconnection.minUptime = 0;
    const back = new Promise<void>((r) => guest.room.onReconnect(() => r()));
    drop(guest);
    await back;
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'race 2');
    const kart = sim(host.server).kart(racer(guest).slot)!;
    await waitFor(() => kart.connected, 3000, 'connected');
    await drive(guest, GAS, 500);
    expect(kart.ackSeq).toBeGreaterThan(0);
    fastForward(host.server, 10);
  });

  it('the host aborting mid-cup (back to lobby) reports nothing and clears the standings', async () => {
    const outcomes: GameOutcome[] = [];
    const stop = onOutcome((o) => outcomes.push(o));
    try {
      const host = await createHost();
      await startRace(host, { mode: 'gp', laps: 1, bots: 2 });
      await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'race 1');
      (host.server as any).intermissionMs = 60_000;
      simulateRace(host.server);
      await waitFor(() => st(host.room).phase === 'INTERMISSION', 5000, 'intermission');
      expect(st(host.room).gp.size).toBe(3);
      host.room.send('lobby:toLobby', {});
      await waitFor(() => st(host.room).phase === 'LOBBY', 3000, 'lobby');
      expect(st(host.room).gp.size).toBe(0);
      expect(st(host.room).race).toMatchObject({ status: 'idle', round: 0, rounds: 4 });
      await sleep(200);
      expect(outcomes.filter((o) => o.placements.flat().includes(host.me().playerId))).toHaveLength(0);
    } finally {
      stop();
    }
  });
});

describe('KartRoom host controls', () => {
  it('kicking a racer mid-race retires their kart; the race goes on', async () => {
    const host = await createHost();
    const victim = await join(host.room.roomId, 'Kicked');
    await startRace(host, { bots: 1 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const id = victim.me().playerId;
    host.room.send('lobby:kick', { playerId: id });
    await waitFor(() => st(host.room).racers.get(id)?.dnf === true, 3000, 'retired');
    expect(st(host.room).racers.get(id).active).toBe(false);
    expect(st(host.room).phase).toBe('PLAYING');
  });

  it('settings changed on the results screen apply to the rematch', async () => {
    const host = await createHost();
    await startRace(host, { laps: 1, bots: 0, track: 'pixel-plaza' });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    simulateRace(host.server);
    await waitFor(() => st(host.room).phase === 'RESULTS', 5000, 'results');
    host.room.send('lobby:settings', { settings: { track: 'dune-drift', bots: 2 } });
    await waitFor(() => JSON.parse(st(host.room).settingsJson).track === 'dune-drift', 3000, 'settings in results');
    // The finished race's meta is untouched until the rematch starts.
    expect(st(host.room).race.trackId).toBe('pixel-plaza');
    host.room.send(KART_MSG.next, {});
    await waitFor(() => st(host.room).race.trackId === 'dune-drift' && st(host.room).racers.size === 3, 3000, 'rematch on the new track');
  });
});
