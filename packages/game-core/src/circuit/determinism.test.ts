/**
 * The circuit engine runs on the server (authoritative) and in client prediction/replay
 * (apps/web/src/games/circuit/net/netClient.ts), and both sides build the track geometry.
 * Math.sin/cos/atan2/hypot/pow/exp are not correctly rounded, so browsers and Node may
 * disagree in the last bit and predicted cars would drift from the server. These tests
 * pin the rule from CLAUDE.md: the shared simulation uses only + − × ÷, Math.sqrt and
 * exact rounding (trigonometry comes from ../detmath).
 */
import { describe, expect, it } from 'vitest';
import { CIRCUIT_TRACK_IDS, packInput, type ChassisId, type CircuitTrackId } from '@dascade/shared/games/circuit';
import { autopilot, createBotMemory } from './bot.ts';
import { generateDecor } from './decor.ts';
import { RaceSim, type SimOptions } from './sim.ts';
import { buildTrack, type Track } from './track.ts';
import { TRACK_DEFS } from './tracks.ts';

// Typed without @types/node (game-core must stay free of Node-only APIs).
const NODE_FS = 'node:fs';
const fs = (await import(/* @vite-ignore */ NODE_FS)) as {
  readFileSync(path: URL, encoding: 'utf8'): string;
  readdirSync(path: URL): string[];
};

const FORBIDDEN_MATH = /\bMath\s*\.\s*(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|hypot|pow|exp|expm1|log|log1p|log2|log10|cbrt)\b/;

/** Source with comments removed and string/template literal contents blanked (line breaks kept). */
function codeOnly(src: string): string {
  const breaks = (from: number, to: number) => src.slice(from, to).replace(/[^\n]/g, '');
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const to = end < 0 ? src.length : end + 2;
      out += ' ' + breaks(i, to);
      i = to;
    } else if (c === "'" || c === '"' || c === '`') {
      const from = i;
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      i++;
      out += c + c + breaks(from, i);
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function violations(file: URL): string[] {
  const found: string[] = [];
  codeOnly(fs.readFileSync(file, 'utf8'))
    .split('\n')
    .forEach((line, idx) => {
      if (FORBIDDEN_MATH.test(line) || /\bMath\s*\[/.test(line) || /\}\s*=\s*Math\b/.test(line) || line.includes('**')) {
        found.push(`${file.pathname.split('/').slice(-2).join('/')}:${idx + 1}: ${line.trim()}`);
      }
    });
  return found;
}

const TRANSCENDENTALS = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'exp', 'expm1', 'log', 'log1p', 'log2', 'log10', 'pow', 'hypot', 'cbrt'] as const;

/**
 * Run `fn` while every transcendental Math function returns a slightly different value,
 * standing in for another JS engine's last-bit differences.
 */
function withPerturbedMath<T>(fn: () => T): T {
  const m = Math as unknown as Record<string, (...args: number[]) => number>;
  const saved = TRANSCENDENTALS.map((name) => [name, m[name]!] as const);
  for (const [name, orig] of saved) m[name] = (...args: number[]) => orig(...args) * (1 + 1e-6);
  try {
    return fn();
  } finally {
    for (const [name, orig] of saved) m[name] = orig;
  }
}

function trackData(t: Track) {
  return { n: t.n, xs: t.xs, ys: t.ys, tx: t.tx, ty: t.ty, s: t.s, segLen: t.segLen, curvature: t.curvature, length: t.length, grid: t.grid, bridges: t.bridges, gates: t.gates };
}

const OPTS: SimOptions = { laps: 1, collisions: true, boost: true, tickRate: 60, finishWindowMs: 10_000, maxRaceMs: 240_000 };

/** A packed 4-car autopilot race on a freshly built track: a snapshot every half second + the collision count. */
function raceSnapshots(trackId: CircuitTrackId, ticks: number): { snaps: Uint8Array[]; collisions: number } {
  const sim = new RaceSim(buildTrack(TRACK_DEFS[trackId]), OPTS);
  const chassis: ChassisId[] = ['volt', 'comet', 'pixel', 'brick'];
  const drivers = chassis.map((c, slot) => {
    sim.addCar(slot, `p${slot}`, c);
    return { slot, seq: 1, memory: createBotMemory() };
  });
  sim.go();
  const snaps: Uint8Array[] = [];
  let collisions = 0;
  for (let t = 0; t < ticks && sim.status !== 'done'; t++) {
    for (const d of drivers) {
      const car = sim.car(d.slot)!;
      const input = autopilot(car.state, car.spec, sim.track, d.memory, { skill: 0.95, lane: 0, drift: d.slot % 2 === 0 });
      sim.pushInputs(d.slot, d.seq++, [packInput(input)]);
    }
    collisions += sim.step().filter((e) => e.type === 'collision').length;
    if (t % 30 === 0) snaps.push(sim.encodeSnapshot());
  }
  snaps.push(sim.encodeSnapshot());
  return { snaps, collisions };
}

describe('circuit determinism across JS engines', () => {
  it('shared simulation sources use no transcendental Math functions', () => {
    const dir = new URL('./', import.meta.url);
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => new URL(f, dir));
    expect(files.map((f) => f.pathname.split('/').pop())).toEqual(expect.arrayContaining(['car.ts', 'collide.ts', 'track.ts', 'sim.ts', 'math.ts']));
    files.push(new URL('../detmath/index.ts', import.meta.url));
    expect(files.flatMap(violations)).toEqual([]);
  });

  it('the guard catches forbidden calls (and ignores comments and strings)', () => {
    expect(FORBIDDEN_MATH.test(codeOnly('const a = Math.atan2(y, x);'))).toBe(true);
    expect(FORBIDDEN_MATH.test(codeOnly('const a = Math . hypot(y, x);'))).toBe(true);
    expect(FORBIDDEN_MATH.test(codeOnly('// Math.cos(x) is not allowed\n/* Math.sin */ const s = "Math.pow(2, 3)";'))).toBe(false);
  });

  it('track geometry does not depend on the engine’s Math.* implementations', () => {
    for (const id of CIRCUIT_TRACK_IDS) {
      const reference = trackData(buildTrack(TRACK_DEFS[id]));
      const perturbed = withPerturbedMath(() => trackData(buildTrack(TRACK_DEFS[id])));
      expect(perturbed, id).toEqual(reference);
    }
  });

  it('a 4-car race with collisions, drift and boost is bit-identical under perturbed Math.*', () => {
    // Sanity: the perturbation is live inside the wrapper.
    expect(withPerturbedMath(() => Math.cos(1))).not.toBe(Math.cos(1));
    for (const id of ['neon-loop', 'skyline-switchback'] as const) {
      const reference = raceSnapshots(id, 60 * 12);
      expect(reference.collisions, id).toBeGreaterThan(0);
      const perturbed = withPerturbedMath(() => raceSnapshots(id, 60 * 12));
      expect(perturbed, id).toEqual(reference);
    }
  });

  it('scenery is identical on every client', () => {
    const id = CIRCUIT_TRACK_IDS[0]!;
    const reference = generateDecor(buildTrack(TRACK_DEFS[id]));
    expect(withPerturbedMath(() => generateDecor(buildTrack(TRACK_DEFS[id])))).toEqual(reference);
  });
});
