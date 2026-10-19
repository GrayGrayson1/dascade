/**
 * DAS Survey Showdown — Presenter Showcase integration tests: event presets (server-side answers that
 * only the presenter ever receives), no teams, wrong answers that never change the board, the
 * server-run "Reveal remaining" sweep (#10 → #1 with a drumroll before the special answer), the round
 * clock, restart/reset with undo, stage cards and the outcome of a show without winners.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, WelcomePayload } from '@dascade/shared';
import {
  SHOWDOWN_MSG,
  validateShowContent,
  type ShowdownActPayload,
  type ShowdownBoardView,
  type ShowdownContentPrivate,
  type ShowdownEvent,
  type ShowdownFinale,
  type ShowdownSheet,
} from '@dascade/shared/games/showdown';
import { SHOWDOWN_EVENT_ROUNDS } from '@dascade/game-core/showdown';
import { onOutcome } from '../src/platform/hub.ts';
import { bootTestServer, collect, quiet, sleep, waitFor } from './helpers.ts';

let colyseus: ColyseusTestServer;
const outcomes: GameOutcome[] = [];
let stopOutcomes: () => void = () => undefined;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['showdown']));
  stopOutcomes = onOutcome((o) => outcomes.push(o));
});
afterEach(async () => {
  await colyseus.cleanup();
  outcomes.length = 0;
});
afterAll(async () => {
  stopOutcomes();
  await colyseus.shutdown();
});

type Json = Record<string, any>;
interface Client {
  room: SdkRoom;
  id: () => string;
  errors: Array<{ type?: string; code: string; message: string }>;
  sheets: Array<ShowdownSheet | null>;
  contents: Array<ShowdownContentPrivate | null>;
  events: ShowdownEvent[];
  all: Array<{ type: string; payload: unknown }>;
}

async function wire(room: SdkRoom): Promise<Client> {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const all: Client['all'] = [];
  const client: Client = {
    room,
    id: () => welcomes.at(-1)!.playerId,
    errors: collect(room, 'sys:error'),
    sheets: collect(room, SHOWDOWN_MSG.sheet),
    contents: collect(room, SHOWDOWN_MSG.content),
    events: collect(room, SHOWDOWN_MSG.event),
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

/** Every answer and note of the DAS-O-Ween boards (as quoted JSON strings, so "Halloween" the title doesn't match). */
const DASOWEEN = validateShowContent(SHOWDOWN_EVENT_ROUNDS['dasoween-2026']).rounds;
const secretsOf = (round: number, except: number[] = []) =>
  DASOWEEN[round]!.answers.flatMap((a, i) => (except.includes(i) ? [] : [`"${a.text}"`, `"${a.note}"`]));

interface Show {
  server: Server;
  host: Client;
  a: Client;
  b: Client;
  join: (name: string, extra?: Json) => Promise<Client>;
}

async function setup(): Promise<Show> {
  const host = await wire(await colyseus.sdk.create('showdown', { name: 'Host' }));
  const server = colyseus.getRoomById(host.room.roomId) as unknown as Server;
  // Fast pacing for the tests: a sweep in well under a second, a 300 ms "minute".
  server.sweepMs = { lead: 30, step: 40, suspense: 80, special: 60 };
  server.minuteMs = 300;
  const join = async (name: string, extra: Json = {}) => wire(await colyseus.sdk.joinById(host.room.roomId, { name, ...extra }));
  const a = await join('Ada');
  const b = await join('Ben');
  return { server, host, a, b, join };
}

async function loadPreset(t: Show, id = 'dasoween-2026'): Promise<void> {
  t.host.room.send(SHOWDOWN_MSG.preset, { id });
  await waitFor(
    () => t.server.state.customRounds === 2 && JSON.parse(t.server.state.settingsJson).mode === 'showcase',
    2000,
    'preset loaded',
  );
}

async function synced(t: Show, clients: Client[] = [t.host, t.a, t.b]): Promise<void> {
  const rev = t.server.state.rev as number;
  const phase = t.server.state.phase as string;
  await waitFor(() => clients.every((c) => json(c).rev === rev && json(c).phase === phase), 2000, 'clients synced');
}

async function start(t: Show): Promise<void> {
  t.host.room.send('lobby:start', {});
  await waitFor(() => t.server.state.phase === 'PLAYING' && t.server.state.boardJson !== '', 3000, 'show started');
  await synced(t);
}

