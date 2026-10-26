/**
 * The hidden answers stay on the server: no web source file imports the engine package (built-in
 * packs, the rehearsal boards), and no real show content is in the repo at all — event presets carry
 * settings only and the real boards load from the presenter's show file (ADM-01). (e2e checks the
 * served bundle itself.)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHOWDOWN_EVENT_IDS, SHOWDOWN_EVENT_INFO } from '@dascade/shared/games/showdown';
import { SHOWDOWN_EVENT_ROUNDS } from '@dascade/game-core/showdown';

const WEB_SRC = join(import.meta.dirname, '..', '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('Showdown secrecy', () => {
  const files = sources(WEB_SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

  it('no web module imports the server-side engine package', () => {
    const offenders = files
      .filter((f) => /(?:from|import)\s*\(?\s*['"][^'"]*game-core(?:\/src)?\/showdown/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('ADM-01: no event preset but the practice boards carries rounds (the real boards live in a show file outside git)', () => {
    for (const id of SHOWDOWN_EVENT_IDS) {
      if (SHOWDOWN_EVENT_INFO[id].rehearsal) continue;
      expect(SHOWDOWN_EVENT_INFO[id].settingsOnly, id).toBe(true);
      expect(SHOWDOWN_EVENT_ROUNDS[id], id).toEqual([]);
    }
  });
});
