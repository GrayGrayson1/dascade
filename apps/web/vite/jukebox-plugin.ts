/**
 * Vite plugin: the jukebox manifest + cover art, generated from apps/web/public/audio/jukebox/.
 *
 *  - dev:   serves /audio/jukebox/manifest.json and /audio/jukebox/art/<id>.<ext> from memory, re-indexes
 *           when files are added/changed/removed and tells open pages via the HMR event
 *           `dascade:jukebox` (payload { tracks }) — no full reload, so games in progress keep running.
 *           The sidecar and non-MP3 files in the folder answer 404.
 *  - build: emits audio/jukebox/manifest.json + art into dist/ and prunes everything in
 *           dist/audio/jukebox/ the manifest doesn't reference (sidecar, duplicates, junk, hidden tracks,
 *           sidecar cover sources). Generated files never touch public/ or the source tree.
 *
 * MP3s stay plain static files (Vite's public dir), never imported into JS.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import { JUKEBOX_MANIFEST_URL } from '@dascade/shared/jukebox';
import { JUKEBOX_URL_BASE, SIDECAR_NAME, isMp3Name, readJukeboxFolder, summaryLine, type JukeboxIndex } from './jukebox/indexer.ts';

export const JUKEBOX_HMR_EVENT = 'dascade:jukebox';

export function jukeboxPlugin(): Plugin {
  let config: ResolvedConfig;
  let dir = '';
  let index: JukeboxIndex | null = null;

  const reindex = (): JukeboxIndex => {
    try {
      index = readJukeboxFolder(dir);
    } catch (err) {
      // The indexer reports bad files instead of throwing; this is a last resort so dev/build never dies.
      config.logger.error(`jukebox: indexing failed — ${(err as Error).message}`);
      index = readEmpty();
    }
    return index;
  };

  const logIndex = (i: JukeboxIndex) => {
    config.logger.info(summaryLine(i));
    for (const r of i.rejected) config.logger.warn(`  jukebox: rejected ${r.file} — ${r.reason}`);
    for (const d of i.duplicates) config.logger.info(`  jukebox: skipped ${d.file} (identical to ${d.duplicateOf})`);
    for (const w of i.warnings) config.logger.warn(`  jukebox: ${w}`);
  };

  return {
    name: 'dascade-jukebox',
    configResolved(resolved) {
      config = resolved;
      dir = path.join(resolved.publicDir || path.join(resolved.root, 'public'), 'audio', 'jukebox');
    },

    configureServer(server: ViteDevServer) {
      logIndex(reindex());
      server.watcher.add(dir);
      let timer: ReturnType<typeof setTimeout> | null = null;
      const onFsEvent = (file: string) => {
        if (!path.resolve(file).startsWith(path.resolve(dir) + path.sep)) return;
        if (timer) clearTimeout(timer);
        // Debounced: copying a large MP3 fires several change events.
        timer = setTimeout(() => {
          timer = null;
          const i = reindex();
          logIndex(i);
          server.ws.send({ type: 'custom', event: JUKEBOX_HMR_EVENT, data: { tracks: i.manifest.tracks.length } });
        }, 250);
      };
      server.watcher.on('add', onFsEvent);
      server.watcher.on('change', onFsEvent);
      server.watcher.on('unlink', onFsEvent);

      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? '';
        if (!url.startsWith(`${JUKEBOX_URL_BASE}/`)) return next();
        const current = index ?? reindex();
        if (url === JUKEBOX_MANIFEST_URL) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(JSON.stringify(current.manifest));
          return;
        }
        let rel: string;
        try {
          rel = decodeURIComponent(url.slice(JUKEBOX_URL_BASE.length + 1));
        } catch {
          rel = '';
        }
        if (rel.startsWith('art/')) {
          const art = current.art.find((a) => a.path === rel);
          if (!art) return notFound(res);
          res.setHeader('Content-Type', art.mime);
          res.setHeader('Cache-Control', 'no-cache');
          res.end(Buffer.from(art.data));
          return;
        }
        // Only MP3s are music; the sidecar and other junk in the folder aren't served.
        if (rel === SIDECAR_NAME || !isMp3Name(rel)) return notFound(res);
        next();
      });
    },

    buildStart() {
      if (config.command !== 'build') return;
      logIndex(reindex());
    },

    generateBundle() {
      if (config.command !== 'build' || !index) return;
      this.emitFile({ type: 'asset', fileName: JUKEBOX_MANIFEST_URL.slice(1), source: JSON.stringify(index.manifest) });
      for (const art of index.art) {
        this.emitFile({ type: 'asset', fileName: `${JUKEBOX_URL_BASE.slice(1)}/${art.path}`, source: art.data });
      }
    },

    closeBundle() {
      if (config.command !== 'build' || !index) return;
      // Vite copied the whole public/audio/jukebox folder; keep only what the manifest references.
      const outDir = path.resolve(config.root, config.build.outDir, JUKEBOX_URL_BASE.slice(1));
      const keep = new Set(index.manifest.tracks.map((t) => t.file));
      let pruned = 0;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(outDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name === 'manifest.json' || e.name === 'art') continue;
        if (e.isFile() && keep.has(e.name)) continue;
        fs.rmSync(path.join(outDir, e.name), { recursive: true, force: true });
        pruned++;
      }
      if (pruned) config.logger.info(`jukebox: left ${pruned} unreferenced file${pruned === 1 ? '' : 's'} out of dist (sidecar, duplicates, non-MP3s)`);
    },
  };
}

function notFound(res: import('node:http').ServerResponse): void {
  res.statusCode = 404;
  res.end();
}

function readEmpty(): JukeboxIndex {
  return {
    manifest: { version: 1, generatedAt: new Date().toISOString(), tracks: [] },
    tracks: [],
    art: [],
    found: 0,
    rejected: [],
    duplicates: [],
    hidden: [],
    ignored: [],
    warnings: [],
    totalBytes: 0,
    totalDuration: 0,
  };
}
