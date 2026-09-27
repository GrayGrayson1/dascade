import { describe, expect, it } from 'vitest';
import { HALF_PI, PI, TAU, datan2, dcos, dhypot, dsin } from './index.ts';

/** FNV-1a over the IEEE-754 bit patterns of `values`. */
function fingerprint(values: number[]): string {
  const view = new DataView(new ArrayBuffer(8));
  let h = 0x811c9dc5;
  for (const v of values) {
    view.setFloat64(0, v);
    for (let b = 0; b < 8; b++) {
      h ^= view.getUint8(b);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}

const ANGLES: number[] = [];
for (let i = 0; i < 4096; i++) ANGLES.push((i - 2048) * 0.0123456789);
const PAIRS: Array<[number, number]> = [];
for (let i = 0; i < 4096; i++) PAIRS.push([((i % 64) - 31.5) * 0.37, (Math.floor(i / 64) - 31.5) * 0.53]);

describe('detmath', () => {
  it('constants are the correctly rounded doubles', () => {
    expect(PI).toBe(Math.PI);
    expect(HALF_PI).toBe(Math.PI / 2);
    expect(TAU).toBe(Math.PI * 2);
  });

  it('dsin/dcos match Math.sin/cos to ≤ 2.3e-16 over |x| ≤ 64π', () => {
    let maxErr = 0;
    const range = 64 * PI;
    const n = 400_000;
    for (let i = 0; i <= n; i++) {
      const x = -range + (2 * range * i) / n;
      maxErr = Math.max(maxErr, Math.abs(dsin(x) - Math.sin(x)), Math.abs(dcos(x) - Math.cos(x)));
    }
    expect(maxErr).toBeLessThan(2.3e-16);
  });

  it('dsin/dcos are exact at the axes and relatively accurate near zero', () => {
    expect(dsin(0)).toBe(0);
    expect(dcos(0)).toBe(1);
    expect(dsin(HALF_PI)).toBe(1);
    expect(dcos(PI)).toBe(-1);
    expect(dsin(-HALF_PI)).toBe(-1);
    expect(Math.abs(dcos(HALF_PI))).toBeLessThan(1e-16);
    for (const x of [1e-300, 1e-12, 3.5e-8, -2e-5, 1e-3]) expect(Math.abs(dsin(x) - Math.sin(x)) / Math.abs(Math.sin(x))).toBeLessThan(2.3e-16);
    for (let i = 0; i < 1000; i++) {
      const x = (i - 500) * 0.0371;
      expect(Math.abs(dsin(x) * dsin(x) + dcos(x) * dcos(x) - 1)).toBeLessThan(5e-16);
    }
  });

  it('dsin/dcos return NaN for non-finite input', () => {
    for (const x of [Infinity, -Infinity, NaN]) {
      expect(dsin(x)).toBeNaN();
      expect(dcos(x)).toBeNaN();
    }
  });

  it('datan2 matches Math.atan2 to ≤ 1e-15 rad over every quadrant and extreme ratio', () => {
    let maxErr = 0;
    const n = 400_000;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU - PI;
      const r = 0.001 + (i % 997);
      const x = Math.cos(t) * r;
      const y = Math.sin(t) * r;
      maxErr = Math.max(maxErr, Math.abs(datan2(y, x) - Math.atan2(y, x)));
    }
    for (let e = -300; e <= 300; e += 7) {
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const small = 10 ** e;
        maxErr = Math.max(maxErr, Math.abs(datan2(sy * small, sx) - Math.atan2(sy * small, sx)));
        maxErr = Math.max(maxErr, Math.abs(datan2(sy, sx * small) - Math.atan2(sy, sx * small)));
      }
    }
    expect(maxErr).toBeLessThan(1e-15);
  });

  it('datan2 follows Math.atan2 on the axes and signed zeros', () => {
    const cases: Array<[number, number]> = [
      [0, 0], [-0, 0], [0, -0], [-0, -0], [0, 1], [-0, 1], [0, -1], [-0, -1], [1, 0], [-1, 0], [1, -0], [-1, -0],
      [1e300, 1e-300], [1e-300, 1e300],
    ];
    for (const [y, x] of cases) expect(Object.is(datan2(y, x), Math.atan2(y, x)), `atan2(${y}, ${x})`).toBe(true);
    for (const [y, x] of [[1, 1], [-1, -1], [2, -2], [-3, 3]]) expect(Math.abs(datan2(y!, x!) - Math.atan2(y!, x!))).toBeLessThan(5e-16);
    expect(datan2(NaN, 1)).toBeNaN();
    expect(datan2(1, NaN)).toBeNaN();
  });

  it('dhypot is √(x² + y²) within 2 ulp of Math.hypot', () => {
    for (const [y, x] of PAIRS) expect(Math.abs(dhypot(x, y) - Math.hypot(x, y))).toBeLessThanOrEqual(Math.hypot(x, y) * 4.5e-16);
    expect(dhypot(3, 4)).toBe(5);
    expect(dhypot(0, 0)).toBe(0);
  });

  it('is deterministic: same inputs → bit-identical outputs, pinned by fingerprint', () => {
    // Only + − × ÷, Math.sqrt and exact rounding are used, so these bit patterns are the same
    // on every IEEE-754 engine (V8, JavaScriptCore, SpiderMonkey). A changed fingerprint means
    // the implementation changed: make sure it still uses only those operations, then update it.
    const sin = ANGLES.map(dsin);
    const cos = ANGLES.map(dcos);
    const atan = PAIRS.map(([y, x]) => datan2(y, x));
    const hyp = PAIRS.map(([y, x]) => dhypot(y, x));
    expect(ANGLES.map(dsin)).toEqual(sin);
    expect(PAIRS.map(([y, x]) => datan2(y, x))).toEqual(atan);
    expect(fingerprint(sin)).toBe('a124ff21');
    expect(fingerprint(cos)).toBe('34ada95c');
    expect(fingerprint(atan)).toBe('fdd7cc0d');
    expect(fingerprint(hyp)).toBe('dcc6ae75');
  });
});
