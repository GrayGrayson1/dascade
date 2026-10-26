/**
 * DAS Survey Showdown — event rooms (the DAS-O-Ween decisions): the settings-only preset, crew links
 * and permissions, presenter succession, the audience picker, moderation, the sound station, the
 * clock's cues, the Room DJ lock, the join-time name check, keep-alive, the preflight and the black box.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import { DJ } from '@dascade/shared/jukebox';
import { JoinErrorCode, type WelcomePayload } from '@dascade/shared';
import {
  SHOWDOWN_MSG,
  type ShowdownAuditView,
  type ShowdownBlackBox,
  type ShowdownBoardView,
  type ShowdownCrewPrivate,
  type ShowdownEvent,
  type ShowdownMe,
  type ShowdownPreflightData,
} from '@dascade/shared/games/showdown';
import { TEST_SHOW_FILE } from './fixtures/showdownShowFile.ts';
import { sealBlackBox } from '../src/rooms/showdown/blackbox.ts';
import { bootTestServer, collect, quiet, sleep, waitFor } from './helpers.ts';

let colyseus: ColyseusTestServer;
let port = 0;

beforeAll(async () => {
  ({ colyseus, port } = await bootTestServer(['showdown']));
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

type Json = Record<string, any>;
interface Client {
  room: SdkRoom;
  id: () => string;
  seatToken: () => string;
  errors: Array<{ type?: string; code: string; message: string }>;
  toasts: Array<{ kind: string; text: string }>;
  events: ShowdownEvent[];
  crew: Array<ShowdownCrewPrivate | null>;
  me: ShowdownMe[];
  pass: Array<{ pass: string } | null>;
  audit: ShowdownAuditView[];
  boxes: Array<ShowdownBlackBox | null>;
  preflight: ShowdownPreflightData[];
  all: Array<{ type: string; payload: unknown }>;
}

async function wire(room: SdkRoom): Promise<Client> {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const all: Client['all'] = [];
  const client: Client = {
    room,
    id: () => welcomes.at(-1)!.playerId,
    seatToken: () => welcomes.at(-1)!.seatToken,
    errors: collect(room, 'sys:error'),
    toasts: collect(room, 'sys:toast'),
    events: collect(room, SHOWDOWN_MSG.event),
    crew: collect(room, SHOWDOWN_MSG.crew),
    me: collect(room, SHOWDOWN_MSG.me),
    pass: collect(room, SHOWDOWN_MSG.pass),
    audit: collect(room, SHOWDOWN_MSG.audit),
    boxes: collect(room, SHOWDOWN_MSG.blackbox),
    preflight: collect(room, SHOWDOWN_MSG.preflight),
    all,
  };
  quiet(room);
  room.onMessage('*', (type: string | number, payload: unknown) => all.push({ type: String(type), payload }));
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, 'welcome');
  return client;
}

const json = (c: Client): Json => (c.room.state as unknown as { toJSON(): Json }).toJSON();
const board = (c: Client): ShowdownBoardView => JSON.parse(json(c).boardJson) as ShowdownBoardView;
type Server = Record<string, any>;

interface Show {
  server: Server;
  host: Client;
  code: string;
  join: (name: string, extra?: Json) => Promise<Client>;
}

/** A room with the DAS-O-Ween preset (settings only) and the test show file: an event room. */
async function eventRoom(names: string[] = []): Promise<Show & { guests: Client[] }> {
  const host = await wire(await colyseus.sdk.create('showdown', { name: 'Host' }));
  const server = colyseus.getRoomById(host.room.roomId) as unknown as Server;
  server.sweepMs = { lead: 30, step: 40, suspense: 80, special: 60 };
  server.minuteMs = 300;
  const code = host.room.roomId;
  const join = async (name: string, extra: Json = {}) => wire(await colyseus.sdk.joinById(code, { name, ...extra }));
  host.room.send(SHOWDOWN_MSG.content, { rounds: TEST_SHOW_FILE });
  await waitFor(() => server.state.customRounds === 2, 2000, 'show file');
  host.room.send(SHOWDOWN_MSG.preset, { id: 'dasoween-2026' });
  await waitFor(() => server.state.event === 'dasoween-2026', 2000, 'event room');
  const guests: Client[] = [];
  for (const n of names) guests.push(await join(n));
  return { server, host, code, join, guests };
}

async function start(t: Show): Promise<void> {
  t.host.room.send('lobby:start', {});
  await waitFor(() => t.server.state.phase === 'PLAYING' && t.server.state.boardJson !== '', 3000, 'show started');
}

async function act(t: Show, payload: Record<string, unknown>): Promise<void> {
  const rev = t.server.state.rev as number;
  const round = JSON.parse(t.server.state.boardJson).round as number;
  const body = ['reveal', 'miss', 'sweep'].includes(payload.a as string)
    ? { round, ...payload }
    : payload.a === 'clock'
      ? payload
      : { rev, ...payload };
  t.host.room.send(SHOWDOWN_MSG.act, body);
  if (payload.a === 'clock' || payload.a === 'miss') return void (await sleep(60));
  await waitFor(() => t.server.state.rev !== rev || t.server.state.phase !== 'PLAYING', 2000, `act ${String(payload.a)}`);
}

/** Round 1's question up. */
async function live(t: Show): Promise<void> {
  await start(t);
  await act(t, { a: 'begin' });
  await act(t, { a: 'question' });
}

