/**
 * DASh Circuit load test + scripted bot drivers.
 *
 * Connects N bots (default 20) to a circuit room, starts the race via the host bot,
 * drives every car with the game-core autopilot at the real input rate (2 frames per
 * packet, ~30 packets/s) and reports server tick health, snapshot sizes/rates and
 * whether every bot made progress / completed a lap.
 *
 *   LOAD_URL=http://localhost:2607 pnpm exec tsx scripts/load-circuit.ts
 *     --bots 20          number of bots
 *     --seconds 60       max duration of the race phase
 *     --laps 1           race length (host bot sets it)
 *     --track neon-loop  neon-loop | skyline-switchback
 *     --join CODE        join an existing room instead of creating one (the room's host starts it)
 *     --no-start         create the room but let a human host start it
 *     --drift 0.35       share of bots that drift through tight corners
 *     --spectators 10    extra passive spectator clients (snapshot delivery only)
 */
import { Client, type Room } from '@colyseus/sdk';
import { CIRCUIT_MSG, CIRCUIT_SIM, CAR_PAINTS, CHASSIS_IDS, DECAL_IDS, WHEEL_IDS, type CircuitTrackId } from '../packages/shared/src/games/circuit.ts';
import { CHASSIS, RaceStatusCode, autopilot, createBotMemory, decodeSnapshot, getTrack, type BotMemory } from '../packages/game-core/src/circuit/index.ts';
// The bots use the real web client's netcode (prediction + reconciliation).
import { CircuitNet } from '../apps/web/src/games/circuit/net/netClient.ts';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--')) return process.argv[i + 1]!;
  return fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const URL = process.env.LOAD_URL ?? 'http://localhost:2567';
const BOTS = Math.max(1, Math.min(30, Number(arg('bots', '20'))));
const SECONDS = Math.max(5, Number(arg('seconds', '60')));
const LAPS = Math.max(1, Math.min(10, Number(arg('laps', '1'))));
const TRACK = arg('track', 'neon-loop') as CircuitTrackId;
const JOIN = arg('join', '');
const NO_START = flag('no-start');
const DRIFT_SHARE = Number(arg('drift', '0.35'));
const SPECTATORS = Math.max(0, Math.min(30, Number(arg('spectators', '0'))));

