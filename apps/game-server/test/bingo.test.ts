import { isDeepStrictEqual } from 'node:util';
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, WelcomePayload } from '@dascade/shared';
import {
  BINGO_FREE,
  BINGO_MSG,
  type BingoCardPayload,
  type BingoClaimResultPayload,
  type BingoEvent,
  type BingoSettings,
} from '@dascade/shared/games/bingo';
import { boardSpec, cardKey, dealCards, isValidCard, verifyCard } from '@dascade/game-core/bingo';
import { bootTestServer, collect, sleep, waitFor, quiet } from './helpers.ts';
import type { BingoRoom } from '../src/rooms/bingo/BingoRoom.ts';
import { onOutcome, type OutcomeContext } from '../src/platform/hub.ts';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['bingo']));
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

interface Client {
  room: SdkRoom;
  me: () => WelcomePayload;
  errors: Array<{ code: string; type?: string; message: string }>;
  cards: BingoCardPayload[];
  results: BingoClaimResultPayload[];
  events: BingoEvent[];
  card: () => BingoCardPayload;
}

function wire(room: SdkRoom): Omit<Client, 'me'> & { welcomes: WelcomePayload[] } {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<{ code: string; type?: string; message: string }>(room, 'sys:error');
  const cards = collect<BingoCardPayload>(room, BINGO_MSG.card);
  const results = collect<BingoClaimResultPayload>(room, BINGO_MSG.claimResult);
  const events = collect<BingoEvent>(room, BINGO_MSG.event);
  quiet(room);
  return { room, welcomes, errors, cards, results, events, card: () => cards[cards.length - 1]! };
}

async function create(settings: Partial<BingoSettings> = {}, name = 'Host') {
  const room = await colyseus.sdk.create('bingo', { name });
  const w = wire(room);
  await room.waitForInitialState();
  await waitFor(() => w.welcomes.length > 0, 3000, 'welcome');
  const server = colyseus.getRoomById(room.roomId) as unknown as BingoRoom;
  (server as any).countdownMs = 30;
  if (Object.keys(settings).length) {
    room.send('lobby:settings', { settings });
    await waitFor(() => {
      const current = JSON.parse(st(room).settingsJson);
      return Object.entries(settings).every(([k, v]) => isDeepStrictEqual(current[k], v));
    }, 3000, 'settings applied');
  }
  return { ...w, server, me: () => w.welcomes[w.welcomes.length - 1]! };
}

async function join(code: string, name: string, extra: Record<string, unknown> = {}): Promise<Client> {
  const room = await colyseus.sdk.joinById(code, { name, ...extra });
  const w = wire(room);
  await room.waitForInitialState();
  await waitFor(() => w.welcomes.length > 0, 3000, 'welcome');
  return { ...w, me: () => w.welcomes[w.welcomes.length - 1]! };
}

const st = (room: SdkRoom) => room.state as any;
const calls = (room: SdkRoom): number[] => [...st(room).calls];

async function start(host: Client & { server: BingoRoom }, players: Client[] = []) {
  host.room.send('lobby:start', {});
  await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'PLAYING');
  for (const c of [host, ...players]) await waitFor(() => c.cards.length > 0, 3000, 'card');
}

const MANUAL: Partial<BingoSettings> = { callerMode: 'manual', manualPick: true, tieWindowMs: 250 };
const corners = (cells: number[], size: number) => [0, size - 1, size * (size - 1), size * size - 1].map((i) => cells[i]!);
const fourCorners = [{ prize: 'Corners', patterns: [{ type: 'preset' as const, id: 'four-corners' as const, rotate: false, mirror: false }] }];

async function hostCall(host: Client, value?: number) {
  const before = calls(host.room).length;
  for (let attempt = 0; attempt < 10; attempt++) {
    const limited = host.errors.filter((e) => e.code === 'rate_limited').length;
    host.room.send(BINGO_MSG.call, value === undefined ? {} : { value });
    await waitFor(
      () => calls(host.room).length === before + 1 || host.errors.filter((e) => e.code === 'rate_limited').length > limited,
      3000,
      `call ${value ?? 'random'}`,
    );
    if (calls(host.room).length === before + 1) return;
    await sleep(350);
  }
  throw new Error('host call kept being rate limited');
}