async function pick(t: Show, by: Client = t.host): Promise<Extract<ShowdownEvent, { type: 'pick' }>> {
  const drawNo = t.server.state.drawNo as number;
  const round = JSON.parse(t.server.state.boardJson).round as number;
  by.room.send(SHOWDOWN_MSG.pick, { a: 'pick', round, drawNo });
  await waitFor(() => t.server.state.drawNo === drawNo + 1, 2000, 'a draw');
  await waitFor(() => by.events.some((e) => e.type === 'pick' && e.drawNo === drawNo + 1), 2000, 'pick event');
  return by.events.find((e) => e.type === 'pick' && e.drawNo === drawNo + 1) as Extract<ShowdownEvent, { type: 'pick' }>;
}

const lastCrew = (c: Client) => c.crew.at(-1) ?? null;

async function lookup(code: string): Promise<Json> {
  const res = await fetch(`http://localhost:${port}/api/rooms/${code}`);
  return (await res.json()) as Json;
}

/** A moderator: the producer mints a link, a guest opens it. */
async function moderator(t: Show, name = 'Mo'): Promise<Client> {
  const mo = await t.join(name);
  t.host.room.send(SHOWDOWN_MSG.crewIssue, { role: 'moderator', name });
  await waitFor(() => t.host.crew.some((c) => c?.fresh?.role === 'moderator'), 2000, 'moderator link');
  const link = t.host.crew.filter((c) => c?.fresh?.role === 'moderator').at(-1)!.fresh!.link;
  mo.room.send(SHOWDOWN_MSG.crewClaim, { link });
  await waitFor(() => lastCrew(mo)?.roles.includes('moderator') === true, 2000, 'moderator role');
  return mo;
}

// ===========================================================================

describe('event rooms (ADM-01, OPS-03 data, crew)', () => {
  it('the DAS-O-Ween preset is settings only: loaded rounds stay, the room becomes an event room, the loader becomes producer', async () => {
    const t = await eventRoom(['Ada']);
    expect(t.server.state.customRounds).toBe(2);
    expect(JSON.parse(t.server.state.settingsJson)).toMatchObject({ mode: 'showcase', look: 'halloween', display: 'auto' });
    await waitFor(() => json(t.guests[0]!).event === 'dasoween-2026', 2000, 'public event flag');
    // The lookup tells the event join screen.
    await sleep(1100);
    expect(await lookup(t.code)).toMatchObject({ exists: true, gameId: 'showdown', event: 'dasoween-2026' });
    // The producer link arrives once, privately.
    const fresh = t.host.crew.find((c) => c?.fresh)?.fresh;
    expect(fresh).toMatchObject({ role: 'producer', name: 'Host' });
    expect(fresh!.link).toMatch(/^[A-Za-z0-9_-]{6,24}\.[A-Za-z0-9_-]{22,64}$/);
    expect(lastCrew(t.host)).toMatchObject({ event: true, roles: ['producer'] });
    expect(lastCrew(t.host)!.perms).toEqual(
      expect.arrayContaining(['presenter.assign', 'crew.issue', 'people.rename', 'picker.run', 'audit.export']),
    );
    // Nobody else ever sees a link or a secret.
    expect(JSON.stringify(t.guests[0]!.all)).not.toContain(fresh!.link.split('.')[1]!);
    expect(JSON.stringify(json(t.guests[0]!))).not.toContain(fresh!.link.split('.')[1]!);
    expect(t.guests[0]!.crew.filter(Boolean)).toEqual([]);
    // A stranger's room that loads the preset with no show file gets settings and no rounds.
    const other = await wire(await colyseus.sdk.create('showdown', { name: 'Stranger' }));
    other.room.send(SHOWDOWN_MSG.preset, { id: 'dasoween-2026' });
    const otherServer = colyseus.getRoomById(other.room.roomId) as unknown as Server;
    await waitFor(() => otherServer.state.event === 'dasoween-2026', 2000, 'stranger event room');
    expect(otherServer.state.customRounds).toBe(0);
    other.room.send('lobby:start', {});
    await waitFor(() => other.errors.some((e) => e.type === 'lobby:start'), 2000, 'start refused without rounds');
  });

  it('a moderator renames and hides a guest in any phase; both are audited; revoking drops the role at once', async () => {
    const t = await eventRoom(['Ada', 'xXghostXx']);
    const mo = await moderator(t);
    const [ada, ghost] = t.guests as [Client, Client];
    await start(t);
    mo.room.send(SHOWDOWN_MSG.rename, { playerId: ghost.id(), name: 'Sam P.' });
    await waitFor(() => t.server.state.players.get(ghost.id()).name === 'Sam P.', 2000, 'renamed');
    await waitFor(() => ghost.toasts.some((x) => /moderator changed your name to Sam P\./.test(x.text)), 2000, 'guest told');
    mo.room.send(SHOWDOWN_MSG.hide, { playerId: ada.id(), on: true });
    await waitFor(() => !t.server.state.seats.get(ada.id()), 1000, 'hidden from the stage within 1 s');
    expect(t.server.state.seats.get(ghost.id())).toBe(true);
    // Crew see who is hidden and who is crew (privately); guests don't.
    await waitFor(() => (mo.crew.at(-1)?.hidden ?? []).includes(ada.id()), 2000, 'moderator sees the hidden list');
    expect(mo.crew.at(-1)!.crewIds).toEqual(expect.arrayContaining([t.host.id(), mo.id()]));
    expect(ghost.crew.filter(Boolean)).toEqual([]);
    // The log names the actor and the change; the presenter (audit.read) receives it.
    await waitFor(() => (t.host.audit.at(-1)?.entries ?? []).some((e) => e.action === 'people.hide'), 2000, 'audit pushed');
    const entries = t.host.audit.at(-1)!.entries;
    expect(entries.find((e) => e.action === 'people.rename')).toMatchObject({
      actorId: mo.id(),
      role: 'moderator',
      target: ghost.id(),
      before: 'xXghostXx',
      after: 'Sam P.',
    });
    expect(entries.find((e) => e.action === 'people.hide')).toMatchObject({ actorId: mo.id(), target: ada.id() });
    // Guests never get the log.
    expect(ada.audit).toEqual([]);
    // Revoke: the next rename is refused.
    const moLink = lastCrew(t.host)!.links.find((l) => l.role === 'moderator')!;
    t.host.room.send(SHOWDOWN_MSG.crewRevoke, { id: moLink.id });
    await waitFor(() => mo.crew.at(-1) === null, 1000, 'role dropped within 1 s');
    mo.room.send(SHOWDOWN_MSG.rename, { playerId: ghost.id(), name: 'Nope' });
    await waitFor(() => mo.errors.some((e) => e.type === SHOWDOWN_MSG.rename), 2000, 'refused after revoke');
    expect(t.server.state.players.get(ghost.id()).name).toBe('Sam P.');
  });

  it('deny by default: guests can’t moderate, issue, revoke, assign, move the station, read the preflight or export the log', async () => {
    const t = await eventRoom(['Ada', 'Ben']);
    const [ada, ben] = t.guests as [Client, Client];
    const tries: Array<[string, Json]> = [
      [SHOWDOWN_MSG.rename, { playerId: ben.id(), name: 'X' }],
      [SHOWDOWN_MSG.hide, { playerId: ben.id(), on: true }],
      [SHOWDOWN_MSG.crewIssue, { role: 'moderator', name: 'X' }],
      [SHOWDOWN_MSG.crewRevoke, { id: 'whatever' }],
      [SHOWDOWN_MSG.assign, { playerId: ada.id() }],
      [SHOWDOWN_MSG.station, { playerId: '' }],
      [SHOWDOWN_MSG.preflight, {}],
      [SHOWDOWN_MSG.auditExport, {}],
    ];
    for (const [type, payload] of tries) ada.room.send(type, payload);
    await waitFor(
      () => tries.every(([type]) => ada.errors.some((e) => e.type === type && e.code === 'not_allowed')),
      3000,
      'every one refused',
    );
    expect(t.server.state.players.get(ben.id()).name).toBe('Ben');
    expect(t.server.state.presenterId).toBe(t.host.id());
    // A forged crew link is refused (and audited).
    ada.room.send(SHOWDOWN_MSG.crewClaim, { link: 'abcdefghij.ABCDEFGHIJKLMNOPQRSTUVWXYZ012345' });
    await waitFor(() => ada.errors.some((e) => e.type === SHOWDOWN_MSG.crewClaim), 2000, 'forged link refused');
    expect(lastCrew(ada)).toBeNull();
    // A guest hammering refused messages can't flood the log: at most one refusal a minute each.
    for (let i = 0; i < 3; i++) ada.room.send(SHOWDOWN_MSG.claim, { pass: 'wrong-pass-123' });
    await waitFor(() => ada.errors.filter((e) => e.type === SHOWDOWN_MSG.claim).length >= 3, 3000, 'claims refused');
    const refusals = (t.server.audit.all() as Array<Json>).filter((e) => e.actorId === ada.id() && String(e.action).endsWith('.refused'));
    expect(refusals.length).toBeLessThanOrEqual(1);
  });
});

