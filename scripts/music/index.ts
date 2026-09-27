/**
 * pnpm music:index — report what the jukebox indexer sees in apps/web/public/audio/jukebox/.
 * Read-only: prints a table, writes nothing (dev serves and `pnpm build` emits the real manifest).
 *
 *   pnpm music:index            # table
 *   pnpm music:index --json     # the manifest that would be published
 *   JUKEBOX_DIR=/some/folder pnpm music:index
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatBytes, formatDuration, readJukeboxFolder, summaryLine } from '../../apps/web/vite/jukebox/indexer.ts';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.resolve(process.env.JUKEBOX_DIR ?? path.join(repo, 'apps/web/public/audio/jukebox'));
const index = readJukeboxFolder(dir);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(index.manifest, null, 2));
  process.exit(0);
}

const rel = path.relative(process.cwd(), dir) || '.';
console.log(`Jukebox folder: ${rel}`);
console.log(
  `Found ${index.found} file${index.found === 1 ? '' : 's'} · indexed ${index.tracks.length} · duplicates ${index.duplicates.length} · rejected ${index.rejected.length}` +
    (index.hidden.length ? ` · hidden ${index.hidden.length}` : '') +
    (index.ignored.length ? ` · ignored ${index.ignored.length} non-MP3` : ''),
);
console.log('');

if (index.tracks.length) {
  const rows = index.tracks.map((t) => [
    String(t.order + 1),
    t.id,
    t.title,
    t.artist ?? '—',
    t.album ?? '—',
    t.trackNo !== undefined ? String(t.trackNo) : '—',
    formatDuration(t.duration) + (t.durationSource === 'cbr' ? '~' : ''),
    formatBytes(t.bytes ?? 0),
    t.artwork ? 'yes' : '—',
    t.titleSource,
  ]);
  const head = ['#', 'id', 'title', 'artist', 'album', 'trk', 'time', 'size', 'art', 'title from'];
  const widths = head.map((h, i) => Math.min(32, Math.max(h.length, ...rows.map((r) => r[i]!.length))));
  const fmt = (r: string[]) => r.map((c, i) => (c.length > widths[i]! ? `${c.slice(0, widths[i]! - 1)}…` : c.padEnd(widths[i]!))).join('  ');
  console.log(fmt(head));
  console.log(widths.map((w) => '─'.repeat(w)).join('  '));
  for (const r of rows) console.log(fmt(r));
  console.log('');
}

for (const d of index.duplicates) console.log(`duplicate  ${d.file}  (identical to ${d.duplicateOf}; not published)`);
for (const r of index.rejected) console.log(`rejected   ${r.file}  — ${r.reason}`);
for (const h of index.hidden) console.log(`hidden     ${h}  (sidecar "hidden": true)`);
for (const f of index.ignored) console.log(`ignored    ${f}  (not an .mp3)`);
for (const w of index.warnings) console.log(`warning    ${w}`);
if (index.duplicates.length + index.rejected.length + index.hidden.length + index.ignored.length + index.warnings.length) console.log('');

console.log(summaryLine(index));
console.log(`Total published audio: ${formatBytes(index.totalBytes)} (${index.totalBytes} bytes); ~ = duration estimated from bitrate.`);
