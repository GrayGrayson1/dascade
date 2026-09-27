import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { GameOutcome } from '@dascade/shared';
import { KART_GP_POINTS, KART_INPUT_MAX, KART_MSG, KART_RACERS, KART_CUPS, type KartEvent } from '@dascade/shared/games/kart';
import { bootTestServer, sleep, waitFor } from './helpers.ts';
import { onOutcome, type OutcomeContext } from '../src/platform/hub.ts';
import { getStatLine } from '../src/platform/stats.ts';
import { placeKartBeforeFinish } from '../src/rooms/kart/testPlacement.ts';
import {
  GAS,
  IDLE,
  drive,
  fastForward,
  kartHelpers,
  racer,
  setSettings,
  sim,
  simulateRace,
  st,
  startRace,
  tune,
  type Client,
} from './kart-helpers.ts';

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

const racers = (c: Client) => [...st(c.room).racers.entries()] as Array<[string, any]>;

describe('KartRoom: lobby', () => {
  it('gives every player a default look and validates look changes', async () => {
    const host = await createHost('Looker');
    const look = () => st(host.room).looks.get(host.me().playerId);
    await waitFor(() => Boolean(look()), 2000, 'default look');
    expect(Object.keys(KART_RACERS)).toContain(look().racer);
    host.room.send(KART_MSG.look, { racer: 'mochi', body: 'rocket', paint: '#FF4FD8' });
    await waitFor(() => look().racer === 'mochi', 2000, 'look update');
    expect(look()).toMatchObject({ racer: 'mochi', body: 'rocket', paint: '#ff4fd8' });
    for (const bad of [
      { racer: 'plumber', body: 'buggy', paint: '#ffffff' },
      { racer: 'nova', body: 'tank', paint: '#ffffff' },
      { racer: 'nova', body: 'buggy', paint: 'red' },
      { racer: 'nova', body: 'buggy', paint: '#fff' },
      null,
    ]) {
      host.room.send(KART_MSG.look, bad);
    }
    await waitFor(() => host.errors.filter((e) => e.type === KART_MSG.look).length >= 5, 2000, 'rejections');
    expect(look()).toMatchObject({ racer: 'mochi', body: 'rocket', paint: '#ff4fd8' });
  });

  it('time trial is solo only: a multiplayer room falls back to a race', async () => {
    const host = await createHost();
    host.room.send('lobby:settings', { settings: { mode: 'timetrial' } });
    await sleep(250);
    expect(JSON.parse(st(host.room).settingsJson).mode).toBe('race');
    const created = await createHost('Sneaky', { settings: { mode: 'timetrial' } });
    expect(JSON.parse(st(created.room).settingsJson).mode).toBe('race');
  });

  it('previews the track, cup, laps and items in race meta', async () => {
    const host = await createHost();
    await setSettings(host, { mode: 'gp', cup: 'jackpot', laps: 2, items: false });
    await waitFor(() => st(host.room).race.mode === 'gp', 2000, 'preview');
    expect(st(host.room).race).toMatchObject({
      mode: 'gp',
      cup: 'jackpot',
      trackId: KART_CUPS.jackpot.tracks[0],
      laps: 2,
      items: false,
      rounds: 4,
      status: 'idle',
    });
  });
});

