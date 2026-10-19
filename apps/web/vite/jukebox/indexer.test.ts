import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { JukeboxManifestSchema, TRACK_ID_RE } from '@dascade/shared/jukebox';
import {
  WARN_TRACK_BYTES,
  assignIds,
  buildIndex,
  hasCopySuffix,
  readJukeboxFolder,
  slugify,
  summaryLine,
  titleFromFileName,
  titleFromFolder,
  type BuildIndexOptions,
  type InputFile,
} from './indexer.ts';
import { inspectMp3, parseFrameHeader } from './mp3.ts';
import { FRAME_BYTES, FRAME_SECONDS, JPEG, PNG, concat, frames, id3v1, id3v2, id3v22, mp3, vbriFrames, xingFrames } from './testMp3.ts';

const NOW = new Date('2026-01-01T00:00:00Z');
const index = (files: InputFile[], sidecarText?: string | null, readCover?: (p: string) => Uint8Array | null) =>
  buildIndex(files, { sidecarText, now: NOW, readCover });
const f = (name: string, bytes: Uint8Array): InputFile => ({ name, bytes });

// ---------------------------------------------------------------------------
describe('MPEG frames and duration', () => {
  it('parses a MPEG-1 Layer III header', () => {
    expect(parseFrameHeader(frames(1), 0)).toMatchObject({ version: '1', layer: 3, bitrateKbps: 128, sampleRate: 44100, channels: 2, frameLength: FRAME_BYTES });
    expect(parseFrameHeader(Uint8Array.of(0xff, 0xfb, 0xf0, 0x64), 0)).toBeNull(); // bad bitrate index
    expect(parseFrameHeader(Uint8Array.of(0xff, 0xfb, 0x9c, 0x64), 0)).toBeNull(); // reserved sample rate
  });

  it('estimates CBR duration from the frame header and size', () => {
    const r = inspectMp3(mp3({ audio: frames(100) }));
    expect(r.ok && r.durationSource).toBe('cbr');
    expect(r.ok && r.duration).toBeCloseTo((100 * FRAME_BYTES * 8) / 128000, 2);
  });

  it('uses Xing / Info / VBRI frame counts when present', () => {
    for (const audio of [xingFrames(1000), xingFrames(1000, 3, 'Info'), vbriFrames(1000)]) {
      const r = inspectMp3(mp3({ v2: id3v2({ title: 'x' }), audio }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.duration).toBeCloseTo(1000 * FRAME_SECONDS, 2);
    }
    const r = inspectMp3(mp3({ audio: vbriFrames(500) }));
    expect(r.ok && r.durationSource).toBe('vbri');
  });

  it('rejects files without real MPEG audio (by content, not extension)', () => {
    const random = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7919 + 13) % 251);
    expect(inspectMp3(random)).toMatchObject({ ok: false });
    expect(inspectMp3(new TextEncoder().encode('<html>'.repeat(50)))).toMatchObject({ ok: false });
    expect(inspectMp3(Uint8Array.of(1, 2, 3))).toMatchObject({ ok: false, reason: expect.stringContaining('too small') });
    expect(inspectMp3(concat(id3v2({ title: 'Only a tag' }), new Uint8Array(64)))).toMatchObject({ ok: false, reason: expect.stringContaining('no MPEG audio') });
    // A single stray sync pattern isn't enough.
    const stray = new Uint8Array(2000);
    stray.set([0xff, 0xfb, 0x90, 0x64], 100);
    expect(inspectMp3(stray).ok).toBe(false);
  });

  it('survives truncated / corrupt tags without throwing', () => {
    const tag = id3v2({ title: 'Truncated', artist: 'Someone' });
    const broken = tag.slice();
    broken[6 + 3] = 0x7f; // declared size far larger than the data
    expect(() => inspectMp3(concat(broken, frames(4)))).not.toThrow();
    expect(() => inspectMp3(concat(tag.subarray(0, 15)))).not.toThrow();
    for (let cut = 0; cut < 200; cut += 7) expect(() => inspectMp3(mp3({ v2: tag }).subarray(0, cut))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
describe('ID3 tags', () => {
  it('reads ID3v2.4 (UTF-8), v2.3 (Latin-1 and UTF-16) and v2.2', () => {
    const cases = [
      id3v2({ title: 'Nachtfahrt — ü', artist: 'Bean', album: 'Neon', track: '3/12' }, 4),
      id3v2({ title: 'Nachtfahrt — ü', artist: 'Bean', album: 'Neon', track: '3/12', encoding: 'utf16' }, 3),
      id3v2({ title: 'Nachtfahrt — ü', artist: 'Bean', album: 'Neon', track: '3/12', encoding: 'utf16be' }, 4),
    ];
    for (const v2 of cases) {
      const r = inspectMp3(mp3({ v2 }));
      expect(r.ok && r.tags).toMatchObject({ title: 'Nachtfahrt — ü', artist: 'Bean', album: 'Neon', trackNo: 3 });
    }
    const latin = inspectMp3(mp3({ v2: id3v2({ title: 'Café', artist: 'Zoë' }, 3) }));
    expect(latin.ok && latin.tags).toMatchObject({ title: 'Café', artist: 'Zoë' });
    const v22 = inspectMp3(mp3({ v2: id3v22({ title: 'Old Tag', artist: 'Retro', album: 'CD', track: '7', picture: { data: JPEG } }) }));
    expect(v22.ok && v22.tags).toMatchObject({ title: 'Old Tag', artist: 'Retro', album: 'CD', trackNo: 7 });
    expect(v22.ok && v22.tagVersions).toEqual(['ID3v2.2']);
    expect(v22.ok && v22.tags.picture?.mime).toBe('image/jpeg');
  });

  it('reads ID3v1(.1) and lets ID3v2 win where both exist', () => {
    const only1 = inspectMp3(mp3({ v1: id3v1({ title: 'V1 Title', artist: 'V1 Artist', album: 'V1 Album', track: 9 }) }));
    expect(only1.ok && only1.tags).toMatchObject({ title: 'V1 Title', artist: 'V1 Artist', album: 'V1 Album', trackNo: 9 });
    const both = inspectMp3(mp3({ v2: id3v2({ title: 'V2 Title' }), v1: id3v1({ title: 'V1 Title', artist: 'V1 Artist' }) }));
    expect(both.ok && both.tags).toMatchObject({ title: 'V2 Title', artist: 'V1 Artist' });
    expect(both.ok && both.tagVersions).toEqual(['ID3v2.4', 'ID3v1']);
    // CBR estimate excludes the 128-byte v1 tag.
    expect(both.ok && both.duration).toBeCloseTo((8 * FRAME_BYTES * 8) / 128000, 2);
  });

  it('extracts APIC artwork (front cover preferred) and uses the album artist as a fallback', () => {
    const r = inspectMp3(mp3({ v2: id3v2({ title: 'Art', albumArtist: 'Band', picture: { data: PNG, mime: 'image/png', description: 'cover' } }) }));
    expect(r.ok && r.tags.picture?.data).toEqual(PNG);
    expect(r.ok && r.tags.artist).toBe('Band');
  });
});

// ---------------------------------------------------------------------------
describe('names, titles and ids', () => {
  it('derives clean titles from file names', () => {
    expect(titleFromFileName('this_is_my_song_v4_final.mp3')).toBe('This Is My Song');
    expect(titleFromFileName("Hope's Turnaround (1).mp3")).toBe("Hope's Turnaround");
    expect(titleFromFileName('Neon Cruising - Copy.mp3')).toBe('Neon Cruising');
    expect(titleFromFileName('neon-cruising-final.mp3')).toBe('Neon Cruising');
    expect(titleFromFileName('01 - Night Drive.mp3')).toBe('Night Drive');
    expect(titleFromFileName('8-Bit Outrun.mp3')).toBe('8-Bit Outrun');
    expect(titleFromFileName('99 Luftballons.mp3')).toBe('99 Luftballons');
    expect(titleFromFileName('07 Night Drive.mp3')).toBe('Night Drive');
    expect(titleFromFileName('3. neon_rain.mp3')).toBe('Neon Rain');
    expect(titleFromFileName('Rock & Roll! (v2).mp3')).toBe('Rock & Roll!');
    expect(titleFromFileName('WHAT IS THIS?.mp3')).toBe('What Is This?');
    expect(titleFromFileName('Café Noir.mp3')).toBe('Café Noir');
    expect(titleFromFileName('夜のドライブ.mp3')).toBe('夜のドライブ');
    expect(titleFromFileName('v2.mp3')).toBe('V2');
    expect(titleFromFileName('___.mp3')).toBe('Untitled Track');
  });

  it('detects copy suffixes', () => {
    expect(hasCopySuffix("Hope's Turnaround (1).mp3")).toBe(true);
    expect(hasCopySuffix('Song copy.mp3')).toBe(true);
    expect(hasCopySuffix('Song - Copy (2).mp3')).toBe(true);
    expect(hasCopySuffix('Song.mp3')).toBe(false);
  });

  it('slugs are URL-safe and match the track id pattern', () => {
    expect(slugify("Hope's Turnaround.mp3")).toBe('hopes-turnaround');
    expect(slugify('Café Noir & Rain.mp3')).toBe('cafe-noir-and-rain');
    expect(slugify('夜のドライブ.mp3')).toBe('');
    for (const n of ['A'.repeat(300) + '.mp3', '--x--.mp3', '8-Bit Outrun.mp3']) expect(TRACK_ID_RE.test(slugify(n))).toBe(true);
  });

  it('collisions get stable, distinct hash-suffixed ids; the first by name keeps the plain slug', () => {
    const names = ['neon_cruising.mp3', 'Neon Cruising.mp3', 'NEON-CRUISING.mp3', '夜.mp3', '朝.mp3'];
    const a = assignIds(names);
    const b = assignIds([...names].reverse());
    expect(a).toEqual(b);
    expect(new Set(a.values()).size).toBe(names.length);
    expect(a.get('NEON-CRUISING.mp3')).toBe('neon-cruising');
    expect(a.get('Neon Cruising.mp3')).toMatch(/^neon-cruising-[0-9a-f]{6}$/);
    expect(a.get('夜.mp3')).toMatch(/^track-[0-9a-f]{6}$/);
    for (const id of a.values()) expect(TRACK_ID_RE.test(id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('buildIndex', () => {
  it('one MP3 → a valid manifest entry', () => {
    const r = index([f('Neon Cruising.mp3', mp3({ v2: id3v2({ title: 'Neon Cruising', artist: 'Bean', album: 'Night', track: '1', picture: { data: JPEG } }) }))]);
    expect(JukeboxManifestSchema.safeParse(r.manifest).success).toBe(true);
    expect(r.manifest).toMatchObject({ version: 1, generatedAt: NOW.toISOString() });
    expect(r.manifest.tracks).toEqual([
      {
        id: 'neon-cruising',
        src: '/audio/jukebox/Neon%20Cruising.mp3',
        file: 'Neon Cruising.mp3',
        title: 'Neon Cruising',
        artist: 'Bean',
        album: 'Night',
        trackNo: 1,
        duration: expect.any(Number),
        artwork: expect.stringMatching(/^\/audio\/jukebox\/art\/neon-cruising\.jpg\?v=[0-9a-f]{8}$/),
        order: 0,
        bytes: expect.any(Number),
      },
    ]);
    expect(r.art).toEqual([{ path: 'art/neon-cruising.jpg', mime: 'image/jpeg', data: JPEG }]);
    expect(summaryLine(r)).toContain('1 track indexed');
  });

  it('multiple files, spaces, punctuation and Unicode names', () => {
    const r = index([
      f('Sunsets in Smog.mp3', mp3({ salt: 1 })),
      f("Rock & Roll! (It's Late).mp3", mp3({ salt: 2 })),
      f('Café — Nuit #2.mp3', mp3({ salt: 3 })),
      f('夜のドライブ.mp3', mp3({ salt: 4 })),
    ]);
    expect(r.tracks.map((t) => t.title)).toEqual(["Café — Nuit #2", "Rock & Roll! (It's Late)", 'Sunsets in Smog', '夜のドライブ']);
    expect(r.tracks.map((t) => t.src)).toContain('/audio/jukebox/Caf%C3%A9%20%E2%80%94%20Nuit%20%232.mp3');
    expect(r.tracks.every((t) => TRACK_ID_RE.test(t.id))).toBe(true);
    expect(r.tracks.map((t) => t.order)).toEqual([0, 1, 2, 3]);
    expect(JukeboxManifestSchema.safeParse(r.manifest).success).toBe(true);
  });

  it('missing metadata → title from the file name; partial ID3 fills what it has', () => {
    const r = index([
      f('this_is_my_song_v4_final.mp3', mp3({ salt: 1 })),
      f('partial.mp3', mp3({ v2: id3v2({ artist: 'Only Artist' }), salt: 2 })),
    ]);
    const bare = r.tracks.find((t) => t.file === 'this_is_my_song_v4_final.mp3')!;
    expect(bare).toMatchObject({ title: 'This Is My Song', titleSource: 'filename' });
    expect(bare.artist).toBeUndefined();
    expect(r.tracks.find((t) => t.file === 'partial.mp3')).toMatchObject({ title: 'Partial', artist: 'Only Artist' });
  });

  it('duplicate titles are fine (distinct ids, both listed)', () => {
    const r = index([
      f('a.mp3', mp3({ v2: id3v2({ title: 'Same Song' }), salt: 1 })),
      f('b.mp3', mp3({ v2: id3v2({ title: 'Same Song' }), salt: 2 })),
    ]);
    expect(r.tracks.map((t) => [t.id, t.title])).toEqual([
      ['a', 'Same Song'],
      ['b', 'Same Song'],
    ]);
  });

  it('file-name slug collisions → distinct ids, stable across runs and input order', () => {
    const files = [f('Neon Cruising.mp3', mp3({ salt: 1 })), f('neon_cruising.mp3', mp3({ salt: 2 })), f('NEON CRUISING!.mp3', mp3({ salt: 3 }))];
    const one = index(files).tracks.map((t) => [t.file, t.id]);
    const two = index([...files].reverse()).tracks.map((t) => [t.file, t.id]);
    expect(new Set(one.map(([, id]) => id)).size).toBe(3);
    expect(Object.fromEntries(one)).toEqual(Object.fromEntries(two));
    expect(Object.fromEntries(one)['NEON CRUISING!.mp3']).toBe('neon-cruising');
  });

  it('byte-identical duplicates: the non-copy name wins, the copy is reported', () => {
    const bytes = mp3({ v2: id3v2({ title: "Hope's Turnaround" }) });
    const r = index([f("Hope's Turnaround (1).mp3", bytes), f("Hope's Turnaround.mp3", bytes.slice()), f('Other.mp3', mp3({ salt: 9 }))]);
    expect(r.tracks.map((t) => t.file).sort()).toEqual(["Hope's Turnaround.mp3", 'Other.mp3']);
    expect(r.duplicates).toEqual([{ file: "Hope's Turnaround (1).mp3", duplicateOf: "Hope's Turnaround.mp3" }]);
  });

  it('bad / non-MP3 files are rejected or ignored, never fatal', () => {
    const r = index([
      f('good.mp3', mp3()),
      f('fake.mp3', new TextEncoder().encode('this is not audio at all, just text pretending'.repeat(20))),
      f('empty.mp3', new Uint8Array(0)),
      f('tag-only.MP3', concat(id3v2({ title: 'x' }), new Uint8Array(100))),
      f('cover.png', PNG),
      f('notes.txt', new TextEncoder().encode('hi')),
      f('.DS_Store', new Uint8Array(10)),
    ]);
    expect(r.tracks.map((t) => t.file)).toEqual(['good.mp3']);
    expect(r.rejected.map((x) => x.file)).toEqual(['empty.mp3', 'fake.mp3', 'tag-only.MP3']);
    expect(r.rejected.every((x) => x.reason.length > 3)).toBe(true);
    expect(r.ignored).toEqual(['cover.png', 'notes.txt']);
    expect(r.found).toBe(6);
  });

  it('accepts an upper-case .MP3 extension', () => {
    expect(index([f('LOUD.MP3', mp3())]).tracks[0]).toMatchObject({ id: 'loud', title: 'Loud' });
  });

  it('empty folder → empty manifest', () => {
    const r = index([]);
    expect(r.manifest.tracks).toEqual([]);
    expect(r.totalBytes).toBe(0);
    expect(summaryLine(r)).toContain('0 tracks indexed');
  });

  it('sorts by sidecar order, then track number, then title', () => {
    const r = index(
      [
        f('zed.mp3', mp3({ salt: 1 })),
        f('alpha.mp3', mp3({ salt: 2 })),
        f('t2.mp3', mp3({ v2: id3v2({ title: 'Track Two', track: '2' }), salt: 3 })),
        f('t1.mp3', mp3({ v2: id3v2({ title: 'Track One', track: '1' }), salt: 4 })),
        f('pinned.mp3', mp3({ salt: 5 })),
      ],
      JSON.stringify({ tracks: { 'pinned.mp3': { order: 1 }, 'zed.mp3': { order: 0 } } }),
    );
    expect(r.tracks.map((t) => t.file)).toEqual(['zed.mp3', 'pinned.mp3', 't1.mp3', 't2.mp3', 'alpha.mp3']);
  });

  it('sidecar overrides title/artist/album/cover/hidden and supplies defaults', () => {
    const r = index(
      [
        f('one.mp3', mp3({ v2: id3v2({ title: 'Tagged', artist: 'Tag Artist', picture: { data: JPEG } }), salt: 1 })),
        f('two.mp3', mp3({ salt: 2 })),
        f('secret.mp3', mp3({ salt: 3 })),
      ],
      JSON.stringify({
        defaults: { artist: 'House Band', album: 'DASCADE OST' },
        tracks: {
          'one.mp3': { title: 'Renamed', album: 'Special', cover: 'covers/one.png' },
          'secret.mp3': { hidden: true },
          'missing.mp3': { title: 'Typo' },
        },
      }),
      (p) => (p === 'covers/one.png' ? PNG : null),
    );
    expect(r.tracks.find((t) => t.file === 'one.mp3')).toMatchObject({ title: 'Renamed', titleSource: 'sidecar', artist: 'Tag Artist', album: 'Special', artwork: expect.stringContaining('/art/one.png') });
    expect(r.tracks.find((t) => t.file === 'two.mp3')).toMatchObject({ title: 'Two', artist: 'House Band', album: 'DASCADE OST' });
    expect(r.hidden).toEqual(['secret.mp3']);
    expect(r.tracks.some((t) => t.file === 'secret.mp3')).toBe(false);
    expect(r.warnings.some((w) => w.includes('missing.mp3'))).toBe(true);
    expect(r.art.map((a) => a.path)).toEqual(['art/one.png']);
  });

  it('unsafe or missing sidecar covers are ignored with a warning', () => {
    const r = index([f('one.mp3', mp3())], JSON.stringify({ tracks: { 'one.mp3': { cover: '../../secrets.png' } } }), () => PNG);
    expect(r.tracks[0]!.artwork).toBeUndefined();
    expect(r.warnings[0]).toContain('inside the jukebox folder');
  });

  it('a corrupt or invalid sidecar is a warning, not a crash', () => {
    const bad = index([f('one.mp3', mp3())], '{ "tracks": { oops');
    expect(bad.tracks).toHaveLength(1);
    expect(bad.warnings[0]).toContain('not valid JSON');
    const wrong = index([f('one.mp3', mp3())], JSON.stringify({ tracks: { 'one.mp3': { order: 'first' } } }));
    expect(wrong.tracks[0]!.title).toBe('One');
    expect(wrong.warnings[0]).toContain("doesn't match");
  });
});

// ---------------------------------------------------------------------------
describe('records (sub-folders)', () => {
  const build = (files: InputFile[], opts: BuildIndexOptions = {}) => buildIndex(files, { now: NOW, ...opts });
  const tagged = (album: string, salt: number, title?: string, artist = 'beanalicious') =>
    mp3({ v2: id3v2({ ...(title ? { title } : {}), artist, album }), salt });

  it('the loose files are the main record; each folder with MP3s is another; the main record comes first', () => {
    const r = build([
      f('Neon Cruising.mp3', tagged('Cyber Nightpulse', 1, 'Neon Cruising')),
      f('Arcade Pulse.mp3', tagged('Cyber Nightpulse', 2, 'Arcade Pulse')),
      f('Spooky Folder/Ghost Song.mp3', mp3({ salt: 3 })),
      f('Spooky Folder/A Bat Waltz.mp3', mp3({ salt: 4 })),
      f('Alpha/Early.mp3', mp3({ salt: 5 })),
    ]);
    expect(JukeboxManifestSchema.safeParse(r.manifest).success).toBe(true);
    expect(r.manifest.records!.map((x) => [x.id, x.title, x.tracks, x.order])).toEqual([
      ['main', 'Cyber Nightpulse', 2, 0],
      ['alpha', 'Alpha', 1, 1],
      ['spooky-folder', 'Spooky Folder', 2, 2],
    ]);
    // Catalogue order runs record by record (so the main record's first song keeps code A1).
    expect(r.manifest.tracks.map((t) => [t.title, t.record ?? null, t.order])).toEqual([
      ['Arcade Pulse', null, 0],
      ['Neon Cruising', null, 1],
      ['Early', 'alpha', 2],
      ['A Bat Waltz', 'spooky-folder', 3],
      ['Ghost Song', 'spooky-folder', 4],
    ]);
    const ghost = r.manifest.tracks.find((t) => t.title === 'Ghost Song')!;
    expect(ghost).toMatchObject({ id: 'ghost-song', file: 'Spooky Folder/Ghost Song.mp3', src: '/audio/jukebox/Spooky%20Folder/Ghost%20Song.mp3' });
    // A record's songs without an album tag are on that record.
    expect(ghost.album).toBe('Spooky Folder');
    expect(r.manifest.tracks[0]!.album).toBe('Cyber Nightpulse');
    expect(r.records.map((x) => x.folder)).toEqual(['', 'Alpha', 'Spooky Folder']);
    expect(r.records[2]!.duration).toBeCloseTo(r.tracks.filter((t) => t.record === 'spooky-folder').reduce((n, t) => n + t.duration, 0));
    expect(summaryLine(r)).toMatch(/^jukebox: 5 tracks indexed, 3 records, /);
  });

  it("adding a record never renames an existing song: the loose files keep their ids, folders get the suffix", () => {
    // "Album/…" sorts before "zed.mp3", and both slug to "zed".
    const before = build([f('zed.mp3', mp3({ salt: 1 }))]);
    const after = build([f('zed.mp3', mp3({ salt: 1 })), f('Album/Zed.mp3', mp3({ salt: 2 })), f('Other/zed.mp3', mp3({ salt: 3 }))]);
    expect(before.tracks[0]!.id).toBe('zed');
    const ids = Object.fromEntries(after.tracks.map((t) => [t.file, t.id]));
    expect(ids['zed.mp3']).toBe('zed');
    expect(ids['Album/Zed.mp3']).toMatch(/^zed-[0-9a-f]{6}$/);
    expect(ids['Other/zed.mp3']).toMatch(/^zed-[0-9a-f]{6}$/);
    expect(new Set(Object.values(ids)).size).toBe(3);
  });

  it("a folder's sidecar names the record, its artist, sleeve, theme, accents and shelf order, and tags its songs", () => {
    const sidecar = {
      record: { title: 'Halloween', artist: 'beanalicious', theme: 'halloween-night', accent: '#ff7a18', accent2: '#9b4dff', order: -1, cover: 'sleeve.jpg' },
      defaults: { artist: 'beanalicious' },
      tracks: { 'Graveyard Shift.mp3': { order: 1 }, 'Typo.mp3': { order: 2 } },
    };
    const r = build(
      [f('Main.mp3', mp3({ salt: 1 })), f('halloween/Pumpkin Patch Groove.mp3', mp3({ salt: 2 })), f('halloween/Graveyard Shift.mp3', mp3({ salt: 3 }))],
      { folderSidecars: { halloween: JSON.stringify(sidecar) }, readCover: (p) => (p === 'halloween/sleeve.jpg' ? JPEG : null) },
    );
    const [first, second] = r.manifest.records!;
    expect(first).toMatchObject({ id: 'halloween', title: 'Halloween', artist: 'beanalicious', theme: 'halloween-night', accent: '#ff7a18', accent2: '#9b4dff', order: 0, tracks: 2 });
    expect(first!.cover).toMatch(/^\/audio\/jukebox\/art\/records\/halloween\.jpg\?v=[0-9a-f]{8}$/);
    expect(second).toMatchObject({ id: 'main', order: 1 });
    expect(r.manifest.tracks.map((t) => [t.title, t.artist ?? null, t.album ?? null])).toEqual([
      ['Graveyard Shift', 'beanalicious', 'Halloween'],
      ['Pumpkin Patch Groove', 'beanalicious', 'Halloween'],
      ['Main', null, null],
    ]);
    expect(r.warnings).toEqual(['halloween/jukebox.json: no file named "Typo.mp3" in the folder']);
  });

  it('record names: the sidecar, else the album most songs share, else the folder name', () => {
    const r = build([
      f('a/One.mp3', tagged('Night Drive', 1)),
      f('a/Two.mp3', tagged('Night Drive', 2)),
      f('a/Three.mp3', tagged('Bonus', 3)),
      f('spooky_season/x.mp3', mp3({ salt: 4 })),
    ]);
    expect(r.records.map((x) => [x.id, x.title, x.artist ?? null])).toEqual([
      ['a', 'Night Drive', 'beanalicious'],
      ['spooky-season', 'Spooky Season', null],
    ]);
    expect(titleFromFolder('halloween')).toBe('Halloween');
    expect(titleFromFolder('DAS-O-Ween 2')).toBe('DAS-O-Ween 2');
    expect(titleFromFolder('  ')).toBe('Untitled Record');
  });

  it("the sleeve falls back to the first song's art; a bad sidecar sleeve is a warning", () => {
    const r = build([f('x/Second.mp3', mp3({ v2: id3v2({ track: '2', picture: { data: PNG } }), salt: 1 })), f('x/First.mp3', mp3({ v2: id3v2({ track: '1', picture: { data: JPEG } }), salt: 2 }))], {
      folderSidecars: { x: JSON.stringify({ record: { cover: '../escape.jpg' } }) },
    });
    expect(r.records[0]!.cover).toBe(r.tracks[0]!.artwork);
    expect(r.tracks[0]!.title).toBe('First');
    expect(r.warnings[0]).toContain('must be a path inside the jukebox folder');
  });

  it('duplicates are per record (the same song may be on two records); junk in a record folder is reported', () => {
    const same = mp3({ salt: 9 });
    const r = build([f('Song.mp3', same), f('best-of/Song.mp3', same), f('best-of/Song (1).mp3', same), f('best-of/notes.txt', new Uint8Array(0)), f('covers/x.jpg', JPEG)]);
    expect(r.tracks.map((t) => t.file)).toEqual(['Song.mp3', 'best-of/Song.mp3']);
    expect(r.duplicates).toEqual([{ file: 'best-of/Song (1).mp3', duplicateOf: 'best-of/Song.mp3' }]);
    expect(r.ignored).toEqual(['best-of/notes.txt']);
    expect(r.records.map((x) => x.id)).toEqual(['main', 'best-of']);
  });

  it('reserved names: art/ is never a record; folders named main or all get a unique id', () => {
    const r = build([f('art/Song.mp3', mp3({ salt: 1 })), f('Main/One.mp3', mp3({ salt: 2 })), f('All/Two.mp3', mp3({ salt: 3 }))]);
    expect(r.tracks.map((t) => t.file).sort()).toEqual(['All/Two.mp3', 'Main/One.mp3']);
    const ids = r.records.map((x) => x.id);
    expect(ids).not.toContain('main');
    expect(ids).not.toContain('all');
    for (const id of ids) expect(TRACK_ID_RE.test(id)).toBe(true);
    expect(r.warnings.some((w) => w.includes('reserved for cover art'))).toBe(true);
  });

  it('warns (never fails) about a song too big for the repo', () => {
    const big = concat(mp3({ salt: 1 }), new Uint8Array(WARN_TRACK_BYTES));
    const r = build([f('x/Huge.mp3', big)]);
    expect(r.tracks).toHaveLength(1);
    expect(r.warnings.some((w) => w.startsWith('x/Huge.mp3 is ') && w.includes('128–192 kbps'))).toBe(true);
  });

  it('a manifest without records still validates (older builds) and a hidden folder song is left out', () => {
    expect(JukeboxManifestSchema.safeParse({ version: 1, generatedAt: NOW.toISOString(), tracks: [] }).success).toBe(true);
    const r = build([f('x/Keep.mp3', mp3({ salt: 1 })), f('x/Drop.mp3', mp3({ salt: 2 }))], { folderSidecars: { x: JSON.stringify({ tracks: { 'Drop.mp3': { hidden: true } } }) } });
    expect(r.hidden).toEqual(['x/Drop.mp3']);
    expect(r.manifest.records![0]).toMatchObject({ id: 'x', tracks: 1 });
  });
});

// ---------------------------------------------------------------------------
describe('readJukeboxFolder (disk)', () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dascade-jukebox-'));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('a missing folder is an empty jukebox', () => {
    expect(readJukeboxFolder(path.join(os.tmpdir(), 'definitely-not-here-dascade')).manifest.tracks).toEqual([]);
  });

  it('picks up newly added and deleted files with stable ids; one level of record folders', () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'First Song.mp3'), mp3({ salt: 1 }));
    fs.mkdirSync(path.join(d, 'sub', 'deeper'), { recursive: true });
    fs.writeFileSync(path.join(d, 'sub', 'Nested.mp3'), mp3({ salt: 2 }));
    fs.writeFileSync(path.join(d, 'sub', 'deeper', 'Too Deep.mp3'), mp3({ salt: 4 }));
    const one = readJukeboxFolder(d);
    expect(one.tracks.map((t) => [t.id, t.record])).toEqual([
      ['first-song', undefined],
      ['nested', 'sub'],
    ]);
    expect(one.records.map((r) => [r.id, r.title, r.tracks])).toEqual([
      ['main', 'DASCADE Jukebox', 1],
      ['sub', 'Sub', 1],
    ]);

    fs.writeFileSync(path.join(d, 'Second Song.mp3'), mp3({ salt: 3 }));
    const two = readJukeboxFolder(d);
    expect(two.tracks.map((t) => t.id)).toEqual(['first-song', 'second-song', 'nested']);

    fs.rmSync(path.join(d, 'First Song.mp3'));
    fs.rmSync(path.join(d, 'sub'), { recursive: true });
    const three = readJukeboxFolder(d);
    expect(three.tracks.map((t) => t.id)).toEqual(['second-song']);
    expect(readJukeboxFolder(d).manifest.tracks).toEqual(three.manifest.tracks.map((t) => ({ ...t })));
  });

  it('reads the sidecar and sidecar covers from disk', () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'song.mp3'), mp3());
    fs.mkdirSync(path.join(d, 'covers'));
    fs.writeFileSync(path.join(d, 'covers', 'song.jpg'), JPEG);
    fs.writeFileSync(path.join(d, 'jukebox.json'), JSON.stringify({ tracks: { 'song.mp3': { title: 'From Sidecar', cover: 'covers/song.jpg' } } }));
    const r = readJukeboxFolder(d);
    expect(r.tracks[0]).toMatchObject({ title: 'From Sidecar', artwork: expect.stringContaining('/art/song.jpg') });
    expect(r.found).toBe(1); // the sidecar isn't a "file found"; a covers folder isn't a record
    expect(r.records.map((x) => x.id)).toEqual(['main']);
  });

  it("reads a record folder's sidecar and sleeve; the reserved art/ folder is never a record", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'Main Song.mp3'), mp3({ salt: 1 }));
    fs.mkdirSync(path.join(d, 'halloween'));
    fs.writeFileSync(path.join(d, 'halloween', 'Graveyard Shift.mp3'), mp3({ salt: 2 }));
    fs.writeFileSync(path.join(d, 'halloween', 'cover.png'), PNG);
    fs.writeFileSync(path.join(d, 'halloween', 'jukebox.json'), JSON.stringify({ record: { title: 'Spooky Season', theme: 'halloween-night', cover: 'cover.png' } }));
    fs.mkdirSync(path.join(d, 'art'));
    fs.writeFileSync(path.join(d, 'art', 'Oops.mp3'), mp3({ salt: 3 }));
    const r = readJukeboxFolder(d);
    expect(r.records.map((x) => [x.id, x.title, x.theme ?? null])).toEqual([
      ['main', 'DASCADE Jukebox', null],
      ['halloween', 'Spooky Season', 'halloween-night'],
    ]);
    expect(r.records[1]!.cover).toMatch(/^\/audio\/jukebox\/art\/records\/halloween\.png\?v=/);
    expect(r.art.map((a) => a.path)).toEqual(['art/records/halloween.png']);
    expect(r.tracks.map((t) => t.file)).toEqual(['Main Song.mp3', 'halloween/Graveyard Shift.mp3']);
    expect(r.ignored).toEqual([]); // the sleeve is the record's, not junk
    expect(r.warnings.some((w) => w.includes('"art" is reserved'))).toBe(true);
  });

  // The folder is the library: people drop MP3s in without touching code, so this checks what must hold
  // for any contents rather than pinning today's songs.
  it('indexes the real DASCADE jukebox folder cleanly', () => {
    const real = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/audio/jukebox');
    const r = readJukeboxFolder(real);
    expect(r.tracks.length).toBeGreaterThanOrEqual(1);
    expect(r.rejected).toEqual([]);
    expect(new Set(r.tracks.map((t) => t.id)).size).toBe(r.tracks.length);
    const files = new Set(r.tracks.map((t) => t.file));
    expect(r.duplicates.every((d) => files.has(d.duplicateOf))).toBe(true);
    expect(r.tracks.every((t) => t.duration > 30 && t.artist && t.title)).toBe(true);
    expect(JukeboxManifestSchema.safeParse(r.manifest).success).toBe(true);
  });
});
