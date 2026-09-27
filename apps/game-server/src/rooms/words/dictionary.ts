/**
 * Server-side loader for the DASwords dictionary (data/dascade-words.txt — see data/LICENSE.md).
 *
 * The list is read once per process on first use (~0.1 s, ~30 MB) and shared by every DASwords room.
 * It is never sent to clients. Lookup order for the file:
 *   1. DASCADE_WORDS_DICT (absolute path override, e.g. for a custom deployment)
 *   2. ./data/dascade-words.txt next to this module (dev: tsx runs the TypeScript sources)
 *   3. ./words-data/dascade-words.txt next to the bundle (production: build.mjs copies data/ into dist/words-data/)
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WordDictionary } from '@dascade/game-core/words';
import { log } from '../../lib/log.ts';

const FILE = 'dascade-words.txt';

let cached: WordDictionary | null = null;

export function dictionaryCandidates(): string[] {
  const out: string[] = [];
  if (process.env.DASCADE_WORDS_DICT) out.push(process.env.DASCADE_WORDS_DICT);
  out.push(fileURLToPath(new URL(`./data/${FILE}`, import.meta.url)));
  out.push(fileURLToPath(new URL(`./words-data/${FILE}`, import.meta.url)));
  return out;
}

/** The shared dictionary (loaded on first call). Throws if the data file is missing. */
export function wordsDictionary(): WordDictionary {
  if (cached) return cached;
  const started = Date.now();
  const path = dictionaryCandidates().find((p) => existsSync(p));
  if (!path) throw new Error(`DASwords dictionary not found (looked in: ${dictionaryCandidates().join(', ')})`);
  cached = WordDictionary.fromText(readFileSync(path, 'utf8'));
  log.info('words dictionary loaded', { words: cached.size, ms: Date.now() - started });
  return cached;
}
