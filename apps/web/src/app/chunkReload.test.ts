import { describe, expect, it } from 'vitest';
import { CHUNK_RELOAD_WINDOW_MS, claimChunkReload, isChunkLoadError } from './chunkReload.ts';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('isChunkLoadError', () => {
  it('recognises the browsers’ failed dynamic import / preload messages', () => {
    for (const message of [
      'Failed to fetch dynamically imported module: https://dascade.app/assets/RoomScreen-abc123.js', // Chrome
      'Importing a module script failed.', // Safari
      'error loading dynamically imported module: https://dascade.app/assets/x.js', // Firefox
      'Unable to preload CSS for /assets/ThemePickerSheet-1a2b.css', // Vite CSS preload
    ]) {
      expect(isChunkLoadError(new Error(message))).toBe(true);
      expect(isChunkLoadError(new TypeError(message))).toBe(true);
    }
    expect(isChunkLoadError({ name: 'ChunkLoadError', message: 'Loading chunk 7 failed' })).toBe(true);
  });

  it('ignores ordinary render errors and junk', () => {
    for (const err of [new Error('Cannot read properties of undefined'), new Error(''), null, undefined, 42, {}]) {
      expect(isChunkLoadError(err)).toBe(false);
    }
  });
});

describe('claimChunkReload', () => {
  it('allows one automatic reload per window, then refuses (no reload loop)', () => {
    const storage = memoryStorage();
    const t0 = 1_000_000;
    expect(claimChunkReload(storage, t0)).toBe(true);
    expect(claimChunkReload(storage, t0 + 500)).toBe(false);
    expect(claimChunkReload(storage, t0 + CHUNK_RELOAD_WINDOW_MS - 1)).toBe(false);
    // A later deploy (well after the last attempt) may reload again.
    expect(claimChunkReload(storage, t0 + CHUNK_RELOAD_WINDOW_MS)).toBe(true);
  });

  it('never reloads without a working guard', () => {
    expect(claimChunkReload(null, Date.now())).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
    };
    expect(claimChunkReload(throwing, Date.now())).toBe(false);
  });

  it('treats a corrupt or future timestamp as no recent attempt', () => {
    expect(claimChunkReload(memoryStorage({ 'dascade:chunk-reload-at': 'garbage' }), 5_000)).toBe(true);
    expect(claimChunkReload(memoryStorage({ 'dascade:chunk-reload-at': '9999999999999' }), 5_000)).toBe(true);
  });
});