describe('presenter succession (ADM-04 B)', () => {
  it('a presenter link can’t take the show from an online presenter; offline it can, and it’s audited', async () => {
    const t = await eventRoom(['Ada']);
    const pass = t.host.pass.filter(Boolean).at(-1)!.pass;
    const ada = t.guests[0]!;
    ada.room.send(SHOWDOWN_MSG.claim, { pass });
    await waitFor(
      () => ada.errors.some((e) => e.type === SHOWDOWN_MSG.claim && /ask the producer/i.test(e.message)),
      2000,
      'claim refused',
    );
    expect(t.server.state.presenterId).toBe(t.host.id());
    // The presenter drops (their seat is held): now the link works.
    await t.host.room.leave(false);
    await waitFor(() => t.server.state.players.get(t.host.id())?.connected === false, 2000, 'presenter offline');
    ada.room.send(SHOWDOWN_MSG.claim, { pass });
    await waitFor(() => t.server.state.presenterId === ada.id(), 2000, 'claimed while offline');
    const log = (t.server.audit.all() as Array<{ action: string; reason?: string }>).map((e) => e.action);
    expect(log).toEqual(expect.arrayContaining(['presenter.refused', 'presenter.claim']));
  });

  it('the producer makes someone presenter: no reload, the pass rotates, the old link stops working', async () => {
    const t = await eventRoom(['Dana']);
    const dana = t.guests[0]!;
    const oldPass = t.host.pass.filter(Boolean).at(-1)!.pass;
    t.host.room.send(SHOWDOWN_MSG.assign, { playerId: dana.id(), reason: 'Hand-over for round 2' });
    await waitFor(() => t.server.state.presenterId === dana.id(), 2000, 'assigned');
    await waitFor(() => dana.pass.filter(Boolean).length > 0, 2000, 'new pass delivered');
    const newPass = dana.pass.filter(Boolean).at(-1)!.pass;
    expect(newPass).not.toBe(oldPass);
    expect(t.host.pass.at(-1)).toBeNull();
    // The old presenter's device is told to drop its black box (an old one must never win a restore).
    await waitFor(() => t.host.boxes.at(-1) === null, 2000, 'old box cleared');
    // The producer is still the producer (and may take it back); the old pass no longer claims.
    expect(lastCrew(t.host)!.roles).toEqual(['producer']);
    const entry = (t.server.audit.all() as Array<Json>).find((e) => e.action === 'presenter.assign');
    expect(entry).toMatchObject({
      actorId: t.host.id(),
      target: dana.id(),
      before: 'Host',
      after: 'Dana',
      reason: 'Hand-over for round 2',
    });
    await dana.room.leave(false);
    await waitFor(() => t.server.state.players.get(dana.id())?.connected === false, 2000, 'presenter offline');
    const eve = await t.join('Eve');
    eve.room.send(SHOWDOWN_MSG.claim, { pass: oldPass });
    await waitFor(() => eve.errors.some((e) => e.type === SHOWDOWN_MSG.claim && /not valid/.test(e.message)), 2000, 'old pass refused');
  });

  it('screens and spectators can never take over (any room)', async () => {
    const host = await wire(await colyseus.sdk.create('showdown', { name: 'Host' }));
    const server = colyseus.getRoomById(host.room.roomId) as unknown as Server;
    const screen = await wire(await colyseus.sdk.joinById(host.room.roomId, { name: 'TV' }));
    const spec = await wire(await colyseus.sdk.joinById(host.room.roomId, { name: 'Spec', spectator: true }));
    screen.room.send(SHOWDOWN_MSG.screen, { on: true });
    await waitFor(() => server.state.screens.get(screen.id()) === true, 2000, 'screen');
    // The presenter leaves for good: the role is free.
    await host.room.leave(true);
    await waitFor(() => server.state.presenterId === '', 2000, 'presenter gone');
    screen.room.send(SHOWDOWN_MSG.takeover, {});
    spec.room.send(SHOWDOWN_MSG.takeover, {});
    await waitFor(
      () => screen.errors.some((e) => e.type === SHOWDOWN_MSG.takeover) && spec.errors.some((e) => e.type === SHOWDOWN_MSG.takeover),
      2000,
      'takeovers refused',
    );
    expect(server.state.presenterId).toBe('');
  });

  it('a backup presenter takes the show only while the presenter is offline', async () => {
    const t = await eventRoom([]);
    const bea = await t.join('Bea');
    t.host.room.send(SHOWDOWN_MSG.crewIssue, { role: 'backup', name: 'Bea' });
    await waitFor(() => t.host.crew.some((c) => c?.fresh?.role === 'backup'), 2000, 'backup link');
    bea.room.send(SHOWDOWN_MSG.crewClaim, { link: t.host.crew.find((c) => c?.fresh?.role === 'backup')!.fresh!.link });
    await waitFor(() => lastCrew(bea)?.roles.includes('backup') === true, 2000, 'backup role');
    bea.room.send(SHOWDOWN_MSG.assign, { playerId: bea.id() });
    await waitFor(() => bea.errors.some((e) => e.type === SHOWDOWN_MSG.assign), 2000, 'refused while online');
    await t.host.room.leave(false);
    await waitFor(() => t.server.state.players.get(t.host.id())?.connected === false, 2000, 'presenter offline');
    bea.room.send(SHOWDOWN_MSG.assign, { playerId: bea.id(), reason: 'The presenter dropped' });
    await waitFor(() => t.server.state.presenterId === bea.id(), 2000, 'backup took over');
  });
});

