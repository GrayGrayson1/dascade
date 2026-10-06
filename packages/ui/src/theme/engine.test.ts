/**
 * Theme engine contract: ids, materials, per-game materials, effects, renderer adapter fallbacks,
 * fx scaling and watchThemeTokens coalescing. (Token completeness / validation: theme.test.ts.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUILT_IN_THEMES,
  DEFAULT_EFFECTS,
  DEFAULT_THEME_ID,
  DELTA_NEON,
  MATERIAL_KEYS,
  THEME_COPY_KEYS,
  applyTheme,
  gameMaterialsCss,
  getTheme,
  materialVar,
  readThemeTokens,
  themeToCss,
  validateTheme,
  watchThemeTokens,
  type ThemeDefinition,
  type ThemeEffects,
} from './index.ts';

const CONTRACT_IDS = [
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
];

const VISUALIZERS: ThemeEffects['visualizer'][] = [
  'neon-bars',
  'pixel-bars',
  'lcd',
  'spectrum',
  'bubbles',
  'reels',
  'hologram',
  'oscilloscope',
  'blocks',
  'vu-meter',
  'glass-wave',
];
const TRANSITIONS: ThemeEffects['transition'][] = [
  'power',
  'boot',
  'shutter',
  'fluorescent',
  'tracking',
  'warp',
  'crt-off',
  'wipe',
  'haunt',
  'fade',
];
const AMBIENT: ThemeEffects['ambient'][] = ['none', 'rain', 'stars', 'dust', 'confetti', 'fog', 'sparkle'];
const SURFACES: ThemeEffects['surface'][] = ['glass', 'bevel', 'flat', 'plastic', 'wood', 'chrome', 'paper', 'felt'];

afterEach(() => {
  applyTheme(DEFAULT_THEME_ID, null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('registration', () => {
  it('registers exactly the twelve contract ids, in picker order, with valid unique kebab ids', () => {
    expect(BUILT_IN_THEMES.map((t) => t.id)).toEqual(CONTRACT_IDS);
    for (const t of BUILT_IN_THEMES) expect(t.id).toMatch(/^[a-z][a-z0-9-]{1,39}$/);
    expect(new Set(BUILT_IN_THEMES.map((t) => t.name)).size).toBe(12);
  });

  it('defaults and falls back to Delta Neon', () => {
    expect(DEFAULT_THEME_ID).toBe('delta-neon');
    for (const bad of [undefined, null, '', 'windows-95', '../x', 'DELTA-NEON', '__proto__', 'constructor']) {
      expect(getTheme(bad as string).id).toBe('delta-neon');
    }
  });

  it('every theme validates and has picker metadata', () => {
    for (const t of BUILT_IN_THEMES) {
      expect(validateTheme(t), t.id).toEqual([]);
      expect(t.meta.era.trim(), t.id).not.toBe('');
      expect(t.meta.tagline.trim(), t.id).not.toBe('');
      expect(t.meta.swatches, t.id).toHaveLength(4);
      expect(t.description.trim(), t.id).not.toBe('');
    }
  });
});

describe('materials', () => {
  it('Delta Neon defines none (every game keeps its own palette)', () => {
    expect(DELTA_NEON.materials).toBeUndefined();
    expect(themeToCss(DELTA_NEON)).not.toContain('--mat-');
  });

  it('every non-default theme defines every material with a parseable colour', () => {
    for (const t of BUILT_IN_THEMES.filter((x) => x.id !== DEFAULT_THEME_ID)) {
      expect(t.materials, t.id).toBeDefined();
      for (const key of MATERIAL_KEYS) {
        const v = t.materials![key];
        expect(typeof v === 'string' && v.trim().length > 0, `${t.id}.${key}`).toBe(true);
      }
      const css = themeToCss(t);
      for (const key of MATERIAL_KEYS) expect(css, `${t.id} ${key}`).toContain(`${materialVar(key)}:`);
    }
  });

  it('materials are required for non-default themes', () => {
    const { materials: _dropped, ...rest } = getTheme('neon-noir');
    void _dropped;
    expect(validateTheme({ ...rest, id: 'no-mats' } as ThemeDefinition).join(' ')).toContain('materials are required');
  });

  it('materialVar converts camelCase keys to --mat-kebab-case', () => {
    expect(materialVar('boardLight')).toBe('--mat-board-light');
    expect(materialVar('felt')).toBe('--mat-felt');
    expect(materialVar('metalHighlight')).toBe('--mat-metal-highlight');
  });

  it('per-game nudges emit [data-game] rules scoped to the theme, skipping unsafe or unknown entries', () => {
    const base = getTheme('neon-noir');
    const theme = {
      ...base,
      gameMaterials: {
        chess: { boardLight: '#eeeeee', boardDark: '#111111' },
        putt: { grass: '#00ff00', bogus: '#fff' } as Record<string, string>,
        'BAD ID': { felt: '#000' },
        ships: { water: 'red; } body { display:none' },
      },
    } as ThemeDefinition;
    const css = gameMaterialsCss(theme);
    expect(css).toContain(":root[data-theme='neon-noir'] [data-game='chess'] {");
    expect(css).toContain('--mat-board-light: #eeeeee;');
    expect(css).toContain('--mat-grass: #00ff00;');
    expect(css).not.toContain('bogus');
    expect(css).not.toContain('BAD ID');
    expect(css).not.toContain('display:none');
    expect(themeToCss(theme)).toContain("[data-game='chess']");
  });

  it('every shipped per-game nudge targets a known material key', () => {
    for (const t of BUILT_IN_THEMES) {
      for (const [game, nudges] of Object.entries(t.gameMaterials ?? {})) {
        expect(game, t.id).toMatch(/^[a-z][a-z0-9-]{1,39}$/);
        for (const key of Object.keys(nudges)) expect(MATERIAL_KEYS as readonly string[], `${t.id}.${game}.${key}`).toContain(key);
      }
    }
  });
});

describe('effects and copy', () => {
  it('every theme has a complete, valid effects profile after merging defaults', () => {
    for (const t of BUILT_IN_THEMES) {
      const e: ThemeEffects = { ...DEFAULT_EFFECTS, ...t.effects };
      expect(VISUALIZERS, t.id).toContain(e.visualizer);
      expect(TRANSITIONS, t.id).toContain(e.transition);
      expect(AMBIENT, t.id).toContain(e.ambient);
      expect(SURFACES, t.id).toContain(e.surface);
      for (const k of ['crt', 'grain', 'analog'] as const) expect(e[k] >= 0 && e[k] <= 1, `${t.id}.${k}`).toBe(true);
    }
  });

  it('copy only uses known keys', () => {
    for (const t of BUILT_IN_THEMES) {
      for (const key of Object.keys(t.copy ?? {})) expect(THEME_COPY_KEYS as readonly string[], `${t.id}.${key}`).toContain(key);
    }
  });
});

describe('renderer adapter (readThemeTokens)', () => {
  const reader = (values: Record<string, string>) => ({ getPropertyValue: (n: string) => values[n] ?? '' });

  it('Delta Neon: materials are absent, so `m.key ?? CURRENT` keeps the game palette', () => {
    const t = readThemeTokens(null, reader({}));
    expect(t.materials).toEqual({});
    expect(t.materials.boardLight ?? '#c9c2f0').toBe('#c9c2f0');
    expect(t.effects).toEqual(DEFAULT_EFFECTS);
  });

  it('resolves materials present in scope (per-game nudges are just CSS in scope of the element)', () => {
    applyTheme('neon-noir', null);
    const t = readThemeTokens(null, reader({ '--mat-board-light': ' #EEEEEE ', '--mat-felt': 'rgb(1, 2, 3)' }));
    expect(t.themeId).toBe('neon-noir');
    expect(t.materials.boardLight).toBe('#eeeeee');
    expect(t.materials.felt).toBe('#010203');
    expect(t.materials.water).toBeUndefined(); // missing in scope → undefined, never a throw
    expect(t.effects).toEqual({ ...DEFAULT_EFFECTS, ...getTheme('neon-noir').effects });
  });

  it('without a DOM, materials come from the active theme definition', () => {
    vi.stubGlobal('document', undefined);
    applyTheme('executive', null);
    const t = readThemeTokens();
    expect(t.materials.boardLight).toBeDefined();
    expect(Object.keys(t.materials)).toHaveLength(MATERIAL_KEYS.length);
  });

  it('scales glow / scanlines by the visual-effects level when derived tokens are unavailable', () => {
    const r = DELTA_NEON.renderer;
    for (const [fx, glow, scan] of [
      ['high', r.glow, r.scanlines],
      ['low', r.glowSoft, r.scanlinesSoft],
      ['off', 0, 0],
    ] as const) {
      vi.stubGlobal('document', {
        documentElement: { getAttribute: (n: string) => (n === 'data-fx' ? fx : n === 'data-reduced-motion' ? 'true' : null) },
      });
      const t = readThemeTokens(null, reader({}));
      expect(t.fx).toBe(fx);
      expect(t.glow).toBe(glow);
      expect(t.scanlines).toBe(scan);
      expect(t.reducedMotion).toBe(true);
    }
  });
});

describe('watchThemeTokens', () => {
  it('calls immediately, coalesces bursts of changes into one call, and stops after dispose', () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', undefined); // no MutationObserver path; theme listener only
    const seen: string[] = [];
    const stop = watchThemeTokens(null, (t) => seen.push(t.themeId));
    expect(seen).toEqual(['delta-neon']);
    applyTheme('neon-noir', null);
    applyTheme('executive', null);
    applyTheme('lan-party', null);
    expect(seen).toHaveLength(1);
    vi.runAllTimers();
    expect(seen).toEqual(['delta-neon', 'lan-party']);
    stop();
    stop(); // idempotent
    applyTheme('delta-neon', null);
    vi.runAllTimers();
    expect(seen).toHaveLength(2);
  });

  it('dispose cancels a pending call; immediate:false skips the first call', () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', undefined);
    const cb = vi.fn();
    const stop = watchThemeTokens(() => null, cb, { immediate: false });
    expect(cb).not.toHaveBeenCalled();
    applyTheme('neon-noir', null);
    stop();
    vi.runAllTimers();
    expect(cb).not.toHaveBeenCalled();
  });
});