interface Bot {
  idx: number;
  room: Room;
  playerId: string;
  seq: number;
  memory: BotMemory;
  skill: number;
  lane: number;
  drift: boolean;
  net: CircuitNet;
  snaps: number;
  bytes: number;
  arrivals: number[];
  firstTick: number;
  lastTick: number;
  firstTickAt: number;
  lastTickAt: number;
  packets: number;
  errors: number;
  startDistance: number | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pick = <T>(xs: readonly T[], i: number) => xs[i % xs.length]!;

function stateOf(room: Room): any {
  return room.state as any;
}

/** Resolves on the first full state (a plain SDK Room has no waitForInitialState). */
function initialState(room: Room, timeoutMs = 5000): Promise<void> {
  if (stateOf(room)?.phase) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    room.onStateChange.once(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function racerOf(bot: Bot): any {
  return stateOf(bot.room)?.racers?.get?.(bot.playerId);
}

async function connect(client: Client, idx: number, code: string | null, spectator = false): Promise<Bot> {
  const name = spectator ? `Watch ${String(idx + 1).padStart(2, '0')}` : `Bot ${String(idx + 1).padStart(2, '0')}`;
  const room = code
    ? await client.joinById(code, spectator ? { name, spectator: true } : { name })
    : await client.create('circuit', { name, maxPlayers: 20, settings: { laps: LAPS, track: TRACK, finishWindowSec: 45 } });
  const bot: Bot = {
    idx,
    room,
    playerId: '',
    seq: 1,
    memory: createBotMemory(),
    skill: 0.78 + ((idx * 37) % 20) / 100,
    lane: (((idx * 13) % 5) - 2) * 26,
    drift: (idx * 0.618) % 1 < DRIFT_SHARE,
    net: new CircuitNet(getTrack(TRACK), (packet) => {
      room.send(CIRCUIT_MSG.input, packet);
      bot.packets++;
    }),
    snaps: 0,
    bytes: 0,
    arrivals: [],
    firstTick: -1,
    lastTick: -1,
    firstTickAt: 0,
    lastTickAt: 0,
    packets: 0,
    errors: 0,
    startDistance: null,
  };
  // Specific handlers take precedence over '*' in the SDK, so register every type we care about explicitly.
  room.onMessage('sys:welcome', (payload: { playerId: string }) => {
    bot.playerId = payload.playerId;
  });
  room.onMessage('sys:error', () => {
    bot.errors++;
  });
  room.onMessage('*', () => undefined);
  room.onMessage(CIRCUIT_MSG.snap, (bytes: Uint8Array) => {
    const now = performance.now();
    bot.snaps++;
    bot.bytes += bytes.byteLength;
    bot.arrivals.push(now);
    const snap = decodeSnapshot(bytes);
    if (!snap) return;
    if (bot.firstTick < 0) {
      bot.firstTick = snap.tick;
      bot.firstTickAt = now;
    }
    bot.lastTick = snap.tick;
    bot.lastTickAt = now;
    const racer = racerOf(bot);
    if (racer && bot.net.local !== racer.slot) {
      const chassis = stateOf(bot.room)?.cars?.get?.(bot.playerId)?.chassis as keyof typeof CHASSIS;
      bot.net.setLocal(racer.slot, CHASSIS[chassis] ?? CHASSIS.volt);
    }
    bot.net.ingest(bytes, now);
  });
  for (const t of ['sys:toast', 'sys:time', 'sys:removed', 'chat:msg', 'chat:history', CIRCUIT_MSG.event]) room.onMessage(t, () => undefined);
  await initialState(room);
  const until = Date.now() + 5000;
  while (!bot.playerId && Date.now() < until) await sleep(20);
  if (spectator) return bot;
  room.send(CIRCUIT_MSG.car, {
    chassis: pick(CHASSIS_IDS, idx),
    primary: pick(CAR_PAINTS, idx * 3),
    secondary: pick(CAR_PAINTS, idx * 3 + 5),
    decal: pick(DECAL_IDS, idx),
    wheels: pick(WHEEL_IDS, idx),
    number: (idx * 7 + 3) % 100,
    nameplate: `BOT${idx + 1}`,
  });
  return bot;
}

function drive(bot: Bot, now: number): void {
  const phase = stateOf(bot.room)?.phase;
  if (phase !== 'COUNTDOWN' && phase !== 'PLAYING') return;
  const net = bot.net;
  if (!net.predicting) return;
  const spec = CHASSIS[(stateOf(bot.room)?.cars?.get?.(bot.playerId)?.chassis as keyof typeof CHASSIS) ?? 'volt'] ?? CHASSIS.volt;
  const track = getTrack(TRACK);
  const locked = net.status !== RaceStatusCode.racing;
  net.update(now, () => autopilot(net.predicted!, spec, track, bot.memory, { skill: bot.skill, lane: bot.lane, drift: bot.drift }), locked);
}

function pct(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
}

async function main(): Promise<void> {
  console.log(`DASh Circuit load test → ${URL} · ${BOTS} bots · ${TRACK} · ${LAPS} lap(s) · ≤${SECONDS}s`);
  const client = new Client(URL);
  const bots: Bot[] = [];
  const t0 = performance.now();
  const host = await connect(client, 0, JOIN || null);
  bots.push(host);
  const code = host.room.roomId;
  console.log(`room ${code} (${JOIN ? 'joined' : 'created'})`);
  for (let i = 1; i < BOTS; i++) {
    bots.push(await connect(client, i, code));
    await sleep(25);
  }
  const watchers: Bot[] = [];
  for (let i = 0; i < SPECTATORS; i++) {
    watchers.push(await connect(client, i, code, true));
    await sleep(25);
  }
  console.log(`${bots.length} bots + ${watchers.length} spectators connected in ${Math.round(performance.now() - t0)} ms`);
  await sleep(800);

  if (!JOIN && !NO_START) {
    host.room.send('lobby:settings', { settings: { laps: LAPS, track: TRACK } });
    await sleep(300);
    host.room.send('lobby:start', {});
  }
  // Wait for the race to begin.
  const startWait = Date.now();
  while (!['COUNTDOWN', 'PLAYING'].includes(stateOf(host.room)?.phase) && Date.now() - startWait < 120_000) await sleep(50);
  if (!['COUNTDOWN', 'PLAYING'].includes(stateOf(host.room)?.phase)) throw new Error('race never started');
  console.log('race starting…');

  const timer = setInterval(() => {
    const now = performance.now();
    for (const b of bots) drive(b, now);
  }, 1000 / CIRCUIT_SIM.tickRate);
  const raceStart = Date.now();
  let lastLog = 0;
  while (Date.now() - raceStart < SECONDS * 1000) {
    const phase = stateOf(host.room)?.phase;
    if (phase === 'PLAYING') {
      for (const b of bots) if (b.startDistance === null && racerOf(b)) b.startDistance = racerOf(b).distance;
    }
    if (phase === 'RESULTS') break;
    if (Date.now() - lastLog > 5000) {
      lastLog = Date.now();
      const laps = bots.map((b) => racerOf(b)?.lap ?? 0);
      console.log(`  t=${Math.round((Date.now() - raceStart) / 1000)}s phase=${phase} laps(min/max)=${Math.min(...laps)}/${Math.max(...laps)} finished=${bots.filter((b) => racerOf(b)?.finished).length}`);
    }
    await sleep(100);
  }
  clearInterval(timer);
  const elapsed = (Date.now() - raceStart) / 1000;

  // ------------------------------------------------------------------ report
  const intervals: number[] = [];
  for (const b of bots) for (let i = 1; i < b.arrivals.length; i++) intervals.push(b.arrivals[i]! - b.arrivals[i - 1]!);
  const totalSnaps = bots.reduce((a, b) => a + b.snaps, 0);
  const totalBytes = bots.reduce((a, b) => a + b.bytes, 0);
  const tickRates = bots.filter((b) => b.lastTickAt > b.firstTickAt).map((b) => ((b.lastTick - b.firstTick) / (b.lastTickAt - b.firstTickAt)) * 1000);
  const progressed = bots.filter((b) => {
    const r = racerOf(b);
    return r && b.startDistance !== null && r.distance > b.startDistance + 500;
  }).length;
  const lapped = bots.filter((b) => {
    const r = racerOf(b);
    return r && (r.lap >= 2 || r.finished);
  }).length;
  const finished = bots.filter((b) => racerOf(b)?.finished).length;
  const phase = stateOf(host.room)?.phase;
  const avgSnapBytes = totalSnaps ? totalBytes / totalSnaps : 0;
  const perBotRate = bots.map((b) => b.snaps / Math.max(1, (b.lastTickAt - b.firstTickAt) / 1000));
  console.log('\n=== DASh Circuit load report ===');
  console.log(`bots                     ${bots.length}`);
  console.log(`race phase at end        ${phase} after ${elapsed.toFixed(1)}s`);
  console.log(`server ticks/s (from snapshots)  mean ${(tickRates.reduce((a, b) => a + b, 0) / Math.max(1, tickRates.length)).toFixed(1)} (target ${CIRCUIT_SIM.tickRate})`);
  console.log(`snapshots/s per bot      mean ${(perBotRate.reduce((a, b) => a + b, 0) / Math.max(1, perBotRate.length)).toFixed(1)}`);
  console.log(`snapshot size            avg ${avgSnapBytes.toFixed(0)} B · downlink per bot ≈ ${((avgSnapBytes * 8 * (perBotRate[0] ?? 0)) / 1000).toFixed(1)} kbit/s`);
  console.log(`snapshot interval        p50 ${pct(intervals, 0.5).toFixed(1)} ms · p95 ${pct(intervals, 0.95).toFixed(1)} ms · max ${Math.max(0, ...intervals).toFixed(1)} ms`);
  console.log(`input packets sent       ${bots.reduce((a, b) => a + b.packets, 0)} (${(bots.reduce((a, b) => a + b.packets, 0) / Math.max(1, elapsed) / bots.length).toFixed(1)}/s per bot)`);
  console.log(`server errors received   ${bots.reduce((a, b) => a + b.errors, 0)}`);
  const stats = bots.map((b) => b.net.stats());
  console.log(`client corrections       mean ${(stats.reduce((a, s) => a + s.corrections, 0) / bots.length).toFixed(1)} per bot · mean input RTT ${(stats.reduce((a, s) => a + s.rttMs, 0) / bots.length).toFixed(0)} ms`);
  if (watchers.length) {
    const wRates = watchers.map((w) => w.snaps / Math.max(1, (w.lastTickAt - w.firstTickAt) / 1000));
    const wGaps: number[] = [];
    for (const w of watchers) for (let i = 1; i < w.arrivals.length; i++) wGaps.push(w.arrivals[i]! - w.arrivals[i - 1]!);
    const seated = watchers.filter((w) => !stateOf(w.room)?.players?.get?.(w.playerId)?.spectator).length;
    console.log(
      `spectators               ${watchers.length} (${seated} wrongly seated) · snapshots/s mean ${(wRates.reduce((a, b) => a + b, 0) / watchers.length).toFixed(1)} · interval p95 ${pct(wGaps, 0.95).toFixed(1)} ms · errors ${watchers.reduce((a, w) => a + w.errors, 0)}`,
    );
  }
  console.log(`bots that made progress  ${progressed}/${bots.length}`);
  console.log(`bots that completed ≥1 lap ${lapped}/${bots.length} · finished ${finished}/${bots.length}`);
  for (const b of bots) {
    const r = racerOf(b);
    if (!r || r.finished) continue;
    const st = b.net.latest(r.slot);
    const pr = b.net.predicted;
    console.log(
      `  unfinished ${b.idx} slot ${r.slot} lap ${r.lap} gate ${r.gate} dnf ${r.dnf} wrongWay ${r.wrongWay} server (${st?.x.toFixed(0)},${st?.y.toFixed(0)}) v=${st ? Math.hypot(st.vx, st.vy).toFixed(0) : '-'} predicted (${pr?.x.toFixed(0)},${pr?.y.toFixed(0)}) corrections ${b.net.stats().corrections} pending ${b.net.stats().pendingInputs}`,
    );
  }
  const ok = progressed === bots.length && (phase === 'RESULTS' || lapped === bots.length || elapsed < SECONDS);
  console.log(ok ? 'RESULT: healthy' : 'RESULT: check the numbers above');
  for (const b of [...bots, ...watchers]) await b.room.leave(true).catch(() => undefined);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
