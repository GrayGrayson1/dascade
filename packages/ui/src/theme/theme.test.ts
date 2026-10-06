import { afterEach, describe, expect, it, vi } from 'vitest';
import { MATERIAL_KEYS, type ThemeMaterials } from './materials.ts';
import {
  BUILT_IN_THEMES,
  DEFAULT_THEME_ID,
  DELTA_NEON,
  DERIVED_TOKENS,
  FOUNDATION_TOKENS,
  OPTIONAL_THEME_TOKENS,
  RENDERER_TOKENS,
  THEME_STYLE_ID,
  THEME_TOKENS,
  THEME_TOKEN_GROUPS,
  activeThemeId,
  applyTheme,
  colorToInt,
  formatColor,
  getTheme,
  hasTheme,
  listThemes,
  onThemeChange,
  parseCssColor,
  readThemeTokens,
  registerTheme,
  themeDeclarations,
  themeToCss,
  unregisterTheme,
  validateTheme,
  type ThemeDefinition,
  type ThemeDocument,
} from './index.ts';

// The ui package compiles without Node types, so fs comes in through an untyped dynamic import.
const { readFileSync } = (await import('node:fs' as string)) as { readFileSync: (path: URL, encoding: 'utf8') => string };
const css = (file: string) => readFileSync(new URL(`../styles/${file}`, import.meta.url), 'utf8');
const TOKENS_CSS = css('tokens.css');

/** name → value of every declaration in the tokens.css block introduced by `/* ---- <label>`. */
function block(label: string): Map<string, string> {
  const re = new RegExp(`/\\* -+ ${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^*]*\\*/\\s*:root \\{([\\s\\S]*?)\\n\\}`);
  const body = re.exec(TOKENS_CSS)?.[1];
  if (!body) throw new Error(`block ${label} not found`);
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Map<string, string>();
  for (const m of clean.matchAll(/(--[\w-]+):\s*([\s\S]*?);/g)) out.set(m[1]!, m[2]!.replace(/\s+/g, ' ').trim());
  return out;
}

/** Declarations inside a `<selector> { … }` rule of tokens.css. */
function rule(selector: string): Map<string, string> {
  const start = TOKENS_CSS.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`rule ${selector} not found`);
  const body = TOKENS_CSS.slice(start, TOKENS_CSS.indexOf('}', start));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+):\s*([\s\S]*?);/g)) out.set(m[1]!, m[2]!.trim());
  return out;
}

function testTheme(overrides: Partial<ThemeDefinition> = {}): ThemeDefinition {
  const tokens = { ...DELTA_NEON.tokens, '--bg-0': '#c0c0c0', '--page-bg': '#008080', '--font-display': "'Tahoma', sans-serif" };
  return {
    id: 'test-desktop',
    name: 'Test Desktop',
    description: 'Throwaway test theme',
    meta: { era: 'Test', tagline: 'Test theme', swatches: ['#008080', '#c0c0c0', '#000080', '#ffffff'], family: 'retro-desktop' },
    materials: Object.fromEntries(MATERIAL_KEYS.map((k) => [k, '#808080'])) as ThemeMaterials,
    colorScheme: 'light',
    metaThemeColor: '#008080',
    tokens,
    overrides: { '--button-primary-bg': '#c0c0c0', '--control-accent': '#000080' },
    renderer: { ...DELTA_NEON.renderer, background: '#008080' },
    ...overrides,
  };
}

class FakeElement {
  attrs = new Map<string, string>();
  id = '';
  textContent: string | null = null;
  removed = false;
  constructor(private readonly doc?: FakeDocument) {}
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  remove() {
    this.removed = true;
    this.doc?.head.children.splice(this.doc.head.children.indexOf(this), 1);
  }
}

class FakeDocument implements ThemeDocument {
  documentElement = new FakeElement();
  meta = new FakeElement();
  head = {
    children: [] as FakeElement[],
    appendChild: (node: unknown) => {
      this.head.children.push(node as FakeElement);
      return node;
    },
  };
  getElementById(id: string) {
    return this.head.children.find((c) => c.id === id) ?? null;
  }
  createElement() {
    return new FakeElement(this);
  }
  querySelector(selector: string) {
    return selector === 'meta[name="theme-color"]' ? this.meta : null;
  }
}

afterEach(() => {
  unregisterTheme('test-desktop');
  applyTheme(DEFAULT_THEME_ID, null);
});

