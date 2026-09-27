/**
 * DASphalt GP load test.
 *
 * Connects N human clients (default 8) to one kart room, starts a race via the host client, and
 * drives every kart like a real browser would: a 60 Hz local loop with client prediction
 * (game-core `KartPredictor`) and a jittery line-following driver, sending 2 frames per packet
 * (~30 packets/s). Measures, from the server (`kart:diag`, relaxed-limit servers only) and the
 * clients: tick time avg/p99/max, event-loop delay, memory, snapshot size + rate, per-client
 * downstream bandwidth, input packets processed/dropped, prediction corrections and ack lag, race
 * completion correctness, and (optionally) disconnect churn.
 *
 *   LOAD_URL=http://localhost:2831 pnpm load:kart -- --clients 16
 *     --clients 8        human clients (1..30)
 *     --bots 0           computer racers the host adds (never more than the free grid slots)
 *     --laps 1           race length
 *     --track pixel-plaza
 *     --items on|off
 *     --seconds 150      max race duration
 *     --churn 0          disconnect + auto-reconnect this many random clients during the race
 *     --spectators 0     extra passive spectator clients
 *     --spikes 0         lag spikes: a random client stops sending for 0.4–2 s (still predicting), then flushes
 *                        the backlog in max-size packets (a Wi-Fi stall), this many times during the race
 *     --hostile 0        this many racing clients also spam junk every frame (malformed inputs, replays,
 *                        oversized arrays, look/next/settings/chat spam)
 *     --mode race|gp     gp = a whole four-race cup (the intermission advances on its own)
 *     --driver bot|line  bot = game-core KartBot on the predicted state (+ steering jitter), line = a simple
 *                        line follower
 *     --json FILE        also write the report as JSON
 *
 * The server must run with DASCADE_RELAXED_LIMITS=1 (per-IP limits + the diag message).
 */
import fs from 'node:fs';
import { Client, type Room } from '@colyseus/sdk';
import {
  KART_INPUT_MAX,
  KART_MSG,
  KART_RACER_IDS,
  KART_SIM,
  KART_TRACK_IDS,
  quantizeKartInput,
  type KartInput,
  type KartTrackId,
} from '../packages/shared/src/games/kart.ts';
import {
  KartBot,
  KartPredictor,
  newStepInfo,
  decodeKartOwn,
  decodeKartSnapshot,
  getKartTrack,
  groundAt,
  pointAtS,
  racerSpec,
  type KartTrack,
} from '../packages/game-core/src/kart/index.ts';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--')) return process.argv[i + 1]!;
  return fallback;
}

