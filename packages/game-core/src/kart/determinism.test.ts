/**
 * The kart engine runs on the server and in client prediction (and every client builds the track),
 * so it must be bit-identical on every JS engine: only + − × ÷, Math.sqrt and exact rounding in the
 * shared sources (trigonometry from ../detmath). Same guard as DASh Circuit's determinism test.
 */
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { KART_RACER_IDS, type KartTrackId } from '@dascade/shared/games/kart';
import { buildTrack, KART_TRACK_DEFS } from './index.ts';
import { KartSim } from './sim.ts';
import type { KartTrack } from './track.ts';

const NODE_FS = 'node:fs';
const fs = (await import(/* @vite-ignore */ NODE_FS)) as {
  readFileSync(path: URL, encoding: 'utf8'): string;
  readdirSync(path: URL): string[];
};

const FORBIDDEN_MATH =
  /\bMath\s*\.\s*(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|hypot|pow|exp|expm1|log|log1p|log2|log10|cbrt)\b/;

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

const TRANSCENDENTALS = [
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'exp',
  'expm1',
  'log',
  'log1p',
  'log2',
  'log10',
  'pow',
  'hypot',
  'cbrt',
] as const;

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

function trackData(t: KartTrack) {
  const { def: _def, ...rest } = t;
  return rest;
}

/** A packed 8-kart bot race with items and bumps: a snapshot + own record every 10 ticks. */
function race(id: KartTrackId, ticks: number, seed: number) {
  const track = buildTrack(KART_TRACK_DEFS[id]);
  const sim = new KartSim(track, { laps: 2, items: true, finishWindowMs: 10_000, maxRaceMs: 300_000 }, createSeededRng(seed), 7);
  for (let i = 0; i < 8; i++) sim.addRacer(i, 'b' + i, KART_RACER_IDS[i]!, i % 3 === 0 ? 'hard' : i % 3 === 1 ? 'normal' : 'easy');
  sim.startCountdown(60);
  const out: Uint8Array[] = [];
  let bumps = 0;
  let hits = 0;
  for (let t = 0; t < ticks && sim.status !== 'done'; t++) {
    for (const e of sim.step()) {
      if (e.type === 'bump') bumps++;
      if (e.type === 'hit') hits++;
    }
    if (t % 10 === 0) {
      out.push(sim.encodeSnapshot());
      for (let s = 0; s < 8; s++) out.push(sim.encodeOwn(s)!);
    }
  }
  return { out, bumps, hits };
}

describe('kart determinism across JS engines', () => {
  it('shared simulation sources use no transcendental Math functions', () => {
    const dir = new URL('./', import.meta.url);
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => new URL(f, dir));
    const tracks = new URL('./tracks/', import.meta.url);
    for (const f of fs.readdirSync(tracks)) if (f.endsWith('.ts') && !f.endsWith('.test.ts')) files.push(new URL(f, tracks));
    expect(files.map((f) => f.pathname.split('/').pop())).toEqual(
      expect.arrayContaining(['kart.ts', 'track.ts', 'sim.ts', 'items.ts', 'predictor.ts', 'collide.ts', 'math.ts', 'bot.ts']),
    );
    files.push(new URL('../detmath/index.ts', import.meta.url));
    expect(files.flatMap(violations)).toEqual([]);
  });

  it('the guard catches forbidden calls (and ignores comments and strings)', () => {
    expect(FORBIDDEN_MATH.test(codeOnly('const a = Math.atan2(y, x);'))).toBe(true);
    expect(FORBIDDEN_MATH.test(codeOnly('// Math.cos(x)\n/* Math.sin */ const s = "Math.pow(2, 3)";'))).toBe(false);
  });

  it('track geometry does not depend on the engine’s Math.* implementations', () => {
    for (const id of ['pixel-plaza', 'dune-drift'] as const) {
      const reference = trackData(buildTrack(KART_TRACK_DEFS[id]));
      const perturbed = withPerturbedMath(() => trackData(buildTrack(KART_TRACK_DEFS[id])));
      expect(perturbed, id).toEqual(reference);
    }
  });

  it('a seeded 8-kart race (items, bumps, bots, drifts) reproduces bit-identically, even under perturbed Math.*', () => {
    expect(withPerturbedMath(() => Math.cos(1))).not.toBe(Math.cos(1));
    for (const id of ['pixel-plaza', 'dune-drift'] as const) {
      const reference = race(id, 60 * 20, 3);
      expect(reference.bumps, id).toBeGreaterThan(0);
      expect(race(id, 60 * 20, 3), id).toEqual(reference);
      expect(
        withPerturbedMath(() => race(id, 60 * 20, 3)),
        id,
      ).toEqual(reference);
    }
  });

  it('different seeds give different races (the rng really drives items/bots)', () => {
    expect(race('pixel-plaza', 60 * 20, 3).out).not.toEqual(race('pixel-plaza', 60 * 20, 4).out);
  });
});
