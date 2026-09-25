import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { WelcomePayload } from '@dascade/shared';
import type { QuestCheckpointPayload, QuestSaveInfo, QuestSceneView } from '@dascade/shared/games/quest';
import { collect, freePort, quiet, waitFor } from './helpers.ts';
import { createDascadeServer } from '../src/server.ts';
import { signSave, verifySave } from '../src/rooms/quest/saves.ts';
import type { QuestRoom } from '../src/rooms/quest/QuestRoom.ts';

process.env.DASCADE_QUEST_DEBUG = '1';

let colyseus: ColyseusTestServer;

/** Boots on a free port (see quest.test.ts for why the shared helper isn't used). */
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

async function wire(room: SdkRoom) {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<{ code: string; type?: string; message: string }>(room, 'sys:error');
  const checkpoints = collect<QuestCheckpointPayload>(room, 'quest:checkpoint');
  quiet(room);
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, 'welcome');
  return { room, errors, checkpoints, me: () => welcomes[welcomes.length - 1]! };
}

async function createQuest(name = 'Host') {
  const room = await colyseus.sdk.create('quest', { name });
  const client = await wire(room);
  const server = colyseus.getRoomById(room.roomId) as unknown as QuestRoom;
  (server as any).countdownMs = 0;
  (server as any).timing = { voteMsPerSecond: 1000, lockInMs: 50, soloLockInMs: 30, rollRevealMs: 60, tiebreakMs: 5000, pauseRecheckMs: 100 };
  return { ...client, server };
}

async function join(code: string, name: string) {
  return wire(await colyseus.sdk.joinById(code, { name }));
}

async function pick(c: Awaited<ReturnType<typeof wire>>, archetype: string) {
  c.room.send('quest:hero', { archetype });
  await waitFor(() => st(c.room).heroes.get(c.me().playerId)?.archetype === archetype);
}

async function start(host: Awaited<ReturnType<typeof wire>>) {
  host.room.send('lobby:start', {});
  await waitFor(() => st(host.room).stage === 'voting' && scene(host.room) !== null, 4000, 'first scene');
}

/** Play into chapter 2 and return the checkpoint the host received there. */
async function reachChapterTwo() {
  const host = await createQuest('Host');
  const guest = await join(host.room.roomId, 'Bea');
  await pick(host, 'tinker');
  await pick(guest, 'seer');
  await start(host);
  await waitFor(() => host.checkpoints.length === 1, 3000, 'chapter 1 checkpoint');
  host.room.send('quest:debug', { nodeId: 'c1_descent' });
  await waitFor(() => scene(host.room)?.nodeId === 'c1_descent');
  host.room.send('quest:vote', { choiceId: 'step', rev: st(host.room).sceneRev });
  guest.room.send('quest:vote', { choiceId: 'step', rev: st(guest.room).sceneRev });
  await waitFor(() => scene(host.room)?.nodeId === 'c2_start', 4000, 'chapter 2');
  await waitFor(() => host.checkpoints.length === 2, 3000, 'chapter 2 checkpoint');
  return { host, guest, checkpoint: host.checkpoints[1]! };
}

describe('save signing', () => {
  const info: QuestSaveInfo = {
    id: 'run1',
    packId: 'glitch-beneath',
    packTitle: 'The Glitch Beneath Delta Alpha',
    chapter: 2,
    chapterTitle: 'Sub-Level ½',
    nodeTitle: 'Sub-Level ½',
    savedAt: 1,
    credits: 3,
    score: 0,
    heroes: [],
  };

  it('verifies what it signed and rejects any modification', () => {
    const blob = signSave({ info, run: { hello: 'world' } as never })!;
    const ok = verifySave(blob);
    expect(ok.ok).toBe(true);
    const [prefix, body, sig] = blob.split('.') as [string, string, string];
    const forged = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    forged.info.credits = 9999;
    const forgedBody = Buffer.from(JSON.stringify(forged)).toString('base64url');
    expect(verifySave(`${prefix}.${forgedBody}.${sig}`)).toMatchObject({ ok: false, error: expect.stringContaining('modified') });
    expect(verifySave(`${prefix}.${body}.${sig.slice(0, -2)}AA`)).toMatchObject({ ok: false });
    expect(verifySave(`xx1.${body}.${sig}`)).toMatchObject({ ok: false, error: expect.stringContaining('not a DASQuest save') });
    expect(verifySave('garbage')).toMatchObject({ ok: false });
  });

  it('a different server secret cannot verify the save', () => {
    const blob = signSave({ info, run: {} as never })!;
    const prev = process.env.DASCADE_SAVE_SECRET;
    process.env.DASCADE_SAVE_SECRET = 'another-secret';
    try {
      expect(verifySave(blob).ok).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.DASCADE_SAVE_SECRET;
      else process.env.DASCADE_SAVE_SECRET = prev;
    }
  });
});