describe('registry', () => {
  it('ships the twelve themes, Delta Neon first and default', () => {
    expect(BUILT_IN_THEMES.map((t) => t.id)).toEqual([
      'delta-neon',
      'shareware-97',
      'corporate-98',
      'cyber-cafe-01',
      'mall-arcade-92',
      'vhs-after-dark',
      'space-casino-2088',
      'lan-party',
      'saturday-morning',
      'executive',
      'neon-noir',
      'halloween-night',
    ]);
    expect(DELTA_NEON.name).toBe('Delta Neon');
    expect(DEFAULT_THEME_ID).toBe('delta-neon');
  });

  it('every registered theme defines every required token and validates cleanly', () => {
    registerTheme(testTheme());
    for (const theme of listThemes()) {
      for (const token of THEME_TOKENS) expect(theme.tokens[token], `${theme.id} ${token}`).toMatch(/\S/);
      expect(validateTheme(theme), theme.id).toEqual([]);
    }
  });

  it('token groups have no duplicates and never overlap foundation / derived / optional tokens', () => {
    expect(new Set(THEME_TOKENS).size).toBe(THEME_TOKENS.length);
    const reserved = new Set<string>([
      ...FOUNDATION_TOKENS,
      ...DERIVED_TOKENS,
      ...OPTIONAL_THEME_TOKENS,
      ...Object.values(RENDERER_TOKENS),
    ]);
    for (const token of THEME_TOKENS) expect(reserved.has(token), token).toBe(false);
    expect(Object.keys(THEME_TOKEN_GROUPS)).toEqual(
      expect.arrayContaining([
        'palette',
        'windows',
        'buttons',
        'shell',
        'hud',
        'cabinet',
        'marquee',
        'textures',
        'glow',
        'motion',
        'typography',
      ]),
    );
  });

  it('unknown, removed, empty and missing ids fall back to Delta Neon', () => {
    for (const id of ['nope', '', null, undefined, '__proto__', 'constructor']) expect(getTheme(id as string).id).toBe('delta-neon');
    registerTheme(testTheme());
    expect(getTheme('test-desktop').id).toBe('test-desktop');
    expect(unregisterTheme('test-desktop')).toBe(true);
    expect(getTheme('test-desktop').id).toBe('delta-neon');
    expect(hasTheme('test-desktop')).toBe(false);
  });

  it('rejects incomplete or unsafe themes with every problem listed', () => {
    const { ['--bg-0']: _dropped, ...missing } = DELTA_NEON.tokens;
    const bad = testTheme({
      id: 'Bad Id',
      tokens: {
        ...missing,
        '--glow-sm': 'none',
        '--sp-4': '10px',
        '--made-up': 'red',
        '--page-bg': 'red; } body { display: none',
      } as never,
      overrides: { '--not-optional': 'x' } as never,
      renderer: { ...DELTA_NEON.renderer, gridAlpha: 3 },
    });
    const problems = validateTheme(bad).join('\n');
    expect(problems).toMatch(/id "Bad Id"/);
    expect(problems).toMatch(/missing token --bg-0/);
    expect(problems).toMatch(/--glow-sm is derived/);
    expect(problems).toMatch(/--sp-4 is a foundation token/);
    expect(problems).toMatch(/unknown token --made-up/);
    expect(problems).toMatch(/--page-bg has an empty or unsafe value/);
    expect(problems).toMatch(/unknown override --not-optional/);
    expect(problems).toMatch(/renderer.gridAlpha/);
    expect(() => registerTheme(bad)).toThrow(/Invalid theme/);
    expect(hasTheme('Bad Id')).toBe(false);
  });

  it('built-in themes cannot be replaced or removed', () => {
    expect(() => registerTheme({ ...testTheme(), id: 'delta-neon' })).toThrow(/built in/);
    expect(unregisterTheme('delta-neon')).toBe(false);
    expect(getTheme('delta-neon')).toBe(DELTA_NEON);
  });
});

