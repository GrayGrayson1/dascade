/**
 * Jukebox indexer — turns the owner's music folder into a JukeboxManifest.
 *
 *   apps/web/public/audio/jukebox/*.mp3   (+ optional jukebox.json sidecar)
 *
 * Rules (documented in README "Jukebox music"):
 *  - Top level of the folder only (sub-folders are never scanned for music; they may hold sidecar covers).
 *  - `.mp3` (any case) whose bytes contain real MPEG audio frames; anything else is ignored or rejected
 *    with a reason. A bad file never throws — it is reported.
 *  - Metadata precedence: sidecar entry > ID3v2 > ID3v1 > sidecar defaults > cleaned file name.
 *  - Byte-identical duplicates (SHA-1) are skipped: the copy without a "(1)"/"copy" suffix wins, else the
 *    first by name. Duplicates are reported, never deleted.
 *  - Ids: slug of the file name; a colliding slug keeps the plain id for the first file by name and the
 *    others get "-<6 hex of sha1(file name)>". Ids don't depend on file contents (re-tagging keeps them).
 *  - Order: sidecar `order` first (ascending), then ID3 track number, then title, then file name.
 *
 * `buildIndex` is pure (in-memory files in, manifest + report out); `readJukeboxFolder` does the I/O.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  JukeboxManifestSchema,
  JukeboxSidecarSchema,
  JukeboxTrackSchema,
  TRACK_ID_RE,
  type JukeboxManifest,
  type JukeboxSidecar,
  type JukeboxTrack,
} from '@dascade/shared/jukebox';
import { cleanTag, inspectMp3 } from './mp3.ts';

export const JUKEBOX_URL_BASE = '/audio/jukebox';
export const SIDECAR_NAME = 'jukebox.json';
/** Files bigger than this are rejected without being read (keeps a stray video from eating memory). */
export const MAX_TRACK_BYTES = 200 * 1024 * 1024;
const MAX_ART_BYTES = 5 * 1024 * 1024;

export interface InputFile {
  /** File name relative to the jukebox folder (top level: no slashes). */
  name: string;
  bytes: Uint8Array;
}

export interface ArtFile {
  /** Path under the jukebox URL base, e.g. "art/neon-cruising.jpg". */
  path: string;
  mime: string;
  data: Uint8Array;
}

export interface IndexedTrack extends JukeboxTrack {
  sha1: string;
  durationSource: 'xing' | 'vbri' | 'cbr';
  tagVersions: string[];
  titleSource: 'sidecar' | 'id3' | 'filename';
}

export interface JukeboxIndex {
  manifest: JukeboxManifest;
  tracks: IndexedTrack[];
  art: ArtFile[];
  /** Files considered (MP3 candidates + junk), not counting the sidecar. */
  found: number;
  rejected: { file: string; reason: string }[];
  duplicates: { file: string; duplicateOf: string }[];
  hidden: string[];
  /** Non-MP3 files in the folder (ignored; never served from a build). */
  ignored: string[];
  warnings: string[];
  totalBytes: number;
  totalDuration: number;
}

export interface BuildIndexOptions {
  sidecarText?: string | null;
  /** Reads a sidecar cover (path relative to the folder); null if missing. */
  readCover?: (relPath: string) => Uint8Array | null;
  /** Timestamp for the manifest (tests pin it). */
  now?: Date;
  /** Files rejected before reading (e.g. too large), merged into the report. */
  preRejected?: { file: string; reason: string }[];
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const VERSION_TOKEN = /^(v\d+([._]\d+)*[a-z]?|ver\d+|version\d*|final+|finalfinal|master(ed)?|mastered|draft\d*|wip|demo\d*|copy|export(ed)?|bounce(d)?|render(ed)?|mixdown|\d+)$/i;
const COPY_SUFFIX = /(\s*\((\d+|copy( \d+)?)\)|\s*\[\d+\]|\s+-\s+copy( \d+)?|\s+copy( \d+)?)$/i;

const LEADING_TRACK_NO = /^(\d{1,3})(?:\s*[-–—.)]\s+|\s*[.)](?=\S)|(?<=^0\d)\s+)(?=\S)/;

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