/** A presenter command against the server's current board revision (and round). */
async function act(t: Show, payload: Record<string, unknown> & { a: ShowdownActPayload['a'] }): Promise<void> {
  const rev = t.server.state.rev as number;
  const round = JSON.parse(t.server.state.boardJson).round as number;
  const errors = t.host.errors.length;
  const body = ['reveal', 'miss', 'sweep'].includes(payload.a)
    ? { round, ...payload }
    : payload.a === 'halt' || payload.a === 'clock'
      ? payload
      : { rev, ...payload };
  t.host.room.send(SHOWDOWN_MSG.act, body);
  if (payload.a === 'miss' || payload.a === 'sweep' || payload.a === 'halt' || payload.a === 'clock') {
    await sleep(60);
    return;
  }
  await waitFor(
    () => t.server.state.rev !== rev || t.server.state.phase !== 'PLAYING' || t.host.errors.length > errors,
    2000,
    `act ${payload.a}`,
  );
  await synced(t);
}

describe('Presenter Showcase — presets, roles and secrecy', () => {
  it('loads the DAS-O-Ween preset: showcase settings for all, the rounds for the presenter only', async () => {
    const t = await setup();
    await loadPreset(t);
    await waitFor(() => JSON.parse(json(t.a).settingsJson).mode === 'showcase', 2000, 'settings synced');
    const settings = JSON.parse(json(t.a).settingsJson);
    expect(settings).toMatchObject({
      mode: 'showcase',
      look: 'halloween',
      title: 'DAS-O-Ween Trivia',
      source: 'custom',
      minutes: 10,
      audience: false,
    });
    expect(json(t.a).rehearsal).toBe(false);
    const content = t.host.contents.at(-1)!;
    expect(content.rounds.map((r) => [r.title, r.special, r.ranked, r.answers.length])).toEqual([
      ['Halloween Songs', 4, true, 10],
      ['Halloween Movies', 4, true, 10],
    ]);
    for (const c of [t.a, t.b]) {
      expect(c.contents.filter(Boolean)).toEqual([]);
      const seen = JSON.stringify(c.all) + JSON.stringify(json(c));
      for (const s of [...secretsOf(0), ...secretsOf(1)]) expect(seen).not.toContain(s);
    }
    // The rehearsal preset flags itself, and only the presenter may load a preset.
    t.host.room.send(SHOWDOWN_MSG.preset, { id: 'dasoween-rehearsal' });
    await waitFor(() => t.server.state.rehearsal === true, 2000, 'rehearsal');
    t.a.room.send(SHOWDOWN_MSG.preset, { id: 'dasoween-2026' });
    await waitFor(() => t.a.errors.some((e) => e.type === SHOWDOWN_MSG.preset && e.code === 'not_host'), 2000, 'preset refused');
    expect(t.server.state.rehearsal).toBe(true);
    // Saving your own rounds ends the rehearsal.
    t.host.room.send(SHOWDOWN_MSG.content, { rounds: SHOWDOWN_EVENT_ROUNDS['dasoween-2026'] });
    await waitFor(() => t.server.state.rehearsal === false, 2000, 'own rounds');
  });

  it('a showcase has no teams: switching the format clears them, switching back deals them out', async () => {
    const t = await setup();
    await waitFor(() => t.server.state.teams.size === 2, 2000, 'classic teams');
    await loadPreset(t);
    await waitFor(() => t.server.state.teams.size === 0, 2000, 'teams cleared');
    const late = await t.join('Cy');
    t.a.room.send(SHOWDOWN_MSG.team, { team: 1 });
    await waitFor(() => t.a.errors.some((e) => e.type === SHOWDOWN_MSG.team), 2000, 'team refused');
    expect(t.server.state.teams.size).toBe(0);
    t.host.room.send('lobby:settings', { settings: { mode: 'classic' } });
    await waitFor(() => t.server.state.teams.size === 3, 2000, 'teams dealt');
    expect(t.server.state.teams.get(late.id())).toBeDefined();
  });

  it('runs a round without leaking: category on the title card, question + attribution when it goes up', async () => {
    const t = await setup();
    await loadPreset(t);
    const spec = await t.join('Spec', { spectator: true });
    const screen = await t.join('TV');
    screen.room.send(SHOWDOWN_MSG.screen, { on: true });
    await waitFor(() => t.server.state.screens.size === 1, 2000, 'screen');
    await start(t);
    expect(board(t.a)).toMatchObject({ mode: 'showcase', stage: 'intro' });
    await act(t, { a: 'begin' });
    expect(board(t.a)).toMatchObject({ stage: 'title', title: 'Halloween Songs', prompt: '', source: '', special: 4 });
    await act(t, { a: 'question' });
    expect(board(t.a)).toMatchObject({ stage: 'live', prompt: 'Name the Top 10 Halloween Songs.', source: 'DAS-O-Ween Host Picks' });
    await act(t, { a: 'reveal', slot: 2 });
    await act(t, { a: 'reveal', slot: 4 });
    await waitFor(() => t.a.events.filter((e) => e.type === 'reveal').length === 2, 2000, 'reveals');
    const special = t.a.events.filter((e) => e.type === 'reveal')[1];
    expect(special).toMatchObject({
      slot: 4,
      special: true,
      late: false,
      text: DASOWEEN[0]!.answers[4]!.text,
      note: DASOWEEN[0]!.answers[4]!.note,
    });
    expect(board(t.a).slots[4]).toMatchObject({ revealed: true, text: DASOWEEN[0]!.answers[4]!.text, late: false });
    expect(board(t.a).scores).toEqual([0, 0]);
    // The presenter's sheet marks the special answer; nobody else gets a sheet.
    expect(t.host.sheets.at(-1)).toMatchObject({ special: 4, ranked: true });
    for (const c of [t.a, t.b, spec, screen]) {
      expect(c.sheets.filter(Boolean)).toEqual([]);
      const seen = JSON.stringify(c.all) + JSON.stringify(json(c));
      for (const s of [...secretsOf(0, [2, 4]), ...secretsOf(1)]) expect(seen).not.toContain(s);
    }
    // Team commands don't exist here.
    t.host.room.send(SHOWDOWN_MSG.act, { a: 'strike', rev: t.server.state.rev });
    await waitFor(() => t.host.errors.some((e) => e.type === SHOWDOWN_MSG.act && e.code === 'not_allowed'), 2000, 'strike refused');
  });
});

