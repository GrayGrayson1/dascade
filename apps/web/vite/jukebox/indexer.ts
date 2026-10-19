/**
 * Jukebox indexer — turns the owner's music folder into a JukeboxManifest.
 *
 *   apps/web/public/audio/jukebox/*.mp3   (+ optional jukebox.json sidecar)
 *
 * Rules (documented in README "Jukebox music"):
 *  - Records: the MP3s loose in the folder are the main record; every sub-folder holding MP3s is another
 *    record (one level deep — deeper folders, and sub-folders without MP3s, may hold covers). Each folder may
 *    have its own sidecar (its `record` block names the record, its sleeve, paired theme and shelf order).
 *  - `.mp3` (any case) whose bytes contain real MPEG audio frames; anything else is ignored or rejected
 *    with a reason. A bad file never throws — it is reported.
 *  - Metadata precedence: sidecar entry > ID3v2 > ID3v1 > sidecar defaults > cleaned file name.
 *  - Byte-identical duplicates (SHA-1) within a record are skipped: the copy without a "(1)"/"copy" suffix wins, else the
 *    first by name. Duplicates are reported, never deleted.
 *  - Ids: slug of the file name; a colliding slug keeps the plain id for the first file by name and the
 *    others get "-<6 hex of sha1(path)>" — the loose files first, then each record folder in name order, so
 *    adding a record never renames an existing song. Ids don't depend on file contents (re-tagging keeps them).
 *  - Order: record by record (sidecar `record.order`, then the main record, then by name); within a record
 *    sidecar `order` first (ascending), then ID3 track number, then title, then file name.
 *
 * `buildIndex` is pure (in-memory files in, manifest + report out); `readJukeboxFolder` does the I/O.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ALL_RECORDS,
  MAIN_RECORD_ID,
  MAX_RECORDS,
  JukeboxManifestSchema,
  JukeboxSidecarSchema,
  JukeboxTrackSchema,
  TRACK_ID_RE,
  type JukeboxManifest,
  type JukeboxRecord,
  type JukeboxSidecar,
  type JukeboxTrack,
} from '@dascade/shared/jukebox';
import { cleanTag, inspectMp3 } from './mp3.ts';

export const JUKEBOX_URL_BASE = '/audio/jukebox';
export const SIDECAR_NAME = 'jukebox.json';
/** Files bigger than this are rejected without being read (keeps a stray video from eating memory). */
export const MAX_TRACK_BYTES = 200 * 1024 * 1024;
const MAX_ART_BYTES = 5 * 1024 * 1024;
/** Size warnings (never errors): a song over this is probably a lossless/320 kbps export. */
export const WARN_TRACK_BYTES = 12 * 1024 * 1024;
/** …and a jukebox over this weighs on every clone and deploy. */
export const WARN_TOTAL_BYTES = 150 * 1024 * 1024;
/** Name of the main record when its songs carry no album tag. */
export const MAIN_RECORD_TITLE = 'DASCADE Jukebox';
/** Generated cover art is served under /audio/jukebox/art/, so a folder of that name is never a record. */
const ART_FOLDER = 'art';
const RESERVED_RECORD_IDS = [MAIN_RECORD_ID, ALL_RECORDS, ART_FOLDER];
const IMAGE_NAME = /\.(jpe?g|png|gif|webp)$/i;