const URL = process.env.LOAD_URL ?? 'http://localhost:2831';
const CLIENTS = Math.max(1, Math.min(30, Number(arg('clients', '8'))));
const BOTS = Math.max(0, Math.min(11, Number(arg('bots', '0'))));
const LAPS = Math.max(1, Math.min(5, Number(arg('laps', '1'))));
const TRACK = arg('track', 'pixel-plaza') as KartTrackId;
const ITEMS = arg('items', 'on') !== 'off';
const SECONDS = Math.max(10, Number(arg('seconds', arg('mode', 'race') === 'gp' ? '600' : '150')));
const CHURN = Math.max(0, Number(arg('churn', '0')));
const SPECTATORS = Math.max(0, Math.min(30, Number(arg('spectators', '0'))));
const JSON_OUT = arg('json', '');
const MODE = arg('mode', 'race') === 'gp' ? 'gp' : 'race';
const DRIVER = arg('driver', 'bot') === 'line' ? 'line' : 'bot';
const SPIKES = Math.max(0, Number(arg('spikes', '0')));
const HOSTILE = Math.max(0, Math.min(CLIENTS - 1, Number(arg('hostile', '0'))));
if (!KART_TRACK_IDS.includes(TRACK)) throw new Error(`unknown track ${TRACK}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Diag {
  room: Record<string, number>;
  process: Record<string, number>;
  karts: number;
  snapEvery: number;
}

interface Racer {
  idx: number;
  room: Room;
  playerId: string;
  spectator: boolean;
  track: KartTrack;
  pred: KartPredictor | null;
  slot: number;
  raceId: number;
  brain: KartBot | null;
  stateLagged: number;
  pending: number[];
  firstSeq: number;
  tickLocal: number;
  // driver personality
  lane: number;
  wobble: number;
  jitterPhase: number;
  lookAhead: number;
  // measurements
  snaps: number;
  snapBytes: number;
  ownBytes: number;
  owns: number;
  wireBytes: number;
  arrivals: number[];
  packets: number;
  errors: number;
  corrections: number;
  bigCorrections: number;
  ackLag: number[];
  reconnects: number;
  stallUntil: number;
  stalls: number;
  hostile: boolean;
  junk: number;
  diag: Diag | null;
  lastSnapTick: number;
  lastSnapStatus: string;
  goTick: number;
}

function stateOf(room: Room): any {
  return room.state as any;
}

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

/** Counts every byte the socket receives (schema patches + snapshots + events). */
function meterSocket(r: Racer): void {
  const ws = (r.room as any).connection?.transport?.ws;
  if (!ws || typeof ws.addEventListener !== 'function') return;
  ws.addEventListener('message', (e: { data: unknown }) => {
    const d = e.data as { byteLength?: number; length?: number } | string;
    r.wireBytes += typeof d === 'string' ? d.length : (d?.byteLength ?? d?.length ?? 0);
  });
}

function wire(r: Racer): void {
  const room = r.room;
  room.onMessage('sys:welcome', (payload: { playerId: string }) => {
    r.playerId = payload.playerId;
  });
  room.onMessage('sys:error', () => {
    r.errors++;
  });
  room.onMessage('kart:diag', (d: Diag) => {
    r.diag = d;
  });
  for (const t of ['sys:toast', 'sys:time', 'sys:removed', 'chat:msg', 'chat:history', 'dj:state', KART_MSG.event])
    room.onMessage(t, () => undefined);
  room.onMessage('*', () => undefined);
  room.onMessage(KART_MSG.snap, (bytes: Uint8Array) => onSnap(r, bytes));
  room.onMessage(KART_MSG.own, (bytes: Uint8Array) => onOwn(r, bytes));
  meterSocket(r);
  room.onReconnect(() => {
    r.reconnects++;
    meterSocket(r);
  });
}

function onSnap(r: Racer, bytes: Uint8Array): void {
  r.snaps++;
  r.snapBytes += bytes.byteLength;
  r.arrivals.push(performance.now());
  const snap = decodeKartSnapshot(bytes);
  if (!snap) return;
  r.lastSnapTick = snap.tick;
  r.lastSnapStatus = snap.status;
  r.goTick = snap.goTick;
}

/** Our kart's exact state + ack: reconcile the prediction like the real client. */
function onOwn(r: Racer, bytes: Uint8Array): void {
  r.owns++;
  r.ownBytes += bytes.byteLength;
  const own = decodeKartOwn(bytes);
  if (!own || r.spectator) return;
  if (r.slot !== own.slot || r.raceId !== own.raceId || !r.pred) {
    // A new race (Grand Prix round / rematch): fresh prediction, sequence restarts at 1.
    r.slot = own.slot;
    r.raceId = own.raceId;
    r.pending = [];
    const look = stateOf(r.room)?.looks?.get?.(r.playerId);
    const race = stateOf(r.room)?.race;
    // The server patches the new race's meta before its first snapshot, so the track id is current.
    if (race?.raceId !== own.raceId) r.stateLagged++;
    r.track = getKartTrack((race?.trackId as KartTrackId) ?? TRACK);
    r.pred = new KartPredictor(r.track, racerSpec(look?.racer ?? 'nova'));
    r.brain = new KartBot(r.idx % 3 === 0 ? 'hard' : 'normal', 1000 + r.idx);
    r.tickLocal = own.tick;
  }
  if (r.pred.seq > 0) r.ackLag.push(Math.max(0, r.pred.seq - own.ack));
  const err = r.pred.reconcile(own.state, own.ack, own.tick, r.lastSnapStatus === 'racing');
  if (err > 0.25) r.corrections++;
  if (err > 3) r.bigCorrections++;
  // Keep the local tick near the server's (the real client syncs its clock the same way).
  if (Math.abs(r.tickLocal - own.tick) > 30) r.tickLocal = own.tick;
}

/**
 * The core's bot brain driving our *predicted* kart (a facade of the sim it expects: just our kart,
 * no rivals or entities), plus steering jitter like a thumb on a touch screen.
 */
function thinkBot(r: Racer, t: number): KartInput {
  const pred = r.pred!;
  const state = pred.state!;
  const row = stateOf(r.room)?.racers?.get?.(r.playerId);
  const kart = {
    slot: r.slot,
    state,
    info: pred.info ?? newStepInfo(),
    spec: pred.spec,
    distance: row?.distance ?? 0,
    position: row?.position ?? 1,
    retired: false,
  };
  const status = r.lastSnapStatus === 'grid' ? 'grid' : r.lastSnapStatus === 'done' ? 'done' : 'racing';
  const simLike = { track: r.track, status, goTick: r.goTick, tick: r.tickLocal, karts: [kart], entities: [], isGhost: () => false };
  const input = r.brain!.think(simLike as never, kart as never);
  const jitter = Math.sin(t * 3.1 + r.jitterPhase) * 0.08 + (Math.random() - 0.5) * 0.12;
  return quantizeKartInput({ ...input, steer: Math.max(-1, Math.min(1, input.steer + jitter)) });
}

/** A jittery line-following driver: aims at a point ahead on the centreline (+ its own lane). */
function think(r: Racer, t: number): KartInput {
  const s0 = r.pred!.state;
  if (!s0) return quantizeKartInput({ throttle: 1, brake: 0, steer: 0, drift: false, item: false, back: false });
  const g = groundAt(r.track, s0.x, s0.y, { branch: s0.branch, seg: s0.seg });
  const ahead = pointAtS(r.track, (g.s + r.lookAhead) % r.track.length);
  // Left normal of the tangent is (-ty, tx).
  const lane = r.lane + Math.sin(t * 0.7 + r.jitterPhase) * r.wobble;
  const tx = ahead.x - ahead.ty * lane - s0.x;
  const ty = ahead.y + ahead.tx * lane - s0.y;
  const hx = Math.cos(s0.heading);
  const hy = Math.sin(s0.heading);
  const cross = hx * ty - hy * tx; // > 0: target is to the left
  const dot = hx * tx + hy * ty;
  const ang = Math.atan2(cross, dot);
  const noise = (Math.random() - 0.5) * 0.25;
  const steer = Math.max(-1, Math.min(1, ang * 2.2 + noise));
  const sharp = Math.abs(ang) > 0.35;
  return quantizeKartInput({
    throttle: sharp && Math.random() < 0.1 ? 0.6 : 1,
    brake: 0,
    steer,
    drift: sharp && Math.abs(ang) < 1.2,
    item: Math.random() < 0.02,
    back: Math.random() < 0.2,
  });
}

function driveTick(r: Racer, t: number): void {
  if (r.spectator || !r.pred) return;
  const phase = stateOf(r.room)?.phase;
  if (phase !== 'COUNTDOWN' && phase !== 'PLAYING') return;
  if (!r.room.connection?.isOpen) return;
  const locked = r.lastSnapStatus === 'grid';
  r.tickLocal++;
  const input = DRIVER === 'bot' && r.pred.state ? thinkBot(r, t) : think(r, t);
  const frame = r.pred.step(input, locked, r.tickLocal);
  if (r.pending.length === 0) r.firstSeq = frame.seq;
  r.pending.push(frame.packed);
  if (r.hostile) spam(r);
  if (performance.now() < r.stallUntil) return; // stalled link: keep predicting, send nothing
  // Normal cadence: 2 frames per packet; after a stall, flush the backlog in max-size packets.
  while (r.pending.length >= KART_SIM.inputEvery) {
    const n = Math.min(r.pending.length, KART_SIM.maxInputsPerPacket);
    r.room.send(KART_MSG.input, { seq: r.firstSeq, inputs: r.pending.slice(0, n) });
    r.packets++;
    r.firstSeq += n;
    r.pending = r.pending.slice(n);
  }
}

/** A hostile client: junk on every frame, alongside its real inputs. */
function spam(r: Racer): void {
  const k = r.junk++ % 10;
  const room = r.room;
  if (k === 0)
    room.send(KART_MSG.input, { seq: 1, inputs: [0, 0] }); // replay
  else if (k === 1)
    room.send(KART_MSG.input, { seq: r.firstSeq + 5000, inputs: Array.from({ length: 8 }, () => KART_INPUT_MAX) }); // far-future + max input
  else if (k === 2) room.send(KART_MSG.input, { seq: Number.NaN, inputs: [1e9] });
  else if (k === 3) room.send(KART_MSG.input, { seq: 1, inputs: Array.from({ length: 500 }, () => 1) });
  else if (k === 4) room.send(KART_MSG.look, { racer: 'nova', body: 'buggy', paint: 'javascript:alert(1)' });
  else if (k === 5) room.send(KART_MSG.next, {});
  else if (k === 6) room.send('lobby:settings', { settings: { laps: 5, bots: 11 } });
  else if (k === 7) room.send('chat:send', { text: 'x'.repeat(2000) });
  else if (k === 8) room.send(KART_MSG.input, 'x'.repeat(20_000));
  else room.send(KART_MSG.input, { seq: r.firstSeq, inputs: [0], x: 1e9, lap: 99, finished: true });
}

async function connect(client: Client, idx: number, code: string | null, spectator = false): Promise<Racer> {
  const name = spectator ? `Watch ${String(idx + 1).padStart(2, '0')}` : `Load ${String(idx + 1).padStart(2, '0')}`;
  const room = code
    ? await client.joinById(code, spectator ? { name, spectator: true } : { name })
    : await client.create('kart', {
        name,
        maxPlayers: 30,
        settings: { laps: LAPS, track: TRACK, items: ITEMS, bots: BOTS, mode: MODE, finishWindowSec: 45 },
      });
  const r: Racer = {
    idx,
    room,
    playerId: '',
    spectator,
    track: getKartTrack(TRACK),
    pred: null,
    slot: -1,
    raceId: -1,
    brain: null,
    stateLagged: 0,
    pending: [],
    firstSeq: 1,
    tickLocal: 0,
    lane: (((idx * 13) % 7) - 3) * 1.4,
    wobble: 0.5 + ((idx * 37) % 10) / 10,
    jitterPhase: idx * 1.7,
    lookAhead: 14 + ((idx * 7) % 8),
    snaps: 0,
    snapBytes: 0,
    ownBytes: 0,
    owns: 0,
    wireBytes: 0,
    arrivals: [],
    packets: 0,
    errors: 0,
    corrections: 0,
    bigCorrections: 0,
    ackLag: [],
    reconnects: 0,
    stallUntil: 0,
    stalls: 0,
    hostile: false,
    junk: 0,
    diag: null,
    lastSnapTick: 0,
    lastSnapStatus: 'grid',
    goTick: -1,
  };
  wire(r);
  room.reconnection.minUptime = 0;
  await initialState(room);
  const until = Date.now() + 5000;
  while (!r.playerId && Date.now() < until) await sleep(20);
  if (!spectator) room.send(KART_MSG.look, { racer: KART_RACER_IDS[idx % KART_RACER_IDS.length], body: 'buggy', paint: '#22d3ee' });
  return r;
}

function pct(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function diag(host: Racer, reset = false): Promise<Diag | null> {
  host.diag = null;
  host.room.send('kart:diag', { reset });
  const until = Date.now() + 2000;
  while (!host.diag && Date.now() < until) await sleep(20);
  return host.diag;
}

async function main(): Promise<void> {
  console.log(
    `DASphalt GP load → ${URL} · ${CLIENTS} clients (${DRIVER} driver) + ${BOTS} bots · ${TRACK} · ${LAPS} lap(s) · items ${ITEMS ? 'on' : 'off'}`,
  );
  const client = new Client(URL);
  const racers: Racer[] = [];
  const t0 = performance.now();
  const host = await connect(client, 0, null);
  racers.push(host);
  const code = host.room.roomId;
  for (let i = 1; i < CLIENTS; i++) {
    racers.push(await connect(client, i, code));
    await sleep(20);
  }
  for (let i = 0; i < HOSTILE; i++) racers[racers.length - 1 - i]!.hostile = true;
  const watchers: Racer[] = [];
  for (let i = 0; i < SPECTATORS; i++) watchers.push(await connect(client, i, code, true));
  console.log(`room ${code}: ${racers.length} clients + ${watchers.length} spectators in ${Math.round(performance.now() - t0)} ms`);
  await sleep(600);
  const before = await diag(host, true);
  if (!before) console.log('(no kart:diag reply — start the server with DASCADE_RELAXED_LIMITS=1 for server-side numbers)');
  const memSamples: number[] = [];

  host.room.send('lobby:start', {});
  const startWait = Date.now();
  while (!['COUNTDOWN', 'PLAYING'].includes(stateOf(host.room)?.phase) && Date.now() - startWait < 10_000) await sleep(20);
  if (!['COUNTDOWN', 'PLAYING'].includes(stateOf(host.room)?.phase)) throw new Error('race never started');
  for (const r of [...racers, ...watchers]) {
    r.arrivals = [];
    r.snaps = r.snapBytes = r.wireBytes = r.ownBytes = r.owns = 0;
  }

  const clock0 = performance.now();
  const loop = setInterval(() => {
    const t = (performance.now() - clock0) / 1000;
    for (const r of racers) driveTick(r, t);
  }, 1000 / KART_SIM.tickRate);

  // Disconnect churn: drop random clients' sockets (auto-reconnect inside the grace).
  const churned = new Set<number>();
  const churnTimers: NodeJS.Timeout[] = [];
  for (let k = 0; k < CHURN; k++) {
    churnTimers.push(
      setTimeout(
        () => {
          const victim = racers[1 + Math.floor(Math.random() * Math.max(1, racers.length - 1))] ?? racers[0]!;
          churned.add(victim.idx);
          try {
            (victim.room as any).connection.transport.ws.close(4010);
          } catch {
            /* already closed */
          }
        },
        6000 + k * 4000,
      ),
    );
  }

  for (let k = 0; k < SPIKES; k++) {
    churnTimers.push(
      setTimeout(
        () => {
          const victim = racers[Math.floor(Math.random() * racers.length)]!;
          victim.stallUntil = performance.now() + 400 + Math.random() * 1600;
          victim.stalls++;
        },
        5000 + (k * 30_000) / Math.max(1, SPIKES),
      ),
    );
  }

  const raceStart = Date.now();
  let lastLog = 0;
  let lastIntermission = -1;
  const intermissions: Array<{ round: number; at: number; endsAt: number }> = [];
  let playingAt = 0;
  while (Date.now() - raceStart < SECONDS * 1000) {
    const phase = stateOf(host.room)?.phase;
    if (phase === 'PLAYING' && !playingAt) playingAt = Date.now();
    if (phase === 'RESULTS' || phase === 'LOBBY') break;
    if (phase === 'INTERMISSION') {
      const round = stateOf(host.room)?.race?.round;
      if (round !== lastIntermission) {
        lastIntermission = round;
        intermissions.push({ round, at: Date.now(), endsAt: stateOf(host.room)?.phaseEndsAt });
        console.log(`  intermission after race ${round}`);
      }
    }
    if (Date.now() - lastLog > 5000) {
      lastLog = Date.now();
      const d = await diag(host);
      if (d) memSamples.push(d.process.rssMb ?? 0);
      const rs = [...(stateOf(host.room)?.racers?.values?.() ?? [])] as any[];
      console.log(
        `  t=${Math.round((Date.now() - raceStart) / 1000)}s ${phase} laps ${Math.min(...rs.map((x) => x.lap))}-${Math.max(...rs.map((x) => x.lap))} finished ${rs.filter((x) => x.finished).length}/${rs.length}` +
          (d
            ? ` · tick avg ${d.room.stepMsAvg!.toFixed(2)} p99 ${d.room.stepMsP99!.toFixed(2)} max ${d.room.stepMsMax!.toFixed(1)} ms · loop p99 ${d.process.loopDelayP99Ms!.toFixed(1)} ms · rss ${d.process.rssMb!.toFixed(0)} MB`
            : ''),
      );
    }
    await sleep(100);
  }
  clearInterval(loop);
  for (const t of churnTimers) clearTimeout(t);
  const elapsed = (Date.now() - (playingAt || raceStart)) / 1000;
  const end = await diag(host);

  // ---------------------------------------------------------------- correctness
  const phase = stateOf(host.room)?.phase;
  const rows = [...(stateOf(host.room)?.racers?.values?.() ?? [])] as any[];
  const finishOrders = rows
    .filter((x) => x.finished)
    .map((x) => x.finishOrder)
    .sort((a, b) => a - b);
  const ordersOk = finishOrders.every((o, i) => o === i + 1);
  const positions = rows.map((x) => x.position).sort((a, b) => a - b);
  const positionsOk = positions.every((p, i) => p === i + 1);
  const settled = rows.every((x) => x.finished || x.dnf);
  const humansFinished = racers.filter((r) => stateOf(host.room)?.racers?.get?.(r.playerId)?.finished).length;

  // ---------------------------------------------------------------- report
  const intervals: number[] = [];
  for (const r of racers) for (let i = 1; i < r.arrivals.length; i++) intervals.push(r.arrivals[i]! - r.arrivals[i - 1]!);
  const dur = Math.max(1, (Date.now() - raceStart) / 1000);
  const snapRate = mean(racers.map((r) => r.snaps / dur));
  const snapSize = mean(racers.filter((r) => r.snaps).map((r) => r.snapBytes / r.snaps));
  const downKbps = mean(racers.map((r) => (r.wireBytes * 8) / 1000 / dur));
  const snapKbps = mean(racers.map((r) => (r.snapBytes * 8) / 1000 / dur));
  const ownKbps = mean(racers.map((r) => (r.ownBytes * 8) / 1000 / dur));
  const lagFrames = racers.flatMap((r) => r.ackLag);
  const frameMs = 1000 / KART_SIM.tickRate;
  const report = {
    clients: CLIENTS,
    bots: BOTS,
    karts: end?.karts ?? rows.length,
    track: TRACK,
    laps: LAPS,
    items: ITEMS,
    mode: MODE,
    driver: DRIVER,
    phaseAtEnd: phase,
    raceSeconds: Number(elapsed.toFixed(1)),
    server: end
      ? {
          tickMsAvg: Number(end.room.stepMsAvg!.toFixed(3)),
          tickMsP99: Number(end.room.stepMsP99!.toFixed(3)),
          tickMsMax: Number(end.room.stepMsMax!.toFixed(2)),
          loopDelayMeanMs: Number(end.process.loopDelayMeanMs!.toFixed(2)),
          loopDelayP99Ms: Number(end.process.loopDelayP99Ms!.toFixed(2)),
          loopDelayMaxMs: Number(end.process.loopDelayMaxMs!.toFixed(1)),
          rssMb: Number(end.process.rssMb!.toFixed(0)),
          rssMbMax: Number(memSamples.reduce((a, b) => Math.max(a, b), end.process.rssMb!).toFixed(0)),
          heapUsedMb: Number(end.process.heapUsedMb!.toFixed(0)),
          snapEvery: end.snapEvery,
          snapshotBytesAvg: Number(end.room.snapshotBytesAvg!.toFixed(0)),
          snapshotBytesMax: end.room.snapshotBytesMax,
          inputPackets: end.room.inputPackets,
          inputFrames: end.room.inputFrames,
          inputFramesDropped: end.room.inputFramesDropped,
          inputPacketsIgnored: end.room.inputPacketsIgnored,
          seqRestarts: end.room.seqRestarts,
        }
      : null,
    client: {
      snapshotsPerSec: Number(snapRate.toFixed(1)),
      snapshotBytesAvg: Number(snapSize.toFixed(0)),
      snapIntervalP50: Number(pct(intervals, 0.5).toFixed(1)),
      snapIntervalP95: Number(pct(intervals, 0.95).toFixed(1)),
      snapIntervalMax: Number(intervals.reduce((a, b) => Math.max(a, b), 0).toFixed(1)),
      downstreamKbpsPerClient: Number(downKbps.toFixed(1)),
      snapshotKbpsPerClient: Number(snapKbps.toFixed(1)),
      ownKbpsPerClient: Number(ownKbps.toFixed(1)),
      ownPerSec: Number(mean(racers.map((r) => r.owns / dur)).toFixed(1)),
      packetsSentPerSecPerClient: Number((racers.reduce((a, r) => a + r.packets, 0) / dur / racers.length).toFixed(1)),
      correctionsPerClientPerMin: Number(((racers.reduce((a, r) => a + r.corrections, 0) / racers.length / dur) * 60).toFixed(1)),
      bigCorrectionsPerClientPerMin: Number(((racers.reduce((a, r) => a + r.bigCorrections, 0) / racers.length / dur) * 60).toFixed(1)),
      ackLagMsP50: Number((pct(lagFrames, 0.5) * frameMs).toFixed(0)),
      ackLagMsP95: Number((pct(lagFrames, 0.95) * frameMs).toFixed(0)),
      errors: racers.reduce((a, r) => a + r.errors, 0),
      ownBeforeStatePatch: racers.reduce((a, r) => a + r.stateLagged, 0),
    },
    churn: { requested: CHURN, dropped: churned.size, reconnected: racers.filter((r) => churned.has(r.idx) && r.reconnects > 0).length },
    adversarial: {
      spikes: racers.reduce((a, r) => a + r.stalls, 0),
      hostileClients: HOSTILE,
      junkMessages: racers.reduce((a, r) => a + r.junk, 0),
      hostileStillConnected: racers.filter((r) => r.hostile && r.room.connection?.isOpen).length,
      hostileErrorsReceived: racers.filter((r) => r.hostile).reduce((a, r) => a + r.errors, 0),
      honestErrorsReceived: racers.filter((r) => !r.hostile).reduce((a, r) => a + r.errors, 0),
      honestFinished: racers.filter((r) => !r.hostile && stateOf(host.room)?.racers?.get?.(r.playerId)?.finished).length,
      honestClients: racers.filter((r) => !r.hostile).length,
    },
    gp:
      MODE === 'gp'
        ? {
            intermissions: intermissions.length,
            rounds: stateOf(host.room)?.race?.round,
            rows: stateOf(host.room)?.gp?.size ?? 0,
            everyRowHas4Places: [...(stateOf(host.room)?.gp?.values?.() ?? [])].every((row: any) => row.places.length === 4),
            pointsTotal: [...(stateOf(host.room)?.gp?.values?.() ?? [])].reduce((a: number, row: any) => a + row.points, 0),
            leader: (() => {
              const rows = [...(stateOf(host.room)?.gp?.values?.() ?? [])] as any[];
              rows.sort((a, b) => b.points - a.points);
              return rows[0] ? `${rows[0].name} ${rows[0].points}` : null;
            })(),
          }
        : null,
    correctness: {
      settled,
      finishOrdersOk: ordersOk,
      positionsOk,
      humansFinished,
      entrants: rows.length,
      dnf: rows.filter((x) => x.dnf).length,
    },
  };
  console.log('\n=== DASphalt GP load report ===');
  console.log(JSON.stringify(report, null, 2));
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  for (const r of [...racers, ...watchers]) await r.room.leave(true).catch(() => undefined);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
