/**
 * Chaos test (OPS-01 C): a real server process is killed (SIGKILL — no graceful shutdown, no last
 * snapshot) in the middle of a DAS-O-Ween round, a fresh process starts on the same port, and the
 * presenter's console hands back the last black box it received. The show must come back under the
 * same code with the board and the hot seat as they were, the phones back in their own seats, and
 * nothing replayed (no board events after the restore).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import type { WelcomePayload } from '@dascade/shared';
import { SHOWDOWN_MSG, type ShowdownBlackBox, type ShowdownBoardView, type ShowdownEvent } from '@dascade/shared/games/showdown';
import { TEST_SHOW_FILE } from './fixtures/showdownShowFile.ts';
import { collect, freePort, quiet, sleep, waitFor } from './helpers.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '..');

let child: ChildProcess | null = null;

async function boot(port: number): Promise<ChildProcess> {
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test', DASCADE_ONLY_GAMES: 'showdown', LOG_LEVEL: 'error' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let err = '';
  proc.stderr?.on('data', (d: Buffer) => (err += d.toString()));
  const started = Date.now();
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`server exited: ${err.slice(-500)}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return proc;
    } catch {
      /* not up yet */
    }
    if (Date.now() - started > 40_000) throw new Error(`server did not start: ${err.slice(-500)}`);
    await sleep(150);
  }
}

interface Wired {
  room: Room;
  welcome: () => WelcomePayload;
  events: ShowdownEvent[];
  boxes: Array<ShowdownBlackBox | null>;
  sheets: unknown[];
}

async function wire(room: Room): Promise<Wired> {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const w: Wired = {
    room,
    welcome: () => welcomes.at(-1)!,
    events: collect(room, SHOWDOWN_MSG.event),
    boxes: collect(room, SHOWDOWN_MSG.blackbox),
    sheets: collect(room, SHOWDOWN_MSG.sheet),
  };
  quiet(room);
  await waitFor(() => welcomes.length > 0, 5000, 'welcome');
  return w;
}

const state = (w: Wired): Record<string, any> => (w.room.state as unknown as { toJSON(): Record<string, any> }).toJSON();
const boardOf = (w: Wired): ShowdownBoardView => JSON.parse(state(w).boardJson) as ShowdownBoardView;

afterAll(() => {
  child?.kill('SIGKILL');
});

describe('chaos: the server process dies mid-round', () => {
  it('restores the show from the console’s black box after a SIGKILL and a fresh start', async () => {
    const port = await freePort();
    child = await boot(port);
    const sdk = new Client(`ws://127.0.0.1:${port}`);
    const host = await wire(await sdk.create('showdown', { name: 'Host' }));
    const code = host.room.roomId;
    const phone = await wire(await sdk.joinById(code, { name: 'Ada' }));
    const send = (type: string, payload: unknown) => host.room.send(type, payload);
    send(SHOWDOWN_MSG.content, { rounds: TEST_SHOW_FILE });
    await sleep(200);
    send(SHOWDOWN_MSG.preset, { id: 'dasoween-2026' });
    await waitFor(() => state(host).event === 'dasoween-2026' && state(host).customRounds === 2, 5000, 'event room');
    send('lobby:start', {});
    await waitFor(() => state(host).phase === 'PLAYING' && state(host).rev > 0, 5000, 'playing');
    send(SHOWDOWN_MSG.act, { a: 'begin', rev: state(host).rev });
    await waitFor(() => boardOf(host).stage === 'title', 5000, 'title');
    send(SHOWDOWN_MSG.act, { a: 'question', rev: state(host).rev });
    await waitFor(() => boardOf(host).stage === 'live', 5000, 'live');
    send(SHOWDOWN_MSG.pick, { a: 'pick', round: 0, drawNo: 0 });
    await waitFor(() => state(host).hotSeat === phone.welcome().playerId, 5000, 'Ada in the hot seat');
    send(SHOWDOWN_MSG.act, { a: 'reveal', slot: 2, round: 0 });
    send(SHOWDOWN_MSG.act, { a: 'reveal', slot: 6, round: 0 });
    await waitFor(() => boardOf(host).slots[6]?.revealed === true, 5000, 'two found');
    // The console keeps the black box (sent within ~1 s of each change).
    await waitFor(() => host.boxes.some((b) => b && b.takenAt > 0), 5000, 'black box');
    await sleep(1300);
    const box = host.boxes.filter(Boolean).at(-1)!;
    const before = boardOf(host);
    const hostSeat = host.welcome().seatToken;
    const phoneSeat = phone.welcome().seatToken;

    // Kill -9: no graceful shutdown, no farewell snapshot.
    child.kill('SIGKILL');
    await waitFor(() => child!.exitCode !== null || child!.signalCode !== null, 5000, 'process gone');
    child = await boot(port);
    const sdk2 = new Client(`ws://127.0.0.1:${port}`);
    // The room is gone until the console restores it.
    await expect(sdk2.joinById(code, { name: 'Ada', seatToken: phoneSeat })).rejects.toBeTruthy();

    const host2 = await wire(await sdk2.create('showdown', { name: 'Host', restore: box.blob, seatToken: hostSeat }));
    expect(host2.room.roomId).toBe(code);
    expect(host2.welcome().playerId).toBe(host.welcome().playerId);
    await waitFor(() => host2.sheets.some(Boolean), 5000, 'the console has its sheet again');
    const phone2 = await wire(await sdk2.joinById(code, { name: 'Ada', seatToken: phoneSeat }));
    expect(phone2.welcome().playerId).toBe(phone.welcome().playerId);
    await waitFor(() => state(phone2).phase === 'PLAYING', 5000, 'phone back in the show');
    const after = boardOf(phone2);
    expect(after.slots.map((s) => s.revealed)).toEqual(before.slots.map((s) => s.revealed));
    expect(after.slots[2]?.calledBy).toBe('Ada');
    expect(state(phone2).hotSeat).toBe(phone.welcome().playerId);
    expect(state(phone2).presenterId).toBe(host.welcome().playerId);
    // The clock comes back paused; nothing was replayed.
    expect(state(phone2).clockEndsAt).toBe(0);
    await sleep(300);
    expect(phone2.events).toEqual([]);
    expect(host2.events).toEqual([]);
    // And the show goes on.
    host2.room.send(SHOWDOWN_MSG.act, { a: 'reveal', slot: 0, round: 0 });
    await waitFor(() => boardOf(phone2).slots[0]?.revealed === true, 5000, 'carries on');
    await phone2.room.leave(true);
    await host2.room.leave(true);
  }, 120_000);
});