describe('tokens.css ⇄ Delta Neon', () => {
  const declared = new Map([...block('2. PALETTE'), ...block('3. SEMANTIC')]);

  it('tokens.css declares exactly the required tokens (+ renderer tokens) with Delta Neon values', () => {
    const cssTokens = [...declared.keys()].filter((k) => !k.startsWith('--render-'));
    expect(cssTokens.sort()).toEqual([...THEME_TOKENS].sort());
    for (const token of THEME_TOKENS) expect(declared.get(token), token).toBe(DELTA_NEON.tokens[token].replace(/\s+/g, ' '));
  });

  it('the display face falls back to legible numerals first (Tiny5 digits are ambiguous)', () => {
    expect(DELTA_NEON.tokens['--font-display'].startsWith("'DASCADE Digits', 'Tiny5'")).toBe(true);
    expect(declared.get('--font-display')?.startsWith("'DASCADE Digits', 'Tiny5'")).toBe(true);
  });

  it('renderer tokens in tokens.css match the Delta Neon renderer palette', () => {
    for (const [field, token] of Object.entries(RENDERER_TOKENS)) {
      expect(declared.get(token), token).toBe(String(DELTA_NEON.renderer[field as keyof typeof RENDERER_TOKENS]));
    }
    expect(DELTA_NEON.renderer.accent).toBe(DELTA_NEON.tokens['--cyan']);
    expect(DELTA_NEON.renderer.background).toBe(DELTA_NEON.tokens['--bg-0']);
  });

  it('foundation block holds only foundation tokens; derived block holds only derived tokens', () => {
    expect([...block('1. FOUNDATION').keys()].sort()).toEqual([...FOUNDATION_TOKENS].sort());
    expect([...block('DERIVED').keys()].sort()).toEqual([...DERIVED_TOKENS].sort());
  });

  it('visual-effects and reduced-motion rules only touch derived tokens', () => {
    const derived = new Set<string>(DERIVED_TOKENS);
    for (const selector of [":root[data-fx='low']", ":root[data-fx='off']", ":root[data-reduced-motion='true']"]) {
      const names = [...rule(selector).keys()];
      expect(names.length, selector).toBeGreaterThan(0);
      for (const name of names) expect(derived.has(name), `${selector} ${name}`).toBe(true);
    }
    expect([...rule(":root[data-fx='off']").keys()].sort()).toEqual(
      ['--glow-sm', '--glow-md', '--glow-lg', '--text-glow', '--scanline-opacity', '--render-glow', '--render-scanlines'].sort(),
    );
  });

  it('every var() used by the design-system CSS is a known token or a component-local variable', () => {
    const known = new Set<string>([
      ...FOUNDATION_TOKENS,
      ...THEME_TOKENS,
      ...DERIVED_TOKENS,
      ...OPTIONAL_THEME_TOKENS,
      ...Object.values(RENDERER_TOKENS),
      // component-local custom properties (set by components / inline styles)
      '--btn-bg',
      '--btn-bg-2',
      '--btn-fg',
      '--btn-edge',
      '--btn-glow',
      '--badge',
      '--tone',
      '--fill',
      '--value',
      '--p',
      '--size',
      '--player',
      '--swatch',
      '--w',
      '--deal-x',
      '--deal-y',
    ]);
    for (const file of ['base.css', 'components.css', 'effects.css']) {
      const source = css(file).replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of source.matchAll(/var\(\s*(--[\w-]+)/g)) expect(known.has(m[1]!), `${file}: ${m[1]}`).toBe(true);
    }
  });

  it('design-system CSS has no hard-coded colours outside tokens.css', () => {
    for (const file of ['base.css', 'components.css', 'effects.css']) {
      const source = css(file).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(source.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b(white|black)\b(?!-)/gi), file).toBeNull();
    }
  });
});

describe('themeToCss', () => {
  it('scopes every declaration to html[data-theme=<id>]', () => {
    const theme = testTheme();
    const out = themeToCss(theme);
    expect(out).toContain(":root[data-theme='test-desktop'] {");
    expect(out).toContain('  --page-bg: #008080;');
    expect(out).toContain('  --button-primary-bg: #c0c0c0;');
    expect(out).toContain('  --render-bg: #008080;');
    expect(out).toContain('  --render-glow-full: 1;');
    const names = themeDeclarations(theme).map(([n]) => n);
    expect(names).toEqual(expect.arrayContaining([...THEME_TOKENS, ...Object.values(RENDERER_TOKENS)]));
    for (const d of DERIVED_TOKENS) expect(names).not.toContain(d);
  });
});

describe('applyTheme', () => {
  it('sets html[data-theme], injects/removes the theme stylesheet and updates theme-color', () => {
    const doc = new FakeDocument();
    registerTheme(testTheme());
    expect(applyTheme('test-desktop', doc).id).toBe('test-desktop');
    expect(doc.documentElement.getAttribute('data-theme')).toBe('test-desktop');
    const style = doc.getElementById(THEME_STYLE_ID)!;
    expect(style.textContent).toContain(":root[data-theme='test-desktop']");
    expect(doc.meta.getAttribute('content')).toBe('#008080');
    expect(activeThemeId()).toBe('test-desktop');

    applyTheme('test-desktop', doc); // idempotent: one stylesheet
    expect(doc.head.children.filter((c) => c.id === THEME_STYLE_ID)).toHaveLength(1);

    applyTheme('delta-neon', doc);
    expect(doc.documentElement.getAttribute('data-theme')).toBe('delta-neon');
    expect(doc.getElementById(THEME_STYLE_ID)).toBeNull();
    expect(doc.meta.getAttribute('content')).toBe('#05040b');
  });

  it('falls back to Delta Neon for unknown ids', () => {
    const doc = new FakeDocument();
    expect(applyTheme('retro-1995-removed', doc).id).toBe('delta-neon');
    expect(doc.documentElement.getAttribute('data-theme')).toBe('delta-neon');
  });

  it('notifies subscribers once per actual change', () => {
    registerTheme(testTheme());
    const seen: string[] = [];
    const off = onThemeChange((t) => seen.push(t.id));
    applyTheme('test-desktop', null);
    applyTheme('test-desktop', null);
    applyTheme('delta-neon', null);
    off();
    applyTheme('test-desktop', null);
    expect(seen).toEqual(['test-desktop', 'delta-neon']);
  });

  it('works without a DOM (records the choice only)', () => {
    expect(applyTheme('delta-neon', null).id).toBe('delta-neon');
  });
});