describe('Presenter Showcase — wrong answers, the sweep, the clock', () => {
  it('a wrong answer reaches every screen, never changes the board, and a double click is one miss', async () => {
    const t = await setup();
    await loadPreset(t);
    await start(t);
    await act(t, { a: 'begin' });
    t.host.room.send(SHOWDOWN_MSG.act, { a: 'miss', round: 0 });
    await waitFor(() => t.host.errors.some((e) => e.code === 'wrong_phase'), 2000, 'miss before the question refused');
    await act(t, { a: 'question' });
    const rev = t.server.state.rev;
    t.host.room.send(SHOWDOWN_MSG.act, { a: 'miss', round: 0 });
    t.host.room.send(SHOWDOWN_MSG.act, { a: 'miss', round: 0 });
    await waitFor(() => t.a.events.some((e) => e.type === 'miss'), 2000, 'miss event');
    await sleep(150);
    expect(t.a.events.filter((e) => e.type === 'miss')).toEqual([{ type: 'miss', rev, round: 0, n: 1 }]);
    await sleep(500);
    t.host.room.send(SHOWDOWN_MSG.act, { a: 'miss', round: 0 });
    await waitFor(() => t.b.events.filter((e) => e.type === 'miss').length === 2, 2000, 'second miss');
    expect(t.server.state.rev).toBe(rev);
    // A command made against the board before the misses still applies (misses never make it stale).
    await act(t, { a: 'restart' });
    expect(board(t.a).stage).toBe('title');
    // Only the presenter buzzes; a miss for an old round is ignored.
    t.a.room.send(SHOWDOWN_MSG.act, { a: 'miss', round: 0 });
    await waitFor(() => t.a.errors.some((e) => e.code === 'not_host'), 2000, 'audience refused');
  });

  it('Reveal remaining flips the rest from #10 up, with a drumroll beat before the special answer', async () => {
    const t = await setup();
    await loadPreset(t);
    await start(t);
    await act(t, { a: 'begin' });
    await act(t, { a: 'question' });
    expect(t.server.state.clockEndsAt).toBeGreaterThan(0);
    await act(t, { a: 'reveal', slot: 0 });
    await act(t, { a: 'reveal', slot: 8 });
    await act(t, { a: 'sweep' });
    await waitFor(() => board(t.a).stage === 'done' && json(t.a).sweep === false, 4000, 'sweep done');
    const evs = t.a.events.filter((e) => ['reveal', 'suspense', 'sweep'].includes(e.type));
    const order = evs.map((e) =>
      e.type === 'reveal' ? `r${e.slot}` : e.type === 'suspense' ? `s${e.slot}` : e.type === 'sweep' ? `w${e.on ? 1 : 0}` : e.type,
    );
    expect(order).toEqual(['r0', 'r8', 'w1', 'r9', 'r7', 'r6', 'r5', 's4', 'r4', 'r3', 'r2', 'r1', 'w0']);
    const swept = t.a.events.filter((e): e is Extract<ShowdownEvent, { type: 'reveal' }> => e.type === 'reveal' && e.sweep);
    expect(swept.every((e) => e.late)).toBe(true);
    expect(swept.find((e) => e.slot === 4)).toMatchObject({ special: true });
    expect(swept.at(-1)).toMatchObject({ cleared: true });
    expect(board(t.a).slots.map((s) => s.late)).toEqual([false, true, true, true, true, true, true, true, false, true]);
    expect(board(t.a).results).toEqual([{ index: 0, winner: -1, points: 0, how: 'none', found: 2, total: 10 }]);
    // The clock stopped for the sweep.
    expect(t.server.state.clockEndsAt).toBe(0);
  });

  it('a sweep stops for Stop or Next, carries on when pressed again, and never touches the next board', async () => {
    const t = await setup();
    t.server.sweepMs = { lead: 30, step: 150, suspense: 150, special: 150 };
    await loadPreset(t);
    await start(t);
    await act(t, { a: 'begin' });
    await act(t, { a: 'question' });
    await act(t, { a: 'sweep' });
    await waitFor(() => board(t.a).slots[9]!.revealed, 2000, 'first sweep tile');
    await act(t, { a: 'halt' });
    await waitFor(() => json(t.a).sweep === false, 2000, 'halted');
    const shown = board(t.a).slots.filter((s) => s.revealed).length;
    await sleep(400);
    expect(board(t.a).slots.filter((s) => s.revealed).length).toBe(shown);
    await act(t, { a: 'sweep' });
    await waitFor(() => board(t.a).slots.filter((s) => s.revealed).length > shown, 2000, 'carried on');
    // Next round while the sweep runs: it stops, and round 2's board stays hidden.
    await act(t, { a: 'next' });
    await sleep(600);
    expect(board(t.a)).toMatchObject({ round: 1, stage: 'title' });
    expect(board(t.a).slots.every((s) => !s.revealed)).toBe(true);
    expect(t.server.state.sweep).toBe(false);
    // A sweep sent for the old round is ignored.
    t.host.room.send(SHOWDOWN_MSG.act, { a: 'sweep', round: 0 });
    await sleep(300);
    expect(board(t.a).slots.every((s) => !s.revealed)).toBe(true);
  });

  it('the clock starts with the question, pauses, takes ±1 minute, resets, and says time’s up once', async () => {
    const t = await setup();
    await loadPreset(t);
    t.host.room.send('lobby:settings', { settings: { minutes: 1 } });
    await waitFor(() => JSON.parse(t.server.state.settingsJson).minutes === 1, 2000, 'minutes');
    await start(t);
    expect(json(t.a)).toMatchObject({ clockMax: 300, clockLeft: 300, clockEndsAt: 0, clockShow: true });
    await act(t, { a: 'begin' });
    expect(t.server.state.clockEndsAt).toBe(0);
    await act(t, { a: 'question' });
    expect(t.server.state.clockEndsAt).toBeGreaterThan(Date.now());
    await act(t, { a: 'clock', op: 'pause' });
    expect(t.server.state.clockEndsAt).toBe(0);
    const left = t.server.state.clockLeft;
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(300);
    await act(t, { a: 'clock', op: 'plus' });
    expect(t.server.state.clockLeft).toBe(left + 300);
    await act(t, { a: 'clock', op: 'reset' });
    expect(t.server.state.clockLeft).toBe(300);
    await act(t, { a: 'clock', op: 'hide' });
    expect(t.server.state.clockShow).toBe(false);
    await act(t, { a: 'clock', op: 'start' });
    await waitFor(() => t.a.events.some((e) => e.type === 'timeup'), 3000, 'time up');
    await sleep(600);
    expect(t.a.events.filter((e) => e.type === 'timeup')).toEqual([{ type: 'timeup', rev: t.server.state.rev, round: 0 }]);
    // Overtime: the clock keeps counting below zero, and nothing was revealed by it.
    expect(t.server.state.clockEndsAt - Date.now()).toBeLessThan(0);
    expect(board(t.a).slots.every((s) => !s.revealed)).toBe(true);
    // The next round starts its clock over.
    await act(t, { a: 'next' });
    expect(json(t.a)).toMatchObject({ clockLeft: 300, clockEndsAt: 0 });
    t.a.room.send(SHOWDOWN_MSG.act, { a: 'clock', op: 'start' });
    await waitFor(() => t.a.errors.some((e) => e.code === 'not_host'), 2000, 'audience refused');
  });
});

