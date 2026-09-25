/**
 * DASQuest adversarial / robustness tests: tie-break stalls, the debug hook gate,
 * saves on a production server without a secret, and replay hygiene.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { WelcomePayload } from '@dascade/shared';
import type { QuestCheckpointPayload, QuestSaveInfo, QuestSceneView } from '@dascade/shared/games/quest';
import { collect, freePort, quiet, sleep, waitFor } from './helpers.ts';
import { createDascadeServer } from '../src/server.ts';
import { questDebugEnabled } from '../src/rooms/quest/debug.ts';
import { SAVES_DISABLED_MESSAGE, resolveSaveKey, signSave, verifySave, warnAboutSaveKey } from '../src/rooms/quest/saves.ts';
import type { QuestRoom, QuestTiming } from '../src/rooms/quest/QuestRoom.ts';

process.env.DASCADE_QUEST_DEBUG = '1';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  const port = await freePort();
  const server = await createDascadeServer({ games: ['quest'] });
  await server.listen(port);
  colyseus = new ColyseusTestServer(server);
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

const st = (room: SdkRoom) => room.state as any;
const scene = (room: SdkRoom): QuestSceneView | null => (st(room).sceneJson ? JSON.parse(st(room).sceneJson) : null);
const logText = (room: SdkRoom): string => [...st(room).log].map((l: { text: string }) => l.text).join('\n');

async function wire(room: SdkRoom) {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<{ code: string; type?: string; message: string }>(room, 'sys:error');
  const checkpoints = collect<QuestCheckpointPayload>(room, 'quest:checkpoint');
  quiet(room);
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, 'welcome');
  return { room, errors, checkpoints, me: () => welcomes[welcomes.length - 1]! };
}
type Client = Awaited<ReturnType<typeof wire>>;

const FAST: QuestTiming = { voteMsPerSecond: 1000, lockInMs: 60, soloLockInMs: 30, rollRevealMs: 60, tiebreakMs: 5000, pauseRecheckMs: 100 };

async function createQuest(name = 'Host', timing: Partial<QuestTiming> = {}) {
  const room = await colyseus.sdk.create('quest', { name });
  const client = await wire(room);
  const server = colyseus.getRoomById(room.roomId) as unknown as QuestRoom;
  (server as any).countdownMs = 0;
  (server as any).timing = { ...FAST, ...timing };
  return { ...client, server };
}

async function join(code: string, name: string): Promise<Client> {
  return wire(await colyseus.sdk.joinById(code, { name }));
}

async function start(host: Client) {
  host.room.send('lobby:start', {});
  await waitFor(() => st(host.room).phase === 'PLAYING' && st(host.room).stage === 'voting' && scene(host.room) !== null, 4000, 'first scene');
}

function vote(c: Client, choiceId: string | null) {
  c.room.send('quest:vote', { choiceId, rev: st(c.room).sceneRev });
}

/** Temporarily run the server process with a different environment. */
async function withEnv<T>(patch: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(patch)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Three-player party standing in front of the fridge (c3_fridge) holding one Energy Bar. */
async function fridgeWithEnergyBar(timing: Partial<QuestTiming> = {}) {
  const host = await createQuest('Host', timing);
  const ava = await join(host.room.roomId, 'Ava');
  const ben = await join(host.room.roomId, 'Ben');
  host.room.send('lobby:settings', { settings: { tieBreak: 'host' } });
  await waitFor(() => JSON.parse(st(host.room).settingsJson).tieBreak === 'host');
  await start(host);
  host.room.send('quest:debug', { nodeId: 'c3_fridge' });
  await waitFor(() => scene(host.room)?.nodeId === 'c3_fridge' && st(host.room).stage === 'voting', 3000, 'fridge');
  // As if the party had bought one at the vending machine.
  const server = host.server as any;
  server.run.inventory.energy_bar = 1;
  server.syncRun();
  server.rerenderScene();
  await waitFor(() => scene(host.room)?.choices.find((c) => c.id === 'feed')?.available === true, 3000, 'feed option');
  // Split vote, the host abstains and calls it: host-mode tie → the host must pick.
  vote(ava, 'feed');
  vote(ben, 'slam');
  await waitFor(() => st(host.room).votes.size === 2);
  host.room.send('quest:decide', {});
  await waitFor(() => st(host.room).stage === 'tiebreak', 3000, 'tie-break');
  expect(JSON.parse(st(host.room).tieJson).choiceIds.sort()).toEqual(['feed', 'slam']);
  return { host, ava, ben };
}

describe('DASQuest tie-breaks never stall', () => {
  it('an item used mid-tie-break that removes a tied option re-opens the vote (with a timer)', async () => {
    const { host, ava, ben } = await fridgeWithEnergyBar();
    // Ava eats the bar while the host is deciding: "Feed it an Energy Bar" is no longer possible.
    ava.room.send('quest:use', { itemId: 'energy_bar', targetId: ava.me().playerId });
    await waitFor(() => !(st(host.room).inventory.get('energy_bar') > 0), 3000, 'bar eaten');
    // The host clicks the (now impossible) option they were looking at.
    host.room.send('quest:tiebreak', { choiceId: 'feed' });
    await waitFor(() => st(host.room).stage === 'voting' && st(host.room).phaseEndsAt > 0, 3000, 'vote re-opened');
    expect(st(host.room).tieJson).toBe('');
    expect(scene(host.room)?.choices.find((c) => c.id === 'feed')?.available).toBe(false);
    // Ava's vote for the vanished option was dropped; Ben's still stands.
    expect(st(host.room).votes.has(ava.me().playerId)).toBe(false);
    expect(st(host.room).votes.get(ben.me().playerId)).toBe('slam');
    expect(logText(host.room)).toMatch(/vote again/);
    // …and the party can carry on.
    vote(host, 'label');
    vote(ava, 'label');
    await waitFor(() => scene(host.room)?.nodeId !== 'c3_fridge' || st(host.room).stage === 'rolling', 4000, 'scene resolved');
  });

  it('the tie-break timeout re-opens the vote if a tied option vanished by any other route', async () => {
    const { host } = await fridgeWithEnergyBar({ tiebreakMs: 300 });
    // Not via quest:use: the inventory changes under the pending tie (defensive path).
    const server = host.server as any;
    delete server.run.inventory.energy_bar;
    server.syncRun();
    // Auto rule would pick "feed" (a sure thing beats a check) — which is no longer possible.
    await waitFor(() => st(host.room).stage === 'voting' && st(host.room).phaseEndsAt > 0, 3000, 'vote re-opened after timeout');
    expect(st(host.room).tieJson).toBe('');
  });
});

describe('DASQuest debug hook', () => {
  it('needs NODE_ENV development/test AND DASCADE_QUEST_DEBUG=1 on the server', () => {
    expect(questDebugEnabled({ NODE_ENV: 'development', DASCADE_QUEST_DEBUG: '1' })).toBe(true);
    expect(questDebugEnabled({ NODE_ENV: 'test', DASCADE_QUEST_DEBUG: '1' })).toBe(true);
    expect(questDebugEnabled({ NODE_ENV: 'production', DASCADE_QUEST_DEBUG: '1' })).toBe(false);
    expect(questDebugEnabled({ DASCADE_QUEST_DEBUG: '1' })).toBe(false); // NODE_ENV unset ≙ production
    expect(questDebugEnabled({ NODE_ENV: 'staging', DASCADE_QUEST_DEBUG: '1' })).toBe(false);
    expect(questDebugEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(questDebugEnabled({ NODE_ENV: 'development', DASCADE_QUEST_DEBUG: 'true' })).toBe(false);
  });

  it('a production server refuses scene jumps whatever the client sends', async () => {
    const host = await createQuest();
    await start(host);
    const nodeId = scene(host.room)!.nodeId;
    for (const env of [{ NODE_ENV: 'production' }, { NODE_ENV: undefined }]) {
      await withEnv(env, async () => {
        const before = host.errors.length;
        host.room.send('quest:debug', { endingId: 'home' });
        host.room.send('quest:debug', { nodeId: 'c3_fridge' });
        await waitFor(() => host.errors.filter((e) => e.type === 'quest:debug' && e.code === 'not_allowed').length >= before + 2, 3000, 'refused');
      });
    }
    // Payload tricks can't opt in either (strict schema).
    host.room.send('quest:debug', { nodeId: 'c3_fridge', enable: true, NODE_ENV: 'development' });
    await waitFor(() => host.errors.some((e) => e.type === 'quest:debug' && e.code === 'invalid_payload'), 3000, 'strict payload');
    await sleep(100);
    expect(scene(host.room)?.nodeId).toBe(nodeId);
    expect(st(host.room).phase).toBe('PLAYING');
  });
});

describe('DASQuest saves without a production secret', () => {
  const info: QuestSaveInfo = {
    id: 'run1',
    packId: 'glitch-beneath',
    packTitle: 'The Glitch Beneath Delta Alpha',
    chapter: 1,
    chapterTitle: 'Ch 1',
    nodeTitle: 'Start',
    savedAt: 1,
    credits: 0,
    score: 0,
    heroes: [],
  };

  it('resolves the key safely and warns at startup', () => {
    expect(resolveSaveKey({ NODE_ENV: 'production' })).toMatchObject({ enabled: false });
    expect(resolveSaveKey({ NODE_ENV: 'production', DASCADE_SAVE_SECRET: '   ' })).toMatchObject({ enabled: false });
    expect(resolveSaveKey({ NODE_ENV: 'production', DASCADE_SAVE_SECRET: 'dascade-dev-save-secret' })).toMatchObject({ enabled: false });
    expect(resolveSaveKey({ NODE_ENV: 'production', DASCADE_SAVE_SECRET: 'k'.repeat(40) })).toMatchObject({ enabled: true, source: 'env' });
    expect(resolveSaveKey({ NODE_ENV: 'development' })).toMatchObject({ enabled: true, source: 'dev-default' });
    expect(resolveSaveKey({ DASCADE_SAVE_SECRET: '' })).toMatchObject({ enabled: true, source: 'dev-default' });

    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    warnAboutSaveKey({ NODE_ENV: 'production' }, warn);
    expect(warnings.pop()).toMatch(/DISABLED.*DASCADE_SAVE_SECRET is not set/);
    warnAboutSaveKey({ NODE_ENV: 'production', DASCADE_SAVE_SECRET: 'hunter2' }, warn);
    expect(warnings.pop()).toMatch(/short/);
    warnAboutSaveKey({ NODE_ENV: 'production', DASCADE_SAVE_SECRET: 'k'.repeat(40) }, warn);
    warnAboutSaveKey({ NODE_ENV: 'development' }, warn);
    expect(warnings).toEqual([]);
  });

  it('never signs with (or accepts) the public development key in production', async () => {
    const devSigned = signSave({ info, run: {} as never })!;
    expect(verifySave(devSigned).ok).toBe(true); // test env: dev key
    await withEnv({ NODE_ENV: 'production', DASCADE_SAVE_SECRET: undefined }, () => {
      expect(signSave({ info, run: {} as never })).toBeNull();
      expect(verifySave(devSigned)).toEqual({ ok: false, error: SAVES_DISABLED_MESSAGE });
    });
    await withEnv({ NODE_ENV: 'production', DASCADE_SAVE_SECRET: 'a-real-production-secret-0123456789' }, () => {
      expect(verifySave(devSigned).ok).toBe(false);
      const blob = signSave({ info, run: {} as never })!;
      expect(verifySave(blob).ok).toBe(true);
    });
  });

  it('a production room with no secret keeps playing: no checkpoint blob, a clear log line, loads refused', async () => {
    const devSigned = signSave({ info, run: {} as never })!;
    await withEnv({ NODE_ENV: 'production', DASCADE_SAVE_SECRET: undefined }, async () => {
      const host = await createQuest();
      await start(host); // the opening scene is a checkpoint
      await waitFor(() => /Saving is turned off/.test(logText(host.room)), 3000, 'checkpoint log');
      await sleep(100);
      expect(host.checkpoints).toHaveLength(0);
      expect(st(host.room).phase).toBe('PLAYING');

      const other = await createQuest('Nia');
      other.room.send('quest:load', { blob: devSigned });
      await waitFor(() => other.errors.some((e) => e.type === 'quest:load' && e.message === SAVES_DISABLED_MESSAGE), 3000, 'load refused');
      expect(st(other.room).saveJson).toBe('');
    });
  });
});

describe('DASQuest replay hygiene', () => {
  it("a replay never hands the previous run's checkpoint to a new host", async () => {
    const host = await createQuest('Host');
    const guest = await join(host.room.roomId, 'Bea');
    const guestCheckpoints = collect<QuestCheckpointPayload>(guest.room, 'quest:checkpoint');
    await start(host);
    await waitFor(() => host.checkpoints.length === 1, 3000, 'first-run checkpoint');
    const old = host.checkpoints[0]!;
    host.room.send('quest:debug', { endingId: 'home' });
    await waitFor(() => st(host.room).phase === 'RESULTS', 3000, 'results');
    host.room.send('lobby:toLobby', {});
    await waitFor(() => st(host.room).phase === 'LOBBY', 3000, 'lobby');
    (host.server as any).countdownMs = 2000;
    host.room.send('lobby:start', {});
    await waitFor(() => st(guest.room).phase === 'COUNTDOWN', 3000, 'countdown');
    await host.room.leave(true);
    await waitFor(() => st(guest.room).hostId === guest.me().playerId, 3000, 'host migration');
    await sleep(150);
    expect(st(guest.room).phase).toBe('COUNTDOWN');
    expect(guestCheckpoints.some((c) => c.blob === old.blob)).toBe(false);
  });
});