describe('the picker (PCK-01…05)', () => {
  it('draws only connected participants — never the presenter, crew, screens, spectators, skippers or hidden guests', async () => {
    const t = await eventRoom(['Ada', 'Ben', 'Cy', 'Dee']);
    const [ada, ben, cy, dee] = t.guests as [Client, Client, Client, Client];
    const mo = await moderator(t);
    const screen = await t.join('TV');
    screen.room.send(SHOWDOWN_MSG.screen, { on: true });
    const spec = await t.join('Spec', { spectator: true });
    await waitFor(() => t.server.state.screens.get(screen.id()) === true, 2000, 'screen');
    ben.room.send(SHOWDOWN_MSG.skip, { on: true });
    mo.room.send(SHOWDOWN_MSG.hide, { playerId: cy.id(), on: true });
    await live(t);
    await waitFor(() => t.server.state.poolSize === 2, 2000, 'pool of two');
    // Only participants who aren't hidden have a seat on the stage (skippers do: nobody can tell).
    expect([...t.server.state.seats.keys()].sort()).toEqual([ada.id(), ben.id(), dee.id()].sort());
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const e = await pick(t);
      seen.add(e.winnerId);
      expect([ada.id(), dee.id()]).toContain(e.winnerId);
      t.host.room.send(SHOWDOWN_MSG.pick, { a: 'noAnswer', drawNo: e.drawNo });
      await waitFor(() => t.server.state.hotSeat === '', 2000, 'hot seat cleared');
    }
    expect(seen.has(spec.id())).toBe(false);
    expect(seen.has(mo.id())).toBe(false);
  });

  it('done counts the turn for the round, no answer puts them back, a reroll redraws without them; stale or repeated acts never apply twice', async () => {
    const t = await eventRoom(['Ada', 'Ben', 'Cy']);
    await live(t);
    await waitFor(() => t.server.state.poolSize === 3, 2000, 'pool of three');
    const first = await pick(t);
    expect(first).toMatchObject({ drawNo: 1, poolSize: 2, reroll: false });
    expect(first.landAt - Date.now()).toBeGreaterThan(2000);
    // A repeated pick (same drawNo) and Pick while someone is up both do nothing.
    t.host.room.send(SHOWDOWN_MSG.pick, { a: 'pick', round: 0, drawNo: 0 });
    t.host.room.send(SHOWDOWN_MSG.pick, { a: 'pick', round: 0, drawNo: 1 });
    await waitFor(() => t.host.errors.some((e) => e.type === SHOWDOWN_MSG.pick && /done/.test(e.message)), 2000, 'nudge');
    expect(t.server.state.drawNo).toBe(1);
    // Mark done: out for the rest of the round; a stale done for an old draw is ignored.
    t.host.room.send(SHOWDOWN_MSG.pick, { a: 'done', drawNo: 1 });
    await waitFor(() => t.server.state.done.get(first.winnerId) === true, 2000, 'done');
    t.host.room.send(SHOWDOWN_MSG.pick, { a: 'done', drawNo: 0 });
    await sleep(100);
    expect(t.server.state.poolSize).toBe(2);
    const second = await pick(t);
    expect(second.winnerId).not.toBe(first.winnerId);
    // Reroll: back in the pool, redrawn without them, with the reason logged.
    t.host.room.send(SHOWDOWN_MSG.pick, { a: 'reroll', drawNo: second.drawNo, reason: 'away' });
    await waitFor(() => t.server.state.drawNo === second.drawNo + 1, 2000, 'rerolled');
    const third = t.host.events.find((e) => e.type === 'pick' && e.drawNo === second.drawNo + 1) as
      Extract<ShowdownEvent, { type: 'pick' }> | undefined;
    await waitFor(() => Boolean(t.host.events.find((e) => e.type === 'pick' && e.drawNo === second.drawNo + 1)), 2000, 'reroll event');
    const reroll = t.host.events.find((e) => e.type === 'pick' && e.drawNo === second.drawNo + 1) as Extract<
      ShowdownEvent,
      { type: 'pick' }
    >;
    void third;
    expect(reroll.reroll).toBe(true);
    expect(reroll.winnerId).not.toBe(second.winnerId);
    expect(reroll.winnerId).not.toBe(first.winnerId);
    const log = (t.server.audit.all() as Array<Json>).filter((e) => e.action.startsWith('picker.'));
    expect(log.map((e) => e.action)).toEqual(['picker.draw', 'picker.done', 'picker.draw', 'picker.reroll']);
    expect(log.at(-1)).toMatchObject({ reason: 'Not there', target: reroll.winnerId });
    // Everyone left has had a turn or is up: the pool is empty and says so.
    t.host.room.send(SHOWDOWN_MSG.pick, { a: 'done', drawNo: reroll.drawNo });
    await waitFor(() => t.server.state.hotSeat === '', 2000, 'done 2');
    t.host.room.send(SHOWDOWN_MSG.pick, { a: 'noAnswer', drawNo: reroll.drawNo });
    await sleep(80);
    expect(t.server.state.poolSize).toBe(1);
  });

  it('the pool refills when the next round starts, late joiners included', async () => {
    const t = await eventRoom(['Ada', 'Ben']);
    await live(t);
    for (let i = 0; i < 2; i++) {
      const e = await pick(t);
      t.host.room.send(SHOWDOWN_MSG.pick, { a: 'done', drawNo: e.drawNo });
      await waitFor(() => t.server.state.hotSeat === '', 2000, 'done');
    }
    await waitFor(() => t.server.state.poolSize === 0, 2000, 'empty pool');
    const late = await t.join('Late');
    await waitFor(() => t.server.state.poolSize === 1, 2000, 'late joiner in');
    await act(t, { a: 'next' });
    await waitFor(() => t.server.state.poolSize === 3 && t.server.state.done.size === 0, 2000, 'round 2 pool = everyone present');
    expect(t.server.state.seats.get(late.id())).toBe(true);
  });

  it('Skip me is private: only the owner learns it; screens, crew and the presenter can’t skip', async () => {
    const t = await eventRoom(['Ada', 'Ben']);
    const [ada, ben] = t.guests as [Client, Client];
    ada.room.send(SHOWDOWN_MSG.skip, { on: true });
    await waitFor(() => ada.me.at(-1)?.pool?.skip === true, 2000, 'my skip');
    expect(ada.me.at(-1)!.pool).toEqual({ in: false, skip: true, done: false });
    expect(ben.me.at(-1)?.pool).toEqual({ in: true, skip: false, done: false });
    // Nothing anyone else receives says Ada skipped (only the pool count moves).
    expect(JSON.stringify(ben.all)).not.toMatch(/"skip":true/);
    expect(JSON.stringify(json(ben))).not.toMatch(/skip/i);
    t.host.room.send(SHOWDOWN_MSG.skip, { on: true });
    await waitFor(() => t.host.errors.some((e) => e.type === SHOWDOWN_MSG.skip), 2000, 'presenter refused');
  });

  it('a tile found during a turn credits the hot seat (only once revealed); undo takes the credit back', async () => {
    const t = await eventRoom(['Ada']);
    const ada = t.guests[0]!;
    await live(t);
    await pick(t);
    expect((JSON.parse(t.server.state.boardJson) as ShowdownBoardView).slots[1]!.calledBy).toBeUndefined();
    await act(t, { a: 'reveal', slot: 1 });
    await waitFor(() => board(ada).slots[1]?.calledBy === 'Ada', 2000, 'credit');
    // An unrevealed tile never carries a name.
    expect(
      board(ada)
        .slots.filter((s) => !s.revealed)
        .every((s) => s.calledBy === undefined),
    ).toBe(true);
    await act(t, { a: 'undo' });
    await waitFor(() => board(ada).slots[1]?.revealed === false, 2000, 'undone');
    expect(board(ada).slots[1]!.calledBy).toBeUndefined();
  });

  it('away and disconnected participants sit the draw out', async () => {
    const t = await eventRoom(['Ada', 'Ben']);
    const [ada, ben] = t.guests as [Client, Client];
    await live(t);
    await ben.room.leave(false);
    await waitFor(() => t.server.state.poolSize === 1, 2000, 'disconnected left out');
    const e = await pick(t);
    expect(e.winnerId).toBe(ada.id());
    await waitFor(() => ada.me.at(-1)?.picked === true, 2000, 'you’re up (private)');
  });
});

