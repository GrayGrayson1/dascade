/**
 * Deterministic math for simulations that both the client and the server run (CONTRACT §7).
 *
 * Only + - * /, Math.sqrt, Math.floor/round/abs/min/max and integer math are used here.
 * Math.sin/cos/atan2/pow/exp may differ in the last bit between JS engines, so directions
 * come from a hard-coded unit-vector table instead (the literals below were generated once
 * and parse identically everywhere).
 *
 * Screen coordinates: +x right, +y DOWN. Direction index i points at angle i·(360°/64),
 * clockwise from +x: 0 = right, 16 = down, 32 = left, 48 = up.
 */

export const DIR_COUNT = 64;

/** 64 unit vectors [x, y]; see the file comment for the orientation. */
export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0.995184726672, 0.09801714033],
  [0.980785280403, 0.195090322016],
  [0.956940335732, 0.290284677254],
  [0.923879532511, 0.382683432365],
  [0.881921264348, 0.471396736826],
  [0.831469612303, 0.55557023302],
  [0.773010453363, 0.634393284164],
  [0.707106781187, 0.707106781187],
  [0.634393284164, 0.773010453363],
  [0.55557023302, 0.831469612303],
  [0.471396736826, 0.881921264348],
  [0.382683432365, 0.923879532511],
  [0.290284677254, 0.956940335732],
  [0.195090322016, 0.980785280403],
  [0.09801714033, 0.995184726672],
  [0, 1],
  [-0.09801714033, 0.995184726672],
  [-0.195090322016, 0.980785280403],
  [-0.290284677254, 0.956940335732],
  [-0.382683432365, 0.923879532511],
  [-0.471396736826, 0.881921264348],
  [-0.55557023302, 0.831469612303],
  [-0.634393284164, 0.773010453363],
  [-0.707106781187, 0.707106781187],
  [-0.773010453363, 0.634393284164],
  [-0.831469612303, 0.55557023302],
  [-0.881921264348, 0.471396736826],
  [-0.923879532511, 0.382683432365],
  [-0.956940335732, 0.290284677254],
  [-0.980785280403, 0.195090322016],
  [-0.995184726672, 0.09801714033],
  [-1, 0],
  [-0.995184726672, -0.09801714033],
  [-0.980785280403, -0.195090322016],
  [-0.956940335732, -0.290284677254],
  [-0.923879532511, -0.382683432365],
  [-0.881921264348, -0.471396736826],
  [-0.831469612303, -0.55557023302],
  [-0.773010453363, -0.634393284164],
  [-0.707106781187, -0.707106781187],
  [-0.634393284164, -0.773010453363],
  [-0.55557023302, -0.831469612303],
  [-0.471396736826, -0.881921264348],
  [-0.382683432365, -0.923879532511],
  [-0.290284677254, -0.956940335732],
  [-0.195090322016, -0.980785280403],
  [-0.09801714033, -0.995184726672],
  [0, -1],
  [0.09801714033, -0.995184726672],
  [0.195090322016, -0.980785280403],
  [0.290284677254, -0.956940335732],
  [0.382683432365, -0.923879532511],
  [0.471396736826, -0.881921264348],
  [0.55557023302, -0.831469612303],
  [0.634393284164, -0.773010453363],
  [0.707106781187, -0.707106781187],
  [0.773010453363, -0.634393284164],
  [0.831469612303, -0.55557023302],
  [0.881921264348, -0.471396736826],
  [0.923879532511, -0.382683432365],
  [0.956940335732, -0.290284677254],
  [0.980785280403, -0.195090322016],
  [0.995184726672, -0.09801714033],
];

export const DIR = { right: 0, down: 16, left: 32, up: 48 } as const;

/** Wrap any integer into [0, DIR_COUNT). */
export function wrapDir(i: number): number {
  const r = i % DIR_COUNT;
  return r < 0 ? r + DIR_COUNT : r;
}

/** Unit vector for a direction index (wrapped). */
export function dirVec(i: number): readonly [number, number] {
  return DIRS[wrapDir(Math.round(i))]!;
}

/** Nearest table direction to a vector (max dot product; no atan2). Returns 0 for a zero vector. */
export function dirIndexOf(x: number, y: number): number {
  if (x === 0 && y === 0) return 0;
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < DIR_COUNT; i++) {
    const d = DIRS[i]!;
    const dot = d[0] * x + d[1] * y;
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return best;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function sign(v: number): -1 | 0 | 1 {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

export function lengthSq(x: number, y: number): number {
  return x * x + y * y;
}

export function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/** Vector scaled to `len` (zero stays zero). */
export function withLength(x: number, y: number, len: number): [number, number] {
  const l = Math.sqrt(x * x + y * y);
  if (l === 0) return [0, 0];
  const k = len / l;
  return [x * k, y * k];
}

/** Rotate a vector by a table direction (complex multiply with DIRS[i]). */
export function rotateBy(x: number, y: number, dirIndex: number): [number, number] {
  const [c, s] = dirVec(dirIndex);
  return [x * c - y * s, x * s + y * c];
}

/** Reflect velocity v off a surface with unit normal n: v − 2(v·n)n. */
export function reflect(vx: number, vy: number, nx: number, ny: number): [number, number] {
  const d = 2 * (vx * nx + vy * ny);
  return [vx - d * nx, vy - d * ny];
}

/** Positive modulo. */
export function mod(v: number, m: number): number {
  const r = v % m;
  return r < 0 ? r + m : r;
}

/** Integer square root (floor) for non-negative integers. */
export function isqrt(n: number): number {
  if (n < 0) throw new RangeError('isqrt of negative');
  let x = Math.floor(Math.sqrt(n));
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

/** Axis-aligned box vs circle overlap. */
export function circleHitsRect(cx: number, cy: number, r: number, x: number, y: number, w: number, h: number): boolean {
  const nx = cx < x ? x : cx > x + w ? x + w : cx;
  const ny = cy < y ? y : cy > y + h ? y + h : cy;
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

export function rectsOverlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}
