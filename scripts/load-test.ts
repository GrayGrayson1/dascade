/**
 * DASCADE load simulation — connects N synthetic WebSocket clients (default 30)
 * and exercises the shared room lifecycle plus game-specific traffic.
 *
 *   LOAD_URL=http://localhost:2567 CLIENTS=30 pnpm load
 *   LOAD_SCENARIOS=join,chat,reconnect,sketch,wheel,bingo,cleanup pnpm load
 *
 * Racing has its own scripted-input bot runner: scripts/load-circuit.ts.
 * Exits non-zero when any scenario fails its thresholds.
 */
import { Client, type Room } from '@colyseus/sdk';

const URL = process.env.LOAD_URL ?? 'http://localhost:2567';
const N = Number(process.env.CLIENTS ?? 30);
const SCENARIOS = (process.env.LOAD_SCENARIOS ?? 'join,chat,reconnect,sketch,wheel,bingo,cleanup').split(',').map((s) => s.trim());

interface Bot {
  name: string;
  room: Room;
  playerId: string;
  seatToken: string;
  messages: Map<string, number>;
  payloads: Map<string, unknown[]>;
}

interface Result {
  scenario: string;
  ok: boolean;
  details: string;
}

const results: Result[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pct(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) return false;
    await sleep(20);
  }
  return true;
}

function track(room: Room, name: string, keep: string[] = []): Bot {
  const bot: Bot = { name, room, playerId: '', seatToken: '', messages: new Map(), payloads: new Map() };
  room.onMessage('*', (type: string | number, payload: unknown) => {
    const t = String(type);
    bot.messages.set(t, (bot.messages.get(t) ?? 0) + 1);
    if (keep.includes(t)) {
      const list = bot.payloads.get(t) ?? [];
      list.push(payload);
      bot.payloads.set(t, list);
    }
    if (t === 'sys:welcome') {
      const w = payload as { playerId: string; seatToken: string };
      bot.playerId = w.playerId;
      bot.seatToken = w.seatToken;
    }
  });
  return bot;
}

function silenceSdkLogs(): void {
  const info = console.info.bind(console);
  console.info = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[Colyseus reconnection]')) return;
    info(...args);
  };
}

async function createBots(gameId: string, count: number, keep: string[] = [], createOptions: Record<string, unknown> = {}): Promise<{ bots: Bot[]; joinMs: number[]; failures: number }> {
  const client = new Client(URL);
  const hostRoom = await client.create(gameId, { name: 'LoadHost', ...createOptions });
  const host = track(hostRoom, 'LoadHost', keep);
  await waitFor(() => host.playerId !== '', 5000);
  const joinMs: number[] = [];
  let failures = 0;
  const others = await Promise.all(
    Array.from({ length: count - 1 }, async (_, i) => {
      const t0 = performance.now();
      try {
        const room = await new Client(URL).joinById(hostRoom.roomId, { name: `Bot ${i + 1}` });
        joinMs.push(performance.now() - t0);
        return track(room, `Bot ${i + 1}`, keep);
      } catch (err) {
        failures++;
        console.error(`  join failed: ${(err as Error).message}`);
        return null;
      }
    }),
  );
  const bots = [host, ...(others.filter(Boolean) as Bot[])];
  await waitFor(() => bots.every((b) => b.playerId !== ''), 8000);
  return { bots, joinMs, failures };
}

async function leaveAll(bots: Bot[]): Promise<void> {
  await Promise.all(bots.map((b) => b.room.leave(true).catch(() => undefined)));
}

function playerCount(room: Room): number {
  const players = (room.state as { players?: { size: number } }).players;
  return players?.size ?? 0;
}

// ---------------------------------------------------------------------------
async function scenarioJoin(): Promise<void> {
  const t0 = performance.now();
  const { bots, joinMs, failures } = await createBots('wheel', N);
  const synced = await waitFor(() => bots.every((b) => playerCount(b.room) === N), 8000);
  const total = performance.now() - t0;
  results.push({
    scenario: `join ×${N}`,
    ok: failures === 0 && synced,
    details: `failures=${failures} p50=${pct(joinMs, 50).toFixed(0)}ms p95=${pct(joinMs, 95).toFixed(0)}ms max=${Math.max(...joinMs).toFixed(0)}ms all-synced=${synced} total=${total.toFixed(0)}ms`,
  });
  await leaveAll(bots);
}

async function scenarioChat(): Promise<void> {
  const { bots } = await createBots('wheel', N);
  const observer = bots[0]!;
  const before = observer.messages.get('chat:msg') ?? 0;
  const errorsBefore = bots.reduce((a, b) => a + (b.messages.get('sys:error') ?? 0), 0);
  const durationMs = 8000;
  const start = Date.now();
  let sent = 0;
  // Each bot bursts 3 messages per second (above the 1.5/s sustained chat limit) to exercise rate limiting.
  while (Date.now() - start < durationMs) {
    for (const b of bots) {
      b.room.send('chat:send', { text: `hello from ${b.name} #${sent}` });
      sent++;
    }
    await sleep(333);
  }
  await sleep(500);
  const received = (observer.messages.get('chat:msg') ?? 0) - before;
  const limited = bots.reduce((a, b) => a + (b.messages.get('sys:error') ?? 0), 0) - errorsBefore;
  const stillConnected = bots.every((b) => b.room.connection.isOpen);
  results.push({
    scenario: `chat burst ×${N}`,
    ok: received > 0 && limited > 0 && stillConnected,
    details: `sent=${sent} delivered-to-observer=${received} rate-limited=${limited} all-connected=${stillConnected}`,
  });
  await leaveAll(bots);
}