describe('the sound station (AUD-02 C)', () => {
  it('the console holds it; crew move it to a big screen; a dropped screen hands it back at once, a silent one within 5 s', async () => {
    const t = await eventRoom(['Ada']);
    const ada = t.guests[0]!;
    const tv = await t.join('TV');
    tv.room.send(SHOWDOWN_MSG.screen, { on: true });
    await waitFor(() => t.server.state.screens.get(tv.id()) === true, 2000, 'screen');
    t.host.room.send(SHOWDOWN_MSG.audio, { ready: true, muted: false, sounds: true });
    tv.room.send(SHOWDOWN_MSG.audio, { ready: true, muted: false, sounds: true });
    // A phone's heartbeat is ignored; a phone can't hold the station.
    ada.room.send(SHOWDOWN_MSG.audio, { ready: true, muted: false, sounds: true });
    await waitFor(() => t.server.state.audio.get(tv.id()) === 1 && t.server.state.soundSeenAt > 0, 2000, 'heartbeats');
    expect(t.server.state.audio.get(ada.id())).toBeUndefined();
    expect(t.server.state.soundStation).toBe('');
    t.host.room.send(SHOWDOWN_MSG.station, { playerId: ada.id() });
    await waitFor(() => t.host.errors.some((e) => e.type === SHOWDOWN_MSG.station), 2000, 'a phone refused');
    t.host.room.send(SHOWDOWN_MSG.station, { playerId: tv.id() });
    await waitFor(() => t.server.state.soundStation === tv.id(), 2000, 'moved to the screen');
    // Silent screen (no heartbeat): back to the console within ~5 s.
    const t0 = Date.now();
    await waitFor(() => t.server.state.soundStation === '', 7000, 'failover after silence');
    expect(Date.now() - t0).toBeLessThan(6500);
    await waitFor(() => t.host.events.some((e) => e.type === 'station' && e.lost), 2000, 'console told');
    // Dropped screen: at once.
    t.host.room.send(SHOWDOWN_MSG.station, { playerId: tv.id() });
    await waitFor(() => t.server.state.soundStation === tv.id(), 2000, 'moved again');
    await tv.room.leave(true);
    await waitFor(() => t.server.state.soundStation === '', 1000, 'failover on disconnect');
    expect((t.server.audit.all() as Array<Json>).filter((e) => e.action === 'audio.failover')).toHaveLength(2);
  }, 20_000);
});

