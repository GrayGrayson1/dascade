/**
 * Word pool construction and no-repeat word picking.
 */
import { shuffleInPlace, type Rng } from '@dascade/shared';
import {
  cleanCustomWords,
  sketchWordKey,
  SKETCH_CATEGORY_IDS,
  type DasketchSettings,
  type SketchChoice,
} from '@dascade/shared/games/dasketch';
import { WORD_BANK } from './words.ts';

/** Pool inputs: the public settings plus the host's (private) custom word list. */
export type WordPoolSettings = Pick<DasketchSettings, 'categories' | 'customOnly' | 'filterProfanity'> & { customWords: readonly string[] };

export interface WordPool {
  entries: SketchChoice[];
  builtIn: number;
  custom: number;
}

/**
 * Builds the de-duplicated pool for a match: selected built-in categories plus the
 * (sanitized, optionally profanity-filtered) custom words, or custom words only.
 */
export function buildWordPool(settings: WordPoolSettings): WordPool {
  const seen = new Set<string>();
  const entries: SketchChoice[] = [];
  const custom = cleanCustomWords(settings.customWords, settings.filterProfanity).words;
  let customCount = 0;
  for (const word of custom) {
    const key = sketchWordKey(word);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ word, category: 'custom' });
    customCount++;
  }
  let builtIn = 0;
  if (!settings.customOnly) {
    for (const category of SKETCH_CATEGORY_IDS) {
      if (!settings.categories.includes(category)) continue;
      for (const word of WORD_BANK[category]) {
        const key = sketchWordKey(word);
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ word, category });
        builtIn++;
      }
    }
  }
  return { entries, builtIn, custom: customCount };
}

/** Size of the pool the given settings would produce (for lobby feedback + start validation). */
export function wordPoolSize(settings: WordPoolSettings): number {
  return buildWordPool(settings).entries.length;
}

/**
 * Offers word choices without repeating words that were already drawn this match.
 * When custom words are mixed with built-in categories, at least one choice is a
 * custom word while unused custom words remain. When everything has been used the
 * history resets (only then can a word come back).
 */
export class WordPicker {
  private readonly used = new Set<string>();

  constructor(private readonly entries: readonly SketchChoice[]) {}

  get size(): number {
    return this.entries.length;
  }

  get usedCount(): number {
    return this.used.size;
  }

  /** Marks a word as drawn so it is not offered again this match. */
  markUsed(word: string): void {
    this.used.add(sketchWordKey(word));
  }

  isUsed(word: string): boolean {
    return this.used.has(sketchWordKey(word));
  }

  pick(count: number, rng: Rng): SketchChoice[] {
    if (this.entries.length === 0 || count <= 0) return [];
    let fresh = this.entries.filter((e) => !this.used.has(sketchWordKey(e.word)));
    if (fresh.length < Math.min(count, this.entries.length)) {
      this.used.clear();
      fresh = [...this.entries];
    }
    const want = Math.min(count, fresh.length);
    const custom = shuffleInPlace(
      fresh.filter((e) => e.category === 'custom'),
      rng,
    );
    const others = shuffleInPlace(
      fresh.filter((e) => e.category !== 'custom'),
      rng,
    );
    const out: SketchChoice[] = [];
    if (custom.length > 0 && others.length > 0) out.push(custom.shift() as SketchChoice);
    const rest = shuffleInPlace([...custom, ...others], rng);
    while (out.length < want && rest.length > 0) out.push(rest.shift() as SketchChoice);
    return shuffleInPlace(out, rng).map((e) => ({ ...e }));
  }
}
