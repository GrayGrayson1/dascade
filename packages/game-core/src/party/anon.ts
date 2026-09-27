/**
 * Anonymous presentation helpers (DASterpiece entries, survey answers…): shuffle with the server
 * Rng and hand out opaque ids so neither order, id nor timing reveals who wrote what.
 */
import { randomId, shuffleInPlace, type Rng } from '@dascade/shared';

export interface AnonymousEntry<T> {
  /** Opaque, unguessable id safe to publish (never derived from the author). */
  key: string;
  item: T;
}

/** Shuffles `items` with `rng` and assigns each a unique opaque key (default 10 chars). */
export function anonymize<T>(items: readonly T[], rng: Rng, keyLength = 10): AnonymousEntry<T>[] {
  const used = new Set<string>();
  const out = shuffleInPlace([...items], rng).map((item) => {
    let key = randomId(keyLength, rng);
    while (used.has(key)) key = randomId(keyLength, rng);
    used.add(key);
    return { key, item };
  });
  return out;
}