async function scenarioReconnect(): Promise<void> {
  const { bots } = await createBots('wheel', N);
  const droppers = bots.slice(1, 11);
  const times: number[] = [];
  await Promise.all(
    droppers.map(
      (b) =>
        new Promise<void>((resolve) => {
          b.room.reconnection.minUptime = 0;
          const t0 = performance.now();
          b.room.onReconnect(() => {
            times.push(performance.now() - t0);
            resolve();
          });
          (b.room.connection as unknown as { transport: { ws: { close(code: number): void } } }).transport.ws.close(4010);
          setTimeout(resolve, 10_000);
        }),
    ),
  );
  // Seat-token rejoin: hard-close 5 more with reconnection disabled, then rejoin with their tokens.
  const rejoiners = bots.slice(11, 16);
  for (const b of rejoiners) {
    b.room.reconnection.enabled = false;
    (b.room.connection as unknown as { transport: { ws: { close(code: number): void } } }).transport.ws.close(4010);
  }
  await sleep(300);
  let rejoined = 0;
  for (const b of rejoiners) {
    try {
      const room = await new Client(URL).joinById(bots[0]!.room.roomId, { name: b.name, seatToken: b.seatToken });
      const again = track(room, b.name);
      await waitFor(() => again.playerId !== '', 4000);
      if (again.playerId === b.playerId) rejoined++;
      b.room = room;
    } catch {
      /* counted below */
    }
  }
  await sleep(500);
  const count = playerCount(bots[0]!.room);
  results.push({
    scenario: 'reconnect + seat rejoin',
    ok: times.length === droppers.length && rejoined === rejoiners.length && count === N,
    details: `auto-reconnected=${times.length}/${droppers.length} p95=${pct(times, 95).toFixed(0)}ms seat-rejoined=${rejoined}/${rejoiners.length} players-after=${count} (no duplicates=${count === N})`,
  });
  await leaveAll(bots);
}

// Game-specific scenarios are registered by name; they use each game's shared message contract.
const GAME_SCENARIOS: Record<string, () => Promise<void>> = {};

export function registerScenario(name: string, fn: () => Promise<void>): void {
  GAME_SCENARIOS[name] = fn;
}

async function scenarioCleanup(): Promise<void> {
  const { bots } = await createBots('wheel', Math.min(N, 10));
  const code = bots[0]!.room.roomId;
  await leaveAll(bots);
  const gone = await pollGone(code);
  results.push({ scenario: 'room cleanup', ok: gone, details: `room ${code} disposed after all left=${gone}` });
}

async function pollGone(code: string): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${URL}/api/rooms/${code}`).then((r) => r.json() as Promise<{ exists: boolean }>);
    if (!res.exists) return true;
    await sleep(250);
  }
  return false;
}

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  silenceSdkLogs();
  const health = await fetch(`${URL}/api/health`)
    .then((r) => r.json())
    .catch(() => null);
  if (!health) {
    console.error(`Cannot reach ${URL}/api/health — start the server first (pnpm dev or pnpm start).`);
    process.exit(2);
  }
  await import('./load-scenarios.ts').then((m: { register: (r: typeof registerScenario, ctx: ScenarioContext) => void }) =>
    m.register(registerScenario, { N, URL, createBots, leaveAll, waitFor, sleep, pct, results }),
  ).catch((err: unknown) => console.warn('No game scenarios loaded:', (err as Error).message));

  const builtIn: Record<string, () => Promise<void>> = { join: scenarioJoin, chat: scenarioChat, reconnect: scenarioReconnect, cleanup: scenarioCleanup };
  console.log(`DASCADE load simulation → ${URL} with ${N} clients`);
  for (const name of SCENARIOS) {
    const fn = builtIn[name] ?? GAME_SCENARIOS[name];
    if (!fn) {
      console.warn(`  (skipping unknown scenario "${name}")`);
      continue;
    }
    process.stdout.write(`▶ ${name}… `);
    const t0 = performance.now();
    try {
      await fn();
      console.log(`done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    } catch (err) {
      console.log('crashed');
      results.push({ scenario: name, ok: false, details: `threw: ${(err as Error).message}` });
    }
  }
  console.log('\nResults');
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.scenario.padEnd(28)} ${r.details}`);
  if (results.length === 0) {
    console.error('No scenarios ran.');
    process.exit(1);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} scenario(s) failed.` : '\nAll scenarios passed.');
  process.exit(failed ? 1 : 0);
}

export interface ScenarioContext {
  N: number;
  URL: string;
  createBots: typeof createBots;
  leaveAll: typeof leaveAll;
  waitFor: typeof waitFor;
  sleep: typeof sleep;
  pct: typeof pct;
  results: Result[];
}

void main();