describe('the round clock’s cues (AUD-01)', () => {
  it('warns once at 1:00 and ticks 10 … 1', async () => {
    const t = await eventRoom([]);
    t.server.minuteMs = 6_100; // a 61-second "10 minutes": the warning comes almost at once
    await live(t);
    await waitFor(() => t.host.events.some((e) => e.type === 'clockWarn'), 2500, 'one-minute warning');
    // Jump to the last ten seconds.
    t.server.state.clockEndsAt = Date.now() + 4_700;
    await waitFor(() => t.host.events.some((e) => e.type === 'tick' && e.n === 1), 6000, 'ticks');
    const ticks = t.host.events.filter((e) => e.type === 'tick').map((e) => (e as Extract<ShowdownEvent, { type: 'tick' }>).n);
    expect(ticks).toEqual([5, 4, 3, 2, 1]);
    expect(t.host.events.filter((e) => e.type === 'clockWarn')).toHaveLength(1);
  });
});

describe('the Pick the Answer song (soundboard)', () => {
  it('plays on a press; a second press while it plays is ignored (never two songs at once)', async () => {
    const t = await eventRoom(['Ada']);
    const cues = collect<{ cue: string; id: number }>(t.guests[0]!.room, SHOWDOWN_MSG.cue);
    await start(t);
    t.host.room.send(SHOWDOWN_MSG.cue, { cue: 'pickAnswer' });
    t.host.room.send(SHOWDOWN_MSG.cue, { cue: 'pickAnswer' });
    t.host.room.send(SHOWDOWN_MSG.cue, { cue: 'ding' });
    await waitFor(() => cues.some((c) => c.cue === 'ding'), 2000, 'cues');
    await sleep(150);
    expect(cues.filter((c) => c.cue === 'pickAnswer')).toHaveLength(1);
    // Guests can't play it.
    t.guests[0]!.room.send(SHOWDOWN_MSG.cue, { cue: 'pickAnswer' });
    await waitFor(() => t.guests[0]!.errors.some((e) => e.type === SHOWDOWN_MSG.cue), 2000, 'refused');
  });
});