/** True for "Song (1).mp3", "Song copy.mp3", "Song - Copy (2).mp3"… */
export function hasCopySuffix(name: string): boolean {
  return COPY_SUFFIX.test(stripExt(name).trim());
}

/**
 * A readable title from a file name: "this_is_my_song_v4_final.mp3" → "This Is My Song",
 * "Hope's Turnaround (1).mp3" → "Hope's Turnaround", "01 - Night Drive.mp3" → "Night Drive".
 */
export function titleFromFileName(name: string): string {
  let s = stripExt(name).normalize('NFC');
  s = s.replace(/_+/g, ' ');
  // "dash-separated-words" with no spaces: dashes are word separators.
  if (!/\s/.test(s) && /[a-z]-[a-z]/i.test(s) && (s.match(/-/g)?.length ?? 0) >= 2) s = s.replace(/-+/g, ' ');
  s = cleanTag(s);
  // Copy suffixes and bracketed version tags, repeatedly from the end.
  for (let guard = 0; guard < 8; guard++) {
    const before = s;
    s = s.replace(COPY_SUFFIX, '').trim();
    s = s.replace(/\s*[([]\s*(v\d+([._]\d+)*|final|master(ed)?|draft|wip|demo|export)\s*[)\]]$/i, '').trim();
    const words = s.split(' ');
    while (words.length > 1 && VERSION_TOKEN.test(words[words.length - 1]!.replace(/^[-.]+|[-.]+$/g, ''))) words.pop();
    s = words.join(' ').replace(/[\s\-–—.,]+$/, '').trim();
    if (s === before) break;
  }
  // Leading track numbers: "01 - Song", "1. Song", "1) Song", "07 Song" — not "8-Bit" or "99 Luftballons".
  s = s.replace(LEADING_TRACK_NO, '').trim();
  if (!s) return 'Untitled Track';
  // Only re-case names typed in a single case; deliberate casing ("8-Bit Outrun") is kept.
  if (s === s.toLowerCase() || s === s.toUpperCase()) {
    s = s.toLowerCase().replace(/(^|[\s\-([/"])(\p{Ll})/gu, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
  }
  return s.slice(0, 160);
}

/** Leading track number in a file name ("03 - Song.mp3" → 3). */
function trackNoFromFileName(name: string): number | undefined {
  const m = stripExt(name).replace(/_+/g, ' ').match(LEADING_TRACK_NO);
  const n = m ? Number(m[1]) : 0;
  return n > 0 ? n : undefined;
}

/** Lowercase ASCII slug of a file name (without extension), ≤ 56 chars; '' when nothing is left. */
export function slugify(name: string): string {
  return stripExt(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56)
    .replace(/-+$/g, '');
}

function sha1(data: Uint8Array | string): string {
  return createHash('sha1').update(data).digest('hex');
}

/** Stable ids for a set of file names (see module doc). */
export function assignIds(names: string[]): Map<string, string> {
  const sorted = [...names].sort(compareNames);
  const ids = new Map<string, string>();
  const used = new Set<string>();
  for (const name of sorted) {
    const base = slugify(name);
    let id = base && TRACK_ID_RE.test(base) && !used.has(base) ? base : '';
    for (let len = 6; !id && len <= 40; len += 2) {
      const candidate = `${base || 'track'}-${sha1(name.normalize('NFC')).slice(0, len)}`;
      if (!used.has(candidate) && TRACK_ID_RE.test(candidate)) id = candidate;
    }
    if (!id) id = `track-${sha1(`${name}#${used.size}`).slice(0, 12)}`;
    used.add(id);
    ids.set(name, id);
  }
  return ids;
}

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function encodeSrc(name: string): string {
  return `${JUKEBOX_URL_BASE}/${encodeURIComponent(name)}`;
}

// ---------------------------------------------------------------------------
// Artwork
// ---------------------------------------------------------------------------

function sniffImage(data: Uint8Array): { mime: string; ext: string } | null {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return { mime: 'image/gif', ext: 'gif' };
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

function parseSidecar(text: string | null | undefined, warnings: string[]): JukeboxSidecar | null {
  if (text == null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    warnings.push(`${SIDECAR_NAME} is not valid JSON (${(err as Error).message}) — ignored`);
    return null;
  }
  const parsed = JukeboxSidecarSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    warnings.push(`${SIDECAR_NAME} doesn't match the expected format (${issue?.path.join('.') || 'root'}: ${issue?.message ?? 'invalid'}) — ignored`);
    return null;
  }
  return parsed.data;
}

function sidecarEntry(sidecar: JukeboxSidecar | null, file: string) {
  const tracks = sidecar?.tracks;
  if (!tracks) return undefined;
  if (tracks[file]) return tracks[file];
  // Forgiving match: same name ignoring case / Unicode normalisation.
  const key = Object.keys(tracks).find((k) => k.normalize('NFC').toLowerCase() === file.normalize('NFC').toLowerCase());
  return key ? tracks[key] : undefined;
}

export function isMp3Name(name: string): boolean {
  return /\.mp3$/i.test(name);
}

/** Index in-memory files (pure apart from hashing). */
export function buildIndex(files: InputFile[], options: BuildIndexOptions = {}): JukeboxIndex {
  const warnings: string[] = [];
  const rejected = [...(options.preRejected ?? [])];
  const duplicates: JukeboxIndex['duplicates'] = [];
  const hidden: string[] = [];
  const ignored: string[] = [];
  const sidecar = parseSidecar(options.sidecarText, warnings);

  const candidates = files.filter((f) => {
    if (f.name === SIDECAR_NAME || f.name.startsWith('.')) return false;
    if (!isMp3Name(f.name)) {
      ignored.push(f.name);
      return false;
    }
    return true;
  });
  const found = candidates.length + ignored.length + rejected.length;

  // Inspect every MP3 candidate.
  interface Probe {
    file: InputFile;
    sha1: string;
    info: Extract<ReturnType<typeof inspectMp3>, { ok: true }>;
  }
  const probes: Probe[] = [];
  for (const file of candidates) {
    let info: ReturnType<typeof inspectMp3>;
    try {
      info = file.bytes.length === 0 ? { ok: false, reason: 'empty file' } : inspectMp3(file.bytes);
    } catch (err) {
      info = { ok: false, reason: `unreadable (${(err as Error).message})` };
    }
    if (!info.ok) {
      rejected.push({ file: file.name, reason: info.reason });
      continue;
    }
    probes.push({ file, sha1: sha1(file.bytes), info });
  }

  // Content duplicates: prefer names without a copy suffix, then the first by name.
  probes.sort((a, b) => Number(hasCopySuffix(a.file.name)) - Number(hasCopySuffix(b.file.name)) || compareNames(a.file.name, b.file.name));
  const byHash = new Map<string, Probe>();
  const unique: Probe[] = [];
  for (const p of probes) {
    const keep = byHash.get(p.sha1);
    if (keep) {
      duplicates.push({ file: p.file.name, duplicateOf: keep.file.name });
      continue;
    }
    byHash.set(p.sha1, p);
    unique.push(p);
  }

  const ids = assignIds(unique.map((p) => p.file.name));
  const art: ArtFile[] = [];
  const tracks: (IndexedTrack & { sortOrder?: number })[] = [];
  for (const p of unique) {
    const name = p.file.name;
    const entry = sidecarEntry(sidecar, name);
    if (entry?.hidden) {
      hidden.push(name);
      continue;
    }
    const id = ids.get(name)!;
    const tags = p.info.tags;
    const sideTitle = entry?.title ? cleanTag(entry.title) : '';
    const title = (sideTitle || tags.title || titleFromFileName(name)).slice(0, 160);
    const titleSource: IndexedTrack['titleSource'] = sideTitle ? 'sidecar' : tags.title ? 'id3' : 'filename';
    const artist = cleanTag(entry?.artist ?? tags.artist ?? sidecar?.defaults?.artist ?? '').slice(0, 160) || undefined;
    const album = cleanTag(entry?.album ?? tags.album ?? sidecar?.defaults?.album ?? '').slice(0, 160) || undefined;
    const trackNo = tags.trackNo ?? trackNoFromFileName(name);

    // Artwork: sidecar cover wins over embedded art.
    let artwork: string | undefined;
    let image: { data: Uint8Array; mime: string; ext: string } | null = null;
    if (entry?.cover) {
      const rel = entry.cover.replace(/\\/g, '/');
      const safe = !rel.startsWith('/') && !rel.split('/').includes('..');
      const data = safe ? (options.readCover?.(rel) ?? null) : null;
      const kind = data ? sniffImage(data) : null;
      if (data && kind && data.length <= MAX_ART_BYTES) image = { data, ...kind };
      else warnings.push(`${name}: cover "${entry.cover}" ${!safe ? 'must be a path inside the jukebox folder' : !data ? 'was not found' : 'is not a JPEG/PNG/GIF/WebP image under 5 MB'} — ignored`);
    }
    if (!image && tags.picture) {
      const kind = sniffImage(tags.picture.data);
      if (kind && tags.picture.data.length <= MAX_ART_BYTES) image = { data: tags.picture.data, ...kind };
      else warnings.push(`${name}: embedded artwork isn't a usable image — ignored`);
    }
    const artPath = image ? `art/${id}.${image.ext}` : '';
    if (image) artwork = `${JUKEBOX_URL_BASE}/${artPath}?v=${sha1(image.data).slice(0, 8)}`;

    const track: IndexedTrack & { sortOrder?: number } = {
      id,
      src: encodeSrc(name),
      file: name,
      title,
      ...(artist ? { artist } : {}),
      ...(album ? { album } : {}),
      ...(trackNo !== undefined && trackNo <= 9999 ? { trackNo } : {}),
      duration: Math.min(24 * 3600, Math.max(0, p.info.duration)),
      ...(artwork ? { artwork } : {}),
      order: 0,
      bytes: p.file.bytes.length,
      sha1: p.sha1,
      durationSource: p.info.durationSource,
      tagVersions: p.info.tagVersions,
      titleSource,
      ...(entry?.order !== undefined ? { sortOrder: entry.order } : {}),
    };
    // Never publish a track the client schema would refuse (e.g. an absurdly long Unicode file name).
    const check = JukeboxTrackSchema.safeParse(track);
    if (!check.success) {
      const issue = check.error.issues[0];
      rejected.push({ file: name, reason: `can't be published (${issue?.path.join('.')}: ${issue?.message})` });
      continue;
    }
    if (image) art.push({ path: artPath, mime: image.mime, data: image.data });
    tracks.push(track);
  }

  // Sidecar entries that match nothing are probably typos.
  for (const key of Object.keys(sidecar?.tracks ?? {})) {
    const known = files.some((f) => f.name.normalize('NFC').toLowerCase() === key.normalize('NFC').toLowerCase());
    if (!known) warnings.push(`${SIDECAR_NAME}: no file named "${key}" in the folder`);
  }

  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  tracks.sort((a, b) => {
    const ao = a.sortOrder;
    const bo = b.sortOrder;
    if (ao !== undefined || bo !== undefined) {
      if (ao === undefined) return 1;
      if (bo === undefined) return -1;
      if (ao !== bo) return ao - bo;
    }
    if (a.trackNo !== undefined || b.trackNo !== undefined) {
      if (a.trackNo === undefined) return 1;
      if (b.trackNo === undefined) return -1;
      if (a.trackNo !== b.trackNo) return a.trackNo - b.trackNo;
    }
    return collator.compare(a.title, b.title) || compareNames(a.file, b.file);
  });
  const finalTracks: IndexedTrack[] = tracks.map(({ sortOrder: _s, ...t }, i) => ({ ...t, order: i }));

  const manifest: JukeboxManifest = {
    version: 1,
    generatedAt: (options.now ?? new Date()).toISOString(),
    tracks: finalTracks.map((t) => {
      const { sha1: _h, durationSource: _d, tagVersions: _v, titleSource: _t, ...pub } = t;
      return pub;
    }),
  };
  // Tracks were validated one by one; the manifest shape itself can only fail on > 2000 tracks.
  if (!JukeboxManifestSchema.safeParse(manifest).success) {
    warnings.push(`more than 2000 tracks — only the first 2000 are published`);
    manifest.tracks = manifest.tracks.slice(0, 2000);
  }

  return {
    manifest,
    tracks: finalTracks,
    art,
    found,
    rejected: rejected.sort((a, b) => compareNames(a.file, b.file)),
    duplicates,
    hidden,
    ignored: ignored.sort(compareNames),
    warnings,
    totalBytes: finalTracks.reduce((n, t) => n + (t.bytes ?? 0), 0),
    totalDuration: finalTracks.reduce((n, t) => n + t.duration, 0),
  };
}

// ---------------------------------------------------------------------------
// Folder I/O
// ---------------------------------------------------------------------------

/** Read and index a jukebox folder. A missing folder is an empty jukebox, not an error. */
export function readJukeboxFolder(dir: string, now?: Date): JukeboxIndex {
  const files: InputFile[] = [];
  const preRejected: { file: string; reason: string }[] = [];
  let sidecarText: string | null = null;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.name === SIDECAR_NAME) {
      try {
        sidecarText = fs.readFileSync(full, 'utf8');
      } catch {
        sidecarText = null;
      }
      continue;
    }
    if (!isMp3Name(e.name)) {
      files.push({ name: e.name, bytes: new Uint8Array(0) });
      continue;
    }
    try {
      const size = fs.statSync(full).size;
      if (size > MAX_TRACK_BYTES) {
        preRejected.push({ file: e.name, reason: `larger than ${MAX_TRACK_BYTES / 1024 / 1024} MB` });
        continue;
      }
      files.push({ name: e.name, bytes: new Uint8Array(fs.readFileSync(full)) });
    } catch (err) {
      preRejected.push({ file: e.name, reason: `unreadable (${(err as NodeJS.ErrnoException).code ?? (err as Error).message})` });
    }
  }
  const root = path.resolve(dir);
  return buildIndex(files, {
    sidecarText,
    now,
    preRejected,
    readCover: (rel) => {
      const full = path.resolve(root, rel);
      if (!full.startsWith(root + path.sep)) return null;
      try {
        const st = fs.statSync(full);
        return st.isFile() && st.size <= MAX_ART_BYTES ? new Uint8Array(fs.readFileSync(full)) : null;
      } catch {
        return null;
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(s: number): string {
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** One-line summary for build logs. */
export function summaryLine(index: JukeboxIndex): string {
  const parts = [
    `${index.tracks.length} track${index.tracks.length === 1 ? '' : 's'} indexed`,
    `${index.duplicates.length} duplicate${index.duplicates.length === 1 ? '' : 's'} skipped`,
    `${index.rejected.length} rejected`,
  ];
  if (index.hidden.length) parts.push(`${index.hidden.length} hidden`);
  return `jukebox: ${parts.join(', ')} (${formatBytes(index.totalBytes)}, ${formatDuration(index.totalDuration)} of music)`;
}
