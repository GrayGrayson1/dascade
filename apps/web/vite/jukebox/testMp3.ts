/**
 * Tiny synthetic MP3 builders for the indexer tests: valid MPEG-1 Layer III frame headers with
 * silent payloads plus hand-built ID3v2.2/2.3/2.4 and ID3v1 tags. Nothing binary is committed.
 */

/** 128 kbps · 44.1 kHz · joint stereo · no padding → 417-byte frames of 1152 samples. */
export const FRAME_BYTES = 417;
export const FRAME_SECONDS = 1152 / 44100;

export function frame(): Uint8Array {
  const f = new Uint8Array(FRAME_BYTES);
  f.set([0xff, 0xfb, 0x90, 0x64]);
  return f;
}

/** `count` CBR frames. */
export function frames(count: number): Uint8Array {
  return concat(...Array.from({ length: count }, frame));
}

/** A first frame carrying a Xing header that declares `totalFrames`, followed by `count` audio frames. */
export function xingFrames(totalFrames: number, count = 3, tag: 'Xing' | 'Info' = 'Xing'): Uint8Array {
  const f = frame();
  const at = 4 + 32; // MPEG-1 stereo side info
  f.set(ascii(tag), at);
  f.set(u32(1), at + 4); // flags: frames field present
  f.set(u32(totalFrames), at + 8);
  return concat(f, frames(count));
}

export function vbriFrames(totalFrames: number, count = 3): Uint8Array {
  const f = frame();
  const at = 4 + 32;
  f.set(ascii('VBRI'), at);
  f.set([0, 1, 0, 0, 0, 50], at + 4); // version, delay, quality
  f.set(u32(12345), at + 10); // bytes
  f.set(u32(totalFrames), at + 14);
  return concat(f, frames(count));
}

export function ascii(s: string): Uint8Array {
  return Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff));
}

export function u32(n: number): Uint8Array {
  return Uint8Array.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function synchsafe(n: number): Uint8Array {
  return Uint8Array.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export type TextEncoding = 'latin1' | 'utf16' | 'utf16be' | 'utf8';

export function encodeText(text: string, enc: TextEncoding): Uint8Array {
  switch (enc) {
    case 'latin1':
      return concat(Uint8Array.of(0), ascii(text));
    case 'utf8':
      return concat(Uint8Array.of(3), new TextEncoder().encode(text));
    case 'utf16': {
      const body = new Uint8Array(text.length * 2);
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        body[i * 2] = c & 0xff;
        body[i * 2 + 1] = c >> 8;
      }
      return concat(Uint8Array.of(1, 0xff, 0xfe), body);
    }
    case 'utf16be': {
      const body = new Uint8Array(text.length * 2);
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        body[i * 2] = c >> 8;
        body[i * 2 + 1] = c & 0xff;
      }
      return concat(Uint8Array.of(2), body);
    }
  }
}

/** A tiny "JPEG" (valid signature; enough for sniffing). */
export const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
export const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

export interface TagSpec {
  title?: string;
  artist?: string;
  album?: string;
  track?: string;
  albumArtist?: string;
  picture?: { data: Uint8Array; mime?: string; type?: number; description?: string };
  encoding?: TextEncoding;
}

/** ID3v2.3 or v2.4 tag. */
export function id3v2(spec: TagSpec, version: 3 | 4 = 4, opts: { padding?: number } = {}): Uint8Array {
  const enc = spec.encoding ?? (version === 4 ? 'utf8' : 'latin1');
  const fr: Uint8Array[] = [];
  const add = (id: string, data: Uint8Array) => {
    fr.push(concat(ascii(id), version === 4 ? synchsafe(data.length) : u32(data.length), Uint8Array.of(0, 0), data));
  };
  if (spec.title !== undefined) add('TIT2', encodeText(spec.title, enc));
  if (spec.artist !== undefined) add('TPE1', encodeText(spec.artist, enc));
  if (spec.albumArtist !== undefined) add('TPE2', encodeText(spec.albumArtist, enc));
  if (spec.album !== undefined) add('TALB', encodeText(spec.album, enc));
  if (spec.track !== undefined) add('TRCK', encodeText(spec.track, enc));
  if (spec.picture) {
    const p = spec.picture;
    add('APIC', concat(Uint8Array.of(0), ascii(p.mime ?? 'image/jpeg'), Uint8Array.of(0, p.type ?? 3), ascii(p.description ?? ''), Uint8Array.of(0), p.data));
  }
  const body = concat(...fr, new Uint8Array(opts.padding ?? 16));
  return concat(ascii('ID3'), Uint8Array.of(version, 0, 0), synchsafe(body.length), body);
}

/** ID3v2.2 tag (3-char frame ids, 3-byte sizes). */
export function id3v22(spec: TagSpec): Uint8Array {
  const fr: Uint8Array[] = [];
  const add = (id: string, data: Uint8Array) => {
    fr.push(concat(ascii(id), Uint8Array.of((data.length >> 16) & 0xff, (data.length >> 8) & 0xff, data.length & 0xff), data));
  };
  if (spec.title !== undefined) add('TT2', encodeText(spec.title, 'latin1'));
  if (spec.artist !== undefined) add('TP1', encodeText(spec.artist, 'latin1'));
  if (spec.album !== undefined) add('TAL', encodeText(spec.album, 'latin1'));
  if (spec.track !== undefined) add('TRK', encodeText(spec.track, 'latin1'));
  if (spec.picture) add('PIC', concat(Uint8Array.of(0), ascii('JPG'), Uint8Array.of(3), Uint8Array.of(0), spec.picture.data));
  const body = concat(...fr);
  return concat(ascii('ID3'), Uint8Array.of(2, 0, 0), synchsafe(body.length), body);
}

/** 128-byte ID3v1.1 tag. */
export function id3v1(spec: { title?: string; artist?: string; album?: string; track?: number }): Uint8Array {
  const t = new Uint8Array(128);
  t.set(ascii('TAG'));
  const put = (s: string | undefined, at: number, n: number) => s && t.set(ascii(s.slice(0, n)), at);
  put(spec.title, 3, 30);
  put(spec.artist, 33, 30);
  put(spec.album, 63, 30);
  if (spec.track) {
    t[125] = 0;
    t[126] = spec.track;
  }
  return t;
}

/** A complete little MP3: optional ID3v2 + audio frames + optional ID3v1. */
/** `salt` changes a payload byte so otherwise-equal fixtures aren't byte-identical duplicates. */
export function mp3(opts: { v2?: Uint8Array; audio?: Uint8Array; v1?: Uint8Array; salt?: number } = {}): Uint8Array {
  const audio = (opts.audio ?? frames(8)).slice();
  if (opts.salt !== undefined) audio[200] = opts.salt & 0xff;
  return concat(opts.v2 ?? new Uint8Array(0), audio, opts.v1 ?? new Uint8Array(0));
}