describe('KartRoom: racing', () => {
  it('builds a locked grid with bots on countdown, then races on server physics', async () => {
    const host = await createHost();
    const guest = await join(host.room.roomId, 'Guest');
    host.room.send(KART_MSG.look, { racer: 'nova', body: 'buggy', paint: '#22d3ee' });
    guest.room.send(KART_MSG.look, { racer: 'rex', body: 'tub', paint: '#2de38f' });
    await sleep(100);
    await startRace(host, { bots: 3 });
    await waitFor(() => host.snaps.length > 0 && st(host.room).racers.size === 5, 2000, 'grid + snapshot');
    const all = racers(host);
    const bots = all.filter(([, r]) => r.bot);
    expect(bots.map(([id]) => id).sort()).toEqual(['bot:1', 'bot:2', 'bot:3']);
    // Bots take racers nobody picked, with the racer's name.
    for (const [, b] of bots) {
      expect(['nova', 'rex']).not.toContain(b.racer);
      expect(b.name).toBe(KART_RACERS[b.racer as keyof typeof KART_RACERS].name);
    }
    expect(new Set(all.map(([, r]) => r.slot)).size).toBe(5);
    expect(racer(host)).toMatchObject({ racer: 'nova', paint: '#22d3ee', bot: false });
    expect(host.snaps.at(-1)!.karts.length).toBe(5);
    expect(st(host.room).race.status).toBe('grid');
    expect(st(host.room).race.entrants).toBe(5);

    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'green light');
    expect(host.events.some((e) => e.kind === 'go')).toBe(true);
    const slot = racer(host).slot;
    const before = sim(host.server).kart(slot)!.distance;
    await Promise.all([drive(host, GAS, 1500), drive(guest, IDLE, 1500)]);
    const kart = sim(host.server).kart(slot)!;
    expect(kart.distance).toBeGreaterThan(before + 10);
    expect(kart.ackSeq).toBeGreaterThan(20);
    const latest = host.snaps.at(-1)!;
    expect(latest.status).toBe('racing');
    expect(latest.karts.some((k) => k.slot === slot)).toBe(true);
    // The exact state + ack go only to the kart's own racer.
    const own = host.owns.at(-1)!;
    expect(own.slot).toBe(slot);
    expect(own.ack).toBeGreaterThan(20);
    expect(guest.owns.every((o) => o.slot === racer(guest).slot)).toBe(true);
    expect(racer(host).lap).toBe(1);
  });

  it('only accepts inputs: clients cannot teleport, claim laps or finish', async () => {
    const host = await createHost();
    const cheater = await join(host.room.roomId, 'Cheater');
    await startRace(host, { laps: 1, bots: 0 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const id = cheater.me().playerId;
    const kart = sim(host.server).kart(racer(cheater).slot)!;
    const x = kart.state.x;
    const y = kart.state.y;
    cheater.room.send(KART_MSG.input, { seq: 1, inputs: [IDLE], x: 99999, y: 99999, lap: 9, finished: true, item: 'pulse' });
    await sleep(250);
    expect(Math.hypot(kart.state.x - x, kart.state.y - y)).toBeLessThan(5);
    cheater.room.send('kart:finish', {});
    cheater.room.send('kart:lap', { lap: 3 });
    cheater.room.send('kart:item', { item: 'warp' });
    await sleep(300);
    const row = host.server.state.racers.get(id)!;
    expect(row.finished).toBe(false);
    expect(row.finishOrder).toBe(0);
    expect(kart.progress.finished).toBe(false);
    expect(kart.progress.lapTimes).toEqual([]);
    expect(host.server.state.phase).toBe('PLAYING');
    expect(host.room.connection.isOpen).toBe(true);
  });

  it('rejects malformed input packets silently and cannot be sped up by flooding', async () => {
    const host = await createHost();
    await startRace(host, { bots: 0 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const server = host.server;
    const before = server.stats.inputPackets;
    for (const payload of [
      { seq: 1, inputs: Array.from({ length: 50 }, () => GAS) },
      { seq: 1, inputs: [] },
      { seq: 0, inputs: [GAS] },
      { seq: -3, inputs: [GAS] },
      { seq: 1.5, inputs: [GAS] },
      { seq: 1, inputs: [KART_INPUT_MAX + 1] },
      { seq: 1, inputs: [GAS, KART_INPUT_MAX + 1] },
      { seq: 1, inputs: [-1] },
      { seq: 1, inputs: [0.5] },
      { seq: 1, inputs: ['gas'] },
      { seq: '1', inputs: [GAS] },
      { seq: 1, inputs: 'x'.repeat(50_000) },
      'x'.repeat(100_000),
      null,
      7,
    ]) {
      host.room.send(KART_MSG.input, payload);
    }
    await sleep(300);
    expect(server.stats.inputPackets).toBe(before);
    expect(host.errors.filter((e) => e.type === KART_MSG.input)).toEqual([]);
    // The largest valid frame is accepted.
    host.room.send(KART_MSG.input, { seq: 1, inputs: [KART_INPUT_MAX] });
    await waitFor(() => server.stats.inputPackets === before + 1, 2000, 'max input accepted');
    expect(host.room.connection.isOpen).toBe(true);

    const flood = server.stats.inputPackets;
    host.seq = 2;
    for (let i = 0; i < 100; i++) {
      host.room.send(KART_MSG.input, { seq: host.seq, inputs: Array.from({ length: 8 }, () => GAS) });
      host.seq += 8;
    }
    await sleep(400);
    const accepted = server.stats.inputPackets - flood;
    expect(accepted).toBeGreaterThan(10);
    expect(accepted).toBeLessThanOrEqual(60);
    // Credit bank: the kart never simulated more of its own frames than server ticks elapsed.
    const kart = sim(server).kart(racer(host).slot)!;
    expect(kart.applied).toBeLessThanOrEqual(sim(server).tick - sim(server).goTick + 12);
  });

  it('decides the finish order on the server and reports it once (bots as non-players)', async () => {
    const outcomes: GameOutcome[] = [];
    const stop = onOutcome((o) => outcomes.push(o));
    try {
      const host = await createHost('Ann');
      const guest = await join(host.room.roomId, 'Ben');
      await startRace(host, { laps: 1, bots: 2, finishWindowSec: 10 });
      await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
      placeKartBeforeFinish(sim(host.server), racer(guest).slot, 8);
      placeKartBeforeFinish(sim(host.server), racer(host).slot, 40);
      await Promise.all([drive(host, GAS, 2500), drive(guest, GAS, 2500)]);
      await waitFor(() => racer(host).finished && racer(guest).finished, 5000, 'both finished');
      expect(racer(guest).finishOrder).toBe(1);
      expect(racer(host).finishOrder).toBe(2);
      expect(st(host.room).race.finishDeadline).toBeGreaterThan(0);
      const finishes = host.events.filter((e): e is Extract<KartEvent, { kind: 'finish' }> => e.kind === 'finish');
      expect(finishes.slice(0, 2).map((e) => e.playerId)).toEqual([guest.me().playerId, host.me().playerId]);
      // The bots still out there get the finish window; fast-forward it.
      fastForward(host.server, 60 * 60);
      await waitFor(() => st(host.room).phase === 'RESULTS', 5000, 'results');
      const mine = outcomes.filter((o) => o.placements.flat().includes(host.me().playerId));
      expect(mine).toHaveLength(1);
      const o = mine[0]!;
      expect(o.placements[0]).toEqual([guest.me().playerId]);
      expect(o.placements[1]).toEqual([host.me().playerId]);
      expect(o.nonPlayerIds?.sort()).toEqual(['bot:1', 'bot:2']);
      expect(o.lowerIsBetter).toBe(true);
      expect(Object.keys(o.scores ?? {}).sort()).toEqual([host.me().playerId, guest.me().playerId].sort());
      expect(st(host.room).players.get(guest.me().playerId).score).toBeGreaterThan(st(host.room).players.get(host.me().playerId).score);
    } finally {
      stop();
    }
  });

  it('bots fill the grid and race to the finish on their own', async () => {
    const host = await createHost();
    await startRace(host, { laps: 1, bots: 5, botSkill: 'hard' });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    simulateRace(host.server);
    await waitFor(() => st(host.room).phase === 'RESULTS', 5000, 'results');
    const all = racers(host);
    expect(all).toHaveLength(6);
    const bots = all.filter(([, r]) => r.bot);
    expect(bots.filter(([, r]) => r.finished).length).toBeGreaterThanOrEqual(4);
    const orders = all
      .filter(([, r]) => r.finished)
      .map(([, r]) => r.finishOrder)
      .sort((a, b) => a - b);
    expect(orders).toEqual(orders.map((_, i) => i + 1));
    expect(all.map(([, r]) => r.position).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('item hits and item rolls reach clients as events (rolls only to their racer)', async () => {
    const host = await createHost();
    const guest = await join(host.room.roomId, 'Target');
    await startRace(host, { bots: 1 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const s = sim(host.server);
    const hostSlot = racer(host).slot;
    const guestSlot = racer(guest).slot;
    const botSlot = st(host.room).racers.get('bot:1').slot;
    const real = s.step.bind(s);
    let injected = false;
    (s as any).step = () => {
      const events = real();
      if (!injected) {
        injected = true;
        events.push(
          { type: 'hit', victim: guestSlot, by: hostSlot, cause: 'puck', blocked: false },
          { type: 'hit', victim: hostSlot, by: null, cause: 'hazard', blocked: true },
          { type: 'hit', victim: guestSlot, by: botSlot, cause: 'mine', blocked: false },
          { type: 'item', slot: hostSlot, item: 'shield' },
          { type: 'item', slot: botSlot, item: 'pulse' },
        );
      }
      return events;
    };
    await waitFor(() => guest.events.filter((e) => e.kind === 'hit').length >= 3, 2000, 'hits');
    const hits = guest.events.filter((e) => e.kind === 'hit');
    expect(hits).toEqual([
      { kind: 'hit', victim: guest.me().playerId, by: host.me().playerId, cause: 'puck', blocked: false },
      { kind: 'hit', victim: host.me().playerId, by: null, cause: 'hazard', blocked: true },
      { kind: 'hit', victim: guest.me().playerId, by: 'bot:1', cause: 'mine', blocked: false },
    ]);
    await waitFor(() => host.events.some((e) => e.kind === 'item'), 2000, 'item roll');
    expect(host.events.filter((e) => e.kind === 'item')).toEqual([{ kind: 'item', playerId: host.me().playerId, item: 'shield' }]);
    await sleep(100);
    expect(guest.events.some((e) => e.kind === 'item')).toBe(false);
    expect((host.server as any).matchStats.get(host.me().playerId).itemHits).toBe(1);
  });

  it('late joiners spectate: they get snapshots but their inputs are ignored', async () => {
    const host = await createHost();
    await startRace(host, { bots: 1 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const late = await join(host.room.roomId, 'Late');
    expect(st(late.room).players.get(late.me().playerId).spectator).toBe(true);
    const before = host.server.stats.inputPackets;
    late.room.send(KART_MSG.input, { seq: 1, inputs: [GAS, GAS] });
    await sleep(200);
    expect(host.server.stats.inputPackets).toBe(before);
    expect(st(host.room).racers.has(late.me().playerId)).toBe(false);
    await waitFor(() => late.snaps.length > 0, 2000, 'spectator snapshots');
    const watcher = await join(host.room.roomId, 'Watcher', { spectator: true });
    await waitFor(() => watcher.snaps.length > 0, 2000, 'explicit spectator snapshots');
    watcher.room.send(KART_MSG.next, {});
    await sleep(100);
    expect(st(host.room).phase).toBe('PLAYING');
  });

  it('a disconnected racer never stalls the race; a reconnecting one drives again', async () => {
    const host = await createHost('Stay');
    const flaky = await join(host.room.roomId, 'Flaky');
    await startRace(host, { laps: 1, bots: 0, finishWindowSec: 60 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const slot = racer(flaky).slot;
    flaky.room.reconnection.minUptime = 0;
    const reconnected = new Promise<void>((r) => flaky.room.onReconnect(() => r()));
    (flaky.room as any).connection.transport.ws.close(4010);
    await waitFor(() => sim(host.server).kart(slot)!.connected === false, 3000, 'dropped');
    await reconnected;
    await waitFor(() => sim(host.server).kart(slot)!.connected === true, 3000, 'back');
    const ack = sim(host.server).kart(slot)!.ackSeq;
    await drive(flaky, GAS, 600);
    await waitFor(() => sim(host.server).kart(slot)!.ackSeq > ack, 2000, 'inputs after reconnect');

    // Now drop for good: the host finishes, the finish window closes, the absent racer is a DNF.
    const flakyId = flaky.me().playerId;
    flaky.room.reconnection.enabled = false;
    (flaky.room as any).connection.transport.ws.close(4010);
    await waitFor(() => st(host.room).players.get(flakyId)?.connected === false, 3000, 'drop');
    (host.server as any).matchSettings.finishWindowSec = 10;
    placeKartBeforeFinish(sim(host.server), racer(host).slot, 8);
    await drive(host, GAS, 1200);
    await waitFor(() => racer(host).finished, 3000, 'host finished');
    fastForward(host.server, 60 * 70);
    await waitFor(() => st(host.room).phase === 'RESULTS', 5000, 'results despite the drop');
    expect(st(host.room).racers.get(flakyId).finished).toBe(false);
    expect(racer(host).finishOrder).toBe(1);
  });

  it('a racer leaving mid-race is retired (dnf) and the race goes on', async () => {
    const host = await createHost('Stay');
    const guest = await join(host.room.roomId, 'Quit');
    await startRace(host, { laps: 2, bots: 1 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const guestId = guest.me().playerId;
    await guest.room.leave(true);
    await waitFor(() => st(host.room).racers.get(guestId)?.dnf === true, 3000, 'dnf');
    expect(st(host.room).racers.get(guestId).active).toBe(false);
    expect(host.events.some((e) => e.kind === 'dnf' && e.playerId === guestId && e.reason === 'left')).toBe(true);
    expect(st(host.room).phase).toBe('PLAYING');
  });

  it('the last racer timing out ends the race with no contest', async () => {
    const outcomes: GameOutcome[] = [];
    const stop = onOutcome((o) => outcomes.push(o));
    try {
      const host = await createHost();
      await startRace(host, { laps: 1, bots: 0 });
      await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
      (sim(host.server).opts as { maxRaceMs: number }).maxRaceMs = 0;
      await waitFor(() => st(host.room).phase === 'RESULTS', 3000, 'results');
      expect(racer(host).dnf).toBe(true);
      expect(outcomes.filter((o) => o.placements.flat().includes(host.me().playerId))).toHaveLength(0);
    } finally {
      stop();
    }
  });

  it('the host can rematch from the results with kart:next (host only, results only)', async () => {
    const host = await createHost();
    const guest = await join(host.room.roomId, 'Guest');
    await startRace(host, { laps: 1, bots: 0 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    host.room.send(KART_MSG.next, {});
    await sleep(100);
    expect(host.errors.some((e) => e.type === KART_MSG.next)).toBe(true);
    const firstRace = st(host.room).race.raceId;
    simulateRace(host.server);
    await waitFor(() => st(host.room).phase === 'RESULTS', 5000, 'results');
    guest.room.send(KART_MSG.next, {});
    await sleep(150);
    expect(st(host.room).phase).toBe('RESULTS');
    host.room.send(KART_MSG.next, {});
    await waitFor(() => st(host.room).phase === 'COUNTDOWN' || st(host.room).phase === 'PLAYING', 3000, 'rematch');
    await waitFor(() => st(host.room).race.raceId !== firstRace, 2000, 'new race id');
    expect(racer(host).finished).toBe(false);
    expect(st(host.room).racers.size).toBe(2);
  });

  it('fills a 30-kart grid (20 players + 10 of 11 requested bots) and runs it', async () => {
    const host = await createHost('Grid 01');
    host.room.send('lobby:room', { maxPlayers: 30 });
    const guests: Client[] = [];
    for (let i = 2; i <= 20; i++) guests.push(await join(host.room.roomId, `Grid ${String(i).padStart(2, '0')}`));
    await startRace(host, { bots: 11, laps: 1 });
    await waitFor(() => st(host.room).racers.size === 30, 3000, 'full grid');
    expect(racers(host).filter(([, r]) => r.bot)).toHaveLength(10);
    expect(new Set(racers(host).map(([, r]) => r.slot)).size).toBe(30);
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    await waitFor(() => guests[18]!.snaps.some((s) => s.karts.length === 30 && s.status === 'racing'), 3000, 'snapshots with 30 karts');
    expect((host.server as any).snapEvery).toBe(3);
    const t0 = performance.now();
    fastForward(host.server, 600);
    const perTick = (performance.now() - t0) / 600;
    expect(perTick).toBeLessThan(8); // generous: includes encoding + broadcasting to 20 clients
  });
});

describe('KartRoom: solo', () => {
  it('a solo time trial starts immediately with no bots and no items, and records the time', async () => {
    const outcomes: Array<{ outcome: GameOutcome; ctx: OutcomeContext }> = [];
    const stop = onOutcome((outcome, ctx) => outcomes.push({ outcome, ctx }));
    try {
      const guestId = 'g_kart_solo_tt_01';
      const solo = await createHost('Solo', { solo: true, guestId, settings: { mode: 'timetrial', laps: 1, bots: 7 } });
      await waitFor(() => st(solo.room).racers.size === 1, 3000, 'grid');
      tune(solo.server);
      expect(st(solo.room).locked).toBe(true);
      expect(st(solo.room).race).toMatchObject({ solo: true, mode: 'timetrial', items: false });
      await waitFor(() => st(solo.room).phase === 'PLAYING', 6000, 'playing');
      expect(sim(solo.server).kart(racer(solo).slot)!.state.item).toBeGreaterThan(0); // the Turbo Trio
      placeKartBeforeFinish(sim(solo.server), racer(solo).slot, 8);
      await drive(solo, GAS, 1200);
      await waitFor(() => st(solo.room).phase === 'RESULTS', 5000, 'results');
      const mine = outcomes.filter((o) => o.ctx.roomCode === solo.room.roomId);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.outcome.placements).toEqual([[solo.me().playerId]]);
      expect(mine[0]!.outcome.scores).toEqual({ [solo.me().playerId]: racer(solo).finishMs });
      expect(getStatLine(`g:${guestId}`, 'kart')).toMatchObject({ games: 1, bestScore: racer(solo).finishMs, lowerIsBetter: true });
      await expect(colyseus.sdk.joinById(solo.room.roomId, { name: 'Intruder' })).rejects.toBeTruthy();
      // Retry = kart:next.
      solo.room.send(KART_MSG.next, {});
      await waitFor(() => st(solo.room).phase === 'COUNTDOWN' || st(solo.room).phase === 'PLAYING', 3000, 'retry');
    } finally {
      stop();
    }
  });

  it('a solo race against bots', async () => {
    const solo = await createHost('Solo', { solo: true, settings: { mode: 'race', bots: 4 } });
    await waitFor(() => st(solo.room).racers.size === 5, 3000, 'grid with bots');
    expect(st(solo.room).race.items).toBe(true);
  });
});

describe('KartRoom: Grand Prix', () => {
  let outcomes: Array<{ outcome: GameOutcome; ctx: OutcomeContext }> = [];
  let stop: () => void = () => undefined;
  beforeEach(() => {
    outcomes = [];
    stop = onOutcome((outcome, ctx) => outcomes.push({ outcome, ctx }));
  });
  afterEach(() => stop());

  it('runs a four-race cup with points, standings between races and one outcome at the end', async () => {
    const host = await createHost('Ann');
    const guest = await join(host.room.roomId, 'Ben');
    const quitter = await join(host.room.roomId, 'Quit');
    await startRace(host, { mode: 'gp', cup: 'joystick', laps: 1, bots: 3 });
    const tracks = KART_CUPS.joystick.tracks;
    const hostId = host.me().playerId;
    const quitId = quitter.me().playerId;
    let late: Client | null = null;
    for (let round = 1; round <= 4; round++) {
      await waitFor(() => st(host.room).race.round === round && st(host.room).phase === 'PLAYING', 5000, `race ${round}`);
      expect(st(host.room).race.trackId).toBe(tracks[round - 1]);
      expect(st(host.room).race.rounds).toBe(4);
      if (round === 1) {
        // Arrives mid-cup: spectates now, races from round 2 with 0 points for round 1.
        late = await join(host.room.roomId, 'Late');
        expect(st(late.room).players.get(late.me().playerId).spectator).toBe(true);
      }
      if (round === 2) {
        expect(st(host.room).racers.has(late!.me().playerId)).toBe(true);
        await quitter.room.leave(true);
        await waitFor(() => st(host.room).racers.get(quitId)?.dnf === true, 3000, 'quitter retired');
      }
      simulateRace(host.server);
      if (round < 4) {
        await waitFor(() => st(host.room).phase === 'INTERMISSION', 5000, `intermission ${round}`);
        const gp = st(host.room).gp;
        // Every row has one place per round so far; the race's points were awarded.
        for (const [, row] of gp.entries()) expect(row.places.length).toBe(round);
        const racedPoints = [...gp.values()].reduce((a: number, r: any) => a + r.points, 0);
        expect(racedPoints).toBeGreaterThan(0);
        expect(outcomes.filter((o) => o.ctx.roomCode === host.room.roomId)).toHaveLength(0);
        if (round === 1) host.room.send(KART_MSG.next, {}); // host skips the wait; later rounds auto-advance
      }
    }
    await waitFor(() => st(host.room).phase === 'RESULTS', 5000, 'cup over');
    const gp = st(host.room).gp;
    expect(gp.size).toBe(7); // 3 players + late joiner + 3 bots
    const rows = [...gp.entries()] as Array<[string, any]>;
    for (const [, row] of rows) expect(row.places.length).toBe(4);
    expect(gp.get(late!.me().playerId).places[0]).toBe(0);
    expect(gp.get(guest.me().playerId).places.every((p: number) => p > 0)).toBe(true);
    expect([...gp.get(quitId).places].slice(2)).toEqual([0, 0]);
    expect(gp.get(quitId).name).toBe('Quit');
    for (const [, row] of rows) {
      const expected = row.places.reduce((a: number, p: number) => a + (p > 0 ? (KART_GP_POINTS[p - 1] ?? 0) : 0), 0);
      expect(row.points).toBe(expected);
    }
    expect(gp.get('bot:1').bot).toBe(true);
    const mine = outcomes.filter((o) => o.ctx.roomCode === host.room.roomId);
    expect(mine).toHaveLength(1);
    const { outcome } = mine[0]!;
    expect(outcome.reason).toBe('cup_finished');
    expect(outcome.placements.at(-1)).toEqual([quitId]); // left mid-cup: last
    expect(outcome.nonPlayerIds?.sort()).toEqual(['bot:1', 'bot:2', 'bot:3']);
    const flat = outcome.placements.flat();
    expect(flat).toContain(hostId);
    expect(flat).toContain(late!.me().playerId);
    const pointsOf = (id: string) => gp.get(id).points;
    const present = outcome.placements.slice(0, -1);
    for (let i = 1; i < present.length; i++) expect(pointsOf(present[i - 1]![0]!)).toBeGreaterThan(pointsOf(present[i]![0]!));
    expect((outcome.details as any).playerStats[hostId].maxCupPoints).toBe(pointsOf(hostId));
    expect(st(host.room).players.get(hostId).score).toBe(pointsOf(hostId));

    // A new cup from the results.
    host.room.send(KART_MSG.next, {});
    await waitFor(() => st(host.room).race.round === 1 && st(host.room).phase !== 'RESULTS', 3000, 'new cup');
    expect([...st(host.room).gp.values()].every((r: any) => r.points === 0)).toBe(true);
  });

  it('settings are locked mid-cup and a double-tapped kart:next never skips a race', async () => {
    const host = await createHost();
    await startRace(host, { mode: 'gp', laps: 1, bots: 1 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'race 1');
    host.room.send('lobby:settings', { settings: { laps: 5 } });
    await waitFor(() => host.errors.some((e) => e.type === 'lobby:settings'), 2000, 'settings refused');
    simulateRace(host.server);
    await waitFor(() => st(host.room).phase === 'INTERMISSION', 5000, 'intermission');
    (host.server as any).intermissionMs = 60_000;
    host.room.send(KART_MSG.next, {});
    host.room.send(KART_MSG.next, {});
    await waitFor(() => st(host.room).race.round === 2, 3000, 'race 2');
    await sleep(300);
    expect(st(host.room).race.round).toBe(2);
    expect(st(host.room).race.laps).toBe(1);
  });
});
