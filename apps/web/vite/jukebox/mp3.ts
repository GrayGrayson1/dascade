/**
 * Minimal, defensive MP3 inspector (no dependencies): ID3v2.2/2.3/2.4 + ID3v1 tags, embedded
 * artwork, MPEG audio frame validation and duration (Xing/Info, VBRI, or CBR estimate).
 *
 * Every read is bounds-checked; malformed input yields `{ ok: false, reason }` — never a throw.
 */

export interface Mp3Picture {
  mime: string;
  /** ID3 picture type (3 = front cover). */
  type: number;
  data: Uint8Array;
}

export interface Mp3Tags {
  title?: string;
  artist?: string;
  album?: string;
  trackNo?: number;
  picture?: Mp3Picture;
}

export interface Mp3Info {
  ok: true;
  tags: Mp3Tags;
  /** Which tag versions were found, e.g. ["ID3v2.4", "ID3v1"]. */
  tagVersions: string[];
  /** Seconds (0 when unknown). */
  duration: number;
  durationSource: 'xing' | 'vbri' | 'cbr';
  /** First audio frame description. */
  mpeg: { version: '1' | '2' | '2.5'; layer: 1 | 2 | 3; bitrateKbps: number; sampleRate: number; channels: 1 | 2 };
  /** Byte offset of the first MPEG frame. */
  audioStart: number;
}

export type Mp3Result = Mp3Info | { ok: false; reason: string };

/** How far past the ID3 tag (or file start) to search for the first frame. */
const SYNC_SEARCH_BYTES = 256 * 1024;

// ---------------------------------------------------------------------------
// MPEG frame headers
// ---------------------------------------------------------------------------

const BITRATES: Record<string, readonly number[]> = {
  'V1L1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  'V1L2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  'V1L3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  'V2L1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  'V2L2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<'1' | '2' | '2.5', readonly number[]> = {
  '1': [44100, 48000, 32000],
  '2': [22050, 24000, 16000],
  '2.5': [11025, 12000, 8000],
};

export interface FrameHeader {
  version: '1' | '2' | '2.5';
  layer: 1 | 2 | 3;
  bitrateKbps: number;
  sampleRate: number;
  channels: 1 | 2;
  samplesPerFrame: number;
  frameLength: number;
}