describe('DAS Bingo room', () => {
  it('deals every player a unique, valid, private card that nobody else receives', async () => {
    const host = await create({ ...MANUAL });
    const guest = await join(host.room.roomId, 'Guest');
    const spectator = await join(host.room.roomId, 'Watcher', { spectator: true });
    await start(host, [guest]);
    await sleep(150);

    const spec = boardSpec({ mode: 'numbers', size: 5, freeCenter: true, items: [] });
    expect(isValidCard(spec, host.card().cells)).toBe(true);
    expect(isValidCard(spec, guest.card().cells)).toBe(true);
    expect(cardKey(host.card().cells)).not.toBe(cardKey(guest.card().cells));
    // Each client only ever received its own card; spectators none.
    expect(host.cards.every((c) => cardKey(c.cells) === cardKey(host.card().cells))).toBe(true);
    expect(guest.cards.every((c) => cardKey(c.cells) === cardKey(guest.card().cells))).toBe(true);
    expect(spectator.cards).toHaveLength(0);
    // Public state never contains card cells.
    const json = JSON.stringify(st(spectator.room).toJSON());
    expect(json).not.toContain(guest.card().cells.join(','));
    expect(st(spectator.room).seed).toBe('');
    expect(st(host.room).bingo.get(guest.me().playerId).hasCard).toBe(true);
    expect(st(host.room).bingo.get(spectator.me().playerId)).toBeUndefined();
  });

  it('rejects a fake claim: marks never count, the claimant is benched and everyone hears about it', async () => {
    const host = await create({ ...MANUAL, falseClaimPenaltySec: 5 });
    const guest = await join(host.room.roomId, 'Faker');
    await start(host, [guest]);
    // Daub the entire card, then claim with nothing called.
    for (let cell = 0; cell < 25; cell++) guest.room.send(BINGO_MSG.mark, { cell, marked: true });
    await sleep(100);
    guest.room.send(BINGO_MSG.claim, {});
    await waitFor(() => guest.results.length === 1, 3000, 'claim result');
    expect(guest.results[0]).toMatchObject({ ok: false, reason: 'no_pattern' });
    expect(guest.results[0]!.lockedUntil).toBeGreaterThan(Date.now() + 3000);
    await waitFor(() => host.events.some((e) => e.kind === 'falseAlarm'), 3000, 'false alarm event');
    await waitFor(() => st(host.room).bingo.get(guest.me().playerId).falseClaims === 1, 3000, 'false claim counted');
    const view = st(host.room).bingo.get(guest.me().playerId);
    expect(view.falseClaims).toBe(1);
    expect(view.lockedUntil).toBeGreaterThan(Date.now());
    expect(st(host.room).winners.length).toBe(0);
    expect(st(host.room).roundStatus).toBe('calling');
    // Claiming again while benched doesn't add another false claim.
    guest.room.send(BINGO_MSG.claim, {});
    await waitFor(() => guest.results.length === 2, 3000, 'second result');
    expect(guest.results[1]).toMatchObject({ ok: false, reason: 'locked' });
    expect(st(host.room).bingo.get(guest.me().playerId).falseClaims).toBe(1);
  });

  it('a client cannot manufacture calls: only the host (or the auto caller) calls', async () => {
    const host = await create({ ...MANUAL });
    const guest = await join(host.room.roomId, 'Sneaky');
    await start(host, [guest]);
    guest.room.send(BINGO_MSG.call, { value: 7 });
    guest.room.send(BINGO_MSG.undo, {});
    await waitFor(() => guest.errors.filter((e) => e.code === 'not_host').length === 2, 3000, 'not_host');
    expect(calls(host.room)).toEqual([]);
    // Only real balls can be called.
    host.room.send(BINGO_MSG.call, { value: 76 });
    await waitFor(() => host.errors.some((e) => /isn’t a ball/.test(e.message)), 3000, 'not a ball');
    host.room.send(BINGO_MSG.call, { value: 9999 });
    await waitFor(() => host.errors.some((e) => e.code === 'invalid_payload'), 3000, 'invalid');
    await hostCall(host, 7);
    host.room.send(BINGO_MSG.call, { value: 7 });
    await waitFor(() => host.errors.some((e) => /already been called/.test(e.message)), 3000, 'duplicate call');
    expect(calls(host.room)).toEqual([7]);
  });

  it('a valid claim wins: the caller stops, the winning card + mask are revealed, results show the seed', async () => {
    const host = await create({ ...MANUAL, rounds: fourCorners });
    const guest = await join(host.room.roomId, 'Winner');
    await start(host, [guest]);
    const need = corners(guest.card().cells, 5);
    // Claiming one call early is a false alarm.
    for (const n of need.slice(0, 3)) await hostCall(host, n);
    await waitFor(() => st(host.room).bingo.get(guest.me().playerId).need === 1, 3000, 'need 1');
    await hostCall(host, need[3]);
    await waitFor(() => st(host.room).bingo.get(guest.me().playerId).need === 0, 3000, 'need 0');
    guest.room.send(BINGO_MSG.claim, {});
    await waitFor(() => guest.results.length === 1, 3000, 'result');
    expect(guest.results[0]).toMatchObject({ ok: true, patternName: 'Four corners', mask: '1000100000000000000010001' });
    await waitFor(() => st(host.room).phase === 'RESULTS', 3000, 'RESULTS');
    const winners = st(host.room).toJSON().winners;
    expect(winners).toHaveLength(1);
    expect(winners[0]).toMatchObject({ playerId: guest.me().playerId, name: 'Winner', round: 1, callCount: 4, patternName: 'Four corners', prize: 'Corners' });
    expect(winners[0].cells).toEqual(guest.card().cells);
    expect(st(host.room).players.get(guest.me().playerId).score).toBe(1);
    // The seed is revealed and reproduces the winning card.
    const seed = st(host.room).seed;
    expect(seed.length).toBeGreaterThan(5);
    const spec = boardSpec({ mode: 'numbers', size: 5, freeCenter: true, items: [] });
    expect(verifyCard(spec, seed, winners[0].deal, winners[0].serial, winners[0].cells)).toBe(true);
    // Late claims after the round are refused politely.
    host.room.send(BINGO_MSG.claim, {});
    await waitFor(() => host.results.length === 1, 3000, 'host result');
    expect(host.results[0]!.ok).toBe(false);
  });

  it('valid claims inside the tie window share the round', async () => {
    const items = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];
    const host = await create({
      ...MANUAL,
      tieWindowMs: 1500,
      mode: 'text',
      size: 3,
      items,
      rounds: [{ prize: '', patterns: [{ type: 'preset', id: 'blackout', rotate: false, mirror: false }] }],
    });
    const a = await join(host.room.roomId, 'Ann');
    const b = await join(host.room.roomId, 'Ben');
    await start(host, [a, b]);
    expect(host.card().cells[4]).toBe(BINGO_FREE);
    for (let i = 0; i < 8; i++) await hostCall(host);
    a.room.send(BINGO_MSG.claim, {});
    await waitFor(() => st(host.room).roundStatus === 'claiming', 3000, 'claiming');
    expect(st(host.room).claimWindowEndsAt).toBeGreaterThan(Date.now());
    b.room.send(BINGO_MSG.claim, {});
    await waitFor(() => st(host.room).winners.length === 2, 3000, 'two winners');
    // The caller is frozen while the window is open.
    await sleep(400); // let the host's call bucket refill after the 8 quick calls
    host.room.send(BINGO_MSG.call, {});
    await waitFor(() => host.errors.some((e) => /hang on/.test(e.message)), 3000, 'caller frozen');
    await waitFor(() => st(host.room).phase === 'RESULTS', 3000, 'RESULTS');
    const names = st(host.room).toJSON().winners.map((w: { name: string }) => w.name).sort();
    expect(names).toEqual(['Ann', 'Ben']);
    expect(a.events.some((e) => e.kind === 'winner' && e.shared)).toBe(true);
    // A claim after the window closed does not join the winners.
    host.room.send(BINGO_MSG.claim, {});
    await waitFor(() => host.results.length === 1, 3000, 'late');
    expect(st(host.room).winners.length).toBe(2);
  });

  it('undo: manual calls only, and never once a claim has been accepted', async () => {
    const host = await create({ callerMode: 'auto', callSeconds: 3, manualPick: true, tieWindowMs: 5000, rounds: fourCorners });
    const guest = await join(host.room.roomId, 'Guest');
    await start(host, [guest]);
    // The automatic caller makes the first call; it can't be undone.
    await waitFor(() => calls(host.room).length === 1, 4000, 'auto call');
    host.room.send(BINGO_MSG.callerMode, { mode: 'manual' });
    await waitFor(() => st(host.room).callerMode === 'manual', 3000, 'manual');
    expect(st(host.room).nextCallAt).toBe(0);
    expect(st(host.room).canUndo).toBe(false);
    host.room.send(BINGO_MSG.undo, {});
    await waitFor(() => host.errors.some((e) => /picked by hand/.test(e.message)), 3000, 'auto undo refused');

    // A manual call can be undone.
    const auto = calls(host.room)[0]!;
    const pick = [1, 2, 3, 4, 5].find((n) => n !== auto)!;
    await hostCall(host, pick);
    await waitFor(() => st(host.room).canUndo === true, 3000, 'canUndo');
    host.room.send(BINGO_MSG.undo, {});
    await waitFor(() => calls(host.room).length === 1, 3000, 'undone');
    expect(host.events.some((e) => e.kind === 'undo' && e.token === pick)).toBe(true);

    // Once the guest's BINGO is accepted, the calls it relies on are locked in.
    for (const n of corners(guest.card().cells, 5)) if (!calls(host.room).includes(n)) await hostCall(host, n);
    guest.room.send(BINGO_MSG.claim, {});
    await waitFor(() => st(host.room).roundStatus === 'claiming', 3000, 'claiming');
    expect(st(host.room).canUndo).toBe(false);
    host.room.send(BINGO_MSG.undo, {});
    await waitFor(() => host.errors.some((e) => /already been accepted/.test(e.message)), 3000, 'undo refused after claim');
  });

  it('pause, resume and speed control the automatic caller', async () => {
    const host = await create({ callerMode: 'auto', callSeconds: 3 });
    await start(host);
    expect(st(host.room).nextCallAt).toBeGreaterThan(Date.now());
    host.room.send(BINGO_MSG.pause, { paused: true });
    await waitFor(() => st(host.room).paused === true && st(host.room).nextCallAt === 0, 3000, 'paused');
    await sleep(2600);
    expect(calls(host.room)).toHaveLength(0);
    host.room.send(BINGO_MSG.speed, { seconds: 15 });
    await waitFor(() => st(host.room).callIntervalMs === 15000, 3000, 'speed');
    host.room.send(BINGO_MSG.speed, { seconds: 1 });
    await waitFor(() => host.errors.some((e) => e.code === 'invalid_payload'), 3000, 'speed bounds');
    host.room.send(BINGO_MSG.speed, { seconds: 3 });
    host.room.send(BINGO_MSG.pause, { paused: false });
    await waitFor(() => st(host.room).paused === false && st(host.room).nextCallAt > 0, 3000, 'resumed');
    await waitFor(() => calls(host.room).length === 1, 4500, 'call after resume');
  });

  it('progressive rounds: intermission, next round, carried calls and one-win-per-player', async () => {
    const host = await create({
      ...MANUAL,
      format: 'progressive',
      continueCalls: true,
      oneWinPerPlayer: true,
      intermissionSec: 3,
      rounds: [
        ...fourCorners,
        { prize: 'Line', patterns: [{ type: 'preset', id: 'any-row', rotate: false, mirror: false }] },
      ],
    });
    const guest = await join(host.room.roomId, 'Guest');
    const third = await join(host.room.roomId, 'Third');
    await start(host, [guest, third]);
    expect(st(host.room).totalRounds).toBe(2);
    expect(JSON.parse(st(host.room).planJson)).toHaveLength(2);
    for (const n of corners(guest.card().cells, 5)) await hostCall(host, n);
    guest.room.send(BINGO_MSG.claim, {});
    await waitFor(() => st(host.room).phase === 'INTERMISSION', 3000, 'INTERMISSION');
    expect(st(host.room).phaseEndsAt).toBeGreaterThan(Date.now());
    expect(host.events.some((e) => e.kind === 'roundOver' && e.round === 1)).toBe(true);
    host.room.send(BINGO_MSG.nextRound, {});
    await waitFor(() => st(host.room).phase === 'PLAYING' && st(host.room).round === 2, 3000, 'round 2');
    // continueCalls keeps the balls; cards are unchanged (no new deal).
    expect(calls(host.room)).toHaveLength(4);
    expect(st(host.room).deal).toBe(1);
    // Carried calls belong to an accepted result: they can't be undone.
    host.room.send(BINGO_MSG.undo, {});
    await waitFor(() => host.errors.some((e) => /accepted BINGO|Nothing to undo/.test(e.message)), 3000, 'carried undo refused');
    // The round-1 winner may not win again, even with a valid card.
    const rows = [third.card().cells.slice(0, 5), guest.card().cells.slice(0, 5)];
    for (const n of rows.flat()) if (n !== BINGO_FREE && !calls(host.room).includes(n)) await hostCall(host, n);
    guest.room.send(BINGO_MSG.claim, {});
    await waitFor(() => guest.results.length === 2, 3000, 'one-win result');
    expect(guest.results[1]).toMatchObject({ ok: false, reason: 'one_win' });
    third.room.send(BINGO_MSG.claim, {});
    await waitFor(() => st(host.room).phase === 'RESULTS', 3000, 'RESULTS');
    const winners = st(host.room).toJSON().winners;
    expect(winners.map((w: { round: number; name: string }) => `${w.round}:${w.name}`)).toEqual(['1:Guest', '2:Third']);
  });

  it('deals fresh cards each round when asked', async () => {
    const host = await create({ ...MANUAL, format: 'progressive', newCardsEachRound: true, intermissionSec: 3, rounds: [...fourCorners, ...fourCorners] });
    const guest = await join(host.room.roomId, 'Guest');
    await start(host, [guest]);
    const first = host.card();
    for (const n of corners(guest.card().cells, 5)) await hostCall(host, n);
    guest.room.send(BINGO_MSG.claim, {});
    await waitFor(() => st(host.room).phase === 'INTERMISSION', 3000, 'INTERMISSION');
    host.room.send(BINGO_MSG.nextRound, {});
    await waitFor(() => host.cards.length === 2, 3000, 'new card');
    await waitFor(() => st(host.room).round === 2 && calls(host.room).length === 0, 3000, 'fresh calls');
    expect(host.card().deal).toBe(2);
    expect(calls(host.room)).toHaveLength(0);
    expect(cardKey(host.card().cells)).not.toBe(cardKey(first.cells));
  });

  it('host can end the game early; results reveal the seed', async () => {
    const host = await create({ ...MANUAL });
    host.room.send(BINGO_MSG.setSeed, { seed: 'PARTY-2026' });
    await waitFor(() => st(host.room).customSeed === true, 3000, 'seed set');
    await start(host);
    await hostCall(host);
    host.room.send(BINGO_MSG.endGame, {});
    await waitFor(() => st(host.room).phase === 'RESULTS', 3000, 'RESULTS');
    expect(st(host.room).seed).toBe('PARTY-2026');
    const spec = boardSpec({ mode: 'numbers', size: 5, freeCenter: true, items: [] });
    expect(verifyCard(spec, 'PARTY-2026', 1, host.card().serial, host.card().cells)).toBe(true);
    host.room.send('lobby:toLobby', {});
    await waitFor(() => st(host.room).phase === 'LOBBY', 3000, 'LOBBY');
    expect(st(host.room).calls.length).toBe(0);
    expect(st(host.room).winners.length).toBe(0);
    expect(st(host.room).seed).toBe('');
  });

  it('a fixed card seed stays with the host: other players cannot work out anyone’s card from public state', async () => {
    const host = await create({ ...MANUAL });
    const guest = await join(host.room.roomId, 'Snoop');
    const seeds = collect<{ seed: string }>(guest.room, BINGO_MSG.seed);
    const hostSeeds = collect<{ seed: string }>(host.room, BINGO_MSG.seed);
    // The old public path (settings) no longer carries a seed at all.
    host.room.send('lobby:settings', { settings: { seed: 'PARTY-2026' } });
    host.room.send(BINGO_MSG.setSeed, { seed: 'PARTY-2026' });
    guest.room.send(BINGO_MSG.setSeed, { seed: 'GUEST-OVERRIDE' });
    await waitFor(() => st(guest.room).customSeed === true, 3000, 'custom seed flag');
    await waitFor(() => hostSeeds.some((s) => s.seed === 'PARTY-2026'), 3000, 'host sees its seed');
    await waitFor(() => guest.errors.some((e) => e.code === 'not_host'), 3000, 'guest refused');
    await start(host, [guest]);
    await sleep(100);
    // Nothing public (settings or state) mentions the seed before results, and the guest never receives it.
    expect(JSON.stringify(st(guest.room).toJSON())).not.toContain('PARTY-2026');
    expect(seeds).toHaveLength(0);
    // Any seed a snoop could read from settings doesn't reproduce the host's card.
    const spec = boardSpec({ mode: 'numbers', size: 5, freeCenter: true, items: [] });
    const published = String(JSON.parse(st(guest.room).settingsJson).seed ?? '');
    if (published) expect(dealCards(spec, published, 1, 2).map(cardKey)).not.toContain(cardKey(host.card().cells));
    // Reproducibility still holds: the fixed seed deals the same cards, and results reveal it.
    expect(dealCards(spec, 'PARTY-2026', 1, 2).map(cardKey)).toEqual([cardKey(host.card().cells), cardKey(guest.card().cells)]);
    host.room.send(BINGO_MSG.endGame, {});
    await waitFor(() => st(guest.room).phase === 'RESULTS', 3000, 'RESULTS');
    expect(st(guest.room).seed).toBe('PARTY-2026');
    // Back in the lobby the host keeps the seed (private) for the next game, and can clear it.
    host.room.send('lobby:toLobby', {});
    await waitFor(() => st(host.room).phase === 'LOBBY', 3000, 'LOBBY');
    expect(st(guest.room).seed).toBe('');
    expect(st(guest.room).customSeed).toBe(true);
    host.room.send(BINGO_MSG.setSeed, { seed: '' });
    await waitFor(() => st(guest.room).customSeed === false, 3000, 'seed cleared');
    expect(seeds).toHaveLength(0);
  });

  it('mid-match host changes never send the seed value, even back to the host who typed it', async () => {
    const host = await create({ ...MANUAL });
    const heir = await join(host.room.roomId, 'Heir');
    const hostSeeds = collect<{ seed: string; hidden: boolean }>(host.room, BINGO_MSG.seed);
    const heirSeeds = collect<{ seed: string; hidden: boolean }>(heir.room, BINGO_MSG.seed);
    host.room.send(BINGO_MSG.setSeed, { seed: 'SECRET-SEED' });
    await waitFor(() => hostSeeds.some((s) => s.seed === 'SECRET-SEED'), 3000, 'host sees its seed in the lobby');
    await start(host, [heir]);
    const before = hostSeeds.length;
    host.room.send('lobby:transferHost', { playerId: heir.me().playerId });
    await waitFor(() => heirSeeds.length > 0, 3000, 'heir told about the seed');
    heir.room.send('lobby:transferHost', { playerId: host.me().playerId });
    await waitFor(() => hostSeeds.length > before, 3000, 'host told again');
    expect(heirSeeds.every((s) => s.seed === '' && s.hidden)).toBe(true);
    expect(hostSeeds.slice(before).every((s) => s.seed === '' && s.hidden)).toBe(true);
    // Once the match is over the original host may see it again.
    host.room.send(BINGO_MSG.endGame, {});
    await waitFor(() => st(host.room).phase === 'RESULTS', 3000, 'RESULTS');
    host.room.send('lobby:toLobby', {});
    await waitFor(() => st(host.room).phase === 'LOBBY', 3000, 'LOBBY');
    host.room.send('lobby:transferHost', { playerId: heir.me().playerId });
    await waitFor(() => st(host.room).hostId === heir.me().playerId, 3000, 'heir host');
    heir.room.send('lobby:transferHost', { playerId: host.me().playerId });
    await waitFor(() => hostSeeds.at(-1)?.seed === 'SECRET-SEED', 3000, 'seed back in the lobby');
  });

  it('a new host is told a fixed seed is set but never sees its value', async () => {
    const host = await create({ ...MANUAL });
    const heir = await join(host.room.roomId, 'Heir');
    const heirSeeds = collect<{ seed: string; hidden: boolean }>(heir.room, BINGO_MSG.seed);
    host.room.send(BINGO_MSG.setSeed, { seed: 'SECRET-1' });
    await waitFor(() => st(heir.room).customSeed === true, 3000, 'seed set');
    await host.room.leave(true);
    await waitFor(() => st(heir.room).hostId === heir.me().playerId, 3000, 'host migrated');
    await waitFor(() => heirSeeds.length > 0, 3000, 'seed status');
    expect(heirSeeds.every((p) => p.seed === '')).toBe(true);
    expect(heirSeeds[heirSeeds.length - 1]).toEqual({ seed: '', hidden: true });
    // The new host can replace it; they then see their own value.
    heir.room.send(BINGO_MSG.setSeed, { seed: 'MINE' });
    await waitFor(() => heirSeeds.some((p) => p.seed === 'MINE' && !p.hidden), 3000, 'own seed');
  });

  it('blocks starting a text game without enough items', async () => {
    const host = await create({ mode: 'text', size: 4, items: ['one', 'two', 'three'] });
    host.room.send('lobby:start', {});
    await waitFor(() => host.errors.some((e) => /Add 13 more items/.test(e.message)), 3000, 'start blocked');
    expect(st(host.room).phase).toBe('LOBBY');
    host.room.send('lobby:settings', { settings: { size: 12 } });
    await waitFor(() => host.errors.some((e) => e.code === 'invalid_payload'), 3000, 'invalid size');
  });

  it('restores the card and daubs when a player reclaims their seat', async () => {
    const host = await create({ ...MANUAL, autoMark: false });
    const guest = await join(host.room.roomId, 'Dauber');
    await start(host, [guest]);
    guest.room.send(BINGO_MSG.mark, { cell: 0, marked: true });
    guest.room.send(BINGO_MSG.mark, { cell: 6, marked: true });
    guest.room.send(BINGO_MSG.mark, { cell: 6, marked: false });
    guest.room.send(BINGO_MSG.mark, { cell: 12, marked: true }); // the free square is ignored
    guest.room.send(BINGO_MSG.mark, { cell: 24, marked: true });
    await sleep(150);
    const again = await join(host.room.roomId, 'Dauber', { seatToken: guest.me().seatToken });
    await waitFor(() => again.cards.length > 0, 3000, 'card restored');
    expect(again.me().playerId).toBe(guest.me().playerId);
    expect(again.card().cells).toEqual(guest.card().cells);
    expect([...again.card().marks].sort((x, y) => x - y)).toEqual([0, 24]);
  });

  it('late joiners are dealt in immediately', async () => {
    const host = await create({ ...MANUAL });
    await start(host);
    await hostCall(host);
    const late = await join(host.room.roomId, 'Latecomer');
    await waitFor(() => late.cards.length > 0, 3000, 'late card');
    expect(late.card().serial).toBe(2);
    expect(cardKey(late.card().cells)).not.toBe(cardKey(host.card().cells));
    await waitFor(() => st(host.room).bingo.get(late.me().playerId)?.need >= 0, 3000, 'need computed');
  });

  it('leaving and rejoining mid-round cannot reroll into an instant win: calls made before a card was dealt do not count on it', async () => {
    const items = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];
    const host = await create({
      ...MANUAL,
      mode: 'text',
      size: 3,
      items,
      rounds: [{ prize: '', patterns: [{ type: 'preset', id: 'any-line', rotate: false, mirror: false }] }],
    });
    const guest = await join(host.room.roomId, 'Reroller');
    await start(host, [guest]);
    // Every item is called: every card dealt at the start now has a line (but nobody claimed yet).
    for (let i = 0; i < 8; i++) await hostCall(host);
    await guest.room.leave(true);
    // Rejoin as a brand-new player: a fresh card is dealt mid-round...
    const again = await join(host.room.roomId, 'Reroller');
    await waitFor(() => again.cards.length > 0, 3000, 'fresh card');
    // ...but the calls made before it was dealt don't count, so the claim is a false alarm.
    again.room.send(BINGO_MSG.claim, {});
    await waitFor(() => again.results.length === 1, 3000, 'claim result');
    expect(again.results[0]).toMatchObject({ ok: false, reason: 'no_pattern' });
    expect(st(host.room).winners.length).toBe(0);
    expect(st(host.room).roundStatus).toBe('calling');
    expect(again.card().fromCall).toBe(8);
    await waitFor(() => st(host.room).bingo.get(again.me().playerId)?.need === 2, 3000, 'late card needs a whole line');
  });

  it('a player joining during the tie window cannot share the round with a card dealt after the fact', async () => {
    const items = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];
    const host = await create({
      ...MANUAL,
      tieWindowMs: 2000,
      mode: 'text',
      size: 3,
      items,
      rounds: [{ prize: '', patterns: [{ type: 'preset', id: 'blackout', rotate: false, mirror: false }] }],
    });
    await start(host);
    for (let i = 0; i < 8; i++) await hostCall(host);
    host.room.send(BINGO_MSG.claim, {});
    await waitFor(() => st(host.room).roundStatus === 'claiming', 3000, 'claiming');
    const late = await join(host.room.roomId, 'Sniper');
    await waitFor(() => late.cards.length > 0, 3000, 'late card');
    late.room.send(BINGO_MSG.claim, {});
    await waitFor(() => late.results.length === 1, 3000, 'late result');
    expect(late.results[0]!.ok).toBe(false);
    await waitFor(() => st(host.room).phase === 'RESULTS', 4000, 'RESULTS');
    expect(st(host.room).toJSON().winners.map((w: { name: string }) => w.name)).toEqual(['Host']);
  });

  it('a late card follows the call list: an undo moves its starting point back', async () => {
    const host = await create({ ...MANUAL });
    await start(host);
    await hostCall(host, 1);
    await hostCall(host, 2);
    await hostCall(host, 3);
    const late = await join(host.room.roomId, 'Late');
    await waitFor(() => late.cards.length > 0, 3000, 'late card');
    expect(late.card().fromCall).toBe(3);
    await waitFor(() => st(host.room).canUndo === true, 3000, 'canUndo');
    host.room.send(BINGO_MSG.undo, {});
    await waitFor(() => calls(host.room).length === 2, 3000, 'undone');
    // The next ball is called after the late player joined, so it must count on their card.
    await waitFor(() => late.card().fromCall === 2, 3000, 'fromCall clamped');
  });

  it('a late card counts every call once the next round clears the calls', async () => {
    const host = await create({ ...MANUAL, format: 'progressive', intermissionSec: 3, rounds: [...fourCorners, ...fourCorners] });
    const guest = await join(host.room.roomId, 'Guest');
    await start(host, [guest]);
    const need = corners(guest.card().cells, 5);
    await hostCall(host, need[0]);
    const late = await join(host.room.roomId, 'Late');
    await waitFor(() => late.cards.length > 0, 3000, 'late card');
    expect(late.card().fromCall).toBe(1);
    for (const n of need.slice(1)) await hostCall(host, n);
    guest.room.send(BINGO_MSG.claim, {});
    await waitFor(() => st(host.room).phase === 'INTERMISSION', 3000, 'INTERMISSION');
    host.room.send(BINGO_MSG.nextRound, {});
    await waitFor(() => st(host.room).round === 2 && calls(host.room).length === 0, 3000, 'round 2');
    await waitFor(() => late.card().fromCall === 0, 3000, 'fromCall reset');
    expect(late.card().deal).toBe(1);
  });

  it('the host cannot hand-pick their own way to a win: a player who picked calls this round cannot claim it', async () => {
    const host = await create({ ...MANUAL, rounds: fourCorners });
    const guest = await join(host.room.roomId, 'Guest');
    await start(host, [guest]);
    for (const n of corners(host.card().cells, 5)) await hostCall(host, n);
    host.room.send(BINGO_MSG.claim, {});
    await waitFor(() => host.results.length === 1, 3000, 'host result');
    expect(host.results[0]).toMatchObject({ ok: false, reason: 'caller' });
    // Not a false alarm: the host isn't benched or counted, and the round goes on.
    expect(st(host.room).bingo.get(host.me().playerId).falseClaims).toBe(0);
    expect(st(host.room).winners.length).toBe(0);
    expect(st(host.room).roundStatus).toBe('calling');
  });

  it('undo only takes back hand-picked balls; random draws are final (no re-drawing until a ball suits you)', async () => {
    const host = await create({ ...MANUAL });
    await start(host);
    await hostCall(host); // random draw by the manual caller
    expect(st(host.room).canUndo).toBe(false);
    host.room.send(BINGO_MSG.undo, {});
    await waitFor(() => host.errors.some((e) => /picked by hand/.test(e.message)), 3000, 'random undo refused');
    expect(calls(host.room)).toHaveLength(1);
    const pick = [1, 2, 3].find((n) => n !== calls(host.room)[0])!;
    await hostCall(host, pick);
    await waitFor(() => st(host.room).canUndo === true, 3000, 'canUndo');
    host.room.send(BINGO_MSG.undo, {});
    await waitFor(() => calls(host.room).length === 1, 3000, 'undone');
  });

  it('the automatic caller keeps going when the host leaves, and the new host has the controls', async () => {
    const host = await create({ callerMode: 'auto', callSeconds: 3 });
    const guest = await join(host.room.roomId, 'Heir');
    await start(host, [guest]);
    await host.room.leave(true);
    await waitFor(() => st(guest.room).hostId === guest.me().playerId, 3000, 'host migrated');
    await waitFor(() => calls(guest.room).length >= 1, 6000, 'auto call after host left');
    guest.room.send(BINGO_MSG.pause, { paused: true });
    await waitFor(() => st(guest.room).paused === true && st(guest.room).nextCallAt === 0, 3000, 'new host paused');
    guest.room.send(BINGO_MSG.endGame, {});
    await waitFor(() => st(guest.room).phase === 'RESULTS', 3000, 'RESULTS');
    expect(st(guest.room).seed.length).toBeGreaterThan(5);
  });

  it('30 simulated players join, each with a unique card, and a claim still resolves', async () => {
    const host = await create({ ...MANUAL, rounds: fourCorners });
    const guests: Client[] = [];
    for (let i = 0; i < 29; i++) guests.push(await join(host.room.roomId, `Bot ${i + 1}`));
    await start(host, guests);
    const everyone = [host, ...guests];
    const keys = new Set(everyone.map((c) => cardKey(c.card().cells)));
    expect(keys.size).toBe(30);
    const serials = new Set(everyone.map((c) => c.card().serial));
    expect(serials.size).toBe(30);
    for (const c of everyone) expect(c.cards.every((k) => cardKey(k.cells) === cardKey(c.card().cells))).toBe(true);
    const target = guests[17]!;
    for (const n of corners(target.card().cells, 5)) await hostCall(host, n);
    target.room.send(BINGO_MSG.claim, {});
    await waitFor(() => st(host.room).phase === 'RESULTS', 5000, 'RESULTS');
    expect(st(host.room).toJSON().winners.some((w: { name: string }) => w.name === 'Bot 18')).toBe(true);
    await Promise.all(everyone.map((c) => c.room.leave(true)));
  });
});

