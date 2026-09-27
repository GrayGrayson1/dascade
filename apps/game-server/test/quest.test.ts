import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, Rng, WelcomePayload } from '@dascade/shared';
import type {
  QuestCheckpointPayload,
  QuestOutcomeView,
  QuestPrivatePayload,
  QuestResultView,
  QuestRollView,
  QuestSceneView,
} from '@dascade/shared/games/quest';
import { collect, freePort, quiet, sleep, waitFor } from './helpers.ts';
import { createDascadeServer } from '../src/server.ts';
import type { QuestRoom, QuestTiming } from '../src/rooms/quest/QuestRoom.ts';
import { onOutcome, type OutcomeContext } from '../src/platform/hub.ts';

process.env.DASCADE_QUEST_DEBUG = '1';

let colyseus: ColyseusTestServer;

/**
 * Boots on a free port. (The shared bootTestServer hands @colyseus/testing a Server
 * instance, which always binds the fixed port 2568 and collides with parallel runs.)
 */
async function bootQuestServer(): Promise<ColyseusTestServer> {
  const port = await freePort();
  const server = await createDascadeServer({ games: ['quest'] });
  await server.listen(port);
  return new ColyseusTestServer(server);
}

beforeAll(async () => {
  colyseus = await bootQuestServer();
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

const st = (room: SdkRoom) => room.state as any;
const scene = (room: SdkRoom): QuestSceneView | null => (st(room).sceneJson ? JSON.parse(st(room).sceneJson) : null);
const outcome = (room: SdkRoom): QuestOutcomeView | null => (st(room).outcomeJson ? JSON.parse(st(room).outcomeJson) : null);
const logText = (room: SdkRoom): string => [...st(room).log].map((l: { text: string }) => l.text).join('\n');

/** Server RNG whose d20 rolls are scripted; every other draw returns 0. */
function scriptedRng(naturals: number[]): Rng {
  const queue = [...naturals];
  return {
    int(n: number) {
      if (n === 20) return (queue.length ? queue.shift()! : 10) - 1;
      return 0;
    },
    next: () => 0,
  };
}

async function wire(room: SdkRoom) {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<{ code: string; type?: string; message: string }>(room, 'sys:error');
  const rolls = collect<QuestRollView>(room, 'quest:roll');
  const privates = collect<QuestPrivatePayload>(room, 'quest:private');
  const checkpoints = collect<QuestCheckpointPayload>(room, 'quest:checkpoint');
  const events = collect<{ kind: string }>(room, 'quest:event');
  quiet(room);
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, 'welcome');
  return { room, welcomes, errors, rolls, privates, checkpoints, events, me: () => welcomes[welcomes.length - 1]! };
}

type Client = Awaited<ReturnType<typeof wire>>;

const FAST: QuestTiming = { voteMsPerSecond: 1000, lockInMs: 60, soloLockInMs: 30, rollRevealMs: 80, tiebreakMs: 5000, pauseRecheckMs: 100 };

async function createQuest(name = 'Host', options: Record<string, unknown> = {}, timing: Partial<QuestTiming> = {}) {
  const room = await colyseus.sdk.create('quest', { name, ...options });
  const client = await wire(room);
  const server = colyseus.getRoomById(room.roomId) as unknown as QuestRoom;
  (server as any).countdownMs = 0;
  (server as any).timing = { ...FAST, ...timing };
  return { ...client, server };
}

async function join(code: string, name: string, extra: Record<string, unknown> = {}): Promise<Client> {
  const room = await colyseus.sdk.joinById(code, { name, ...extra });
  return wire(room);
}

async function pick(c: Client, archetype: string) {
  c.room.send('quest:hero', { archetype });
  await waitFor(() => st(c.room).heroes.get(c.me().playerId)?.archetype === archetype, 3000, `pick ${archetype}`);
}

async function start(host: Client) {
  host.room.send('lobby:start', {});
  await waitFor(() => st(host.room).phase === 'PLAYING' && st(host.room).stage === 'voting' && scene(host.room) !== null, 4000, 'first scene');
}

function vote(c: Client, choiceId: string | null) {
  c.room.send('quest:vote', { choiceId, rev: st(c.room).sceneRev });
}

async function nextScene(c: Client, nodeId: string, timeout = 4000) {
  await waitFor(() => scene(c.room)?.nodeId === nodeId && st(c.room).stage === 'voting', timeout, `scene ${nodeId}`);
}

describe('DASQuest lobby', () => {
  it('publishes the pack catalog and lets players pick heroes (duplicate rule enforced, spectators refused)', async () => {
    const host = await createQuest();
    const guest = await join(host.room.roomId, 'Bea');
    const watcher = await join(host.room.roomId, 'Wes', { spectator: true });
    const packs = JSON.parse(st(host.room).packsJson);
    expect(packs.map((p: { id: string }) => p.id)).toEqual(['glitch-beneath', 'missing-beans']);
    expect(st(host.room).packTitle).toBe('The Glitch Beneath Delta Alpha');

    await pick(host, 'tinker');
    host.room.send('lobby:settings', { settings: { allowDuplicates: false } });
    await waitFor(() => JSON.parse(st(host.room).settingsJson).allowDuplicates === false);
    guest.room.send('quest:hero', { archetype: 'tinker' });
    await waitFor(() => guest.errors.some((e) => e.type === 'quest:hero' && e.code === 'not_allowed'));
    await pick(guest, 'seer');
    watcher.room.send('quest:hero', { archetype: 'scout' });
    await waitFor(() => watcher.errors.some((e) => e.type === 'quest:hero' && e.code === 'not_allowed'));
    guest.room.send('quest:hero', { archetype: 'wizard' });
    await waitFor(() => guest.errors.some((e) => e.type === 'quest:hero' && e.code === 'invalid_payload'));
    expect(st(host.room).heroes.get(watcher.me().playerId)).toBeUndefined();
  });

  it('switches packs, rejects packs the server does not have, and blocks impossible unique parties', async () => {
    const host = await createQuest();
    host.room.send('lobby:settings', { settings: { pack: 'missing-beans' } });
    await waitFor(() => st(host.room).packId === 'missing-beans');
    host.room.send('lobby:settings', { settings: { pack: 'not-installed' } });
    await sleep(150);
    expect(JSON.parse(st(host.room).settingsJson).pack).toBe('missing-beans');
    host.room.send('lobby:settings', { settings: { voteSeconds: 5 } });
    await waitFor(() => host.errors.some((e) => e.code === 'invalid_payload'));
  });
});

describe('DASQuest voting', () => {
  it('only party members vote; double votes replace; a unanimous party resolves after lock-in', async () => {
    const host = await createQuest();
    const guest = await join(host.room.roomId, 'Bea');
    const watcher = await join(host.room.roomId, 'Wes', { spectator: true });
    await pick(host, 'guardian');
    await pick(guest, 'scout');
    await start(host);
    expect(scene(host.room)).toMatchObject({ nodeId: 'c1_start', chapter: 1, checkpoint: true });
    expect(st(host.room).heroes.get(guest.me().playerId)).toMatchObject({ archetype: 'scout', hp: 9, maxHp: 9 });
    expect(st(host.room).inventory.get('first_aid')).toBe(1);

    // Spectators can't vote; neither can someone who joins mid-match (queued spectator).
    vote(watcher, 'printer');
    await waitFor(() => watcher.errors.some((e) => e.type === 'quest:vote' && e.code === 'not_allowed'));
    const late = await join(host.room.roomId, 'Late');
    await waitFor(() => st(host.room).players.get(late.me().playerId) !== undefined);
    expect(st(host.room).players.get(late.me().playerId)).toMatchObject({ spectator: true, queued: true });
    vote(late, 'printer');
    await waitFor(() => late.errors.some((e) => e.type === 'quest:vote' && e.code === 'not_allowed'));

    // Invalid / stale / forged payloads.
    guest.room.send('quest:vote', { choiceId: 'teleport', rev: st(guest.room).sceneRev });
    await waitFor(() => guest.errors.some((e) => e.type === 'quest:vote' && e.code === 'not_allowed'));
    guest.room.send('quest:vote', { choiceId: 'printer', rev: st(guest.room).sceneRev - 1 });
    await waitFor(() => guest.errors.some((e) => e.type === 'quest:vote' && e.code === 'wrong_phase'));
    guest.room.send('quest:vote', { choiceId: 'printer', rev: st(guest.room).sceneRev, weight: 5 });
    await waitFor(() => guest.errors.some((e) => e.type === 'quest:vote' && e.code === 'invalid_payload'));

    // Changing a vote replaces it.
    vote(guest, 'coffee');
    await waitFor(() => st(host.room).votes.get(guest.me().playerId) === 'coffee');
    vote(guest, 'printer');
    await waitFor(() => st(host.room).votes.get(guest.me().playerId) === 'printer');
    expect([...st(host.room).votes.values()]).toEqual(['printer']);
    expect(st(host.room).stage).toBe('voting');

    vote(host, 'printer');
    await nextScene(host, 'c1_printer');
    expect(outcome(host.room)).toMatchObject({ choiceLabel: 'Follow the noise to the copy room', votes: 2, voters: 2, success: null });
    expect(st(host.room).votes.size).toBe(0);
    expect(logText(host.room)).toMatch(/The party chose “Follow the noise to the copy room” \(2\/2 votes\)/);
  });

  it('the vote timer resolves on its own, using the documented tie-break rule', async () => {
    const host = await createQuest('Host', {}, { voteMsPerSecond: 20 });
    const guest = await join(host.room.roomId, 'Bea');
    await pick(host, 'guardian');
    await pick(guest, 'scout');
    await start(host);
    const rev = st(host.room).sceneRev;
    // Nobody votes: after 45 × 20ms the auto rule picks among all choices.
    await waitFor(() => st(host.room).sceneRev > rev, 4000, 'timer resolution');
    expect(logText(host.room)).toMatch(/No votes were cast — decided by/);
    expect(st(host.room).turn).toBe(1);
  });

  it('a split vote with host tie-break waits for the host, and only the host can decide', async () => {
    const host = await createQuest();
    const a = await join(host.room.roomId, 'Ana');
    const b = await join(host.room.roomId, 'Ben');
    host.room.send('lobby:settings', { settings: { tieBreak: 'host' } });
    await waitFor(() => JSON.parse(st(host.room).settingsJson).tieBreak === 'host');
    await start(host);
    vote(a, 'printer');
    vote(b, 'coffee');
    await waitFor(() => st(host.room).votes.size === 2);
    a.room.send('quest:decide', {});
    await waitFor(() => a.errors.some((e) => e.type === 'quest:decide' && e.code === 'not_host'));
    host.room.send('quest:decide', {});
    await waitFor(() => st(host.room).stage === 'tiebreak');
    expect(JSON.parse(st(host.room).tieJson)).toEqual({ choiceIds: ['printer', 'coffee'], counts: 1 });
    a.room.send('quest:tiebreak', { choiceId: 'printer' });
    await waitFor(() => a.errors.some((e) => e.type === 'quest:tiebreak' && e.code === 'not_host'));
    host.room.send('quest:tiebreak', { choiceId: 'elevator' });
    await waitFor(() => host.errors.some((e) => e.type === 'quest:tiebreak' && e.code === 'not_allowed'));
    host.room.send('quest:tiebreak', { choiceId: 'coffee' });
    await nextScene(host, 'c1_coffee');
    expect(outcome(host.room)?.tieRule).toBe('Tie broken by the host');
    expect(logText(host.room)).toMatch(/Tie broken by the host/);
  });

  it("in auto mode a tie is broken by odds, then the leader's vote", async () => {
    const host = await createQuest();
    const guest = await join(host.room.roomId, 'Bea');
    await start(host);
    vote(host, 'coffee');
    vote(guest, 'it');
    // Both are no-check choices (equal odds), so the leader's (host's) vote decides.
    await nextScene(host, 'c1_coffee');
    expect(outcome(host.room)?.tieRule).toBe("Tie broken by the leader's vote");
  });
});

describe('DASQuest checks', () => {
  it('the server rolls every die — clients cannot choose outcomes', async () => {
    const host = await createQuest();
    const guest = await join(host.room.roomId, 'Bea');
    await pick(host, 'tinker');
    await pick(guest, 'scout');
    await start(host);
    vote(host, 'printer');
    vote(guest, 'printer');
    await nextScene(host, 'c1_printer');

    // A forged "I succeeded" payload is rejected outright.
    host.room.send('quest:vote', { choiceId: 'fix', rev: st(host.room).sceneRev, success: true, roll: 20 });
    await waitFor(() => host.errors.some((e) => e.type === 'quest:vote' && e.code === 'invalid_payload'));

    (host.server as any).rng = scriptedRng([1]);
    const tinkerId = host.me().playerId;
    vote(host, 'fix');
    vote(guest, 'fix');
    await waitFor(() => host.rolls.length === 1 && guest.rolls.length === 1, 4000, 'roll event');
    const roll = host.rolls[0]!;
    expect(roll).toMatchObject({ choiceId: 'fix', stat: 'WITS', dc: 11, success: false, crit: 'failure', needed: 1 });
    expect(roll.dice).toHaveLength(1);
    expect(roll.dice[0]).toMatchObject({ heroPlayerId: tinkerId, naturals: [1], kept: 1, modifier: 6, total: 7, success: false });
    expect(roll.dice[0]!.parts).toEqual([
      { label: 'WIT', value: 4 },
      { label: 'Jury-Rig', value: 2 },
    ]);
    expect(st(host.room).stage === 'rolling' || st(host.room).stage === 'voting').toBe(true);
    await nextScene(host, 'c1_printer_angry');
    // Failure: −2 HP, plus a critical fumble −1.
    expect(st(host.room).heroes.get(tinkerId).hp).toBe(8 - 3);
    expect(st(host.room).heroes.get(tinkerId).statuses).toContain('paper_cut:3');
    expect(outcome(host.room)).toMatchObject({ success: false, crit: 'failure' });
    expect(logText(host.room)).toMatch(/WITS check by Host \(1 \+ 6 = 7 vs DC 11\): FAILURE — FUMBLE!/);
  });

  it('heroes can use party items on each other while deciding', async () => {
    const host = await createQuest();
    const guest = await join(host.room.roomId, 'Bea');
    await pick(host, 'guardian');
    await pick(guest, 'analyst');
    await start(host);
    const run = (host.server as any).run;
    run.heroes[1].hp = 2;
    (host.server as any).syncRun();
    await waitFor(() => st(host.room).heroes.get(guest.me().playerId).hp === 2);
    host.room.send('quest:use', { itemId: 'first_aid', targetId: guest.me().playerId });
    await waitFor(() => st(host.room).heroes.get(guest.me().playerId).hp === 7);
    expect(st(host.room).inventory.has('first_aid')).toBe(false);
    expect(logText(host.room)).toMatch(/Host used First-Aid Kit on Bea/);
    host.room.send('quest:use', { itemId: 'first_aid', targetId: guest.me().playerId });
    await waitFor(() => host.errors.some((e) => e.type === 'quest:use' && e.code === 'not_allowed'));
    host.room.send('quest:use', { itemId: 'rubber_duck', targetId: guest.me().playerId });
    await waitFor(() => host.errors.filter((e) => e.type === 'quest:use').length === 2);
  });
});

describe('DASQuest private info & reconnects', () => {
  it('only Signal Seers receive omens, and a reconnect restores the scene and their omens', async () => {
    const host = await createQuest();
    const seer = await join(host.room.roomId, 'Sia');
    const watcher = await join(host.room.roomId, 'Wes', { spectator: true });
    await pick(host, 'guardian');
    await pick(seer, 'seer');
    await start(host);
    await waitFor(() => seer.privates.some((p) => p.omens.length > 0), 3000, 'seer omens');
    const rev = st(host.room).sceneRev;
    const omens = seer.privates.at(-1)!;
    expect(omens.rev).toBe(rev);
    expect(omens.omens.map((o) => o.choiceId)).toEqual(['printer', 'coffee', 'it', 'elevator']);
    expect(omens.omens.find((o) => o.choiceId === 'elevator')!.text).toMatch(/waiting/);
    expect(host.privates.every((p) => p.omens.length === 0)).toBe(true);
    expect(watcher.privates.every((p) => p.omens.length === 0)).toBe(true);

    const before = seer.privates.length;
    seer.room.reconnection.minUptime = 0;
    const reconnected = new Promise<void>((r) => seer.room.onReconnect(() => r()));
    (seer.room as any).connection.transport.ws.close(4010);
    await waitFor(() => st(host.room).players.get(seer.me().playerId)?.connected === false);
    await reconnected;
    await waitFor(() => seer.privates.length > before, 4000, 'omens re-sent');
    expect(seer.privates.at(-1)).toEqual(omens);
    expect(scene(seer.room)?.nodeId).toBe('c1_start');
    expect(st(seer.room).heroes.get(seer.me().playerId).archetype).toBe('seer');
  });

  it('a disconnected player is not waited for, and their vote does not count', async () => {
    const host = await createQuest();
    const guest = await join(host.room.roomId, 'Bea');
    await start(host);
    guest.room.reconnection.enabled = false;
    vote(guest, 'it');
    await waitFor(() => st(host.room).votes.size === 1);
    (guest.room as any).connection.transport.ws.close(4010);
    await waitFor(() => st(host.room).players.get(guest.me().playerId)?.connected === false);
    vote(host, 'coffee');
    await nextScene(host, 'c1_coffee');
    expect(outcome(host.room)).toMatchObject({ votes: 1, voters: 1 });
  });
});

describe('DASQuest solo & endings', () => {
  it('solo play runs from hero pick to an ending and the results screen', async () => {
    const solo = await createQuest('Solo', { solo: true });
    expect(st(solo.room).locked).toBe(true);
    await pick(solo, 'trickster');
    await start(solo);
    expect(st(solo.room).heroes.get(solo.me().playerId)).toMatchObject({ hp: 12, maxHp: 12 });
    vote(solo, 'elevator');
    await nextScene(solo, 'c1_elevator');
    vote(solo, 'lobby');
    await nextScene(solo, 'c1_lobby');
    vote(solo, 'home');
    await waitFor(() => st(solo.room).phase === 'RESULTS', 4000, 'results');
    const results = JSON.parse(st(solo.room).resultJson) as QuestResultView;
    expect(results).toMatchObject({ endingId: 'home', tier: 'comedic', title: 'Just Go Home', turns: 3, endingsTotal: 7 });
    expect(results.timeline.map((t) => t.choiceLabel)).toEqual(['Head straight for the elevators', 'Press L and go home', 'Go home. This is above your pay grade.']);
    expect(st(solo.room).stage).toBe('ended');
    // Play again returns to the lobby with the hero pick kept.
    solo.room.send('lobby:toLobby', {});
    await waitFor(() => st(solo.room).phase === 'LOBBY');
    expect(st(solo.room).heroes.get(solo.me().playerId).archetype).toBe('trickster');
    expect(st(solo.room).sceneJson).toBe('');
  });

  it('when every hero is knocked out the party lands on the defeat ending', async () => {
    const solo = await createQuest('Solo', { solo: true });
    await pick(solo, 'analyst');
    await start(solo);
    vote(solo, 'printer');
    await nextScene(solo, 'c1_printer');
    (solo.server as any).run.heroes[0].hp = 2;
    (solo.server as any).rng = scriptedRng([2]);
    vote(solo, 'fix');
    await waitFor(() => st(solo.room).phase === 'RESULTS', 4000, 'defeat');
    expect(JSON.parse(st(solo.room).resultJson)).toMatchObject({ endingId: 'all-hands', title: 'The 9 AM All-Hands' });
    expect(st(solo.room).heroes.get(solo.me().playerId)).toMatchObject({ ko: true, hp: 0 });
  });
});

describe('DASQuest DASCADE outcomes', () => {
  let outcomes: Array<{ outcome: GameOutcome; ctx: OutcomeContext }> = [];
  let stop: () => void = () => undefined;
  beforeEach(() => {
    outcomes = [];
    stop = onOutcome((outcome, ctx) => outcomes.push({ outcome, ctx }));
  });
  afterEach(() => stop());
  const forRoom = (code: string) => outcomes.filter((o) => o.ctx.roomCode === code);
  type Details = { ending: string; success: boolean; playerStats: Record<string, Record<string, number>> };

  it('a successful ending puts the whole party (including a hero whose player left) in one place', async () => {
    const host = await createQuest();
    const guest = await join(host.room.roomId, 'Bea');
    const leaver = await join(host.room.roomId, 'Lee');
    const leaverId = leaver.me().playerId;
    await start(host);
    await leaver.room.leave(true);
    await waitFor(() => st(host.room).heroes.get(leaverId)?.present === false, 3000, 'leaver gone');
    host.room.send('quest:debug', { endingId: 'player-two' });
    await waitFor(() => st(host.room).phase === 'RESULTS', 4000, 'results');

    const mine = forRoom(host.room.roomId);
    expect(mine).toHaveLength(1);
    const { outcome } = mine[0]!;
    const party = [host.me().playerId, guest.me().playerId, leaverId];
    expect(outcome.placements).toHaveLength(1);
    expect(outcome.placements[0]!.slice().sort()).toEqual(party.slice().sort());
    const score = (JSON.parse(st(host.room).resultJson) as QuestResultView).score;
    expect(outcome.scores).toEqual(Object.fromEntries(party.map((id) => [id, score])));
    expect(outcome.reason).toBe('quest_complete');
    const details = outcome.details as Details;
    expect(details).toMatchObject({ ending: 'player-two', success: true });
    for (const id of party) expect(details.playerStats[id]!.questsCompleted).toBe(1);
  });

  it('a failed ending still counts the game but no completed quest', async () => {
    const solo = await createQuest('Solo', { solo: true });
    await pick(solo, 'analyst');
    await start(solo);
    vote(solo, 'printer');
    await nextScene(solo, 'c1_printer');
    (solo.server as any).run.heroes[0].hp = 2;
    (solo.server as any).rng = scriptedRng([2]);
    vote(solo, 'fix');
    await waitFor(() => st(solo.room).phase === 'RESULTS', 4000, 'defeat');
    const mine = forRoom(solo.room.roomId);
    expect(mine).toHaveLength(1);
    const { outcome } = mine[0]!;
    expect(outcome.placements).toEqual([[solo.me().playerId]]);
    expect(outcome.reason).toBe('quest_failed');
    const details = outcome.details as Details;
    expect(details).toMatchObject({ ending: 'all-hands', success: false });
    expect(details.playerStats[solo.me().playerId]).toMatchObject({ questsCompleted: 0, checksPassed: 0 });
  });

  it('reports nothing for an adventure sent back to the lobby', async () => {
    const host = await createQuest();
    await join(host.room.roomId, 'Bea');
    await start(host);
    host.room.send('lobby:toLobby', {});
    await waitFor(() => st(host.room).phase === 'LOBBY', 3000, 'lobby');
    await sleep(80);
    expect(forRoom(host.room.roomId)).toHaveLength(0);
  });
});
