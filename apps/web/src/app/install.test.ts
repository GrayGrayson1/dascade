/**
 * The installable app and link previews (C13): the web manifest, its icons and the Open Graph /
 * Twitter tags in index.html, checked against the files that ship in public/.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_TITLE } from './title.ts';

const WEB = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, WEB));
const INDEX_HTML = read('index.html').toString('utf8');

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}
const MANIFEST = JSON.parse(read('public/manifest.webmanifest').toString('utf8')) as {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
};

/** A PNG's pixel size, from its IHDR chunk (bytes 16–23). */
function pngSize(path: string): { width: number; height: number } {
  const buf = read(path);
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** content="…" of the <meta> with this property / name. */
function meta(key: string): string | undefined {
  const re = new RegExp(`<meta (?:property|name)="${key.replace(/[.:]/g, '\\$&')}" content="([^"]*)" />`);
  return re.exec(INDEX_HTML)?.[1];
}

describe('web manifest', () => {
  it('is linked from index.html', () => {
    expect(INDEX_HTML).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
  });

  it('names the app, starts at the floor and opens standalone in the default theme’s colours', () => {
    expect(MANIFEST.name).toBe(APP_TITLE);
    expect(MANIFEST.short_name).toBe('DASCADE');
    expect(MANIFEST.start_url).toBe('/');
    expect(MANIFEST.scope).toBe('/');
    expect(MANIFEST.display).toBe('standalone');
    // The same colour as index.html's theme-color (Delta Neon's page background).
    expect(INDEX_HTML).toContain(`<meta name="theme-color" content="${MANIFEST.theme_color}" />`);
    expect(MANIFEST.background_color).toBe(MANIFEST.theme_color);
  });

  it('has 192 and 512 icons plus a maskable 512, each the size it says', () => {
    const any = MANIFEST.icons.filter((i) => (i.purpose ?? 'any') === 'any').map((i) => i.sizes);
    expect(any).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(MANIFEST.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512')).toBe(true);
    for (const icon of MANIFEST.icons) {
      expect(icon.type).toBe('image/png');
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(pngSize(`public${icon.src}`)).toEqual({ width: w, height: h });
    }
  });

  it('has an Apple touch icon (180 × 180)', () => {
    expect(INDEX_HTML).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(pngSize('public/apple-touch-icon.png')).toEqual({ width: 180, height: 180 });
  });
});

describe('link previews', () => {
  it('Open Graph: title, description, the live URL and a 1200 × 630 image', () => {
    expect(meta('og:title')).toBe(APP_TITLE);
    expect(meta('og:description')).toBeTruthy();
    expect(meta('og:type')).toBe('website');
    expect(meta('og:url')).toBe('https://dascade.onrender.com/');
    const image = meta('og:image')!;
    // Scrapers need an absolute URL; the file it names ships in public/.
    expect(image).toMatch(/^https:\/\/dascade\.onrender\.com\/[^/]+\.png$/);
    const file = new URL(image).pathname;
    expect(pngSize(`public${file}`)).toEqual({ width: 1200, height: 630 });
    expect(meta('og:image:width')).toBe('1200');
    expect(meta('og:image:height')).toBe('630');
    expect(meta('og:image:alt')).toBeTruthy();
  });

  it('Twitter / X: a large-image card with the same title, description and image', () => {
    expect(meta('twitter:card')).toBe('summary_large_image');
    expect(meta('twitter:title')).toBe(meta('og:title'));
    expect(meta('twitter:description')).toBe(meta('og:description'));
    expect(meta('twitter:image')).toBe(meta('og:image'));
  });
});
