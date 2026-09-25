/**
 * Randomness abstraction. Game engines in @dascade/game-core take an `Rng` so
 * they are deterministic under test (seeded) while the server always uses the
 * cryptographically strong implementation for anything that decides gameplay.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). Unbiased. */
  int(maxExclusive: number): number;
}

const UINT32 = 0x1_0000_0000;

function getCrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('Secure random source unavailable (globalThis.crypto.getRandomValues)');
  }
  return c;
}

/** Cryptographically strong RNG (Web Crypto — available in Node ≥ 19 and all modern browsers). */
export function createCryptoRng(): Rng {
  const crypto = getCrypto();
  const buf = new Uint32Array(64);
  let idx = buf.length;
  const nextU32 = (): number => {
    if (idx >= buf.length) {
      crypto.getRandomValues(buf);
      idx = 0;
    }
    return buf[idx++] as number;
  };
  return {
    next() {
      // 53 bits of randomness.
      const hi = nextU32() >>> 5; // 27 bits
      const lo = nextU32() >>> 6; // 26 bits
      return (hi * 67108864 + lo) / 9007199254740992;
    },
    int(maxExclusive: number) {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new RangeError(`int(${maxExclusive})`);
      if (maxExclusive > UINT32) return Math.floor(this.next() * maxExclusive);
      // Rejection sampling for an unbiased result.
      const limit = UINT32 - (UINT32 % maxExclusive);
      for (;;) {
        const v = nextU32();
        if (v < limit) return v % maxExclusive;
      }
    },
  };
}

function hashSeed(seed: string | number): number {
  const s = String(seed);
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Deterministic PRNG (sfc32) for tests and reproducible content (e.g. bingo cards from a seed). Never for secret outcomes. */
export function createSeededRng(seed: string | number): Rng {
  let a = hashSeed(seed);
  let b = hashSeed(`${seed}:b`);
  let c = hashSeed(`${seed}:c`);
  let d = hashSeed(`${seed}:d`);
  const nextU32 = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 12; i++) nextU32();
  return {
    next() {
      return nextU32() / UINT32;
    },
    int(maxExclusive: number) {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new RangeError(`int(${maxExclusive})`);
      const limit = UINT32 - (UINT32 % maxExclusive);
      for (;;) {
        const v = nextU32();
        if (v < limit) return v % maxExclusive;
      }
    },
  };
}

/** In-place Fisher–Yates shuffle. Returns the same array. */
export function shuffleInPlace<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = items[i] as T;
    items[i] = items[j] as T;
    items[j] = tmp;
  }
  return items;
}

export function pick<T>(items: readonly T[], rng: Rng): T {
  if (items.length === 0) throw new RangeError('pick() from empty list');
  return items[rng.int(items.length)] as T;
}

/** Random id (URL-safe) using the crypto RNG. */
export function randomId(length = 16, rng: Rng = createCryptoRng()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[rng.int(alphabet.length)];
  return out;
}