describe('DAS Bingo room: DASCADE outcomes', () => {
  let outcomes: Array<{ outcome: GameOutcome; ctx: OutcomeContext }> = [];
  let stop: () => void = () => undefined;
  beforeEach(() => {
    outcomes = [];
    stop = onOutcome((outcome, ctx) => outcomes.push({ outcome, ctx }));
  });
  afterEach(() => stop());
  const forRoom = (code: string) => outcomes.filter((o) => o.ctx.roomCode === code);
  type Extras = { playerStats: Record<string, Record<string, number>> };

  it('puts the bingo winner first and everyone else (a leaver included) second, with bingo counts', async () => {
    const host = await create({ ...MANUAL, rounds: fourCorners });
    const guest = await join(host.room.roomId, 'Winner');
    const leaver = await join(host.room.roomId, 'Leaver');
    const leaverId = leaver.me().playerId;
    await start(host, [guest, leaver]);
    await leaver.room.leave(true);
    await waitFor(() => !st(host.room).players.has(leaverId), 3000, 'leaver gone');
    for (const n of corners(guest.card().cells, 5)) await hostCall(host, n);
    guest.room.send(BINGO_MSG.claim, {});
    await waitFor(() => st(host.room).phase === 'RESULTS', 3000, 'RESULTS');
    const mine = forRoom(host.room.roomId);
    expect(mine).toHaveLength(1);
    const { outcome } = mine[0]!;
    expect(outcome.placements).toEqual([[guest.me().playerId], [host.me().playerId, leaverId]]);
    expect(outcome.reason).toBe('bingo');
    expect(outcome.scores).toBeUndefined();
    expect((outcome.details as Extras).playerStats).toEqual({
      [guest.me().playerId]: { bingos: 1 },
      [host.me().playerId]: { bingos: 0 },
      [leaverId]: { bingos: 0 },
    });
  });

  it('players sharing a round share first place', async () => {
    const items = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];
    const host = await create({
      ...MANUAL,
      tieWindowMs: 600,
      mode: 'text',
      size: 3,
      items,
      rounds: [{ prize: '', patterns: [{ type: 'preset', id: 'blackout', rotate: false, mirror: false }] }],
    });
    const a = await join(host.room.roomId, 'Ann');
    const b = await join(host.room.roomId, 'Ben');
    await start(host, [a, b]);
    for (let i = 0; i < 8; i++) await hostCall(host);
    a.room.send(BINGO_MSG.claim, {});
    b.room.send(BINGO_MSG.claim, {});
    await waitFor(() => st(host.room).phase === 'RESULTS', 3000, 'RESULTS');
    const [only] = forRoom(host.room.roomId);
    expect(only!.outcome.placements[0]!.slice().sort()).toEqual([a.me().playerId, b.me().playerId].sort());
    // The host never claimed, so they are the only one in second place.
    expect(only!.outcome.placements[1]).toEqual([host.me().playerId]);
  });

  it('a game nobody won is a draw; ending before any ball or going back to the lobby reports nothing', async () => {
    const played = await create({ ...MANUAL });
    const guest = await join(played.room.roomId, 'Guest');
    await start(played, [guest]);
    await hostCall(played);
    played.room.send(BINGO_MSG.endGame, {});
    await waitFor(() => st(played.room).phase === 'RESULTS', 3000, 'RESULTS');
    const [draw] = forRoom(played.room.roomId);
    expect(draw!.outcome.placements).toEqual([[played.me().playerId, guest.me().playerId]]);
    expect(draw!.outcome.reason).toBe('no_winner');

    const early = await create({ ...MANUAL });
    await join(early.room.roomId, 'Guest');
    await start(early);
    early.room.send(BINGO_MSG.endGame, {});
    await waitFor(() => st(early.room).phase === 'RESULTS', 3000, 'RESULTS');

    const lobby = await create({ ...MANUAL });
    await join(lobby.room.roomId, 'Guest');
    await start(lobby);
    await hostCall(lobby);
    lobby.room.send('lobby:toLobby', {});
    await waitFor(() => st(lobby.room).phase === 'LOBBY', 3000, 'LOBBY');
    await sleep(80);
    expect(forRoom(early.room.roomId)).toHaveLength(0);
    expect(forRoom(lobby.room.roomId)).toHaveLength(0);
    expect(forRoom(played.room.roomId)).toHaveLength(1);
  });
});