export interface InputFile {
  /** Path relative to the jukebox folder: "Song.mp3" (the main record) or "halloween/Song.mp3" (a record's folder). */
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

export interface IndexedRecord extends JukeboxRecord {
  /** Sub-folder ('' = the loose files). */
  folder: string;
}

export interface JukeboxIndex {
  manifest: JukeboxManifest;
  tracks: IndexedTrack[];
  records: IndexedRecord[];
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
  /** The top-level sidecar. */
  sidecarText?: string | null;
  /** Record folders' sidecars, by folder name. */
  folderSidecars?: Record<string, string | null>;
  /** Reads a sidecar cover (path relative to the jukebox folder); null if missing. */
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
  return slugOf(stripExt(name));
}

/** The last path segment ("halloween/Song.mp3" → "Song.mp3"). */
function baseName(rel: string): string {
  return rel.slice(rel.lastIndexOf('/') + 1);
}

function slugOf(text: string): string {
  return text
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

/** Stable ids for a set of file paths (see module doc); `used` holds ids taken by folders indexed earlier. */
export function assignIds(names: string[], used: Set<string> = new Set()): Map<string, string> {
  const sorted = [...names].sort(compareNames);
  const ids = new Map<string, string>();
  for (const name of sorted) {
    const base = slugify(baseName(name));
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
  return `${JUKEBOX_URL_BASE}/${name.split('/').map(encodeURIComponent).join('/')}`;
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

function parseSidecar(text: string | null | undefined, warnings: string[], label = SIDECAR_NAME): JukeboxSidecar | null {
  if (text == null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    warnings.push(`${label} is not valid JSON (${(err as Error).message}) — ignored`);
    return null;
  }
  const parsed = JukeboxSidecarSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    warnings.push(`${label} doesn't match the expected format (${issue?.path.join('.') || 'root'}: ${issue?.message ?? 'invalid'}) — ignored`);
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
  let found = rejected.length;

  // Folders: '' (the loose files = the main record) first, then every record folder by name.
  const byFolder = new Map<string, InputFile[]>();
  let artFolderWarned = false;
  for (const file of files) {
    const parts = file.name.split('/');
    // Only the top level and one level of sub-folders hold music (deeper folders may hold covers).
    if (parts.length > 2 || parts.some((p) => !p || p.startsWith('.'))) continue;
    const folder = parts.length === 2 ? parts[0]! : '';
    if (folder.toLowerCase() === ART_FOLDER) {
      if (isMp3Name(file.name) && !artFolderWarned) {
        artFolderWarned = true;
        warnings.push(`${folder}/ holds MP3s, but "${ART_FOLDER}" is reserved for cover art — rename the folder to make it a record`);
      }
      continue;
    }
    const list = byFolder.get(folder);
    if (list) list.push(file);
    else byFolder.set(folder, [file]);
  }
  const folders = [...byFolder.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : compareNames(a, b)));

  interface Probe {
    file: InputFile;
    sha1: string;
    info: Extract<ReturnType<typeof inspectMp3>, { ok: true }>;
  }
  interface Group {
    folder: string;
    label: string;
    sidecar: JukeboxSidecar | null;
    unique: Probe[];
    ids: Map<string, string>;
  }
  const groups: Group[] = [];
  const usedIds = new Set<string>();
  for (const folder of folders) {
    const label = folder ? `${folder}/${SIDECAR_NAME}` : SIDECAR_NAME;
    const sidecarText = folder ? options.folderSidecars?.[folder] : options.sidecarText;
    const sidecar = parseSidecar(sidecarText, warnings, label);
    const candidates: InputFile[] = [];
    const junk: string[] = [];
    for (const f of byFolder.get(folder)!) {
      const base = baseName(f.name);
      if (base === SIDECAR_NAME) continue;
      if (isMp3Name(base)) candidates.push(f);
      // A record folder's images are its sleeve candidates; other junk is reported like the top level's.
      else if (!folder || !IMAGE_NAME.test(base)) junk.push(f.name);
    }
    if (folder && candidates.length === 0) continue; // a folder of covers, not a record
    ignored.push(...junk);
    found += candidates.length + junk.length;

    // Inspect every MP3 candidate.
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

    // Content duplicates (within a record — the same song may be on two records): prefer names without a
    // copy suffix, then the first by name.
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
    // Ids: the loose files first, then each folder in name order, so adding a record never renames a song.
    groups.push({ folder, label, sidecar, unique, ids: assignIds(unique.map((p) => p.file.name), usedIds) });
  }

  const art: ArtFile[] = [];
  type Draft = IndexedTrack & { sortOrder?: number };
  interface RecordDraft {
    group: Group;
    id: string;
    tracks: Draft[];
  }
  const drafts: RecordDraft[] = [];
  const usedRecordIds = new Set<string>(RESERVED_RECORD_IDS);
  for (const group of groups) {
    const { folder, sidecar } = group;
    const recordId = folder ? recordIdFor(folder, usedRecordIds) : MAIN_RECORD_ID;
    const tracks: Draft[] = [];
    for (const p of group.unique) {
      const name = p.file.name;
      const entry = sidecarEntry(sidecar, baseName(name));
      if (entry?.hidden) {
        hidden.push(name);
        continue;
      }
      const id = group.ids.get(name)!;
      const tags = p.info.tags;
      const sideTitle = entry?.title ? cleanTag(entry.title) : '';
      const title = (sideTitle || tags.title || titleFromFileName(baseName(name))).slice(0, 160);
      const titleSource: IndexedTrack['titleSource'] = sideTitle ? 'sidecar' : tags.title ? 'id3' : 'filename';
      const artist = cleanTag(entry?.artist ?? tags.artist ?? sidecar?.defaults?.artist ?? '').slice(0, 160) || undefined;
      const album = cleanTag(entry?.album ?? tags.album ?? sidecar?.defaults?.album ?? '').slice(0, 160) || undefined;
      const trackNo = tags.trackNo ?? trackNoFromFileName(baseName(name));

      // Artwork: sidecar cover wins over embedded art.
      let artwork: string | undefined;
      let image: { data: Uint8Array; mime: string; ext: string } | null = null;
      if (entry?.cover) {
        const cover = readCoverIn(folder, entry.cover, options);
        if (cover.image) image = cover.image;
        else warnings.push(`${name}: cover "${entry.cover}" ${cover.problem} — ignored`);
      }
      if (!image && tags.picture) {
        const kind = sniffImage(tags.picture.data);
        if (kind && tags.picture.data.length <= MAX_ART_BYTES) image = { data: tags.picture.data, ...kind };
        else warnings.push(`${name}: embedded artwork isn't a usable image — ignored`);
      }
      const artPath = image ? `art/${id}.${image.ext}` : '';
      if (image) artwork = `${JUKEBOX_URL_BASE}/${artPath}?v=${sha1(image.data).slice(0, 8)}`;

      const track: Draft = {
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
        ...(folder ? { record: recordId } : {}),
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
      if ((track.bytes ?? 0) > WARN_TRACK_BYTES) {
        warnings.push(`${name} is ${formatBytes(track.bytes ?? 0)} — over ${formatBytes(WARN_TRACK_BYTES)}; a 128–192 kbps MP3 keeps clones and deploys small`);
      }
      tracks.push(track);
    }

    // Sidecar entries that match nothing are probably typos.
    const names = (byFolder.get(folder) ?? []).map((f) => baseName(f.name).normalize('NFC').toLowerCase());
    for (const key of Object.keys(sidecar?.tracks ?? {})) {
      if (!names.includes(key.normalize('NFC').toLowerCase())) warnings.push(`${group.label}: no file named "${key}" in the folder`);
    }
    tracks.sort(compareTracks);
    if (tracks.length) drafts.push({ group, id: recordId, tracks });
  }

  // Records: sidecar `record.order` first, then the main record, then by name.
  const records: (IndexedRecord & { sortOrder?: number })[] = [];
  for (const d of drafts) {
    const { folder, sidecar, label } = d.group;
    const meta = sidecar?.record;
    const title = (cleanTag(meta?.title ?? '') || mostCommon(d.tracks.map((t) => t.album)) || (folder ? titleFromFolder(folder) : MAIN_RECORD_TITLE)).slice(0, 160);
    const artist = (cleanTag(meta?.artist ?? '') || mostCommon(d.tracks.map((t) => t.artist)) || '').slice(0, 160) || undefined;
    // A record's songs without an album tag are on that record (the phone's "now playing" shows it).
    if (folder) for (const t of d.tracks) t.album ??= title;
    let cover = d.tracks.find((t) => t.artwork)?.artwork;
    if (meta?.cover) {
      const sleeve = readCoverIn(folder, meta.cover, options);
      if (sleeve.image) {
        const artPath = `art/records/${d.id}.${sleeve.image.ext}`;
        art.push({ path: artPath, mime: sleeve.image.mime, data: sleeve.image.data });
        cover = `${JUKEBOX_URL_BASE}/${artPath}?v=${sha1(sleeve.image.data).slice(0, 8)}`;
      } else warnings.push(`${label}: record cover "${meta.cover}" ${sleeve.problem} — ignored`);
    }
    records.push({
      id: d.id,
      title,
      ...(artist ? { artist } : {}),
      ...(cover ? { cover } : {}),
      ...(meta?.theme ? { theme: meta.theme } : {}),
      ...(meta?.accent ? { accent: meta.accent } : {}),
      ...(meta?.accent2 ? { accent2: meta.accent2 } : {}),
      order: 0,
      tracks: d.tracks.length,
      duration: d.tracks.reduce((n, t) => n + t.duration, 0),
      bytes: d.tracks.reduce((n, t) => n + (t.bytes ?? 0), 0),
      folder,
      ...(meta?.order !== undefined ? { sortOrder: meta.order } : {}),
    });
  }
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  records.sort((a, b) => {
    if (a.sortOrder !== undefined || b.sortOrder !== undefined) {
      if (a.sortOrder === undefined) return 1;
      if (b.sortOrder === undefined) return -1;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    }
    if (a.id === MAIN_RECORD_ID || b.id === MAIN_RECORD_ID) return a.id === MAIN_RECORD_ID ? -1 : 1;
    return collator.compare(a.title, b.title) || compareNames(a.folder, b.folder);
  });
  if (records.length > MAX_RECORDS) {
    warnings.push(`more than ${MAX_RECORDS} records — only the first ${MAX_RECORDS} are published`);
    records.length = MAX_RECORDS;
  }
  const finalRecords: IndexedRecord[] = records.map(({ sortOrder: _s, ...r }, i) => ({ ...r, order: i }));

  // Catalogue order: record by record (the main record's songs first unless a sidecar says otherwise).
  const trackLists = new Map(drafts.map((d) => [d.id, d.tracks]));
  const finalTracks: IndexedTrack[] = finalRecords
    .flatMap((r) => trackLists.get(r.id) ?? [])
    .map(({ sortOrder: _s, ...t }, i) => ({ ...t, order: i }));
  // Only art the manifest points at (a record dropped past MAX_RECORDS takes its art with it).
  const referenced = new Set([...finalTracks.map((t) => t.artwork), ...finalRecords.map((r) => r.cover)].map((u) => artPathOf(u)));
  const finalArt = art.filter((a) => referenced.has(a.path));

  const manifest: JukeboxManifest = {
    version: 1,
    generatedAt: (options.now ?? new Date()).toISOString(),
    tracks: finalTracks.map((t) => {
      const { sha1: _h, durationSource: _d, tagVersions: _v, titleSource: _t, ...pub } = t;
      return pub;
    }),
    records: finalRecords.map(({ folder: _f, ...r }) => r),
  };
  // Tracks were validated one by one; the manifest shape itself can only fail on > 2000 tracks.
  if (!JukeboxManifestSchema.safeParse(manifest).success) {
    warnings.push(`more than 2000 tracks — only the first 2000 are published`);
    manifest.tracks = manifest.tracks.slice(0, 2000);
    manifest.records = (manifest.records ?? []).filter((r) => manifest.tracks.some((t) => (t.record ?? MAIN_RECORD_ID) === r.id));
  }

  const totalBytes = finalTracks.reduce((n, t) => n + (t.bytes ?? 0), 0);
  if (totalBytes > WARN_TOTAL_BYTES) {
    warnings.push(`the jukebox is ${formatBytes(totalBytes)} — over ${formatBytes(WARN_TOTAL_BYTES)}; every clone and deploy carries it`);
  }

  return {
    manifest,
    tracks: finalTracks,
    records: finalRecords,
    art: finalArt,
    found,
    rejected: rejected.sort((a, b) => compareNames(a.file, b.file)),
    duplicates,
    hidden,
    ignored: ignored.sort(compareNames),
    warnings,
    totalBytes,
    totalDuration: finalTracks.reduce((n, t) => n + t.duration, 0),
  };
}

const collatorEn = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** Within a record: sidecar `order` first (ascending), then ID3/file-name track number, then title, then file name. */
function compareTracks(a: IndexedTrack & { sortOrder?: number }, b: IndexedTrack & { sortOrder?: number }): number {
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
  return collatorEn.compare(a.title, b.title) || compareNames(a.file, b.file);
}

/** "/audio/jukebox/art/x.jpg?v=…" → "art/x.jpg" ('' for anything else). */
function artPathOf(url: string | undefined): string {
  if (!url?.startsWith(`${JUKEBOX_URL_BASE}/`)) return '';
  return url.slice(JUKEBOX_URL_BASE.length + 1).split('?')[0] ?? '';
}

/** The most frequent non-empty value (ties: the earliest); '' when there is none. */
function mostCommon(values: (string | undefined)[]): string {
  const counts = new Map<string, number>();
  let best = '';
  let bestN = 0;
  for (const v of values) {
    if (!v) continue;
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

/** A record id from its folder name: the slug, made unique (reserved ids and collisions get a hash suffix). */
function recordIdFor(folder: string, used: Set<string>): string {
  const base = slugOf(folder);
  let id = base && TRACK_ID_RE.test(base) && !used.has(base) ? base : '';
  for (let len = 6; !id && len <= 40; len += 2) {
    const candidate = `${base || 'record'}-${sha1(`record:${folder.normalize('NFC')}`).slice(0, len)}`;
    if (!used.has(candidate) && TRACK_ID_RE.test(candidate)) id = candidate;
  }
  if (!id) id = `record-${sha1(`${folder}#${used.size}`).slice(0, 12)}`;
  used.add(id);
  return id;
}

/** "halloween" → "Halloween", "spooky_season" → "Spooky Season"; deliberate casing is kept. */
export function titleFromFolder(folder: string): string {
  let s = cleanTag(folder.normalize('NFC').replace(/_+/g, ' ')) || 'Untitled Record';
  if (s === s.toLowerCase() || s === s.toUpperCase()) {
    s = s.toLowerCase().replace(/(^|[\s\-([/"])(\p{Ll})/gu, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
  }
  return s.slice(0, 160);
}

/** Reads a sidecar cover given relative to `folder` (a record's folder, or '' for the top level). */
function readCoverIn(
  folder: string,
  cover: string,
  options: BuildIndexOptions,
): { image: { data: Uint8Array; mime: string; ext: string }; problem?: never } | { image: null; problem: string } {
  const rel = cover.replace(/\\/g, '/');
  if (rel.startsWith('/') || rel.split('/').includes('..')) return { image: null, problem: 'must be a path inside the jukebox folder' };
  const data = options.readCover?.(folder ? `${folder}/${rel}` : rel) ?? null;
  if (!data) return { image: null, problem: 'was not found' };
  const kind = sniffImage(data);
  if (!kind || data.length > MAX_ART_BYTES) return { image: null, problem: 'is not a JPEG/PNG/GIF/WebP image under 5 MB' };
  return { image: { data, ...kind } };
}

// ---------------------------------------------------------------------------
// Folder I/O
// ---------------------------------------------------------------------------

/** Read and index a jukebox folder (the loose MP3s + one level of record folders). A missing folder is an empty jukebox. */
export function readJukeboxFolder(dir: string, now?: Date): JukeboxIndex {
  const files: InputFile[] = [];
  const preRejected: { file: string; reason: string }[] = [];
  let sidecarText: string | null = null;
  const folderSidecars: Record<string, string | null> = {};
  const list = (d: string): fs.Dirent[] => {
    try {
      return fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  const readText = (full: string): string | null => {
    try {
      return fs.readFileSync(full, 'utf8');
    } catch {
      return null;
    }
  };
  const take = (full: string, rel: string) => {
    if (!isMp3Name(rel)) {
      files.push({ name: rel, bytes: new Uint8Array(0) });
      return;
    }
    try {
      const size = fs.statSync(full).size;
      if (size > MAX_TRACK_BYTES) {
        preRejected.push({ file: rel, reason: `larger than ${MAX_TRACK_BYTES / 1024 / 1024} MB` });
        return;
      }
      files.push({ name: rel, bytes: new Uint8Array(fs.readFileSync(full)) });
    } catch (err) {
      preRejected.push({ file: rel, reason: `unreadable (${(err as NodeJS.ErrnoException).code ?? (err as Error).message})` });
    }
  };
  for (const e of list(dir)) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.toLowerCase() === ART_FOLDER) {
        // Reserved for generated cover art: buildIndex warns about any MP3s in it and never publishes them.
        for (const s of list(full)) if (s.isFile() && isMp3Name(s.name)) files.push({ name: `${e.name}/${s.name}`, bytes: new Uint8Array(0) });
        continue;
      }
      // A folder without MP3s is covers (or nothing): never read its images.
      const inner = list(full).filter((s) => s.isFile() && !s.name.startsWith('.'));
      if (!inner.some((s) => isMp3Name(s.name))) continue;
      for (const s of inner) {
        const rel = `${e.name}/${s.name}`;
        if (s.name === SIDECAR_NAME) folderSidecars[e.name] = readText(path.join(full, s.name));
        else take(path.join(full, s.name), rel);
      }
      continue;
    }
    if (!e.isFile()) continue;
    if (e.name === SIDECAR_NAME) {
      sidecarText = readText(full);
      continue;
    }
    take(full, e.name);
  }
  const root = path.resolve(dir);
  return buildIndex(files, {
    sidecarText,
    folderSidecars,
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
  if (index.records.length > 1) parts.splice(1, 0, `${index.records.length} records`);
  return `jukebox: ${parts.join(', ')} (${formatBytes(index.totalBytes)}, ${formatDuration(index.totalDuration)} of music)`;
}