describe('checkpoints & resume', () => {
  it('sends signed checkpoints to the host only, and a new party can resume from one', async () => {
    const { host, guest, checkpoint } = await reachChapterTwo();
    expect(guest.checkpoints).toHaveLength(0);
    expect(checkpoint.info).toMatchObject({ packId: 'glitch-beneath', chapter: 2, chapterTitle: 'Sub-Level ½', nodeTitle: 'Sub-Level ½' });
    expect(checkpoint.info.heroes.map((h) => h.archetype)).toEqual(['tinker', 'seer']);
    expect(checkpoint.name).toBe('The Glitch Beneath Delta Alpha · Ch. 2: Sub-Level ½');
    expect(checkpoint.id).toBe(host.checkpoints[0]!.id);

    // A brand-new room: the host loads the save, players claim heroes, the run resumes.
    const host2 = await createQuest('Nia');
    const p2 = await join(host2.room.roomId, 'Oli');
    host2.room.send('lobby:settings', { settings: { pack: 'missing-beans' } });
    await waitFor(() => st(host2.room).packId === 'missing-beans');
    host2.room.send('quest:load', { blob: checkpoint.blob });
    await waitFor(() => st(host2.room).saveJson !== '', 3000, 'save loaded');
    expect(JSON.parse(st(host2.room).saveJson)).toMatchObject({ chapter: 2, packId: 'glitch-beneath' });
    expect(st(host2.room).packId).toBe('glitch-beneath');
    p2.room.send('quest:claim', { slot: 0 });
    await waitFor(() => st(host2.room).heroes.get(p2.me().playerId)?.slot === 0);
    host2.room.send('quest:claim', { slot: 0 });
    await waitFor(() => host2.errors.some((e) => e.type === 'quest:claim' && e.code === 'not_allowed'));
    host2.room.send('quest:claim', { slot: 1 });
    await waitFor(() => st(host2.room).heroes.get(host2.me().playerId)?.slot === 1);

    host2.room.send('lobby:start', {});
    await waitFor(() => scene(host2.room)?.nodeId === 'c2_start' && st(host2.room).stage === 'voting', 4000, 'resumed scene');
    expect(st(host2.room).chapter).toBe(2);
    expect(st(host2.room).heroes.get(p2.me().playerId)).toMatchObject({ archetype: 'tinker', name: 'Oli' });
    expect(st(host2.room).heroes.get(host2.me().playerId)).toMatchObject({ archetype: 'seer', name: 'Nia' });
    expect(st(host2.room).saveJson).toBe('');
    expect([...st(host2.room).log].some((l: { text: string }) => l.text.startsWith('Resumed The Glitch Beneath'))).toBe(true);
  });

  it('rejects tampered, foreign and outdated saves, and only the host may load', async () => {
    const { checkpoint } = await reachChapterTwo();
    const host2 = await createQuest('Nia');
    const p2 = await join(host2.room.roomId, 'Oli');

    p2.room.send('quest:load', { blob: checkpoint.blob });
    await waitFor(() => p2.errors.some((e) => e.type === 'quest:load' && e.code === 'not_host'));

    const [prefix, body, sig] = checkpoint.blob.split('.') as [string, string, string];
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));

    // 1. Edited payload with the original signature.
    const edited = structuredClone(payload);
    edited.run.inventory.golden_token = 1;
    host2.room.send('quest:load', { blob: `${prefix}.${Buffer.from(JSON.stringify(edited)).toString('base64url')}.${sig}` });
    await waitFor(() => host2.errors.some((e) => e.type === 'quest:load' && /modified/.test(e.message)), 3000, 'tamper rejected');

    // 2. Validly signed but structurally impossible (e.g. forged by someone who knows the dev secret).
    const impossible = structuredClone(payload);
    impossible.run.heroes[0].hp = 999;
    host2.room.send('quest:load', { blob: signSave(impossible)! });
    await waitFor(() => host2.errors.some((e) => e.type === 'quest:load' && /damaged/.test(e.message)), 3000, 'invalid run rejected');

    // 3. Made with an older version of the adventure.
    const old = structuredClone(payload);
    old.run.packVersion = '0.9.0';
    host2.room.send('quest:load', { blob: signSave(old)! });
    await waitFor(() => host2.errors.some((e) => e.type === 'quest:load' && /version 0\.9\.0/.test(e.message)), 3000, 'outdated rejected');

    // 4. An adventure this server doesn't have.
    const foreign = structuredClone(payload);
    foreign.info.packId = 'not-installed';
    host2.room.send('quest:load', { blob: signSave(foreign)! });
    await waitFor(() => host2.errors.some((e) => e.type === 'quest:load' && /not installed/.test(e.message)), 3000, 'foreign rejected');

    // 5. Oversized / malformed payloads never reach the handler.
    host2.room.send('quest:load', { blob: 'x'.repeat(10) });
    await waitFor(() => host2.errors.some((e) => e.type === 'quest:load' && e.code === 'invalid_payload'));

    expect(st(host2.room).saveJson).toBe('');
    host2.room.send('quest:claim', { slot: 0 });
    await waitFor(() => host2.errors.some((e) => e.type === 'quest:claim' && e.code === 'not_allowed'));
  });

  it('the new host receives the latest checkpoint after host migration', async () => {
    const { host, guest, checkpoint } = await reachChapterTwo();
    const guestCheckpoints = collect<QuestCheckpointPayload>(guest.room, 'quest:checkpoint');
    await host.room.leave(true);
    await waitFor(() => st(guest.room).hostId === guest.me().playerId, 4000, 'host migration');
    await waitFor(() => guestCheckpoints.length > 0, 3000, 'checkpoint handed over');
    expect(guestCheckpoints[0]!.blob).toBe(checkpoint.blob);
  });
});