describe('Room DJ lock (AUD-04 C)', () => {
  it('a running Room DJ switches off when the event show starts and can’t start until the show ends', async () => {
    const t = await eventRoom(['Ada']);
    const djStates = collect<{ enabled: boolean }>(t.host.room, DJ.state);
    t.host.room.send(DJ.config, { enabled: true });
    await waitFor(() => djStates.at(-1)?.enabled === true, 2000, 'DJ on in the lobby');
    await start(t);
    await waitFor(() => djStates.at(-1)?.enabled === false, 2000, 'DJ off when the show starts');
    t.host.room.send(DJ.config, { enabled: true });
    await waitFor(() => t.host.errors.some((e) => e.type === DJ.config && /show/i.test(e.message)), 2000, 'refused during the show');
  });
});

describe('the join name check (JOI-03 B)', () => {
  it('a strict join with a taken name is refused with the suggestion; a normal one still gets " 2"', async () => {
    const t = await eventRoom(['Sam']);
    let err: { code?: number; message?: string } | null = null;
    try {
      await colyseus.sdk.joinById(t.code, { name: 'sam', strictName: true });
    } catch (e) {
      err = e as { code?: number; message?: string };
    }
    expect(err?.code).toBe(JoinErrorCode.NAME_TAKEN);
    expect(err?.message).toBe('sam 2');
    const initial = await t.join('Sam P.', { strictName: true });
    expect(t.server.state.players.get(initial.id()).name).toBe('Sam P.');
    const keep = await t.join('Sam');
    expect(t.server.state.players.get(keep.id()).name).toBe('Sam 2');
  });
});

describe('keep-alive (OPS-01, part one)', () => {
  it('holds the presenter’s seat for 30 minutes and keeps a live event room from closing by itself', async () => {
    const t = await eventRoom(['Ada']);
    await start(t);
    const host = t.server.getPlayer(t.host.id());
    const ada = t.server.getPlayer(t.guests[0]!.id());
    expect(t.server.reconnectGraceFor(host)).toBe(30 * 60);
    expect(t.server.reconnectGraceFor(ada)).toBe(t.server.reconnectGraceSeconds);
    expect(t.server.autoDispose).toBe(false);
    act(t, { a: 'finish' }).catch(() => undefined);
    await waitFor(() => t.server.state.phase === 'RESULTS', 2000, 'results');
    expect(t.server.autoDispose).toBe(true);
  });
});

describe('keep-alive: a lone presenter drops (OPS-01)', () => {
  it('the presenter’s seat outlives a guest’s grace, and the room survives with nobody connected', async () => {
    const t = await eventRoom(['Ada']);
    // Compress time: guests get 1 s of grace; the presenter keeps the event's 30 minutes.
    t.server.reconnectGraceSeconds = 1;
    await start(t);
    const hostId = t.host.id();
    const adaId = t.guests[0]!.id();
    await t.guests[0]!.room.leave(false);
    await t.host.room.leave(false);
    await sleep(2500);
    // Ada's grace ran out (she's away, seat kept mid-show); the presenter's is still pending.
    expect(t.server.getPlayer(adaId)?.away).toBe(true);
    expect(t.server.getPlayer(hostId)?.away).toBe(false);
    expect(colyseus.getRoomById(t.code)).toBeTruthy();
    expect(t.server.clients.length).toBe(0);
    // The presenter comes back with their seat token and carries on.
    const back = await wire(await colyseus.sdk.joinById(t.code, { name: 'Host', seatToken: t.host.seatToken() }));
    expect(back.id()).toBe(hostId);
    expect(t.server.state.presenterId).toBe(hostId);
  });
});

