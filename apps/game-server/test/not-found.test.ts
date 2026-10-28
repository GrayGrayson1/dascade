/**
 * Security sweep (Oct 2026), F-07: dot-paths and file names that no static file matched get a 404,
 * never the app page (scanners reported /.env and /.git/HEAD as exposed).
 */
import { describe, expect, it } from 'vitest';
import { isFileLikePath } from '../src/server.ts';

describe('file-like paths 404 (F-07)', () => {
  it('catches dot segments and file names', () => {
    for (const p of ['/.env', '/.git/HEAD', '/.git/config', '/.well-known/security.txt', '/package.json', '/server.js', '/robots.txt', '/apps/game-server/dist/index.js', '/%2eenv', '/a/.hidden/b']) {
      expect(isFileLikePath(p), p).toBe(true);
    }
  });

  it('leaves every client route alone', () => {
    for (const p of ['/', '/play/showdown', '/room/ABCDE', '/r/ABCDE', '/R/ABCDE', '/tutorial/showdown', '/tournaments', '/cabinet/party', '/admin', '/%E0%A4%A']) {
      expect(isFileLikePath(p), p).toBe(false);
    }
  });
});
