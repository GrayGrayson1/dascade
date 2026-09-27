import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Plugin } from 'vite';
import { JukeboxManifestSchema } from '@dascade/shared/jukebox';
import { JUKEBOX_HMR_EVENT, jukeboxPlugin } from './jukebox-plugin.ts';
import { JPEG, id3v2, mp3 } from './jukebox/testMp3.ts';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
  vi.useRealTimers();
});

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dascade-jb-plugin-'));
  roots.push(root);
  const music = path.join(root, 'public', 'audio', 'jukebox');
  fs.mkdirSync(path.join(music, 'covers'), { recursive: true });
  fs.writeFileSync(path.join(music, 'Neon Cruising.mp3'), mp3({ v2: id3v2({ title: 'Neon Cruising', picture: { data: JPEG } }), salt: 1 }));
  fs.writeFileSync(path.join(music, 'Neon Cruising (1).mp3'), mp3({ v2: id3v2({ title: 'Neon Cruising', picture: { data: JPEG } }), salt: 1 }));
  fs.writeFileSync(path.join(music, 'Secret.mp3'), mp3({ salt: 2 }));
  fs.writeFileSync(path.join(music, 'readme.txt'), 'junk');
  fs.writeFileSync(path.join(music, 'covers', 'x.jpg'), JPEG);
  fs.writeFileSync(path.join(music, 'jukebox.json'), JSON.stringify({ tracks: { 'Secret.mp3': { hidden: true } } }));
  const logs: string[] = [];
  const logger = { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) };
  return { root, music, logs, logger };
}

type Hook = (...args: any[]) => any;
const call = (p: Plugin, hook: keyof Plugin, ctx: unknown, ...args: unknown[]) => (p[hook] as Hook).call(ctx, ...args);

describe('jukebox Vite plugin — build', () => {
  it('emits manifest + art into dist and prunes unreferenced files copied from public/', () => {
    const { root, music, logs, logger } = project();
    const plugin = jukeboxPlugin();
    call(plugin, 'configResolved', null, { root, publicDir: path.join(root, 'public'), command: 'build', build: { outDir: 'dist' }, logger });
    call(plugin, 'buildStart', {});
    const emitted: { fileName: string; source: string | Uint8Array }[] = [];
    call(plugin, 'generateBundle', { emitFile: (f: { fileName: string; source: string | Uint8Array }) => emitted.push(f) });

    const manifestFile = emitted.find((e) => e.fileName === 'audio/jukebox/manifest.json');
    const manifest = JukeboxManifestSchema.parse(JSON.parse(String(manifestFile!.source)));
    expect(manifest.tracks.map((t) => t.file)).toEqual(['Neon Cruising.mp3']);
    expect(emitted.map((e) => e.fileName)).toContain('audio/jukebox/art/neon-cruising.jpg');
    expect(logs[0]).toMatch(/^jukebox: 1 track indexed, 1 duplicate skipped, 0 rejected, 1 hidden/);

    // Simulate Vite's public/ copy, then the plugin's prune.
    const out = path.join(root, 'dist', 'audio', 'jukebox');
    fs.cpSync(music, out, { recursive: true });
    fs.mkdirSync(path.join(out, 'art'));
    fs.writeFileSync(path.join(out, 'manifest.json'), String(manifestFile!.source));
    call(plugin, 'closeBundle', {});
    expect(fs.readdirSync(out).sort()).toEqual(['Neon Cruising.mp3', 'art', 'manifest.json']);
    // The source tree is untouched.
    expect(fs.readdirSync(music).sort()).toEqual(['Neon Cruising (1).mp3', 'Neon Cruising.mp3', 'Secret.mp3', 'covers', 'jukebox.json', 'readme.txt']);
  });
});

describe('jukebox Vite plugin — dev server', () => {
  function devServer() {
    const p = project();
    const plugin = jukeboxPlugin();
    call(plugin, 'configResolved', null, { root: p.root, publicDir: path.join(p.root, 'public'), command: 'serve', build: { outDir: 'dist' }, logger: p.logger });
    const handlers: Record<string, (file: string) => void> = {};
    const sent: unknown[] = [];
    let middleware: (req: { url: string }, res: any, next: () => void) => void = () => undefined;
    call(plugin, 'configureServer', null, {
      watcher: { add: vi.fn(), on: (ev: string, fn: (file: string) => void) => (handlers[ev] = fn) },
      ws: { send: (m: unknown) => sent.push(m) },
      middlewares: { use: (fn: typeof middleware) => (middleware = fn) },
    });
    const request = (url: string) => {
      const res = { statusCode: 200, headers: {} as Record<string, string>, body: undefined as unknown, setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; }, end(b?: unknown) { this.body = b; } };
      let passed = false;
      middleware({ url }, res, () => (passed = true));
      return { res, passed };
    };
    return { ...p, handlers, sent, request };
  }

  it('serves the manifest and art from memory; 404s the sidecar and junk; passes MP3s through', () => {
    const { request } = devServer();
    const m = request('/audio/jukebox/manifest.json');
    expect(m.res.headers['content-type']).toContain('application/json');
    expect(JSON.parse(String(m.res.body)).tracks).toHaveLength(1);
    const art = request('/audio/jukebox/art/neon-cruising.jpg?v=123');
    expect(art.res.headers['content-type']).toBe('image/jpeg');
    expect(request('/audio/jukebox/art/nope.jpg').res.statusCode).toBe(404);
    expect(request('/audio/jukebox/jukebox.json').res.statusCode).toBe(404);
    expect(request('/audio/jukebox/readme.txt').res.statusCode).toBe(404);
    expect(request('/audio/jukebox/Neon%20Cruising.mp3').passed).toBe(true);
    expect(request('/assets/app.js').passed).toBe(true);
  });

  it('re-indexes on add/remove and notifies pages with an HMR event', () => {
    vi.useFakeTimers();
    const { music, handlers, sent, request } = devServer();
    const added = path.join(music, 'Brand New.mp3');
    fs.writeFileSync(added, mp3({ salt: 7 }));
    handlers.add!(added);
    vi.advanceTimersByTime(300);
    expect(sent).toEqual([{ type: 'custom', event: JUKEBOX_HMR_EVENT, data: { tracks: 2 } }]);
    expect(JSON.parse(String(request('/audio/jukebox/manifest.json').res.body)).tracks.map((t: { id: string }) => t.id)).toContain('brand-new');
    fs.rmSync(added);
    handlers.unlink!(added);
    vi.advanceTimersByTime(300);
    expect(JSON.parse(String(request('/audio/jukebox/manifest.json').res.body)).tracks).toHaveLength(1);
    // Files elsewhere in the project don't trigger a re-index.
    handlers.change!(path.join(music, '..', '..', 'favicon.svg'));
    vi.advanceTimersByTime(300);
    expect(sent).toHaveLength(2);
  });
});