describe('Presenter Showcase — keeping control', () => {
  it('restart and reset are undoable, and the revision keeps rising', async () => {
    const t = await setup();
    await loadPreset(t);
    await start(t);
    await act(t, { a: 'begin' });
    await act(t, { a: 'question' });
    await act(t, { a: 'reveal', slot: 1 });
    await act(t, { a: 'restart' });
    expect(board(t.a)).toMatchObject({ stage: 'title' });
    expect(board(t.a).slots.every((s) => !s.revealed)).toBe(true);
    await act(t, { a: 'undo' });
    expect(board(t.a)).toMatchObject({ stage: 'live' });
    expect(board(t.a).slots[1]!.revealed).toBe(true);
    const rev = t.server.state.rev;
    await act(t, { a: 'reset' });
    expect(board(t.a)).toMatchObject({ stage: 'intro', round: -1 });
    await act(t, { a: 'undo' });
    expect(board(t.a)).toMatchObject({ stage: 'live', round: 0 });
    expect(t.server.state.rev).toBeGreaterThan(rev);
  });

  it('stage cards: the presenter puts one up in any phase, the show start clears it', async () => {
    const t = await setup();
    await loadPreset(t);
    t.host.room.send(SHOWDOWN_MSG.card, { card: 'welcome' });
    await waitFor(() => json(t.a).card === 'welcome', 2000, 'card in lobby');
    t.a.room.send(SHOWDOWN_MSG.card, { card: 'break' });
    await waitFor(() => t.a.errors.some((e) => e.type === SHOWDOWN_MSG.card), 2000, 'audience refused');
    expect(t.server.state.card).toBe('welcome');
    await start(t);
    expect(json(t.a).card).toBe('');
    t.host.room.send(SHOWDOWN_MSG.card, { card: 'break' });
    await waitFor(() => json(t.b).card === 'break', 2000, 'card mid-show');
    t.host.room.send(SHOWDOWN_MSG.card, { card: 'nope' });
    await waitFor(() => t.host.errors.some((e) => e.type === SHOWDOWN_MSG.card), 2000, 'bad card refused');
    t.host.room.send(SHOWDOWN_MSG.card, { card: '' });
    await waitFor(() => json(t.b).card === '', 2000, 'card off');
  });

  it('a showcase ends with no winner: the crowd counts, everyone shares one place', async () => {
    const t = await setup();
    await loadPreset(t);
    await start(t);
    await act(t, { a: 'begin' });
    await act(t, { a: 'question' });
    await act(t, { a: 'reveal', slot: 0 });
    await act(t, { a: 'next' });
    await act(t, { a: 'question' });
    await act(t, { a: 'next' });
    await waitFor(() => t.server.state.phase === 'RESULTS' && json(t.a).finaleJson !== '', 3000, 'finale');
    const finale = JSON.parse(json(t.a).finaleJson) as ShowdownFinale;
    expect(finale).toMatchObject({ mode: 'showcase', winner: -1 });
    expect(finale.results.map((r) => [r.found, r.total])).toEqual([
      [1, 10],
      [0, 10],
    ]);
    await waitFor(() => outcomes.length === 1, 2000, 'outcome');
    expect(outcomes[0]!.placements).toHaveLength(1);
    expect(new Set(outcomes[0]!.placements[0])).toEqual(new Set([t.a.id(), t.b.id()]));
  });

  it('Team Showdown refuses ranked rounds (they have no points to score)', async () => {
    const t = await setup();
    await loadPreset(t);
    t.host.room.send('lobby:settings', { settings: { mode: 'classic' } });
    await waitFor(() => JSON.parse(t.server.state.settingsJson).mode === 'classic', 2000, 'classic');
    t.host.room.send('lobby:start', {});
    await waitFor(() => t.host.errors.some((e) => /ranks its answers/.test(e.message)), 2000, 'start refused');
    expect(t.server.state.phase).toBe('LOBBY');
  });
});