/** Parse a 4-byte MPEG audio frame header at `o` (null if it isn't one we can use). */
export function parseFrameHeader(b: Uint8Array, o: number): FrameHeader | null {
  if (o + 4 > b.length) return null;
  const b1 = b[o + 1]!;
  const b2 = b[o + 2]!;
  const b3 = b[o + 3]!;
  if (b[o] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const vBits = (b1 >> 3) & 3;
  const lBits = (b1 >> 1) & 3;
  if (vBits === 1 || lBits === 0) return null;
  const version = vBits === 3 ? '1' : vBits === 2 ? '2' : '2.5';
  const layer = (4 - lBits) as 1 | 2 | 3;
  const brIndex = b2 >> 4;
  const srIndex = (b2 >> 2) & 3;
  if (brIndex === 0 || brIndex === 15 || srIndex === 3) return null; // free-format / bad / reserved
  const table = version === '1' ? BITRATES[`V1L${layer}`]! : BITRATES[layer === 1 ? 'V2L1' : 'V2L2']!;
  const bitrateKbps = table[brIndex]!;
  const sampleRate = SAMPLE_RATES[version][srIndex]!;
  const padding = (b2 >> 1) & 1;
  const channels = b3 >> 6 === 3 ? 1 : 2;
  const samplesPerFrame = layer === 1 ? 384 : layer === 2 ? 1152 : version === '1' ? 1152 : 576;
  const frameLength =
    layer === 1
      ? (Math.floor((12 * bitrateKbps * 1000) / sampleRate) + padding) * 4
      : Math.floor(((samplesPerFrame / 8) * bitrateKbps * 1000) / sampleRate) + padding;
  if (frameLength < 21) return null;
  return { version, layer, bitrateKbps, sampleRate, channels, samplesPerFrame, frameLength };
}

/**
 * Find the first frame at/after `from` that is followed by another consistent frame (or ends the
 * file exactly) — a single stray 0xFFE sync pattern in random data doesn't count.
 */
function findFirstFrame(b: Uint8Array, from: number): { offset: number; header: FrameHeader } | null {
  const end = Math.min(b.length - 4, from + SYNC_SEARCH_BYTES);
  for (let o = from; o <= end; o++) {
    if (b[o] !== 0xff) continue;
    const h = parseFrameHeader(b, o);
    if (!h) continue;
    const nextAt = o + h.frameLength;
    if (nextAt === b.length || (nextAt + 128 === b.length && isId3v1At(b, nextAt))) return { offset: o, header: h };
    const n = parseFrameHeader(b, nextAt);
    if (n && n.version === h.version && n.layer === h.layer && n.sampleRate === h.sampleRate) return { offset: o, header: h };
  }
  return null;
}

function sideInfoLength(h: FrameHeader): number {
  if (h.layer !== 3) return 0;
  if (h.version === '1') return h.channels === 1 ? 17 : 32;
  return h.channels === 1 ? 9 : 17;
}

function u32(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!;
}

function ascii(b: Uint8Array, o: number, n: number): string {
  if (o + n > b.length) return '';
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(b[o + i]!);
  return s;
}

function vbrDuration(b: Uint8Array, offset: number, h: FrameHeader): { duration: number; source: 'xing' | 'vbri' } | null {
  const xingAt = offset + 4 + sideInfoLength(h);
  const tag = ascii(b, xingAt, 4);
  if (tag === 'Xing' || tag === 'Info') {
    const flags = xingAt + 8 <= b.length ? u32(b, xingAt + 4) : 0;
    if (flags & 1 && xingAt + 12 <= b.length) {
      const frames = u32(b, xingAt + 8);
      if (frames > 0) return { duration: (frames * h.samplesPerFrame) / h.sampleRate, source: 'xing' };
    }
    return null;
  }
  const vbriAt = offset + 4 + 32;
  if (ascii(b, vbriAt, 4) === 'VBRI' && vbriAt + 18 <= b.length) {
    const frames = u32(b, vbriAt + 14);
    if (frames > 0) return { duration: (frames * h.samplesPerFrame) / h.sampleRate, source: 'vbri' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// ID3v2
// ---------------------------------------------------------------------------

function synchsafe(b: Uint8Array, o: number): number {
  return ((b[o]! & 0x7f) << 21) | ((b[o + 1]! & 0x7f) << 14) | ((b[o + 2]! & 0x7f) << 7) | (b[o + 3]! & 0x7f);
}

/** Undo ID3 unsynchronisation (0xFF 0x00 → 0xFF). */
function unsync(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(b.length);
  let j = 0;
  for (let i = 0; i < b.length; i++) {
    out[j++] = b[i]!;
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, j);
}

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');
const utf16le = new TextDecoder('utf-16le');
const utf16be = new TextDecoder('utf-16be');

function decodeText(enc: number, b: Uint8Array): string {
  if (b.length === 0) return '';
  switch (enc) {
    case 1: {
      // UTF-16 with BOM (default LE when missing, as most taggers do).
      if (b[0] === 0xfe && b[1] === 0xff) return utf16be.decode(b.subarray(2));
      if (b[0] === 0xff && b[1] === 0xfe) return utf16le.decode(b.subarray(2));
      return utf16le.decode(b);
    }
    case 2:
      return utf16be.decode(b);
    case 3:
      return utf8.decode(b);
    default:
      return latin1.decode(b);
  }
}

/** Index of the string terminator for encoding `enc` starting at `o` (b.length if none). */
function terminator(b: Uint8Array, o: number, enc: number): number {
  if (enc === 1 || enc === 2) {
    for (let i = o; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
    return b.length;
  }
  const i = b.indexOf(0, o);
  return i < 0 ? b.length : i;
}

function textFrame(data: Uint8Array): string | undefined {
  if (data.length < 2) return undefined;
  const enc = data[0]!;
  const body = data.subarray(1);
  // v2.4 allows several null-separated values; the first one is the display value.
  const first = body.subarray(0, terminator(body, 0, enc));
  const text = cleanTag(decodeText(enc, first));
  return text || undefined;
}

function pictureFrame(data: Uint8Array, v22: boolean): Mp3Picture | undefined {
  if (data.length < 4) return undefined;
  const enc = data[0]!;
  let o = 1;
  let mime: string;
  if (v22) {
    const fmt = ascii(data, 1, 3).toUpperCase();
    mime = fmt === 'PNG' ? 'image/png' : fmt === 'JPG' ? 'image/jpeg' : `image/${fmt.toLowerCase()}`;
    o = 4;
  } else {
    const end = data.indexOf(0, o);
    if (end < 0) return undefined;
    mime = latin1.decode(data.subarray(o, end)).trim().toLowerCase();
    o = end + 1;
  }
  if (o >= data.length) return undefined;
  const type = data[o]!;
  o++;
  const descEnd = terminator(data, o, enc);
  o = descEnd + (enc === 1 || enc === 2 ? 2 : 1);
  if (o >= data.length) return undefined;
  return { mime: mime || 'image/jpeg', type, data: data.slice(o) };
}

function trackNumber(s: string | undefined): number | undefined {
  const m = s?.match(/^\s*(\d{1,4})/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n > 0 ? n : undefined;
}

export function cleanTag(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
}

interface Id3v2 {
  tags: Mp3Tags;
  version: string;
  /** Total bytes the tag occupies (header + body + footer). */
  length: number;
}

/** Parse an ID3v2 tag at offset `at` (null if none / malformed header). */
export function parseId3v2(b: Uint8Array, at = 0): Id3v2 | null {
  if (ascii(b, at, 3) !== 'ID3' || at + 10 > b.length) return null;
  const major = b[at + 3]!;
  const flags = b[at + 5]!;
  if (major < 2 || major > 4 || b[at + 3] === 0xff) return null;
  if ([6, 7, 8, 9].some((i) => b[at + i]! & 0x80)) return null;
  const size = synchsafe(b, at + 6);
  const footer = major === 4 && flags & 0x10 ? 10 : 0;
  const length = 10 + size + footer;
  let body = b.subarray(at + 10, Math.min(b.length, at + 10 + size));
  // v2.2/v2.3: unsynchronisation applies to the whole tag; v2.4: per frame.
  if (flags & 0x80 && major < 4) body = unsync(body);
  let o = 0;
  if (flags & 0x40 && major >= 3 && body.length >= 4) {
    // Extended header: v2.3 size excludes its own 4 bytes; v2.4 is synchsafe and includes them.
    o = major === 3 ? 4 + u32(body, 0) : synchsafe(body, 0);
    if (o > body.length) o = body.length;
  }
  const tags: Mp3Tags = {};
  const v22 = major === 2;
  const idLen = v22 ? 3 : 4;
  const headerLen = v22 ? 6 : 10;
  const pictures: Mp3Picture[] = [];
  let albumArtist: string | undefined;
  while (o + headerLen <= body.length) {
    if (body[o] === 0) break; // padding
    const id = ascii(body, o, idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let frameSize: number;
    let fFlags = 0;
    if (v22) frameSize = (body[o + 3]! << 16) | (body[o + 4]! << 8) | body[o + 5]!;
    else {
      frameSize = major === 4 ? synchsafe(body, o + 4) : u32(body, o + 4);
      fFlags = (body[o + 8]! << 8) | body[o + 9]!;
    }
    const start = o + headerLen;
    const end = start + frameSize;
    if (frameSize <= 0 || end > body.length) break;
    o = end;
    let data = body.subarray(start, end);
    if (major === 3) {
      if (fFlags & 0x00c0) continue; // compressed / encrypted
      if (fFlags & 0x0020) data = data.subarray(1); // grouping id
    } else if (major === 4) {
      if (fFlags & 0x000c) continue; // compressed / encrypted
      if (fFlags & 0x0040) data = data.subarray(1); // grouping id
      if (fFlags & 0x0001) data = data.subarray(4); // data length indicator
      if (fFlags & 0x0002 || flags & 0x80) data = unsync(data);
    }
    switch (id) {
      case 'TIT2':
      case 'TT2':
        tags.title ??= textFrame(data);
        break;
      case 'TPE1':
      case 'TP1':
        tags.artist ??= textFrame(data);
        break;
      case 'TPE2':
      case 'TP2':
        // Album artist: only a fallback for a missing lead artist.
        albumArtist ??= textFrame(data);
        break;
      case 'TALB':
      case 'TAL':
        tags.album ??= textFrame(data);
        break;
      case 'TRCK':
      case 'TRK':
        tags.trackNo ??= trackNumber(textFrame(data));
        break;
      case 'APIC':
      case 'PIC': {
        const pic = pictureFrame(data, v22);
        if (pic && pic.data.length > 0) pictures.push(pic);
        break;
      }
      default:
        break;
    }
  }
  if (!tags.artist && albumArtist) tags.artist = albumArtist;
  const cover = pictures.find((p) => p.type === 3) ?? pictures[0];
  if (cover) tags.picture = cover;
  return { tags, version: `ID3v2.${major}`, length };
}

// ---------------------------------------------------------------------------
// ID3v1
// ---------------------------------------------------------------------------

function isId3v1At(b: Uint8Array, o: number): boolean {
  return o >= 0 && o + 128 <= b.length && b[o] === 0x54 && b[o + 1] === 0x41 && b[o + 2] === 0x47;
}

export function parseId3v1(b: Uint8Array): Mp3Tags | null {
  const o = b.length - 128;
  if (!isId3v1At(b, o)) return null;
  const field = (off: number, n: number) => {
    const raw = b.subarray(o + off, o + off + n);
    const end = raw.indexOf(0);
    return cleanTag(latin1.decode(end < 0 ? raw : raw.subarray(0, end))) || undefined;
  };
  const tags: Mp3Tags = { title: field(3, 30), artist: field(33, 30), album: field(63, 30) };
  // ID3v1.1: a zero byte before the last comment byte means that byte is the track number.
  if (b[o + 125] === 0 && b[o + 126]! > 0) tags.trackNo = b[o + 126]!;
  return tags;
}

// ---------------------------------------------------------------------------
// Whole file
// ---------------------------------------------------------------------------

export function inspectMp3(b: Uint8Array): Mp3Result {
  if (b.length < 32) return { ok: false, reason: 'file too small to be an MP3' };
  const tagVersions: string[] = [];
  let tags: Mp3Tags = {};
  let o = 0;
  // One or more ID3v2 tags at the start (some tools prepend a second one).
  for (let guard = 0; guard < 4; guard++) {
    const t = parseId3v2(b, o);
    if (!t) break;
    tagVersions.push(t.version);
    tags = { ...t.tags, ...Object.fromEntries(Object.entries(tags).filter(([, v]) => v !== undefined)) };
    o += t.length;
    if (o >= b.length) return { ok: false, reason: 'ID3 tag but no audio data' };
  }
  const v1 = parseId3v1(b);
  if (v1) {
    tagVersions.push('ID3v1');
    tags.title ??= v1.title;
    tags.artist ??= v1.artist;
    tags.album ??= v1.album;
    tags.trackNo ??= v1.trackNo;
  }
  const first = findFirstFrame(b, o);
  if (!first) return { ok: false, reason: tagVersions.length ? 'has an ID3 tag but no MPEG audio frames' : 'not an MP3 (no MPEG audio frames found)' };
  const { header: h, offset } = first;
  const vbr = vbrDuration(b, offset, h);
  let duration: number;
  let durationSource: Mp3Info['durationSource'];
  if (vbr) {
    duration = vbr.duration;
    durationSource = vbr.source;
  } else {
    const audioBytes = b.length - offset - (v1 ? 128 : 0);
    duration = Math.max(0, (audioBytes * 8) / (h.bitrateKbps * 1000));
    durationSource = 'cbr';
  }
  return {
    ok: true,
    tags,
    tagVersions,
    duration: Math.round(duration * 1000) / 1000,
    durationSource,
    mpeg: { version: h.version, layer: h.layer, bitrateKbps: h.bitrateKbps, sampleRate: h.sampleRate, channels: h.channels },
    audioStart: offset,
  };
}
