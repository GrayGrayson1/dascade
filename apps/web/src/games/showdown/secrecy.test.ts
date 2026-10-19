/**
 * The hidden answers stay on the server: no web source file imports the engine package (built-in
 * packs, event presets) and none contains an answer of the DAS-O-Ween boards, so the browser bundle
 * can't carry them. (e2e/showdown-showcase.spec.ts checks the served bundle itself.)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateShowContent } from '@dascade/shared/games/showdown';
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

  it('no web source contains an answer of the DAS-O-Ween boards', () => {
    // (The rehearsal boards are practice material — candy and costumes — not secrets.)
    const answers = validateShowContent(SHOWDOWN_EVENT_ROUNDS['dasoween-2026'])
      .rounds.flatMap((r) => r.answers.map((a) => a.text))
      // Single common words ("Ghost", "Witch") are fair game in decor and copy; titles are not.
      .filter((text) => text.includes(' ') && text.length > 8);
    expect(answers.length).toBeGreaterThan(10);
    const hits = files.flatMap((f) => answers.filter((a) => f.text.toLowerCase().includes(a.toLowerCase())).map((a) => `${f.path}: ${a}`));
    expect(hits).toEqual([]);
  });
});