describe('preflight (OPS-03 B)', () => {
  it('sends crew the server facts: uptime, commit, the loaded show, backups, the station, the black box', async () => {
    const t = await eventRoom([]);
    t.host.room.send(SHOWDOWN_MSG.preflight, {});
    await waitFor(() => t.host.preflight.length > 0, 2000, 'preflight');
    expect(t.host.preflight.at(-1)).toMatchObject({
      event: 'dasoween-2026',
      rehearsal: false,
      rounds: 2,
      specials: 2,
      backups: { issued: 0, online: 0 },
      blackbox: true,
    });
    expect(t.host.preflight.at(-1)!.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe('the black box (OPS-01 C)', () => {
  it('only the presenter’s console gets the sealed snapshot, and it can’t read it', async () => {
    const t = await eventRoom(['Ada']);
    await live(t);
    await act(t, { a: 'reveal', slot: 2 });
    await waitFor(() => t.host.boxes.some((b) => b && b.takenAt > 0), 3000, 'black box');
    const box = t.host.boxes.filter(Boolean).at(-1)!;
    expect(box.code).toBe(t.code);
    expect(box.blob).toMatch(/^sb1\./);
    // Sealed: no answer, name or secret readable inside.
    for (const r of TEST_SHOW_FILE) for (const a of r.answers) expect(box.blob).not.toContain(a.text);
    expect(box.blob).not.toContain('Ada');
    expect(t.guests[0]!.boxes).toEqual([]);
  });

  it('after the room is gone, the console restores it under the same code: board, paused clock, picker, crew; seats come back by token; nothing replays', async () => {
    const t = await eventRoom(['Ada', 'Ben']);
    const [ada, ben] = t.guests as [Client, Client];
    ben.room.send(SHOWDOWN_MSG.skip, { on: true });
    await live(t);
    const drawn = await pick(t);
    await act(t, { a: 'reveal', slot: 3 });
    act(t, { a: 'clock', op: 'start' }).catch(() => undefined);
    await sleep(1300);
    const before = board(t.host);
    const hostToken = t.host.seatToken();
    const tokens = { ada: ada.seatToken(), ben: ben.seatToken() };
    const box = t.host.boxes.filter(Boolean).at(-1)!;
    expect(box).toBeTruthy();
    // "The server restarts": the room and every connection are gone.
    await t.server.disconnect();
    await waitFor(() => !colyseus.getRoomById(t.code), 3000, 'room gone');

    const host2 = await wire(await colyseus.sdk.create('showdown', { name: 'Host', restore: box.blob, seatToken: hostToken }));
    expect(host2.room.roomId).toBe(t.code);
    const server2 = colyseus.getRoomById(t.code) as unknown as Server;
    expect(host2.id()).toBe(t.host.id());
    expect(server2.state.presenterId).toBe(t.host.id());
    expect(server2.state.event).toBe('dasoween-2026');
    expect(server2.state.phase).toBe('PLAYING');
    const after = JSON.parse(server2.state.boardJson) as ShowdownBoardView;
    expect(after.slots.map((s) => s.revealed)).toEqual(before.slots.map((s) => s.revealed));
    expect(after.slots[3]).toMatchObject({ revealed: true, calledBy: drawn.name });
    expect(server2.state.hotSeat).toBe(drawn.winnerId);
    expect(server2.state.clockEndsAt).toBe(0);
    expect(server2.state.clockLeft).toBeGreaterThan(0);
    // The console got a new pass and its sheet; nothing was broadcast as an event (no replays).
    await waitFor(() => host2.pass.filter(Boolean).length > 0, 2000, 'new pass');
    expect(host2.events).toEqual([]);
    expect(lastCrew(host2)?.roles).toEqual(['producer']);
    // Phones come back to their own seats with their old tokens; Ben's Skip me survived.
    const ada2 = await wire(await colyseus.sdk.joinById(t.code, { name: 'Ada', seatToken: tokens.ada }));
    const ben2 = await wire(await colyseus.sdk.joinById(t.code, { name: 'Ben', seatToken: tokens.ben }));
    expect(ada2.id()).toBe(ada.id());
    expect(ben2.id()).toBe(ben.id());
    await waitFor(() => ben2.me.at(-1)?.pool?.skip === true, 2000, 'skip kept');
    expect(ada2.events).toEqual([]);
    expect((server2.audit.all() as Array<Json>).some((e) => e.action === 'show.restored')).toBe(true);
    // The show carries on.
    host2.room.send(SHOWDOWN_MSG.act, { a: 'reveal', slot: 0, round: 0 });
    await waitFor(() => (JSON.parse(server2.state.boardJson) as ShowdownBoardView).slots[0]!.revealed, 2000, 'show goes on');
  });

  it('only the presenter it was sealed for can restore it; an incomplete snapshot is refused', async () => {
    const t = await eventRoom(['Ada']);
    await live(t);
    await waitFor(() => t.host.boxes.some((b) => b && b.takenAt > 0), 3000, 'box');
    const box = t.host.boxes.filter(Boolean).at(-1)!;
    const adaToken = t.guests[0]!.seatToken();
    await t.server.disconnect();
    await waitFor(() => !colyseus.getRoomById(t.code), 3000, 'room gone');
    for (const opts of [{}, { seatToken: adaToken }, { seatToken: 'not-a-seat' }]) {
      let err: { code?: number } | null = null;
      try {
        await colyseus.sdk.create('showdown', { name: 'X', restore: box.blob, ...opts });
      } catch (e) {
        err = e as { code?: number };
      }
      expect(err?.code, JSON.stringify(opts)).toBe(JoinErrorCode.RESTORE_FAILED);
    }
    // A sealed snapshot from "another build" that lacks fields is refused, and the code is free again.
    const partial = sealBlackBox({
      v: 1,
      takenAt: Date.now(),
      code: t.code,
      event: 'dasoween-2026',
      seats: [],
      presenterId: 'x',
    } as never)!;
    let err: { code?: number } | null = null;
    try {
      await colyseus.sdk.create('showdown', { name: 'X', restore: partial, seatToken: 'x' });
    } catch (e) {
      err = e as { code?: number };
    }
    expect(err?.code).toBe(JoinErrorCode.RESTORE_FAILED);
    // The real presenter still can.
    const back = await wire(await colyseus.sdk.create('showdown', { name: 'Host', restore: box.blob, seatToken: t.host.seatToken() }));
    expect(back.room.roomId).toBe(t.code);
  });

  it('a forged, damaged or reused-code black box is refused', async () => {
    let err: { code?: number } | null = null;
    try {
      await colyseus.sdk.create('showdown', { name: 'X', restore: 'sb1.AAAA.BBBB.CCCC' });
    } catch (e) {
      err = e as { code?: number };
    }
    expect(err?.code).toBe(JoinErrorCode.RESTORE_FAILED);
    // A live room's code can't be taken by restoring its snapshot elsewhere.
    const t = await eventRoom([]);
    await waitFor(() => t.host.boxes.some(Boolean), 3000, 'box');
    err = null;
    try {
      await colyseus.sdk.create('showdown', { name: 'X', restore: t.host.boxes.filter(Boolean).at(-1)!.blob });
    } catch (e) {
      err = e as { code?: number };
    }
    expect(err?.code).toBe(JoinErrorCode.RESTORE_FAILED);
  });
});