describe('colours and renderer tokens', () => {
  it('parses hex and rgb() forms', () => {
    expect(parseCssColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor('#05040b')).toEqual({ r: 5, g: 4, b: 11, a: 1 });
    expect(parseCssColor('#00000080')?.a).toBeCloseTo(0.502, 2);
    expect(parseCssColor('rgba(190, 176, 255, 0.12)')).toEqual({ r: 190, g: 176, b: 255, a: 0.12 });
    expect(parseCssColor('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseCssColor('transparent')?.a).toBe(0);
    expect(parseCssColor('color-mix(in srgb, red 50%, blue)')).toBeNull();
    expect(formatColor({ r: 34, g: 211, b: 238, a: 1 })).toBe('#22d3ee');
    expect(formatColor({ r: 0, g: 0, b: 0, a: 0.35 })).toBe('rgba(0, 0, 0, 0.35)');
    expect(colorToInt('#22d3ee')).toBe(0x22d3ee);
    expect(colorToInt('not a colour', 0x123456)).toBe(0x123456);
  });

  it('readThemeTokens resolves the CSS it is given (scoped accent, fx-scaled glow)', () => {
    const values: Record<string, string> = {
      '--render-bg': ' #05040b',
      '--render-surface': '#110e22',
      '--render-text': '#f8f6ff',
      '--render-text-muted': '#9d95c4',
      '--render-line': '#beb0ff',
      '--accent': '#ffb020',
      '--accent-2': '#ff4f81',
      '--accent-deep': '#2a1405',
      '--render-grid-alpha': '0.06',
      '--render-glow': '0.5',
      '--render-scanlines': '0',
      '--font-num': "'Space Grotesk Variable', sans-serif",
    };
    const t = readThemeTokens(null, { getPropertyValue: (n) => values[n] ?? '' });
    expect(t.themeId).toBe('delta-neon');
    expect(t.background).toBe('#05040b');
    expect(t.accent).toBe('#ffb020');
    expect(t.int.accent).toBe(0xffb020);
    expect(t.glow).toBe(0.5);
    expect(t.scanlines).toBe(0);
    expect(t.gridAlpha).toBe(0.06);
    expect(t.fonts.num).toContain('Space Grotesk');
    expect(t.fonts.display).toBe(DELTA_NEON.tokens['--font-display']);
    expect(t.success).toBe('#2de38f'); // falls back to the palette when CSS is unavailable
  });

  it('readThemeTokens without a DOM returns the active theme palette', () => {
    vi.stubGlobal('document', undefined);
    try {
      const t = readThemeTokens();
      expect(t.background).toBe(DELTA_NEON.renderer.background);
      expect(t.accent).toBe(DELTA_NEON.renderer.accent);
      expect(t.glow).toBe(DELTA_NEON.renderer.glow);
      expect(t.int.background).toBe(0x05040b);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('material ink pairs stay legible (per game, after gameMaterials)', () => {
  const lum = (css: string) => {
    const c = parseCssColor(css)!;
    const ch = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const PAIRS = [
    ['cardFace', 'cardInk'],
    ['paper', 'paperInk'],
  ] as const;
  for (const theme of BUILT_IN_THEMES) {
    const base = theme.materials as Partial<ThemeMaterials> | undefined;
    if (!base) continue;
    const variants: [string, Partial<ThemeMaterials>][] = [['*', base]];
    for (const [game, nudge] of Object.entries(theme.gameMaterials ?? {})) variants.push([game, { ...base, ...nudge }]);
    for (const [game, m] of variants) {
      for (const [face, ink] of PAIRS) {
        const f = m[face];
        const i = m[ink];
        if (!f || !i || !parseCssColor(f) || !parseCssColor(i)) continue;
        it(`${theme.id} [${game}] ${ink} on ${face} is AA (≥ 4.5:1)`, () => {
          expect(ratio(f, i)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
});
