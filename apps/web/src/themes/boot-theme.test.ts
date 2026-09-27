/**
 * public/boot-theme.js (the pre-paint theme script in index.html) keeps a hand-written copy of each
 * theme's page background / theme-color / colour scheme. These tests run it against a tiny fake DOM
 * and pin its map to the theme definitions, so a theme edit can't silently bring the flash back.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_THEMES, DEFAULT_THEME_ID, getTheme, type ThemeDefinition } from '@dascade/ui';
import { peekStoredTheme } from '../app/settings.ts';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = readFileSync(join(WEB, 'public', 'boot-theme.js'), 'utf8');
const INDEX_HTML = readFileSync(join(WEB, 'index.html'), 'utf8');
const SETTINGS_KEY = 'dascade:v1:settings';

type Storage = { getItem(key: string): string | null };

function boot(storage: Storage | null) {
  const attrs = new Map<string, string>([['data-theme', DEFAULT_THEME_ID]]);
  const styles: Array<{ id: string; textContent: string }> = [];
  const meta = {
    content: getTheme(DEFAULT_THEME_ID).metaThemeColor,
    setAttribute(name: string, value: string) {
      if (name === 'content') meta.content = value;
    },
  };
  const document = {
    documentElement: { setAttribute: (name: string, value: string) => void attrs.set(name, value) },
    head: { appendChild: (node: { id: string; textContent: string }) => styles.push(node) },
    createElement: () => ({ id: '', textContent: '' }),
    querySelector: (selector: string) => (selector === 'meta[name="theme-color"]' ? meta : null),
  };
  const localStorage = storage ?? {
    getItem: () => {
      throw new Error('SecurityError: storage disabled');
    },
  };
  runInNewContext(SCRIPT, { document, localStorage });
  return { theme: attrs.get('data-theme'), styles, themeColor: meta.content };
}

const stored = (value: string): Storage => ({ getItem: (key) => (key === SETTINGS_KEY ? value : null) });
const withTheme = (theme: unknown) => stored(JSON.stringify({ masterVolume: 0.5, theme, settingsVersion: 3 }));

/** What the page background resolves to once the theme's CSS is applied. */
function pageBackground(t: ThemeDefinition): string {
  const tokens = t.tokens as Record<string, string>;
  const bg = tokens['--page-bg']!.trim();
  return bg === 'var(--bg-0)' ? tokens['--bg-0']!.trim() : bg;
}

describe('boot-theme.js (pre-paint theme)', () => {
  const themed = BUILT_IN_THEMES.filter((t) => t.id !== DEFAULT_THEME_ID);

  for (const t of themed) {
    it(`${t.id}: data-theme, page background, colour scheme and theme-color match the definition`, () => {
      const bg = pageBackground(t);
      // A gradient / another var would need the boot script to learn it: fail loudly instead.
      expect(bg, `${t.id} --page-bg`).toMatch(/^#[0-9a-f]{3,8}$/i);
      const scheme = (t.tokens as Record<string, string>)['--theme-color-scheme']!.trim();
      const out = boot(withTheme(t.id));
      expect(out.theme).toBe(t.id);
      expect(out.themeColor).toBe(t.metaThemeColor);
      expect(out.styles).toHaveLength(1);
      expect(out.styles[0]!.id).toBe('dc-boot-theme');
      // Same selector (and specificity) as the generated theme CSS, which comes later and wins.
      expect(out.styles[0]!.textContent).toBe(`:root[data-theme='${t.id}']{--page-bg:${bg};--theme-color-scheme:${scheme}}`);
      // Reads the same stored preference the app does.
      expect(peekStoredTheme(withTheme(t.id))).toBe(t.id);
    });
  }

  it('knows every built-in theme and nothing else', () => {
    const known = SCRIPT.match(/^\s*'?([a-z][a-z0-9-]+)'?: \[/gm)!.map((line) => line.trim().replace(/^'|'?: \[$/g, ''));
    expect(known.sort()).toEqual(themed.map((t) => t.id).sort());
  });

  it('leaves Delta Neon, unknown, corrupt, hostile or unreadable preferences to the page defaults', () => {
    const cases: Array<Storage | null> = [
      withTheme(DEFAULT_THEME_ID),
      withTheme('windows-2000'),
      withTheme('__proto__'),
      withTheme('toString'),
      withTheme(42),
      stored('{"theme": "shareware-97", oops'),
      stored('null'),
      stored('[]'),
      { getItem: () => null },
      null, // localStorage throws
    ];
    for (const storage of cases) {
      const out = boot(storage);
      expect(out.theme).toBe(DEFAULT_THEME_ID);
      expect(out.styles).toEqual([]);
      expect(out.themeColor).toBe(getTheme(DEFAULT_THEME_ID).metaThemeColor);
    }
  });

  it('index.html defaults are Delta Neon and load the boot script in <head> before the app', () => {
    const head = INDEX_HTML.slice(0, INDEX_HTML.indexOf('</head>'));
    expect(INDEX_HTML).toContain(`data-theme="${DEFAULT_THEME_ID}"`);
    expect(INDEX_HTML).toContain(`<meta name="theme-color" content="${getTheme(DEFAULT_THEME_ID).metaThemeColor}" />`);
    // A classic (render-blocking) script: not a module, not async/defer.
    expect(head).toMatch(/<script src="\/boot-theme\.js"><\/script>/);
    expect(INDEX_HTML.indexOf('/boot-theme.js')).toBeLessThan(INDEX_HTML.indexOf('type="module"'));
  });
});
