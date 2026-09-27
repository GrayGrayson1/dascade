/**
 * Resolved theme values for Canvas 2D / Phaser renderers, which can't read CSS custom properties.
 *
 *   const t = readThemeTokens(stageElement);   // stage element → the game's accent is in scope
 *   ctx.fillStyle = t.background;               // CSS strings for Canvas 2D
 *   scene.cameras.main.setBackgroundColor(t.int.background);   // 0xRRGGBB for Phaser
 *   glow.setStrength(base * t.glow);            // already scaled by the Visual-effects setting
 *
 * In React use useThemeTokens(ref) — it re-reads when the theme, fx or reduced-motion setting changes.
 */
import { activeTheme } from './apply.ts';
import type { ThemeTokens } from './types.ts';
import { DEFAULT_EFFECTS, MATERIAL_KEYS, materialVar, type MaterialKey } from './materials.ts';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

/** Parses #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() (comma or space syntax). Null otherwise. */
export function parseCssColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(s)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a = 'f'] = hex.split('').map((c) => c + c) as [string, string, string, string?];
      return { r: parseInt(r, 16), g: parseInt(g, 16), b: parseInt(b, 16), a: parseInt(a.length === 1 ? a + a : a, 16) / 255 };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(s)?.[1];
  if (fn) {
    const parts = fn
      .replace(/\s*\/\s*/, ' / ')
      .split(/[\s,]+/)
      .filter((p) => p && p !== '/');
    if (parts.length < 3) return null;
    const channel = (p: string) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p));
    const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    const [r, g, b] = parts.slice(0, 3).map(channel) as [number, number, number];
    if (![r, g, b, alpha].every(Number.isFinite)) return null;
    return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: Math.max(0, Math.min(1, alpha)) };
  }
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  return null;
}

const toHex2 = (n: number) => clamp255(n).toString(16).padStart(2, '0');

/** Normalises a parsed colour to #rrggbb (opaque) or rgba(). */
export function formatColor(c: Rgba): string {
  return c.a >= 1 ? `#${toHex2(c.r)}${toHex2(c.g)}${toHex2(c.b)}` : `rgba(${c.r}, ${c.g}, ${c.b}, ${Number(c.a.toFixed(3))})`;
}

/** 0xRRGGBB for Phaser (alpha dropped). Falls back to `fallback` when the colour can't be parsed. */
export function colorToInt(color: string, fallback = 0): number {
  const c = parseCssColor(color);
  return c ? (c.r << 16) | (c.g << 8) | c.b : fallback;
}

let probe: HTMLElement | null = null;
const resolvedCache = new Map<string, string>();

/**
 * Resolves any CSS colour (named, color-mix(), hsl(), var()-free expressions) to #rrggbb / rgba()
 * via the browser. Plain hex / rgb() values are parsed without touching the DOM.
 */
export function resolveColor(value: string, fallback: string): string {
  const raw = value.trim();
  if (!raw) return fallback;
  const parsed = parseCssColor(raw);
  if (parsed) return formatColor(parsed);
  const cached = resolvedCache.get(raw);
  if (cached) return cached;
  if (typeof document === 'undefined' || !document.body) return fallback;
  probe ??= Object.assign(document.createElement('span'), { hidden: true });
  if (!probe.isConnected) document.body.appendChild(probe);
  probe.style.color = '';
  probe.style.color = raw;
  if (!probe.style.color) return fallback; // the browser rejected the value
  let out = getComputedStyle(probe).color;
  const direct = parseCssColor(out);
  if (direct) out = formatColor(direct);
  else {
    // Modern engines may report color(srgb r g b / a) for color-mix(); rasterise one pixel instead.
    try {
      const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.fillStyle = out;
        ctx.fillRect(0, 0, 1, 1);
        const [r = 0, g = 0, b = 0, a = 255] = ctx.getImageData(0, 0, 1, 1).data;
        out = formatColor({ r, g, b, a: a / 255 });
      }
    } catch {
      out = fallback;
    }
  }
  if (resolvedCache.size > 256) resolvedCache.clear();
  resolvedCache.set(raw, out);
  return out;
}

function num(value: string, fallback: number): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Minimal slice of CSSStyleDeclaration used here (lets tests pass a fake). */
export interface StyleReader {
  getPropertyValue(name: string): string;
}

/**
 * Reads the resolved renderer palette from CSS. Pass the element your canvas lives in (a
 * <GameStage> descendant) so `accent` is your game's accent; defaults to <html>. Without a DOM
 * (tests, SSR) it returns the active theme's renderer palette.
 */
export function readThemeTokens(el?: Element | null, style?: StyleReader): ThemeTokens {
  const theme = activeTheme();
  const r = theme.renderer;
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  const target = el ?? root;
  const cs: StyleReader | null = style ?? (target && typeof getComputedStyle === 'function' ? getComputedStyle(target) : null);
  const get = (name: string) => (cs ? cs.getPropertyValue(name).trim() : '');
  const color = (name: string, fallback: string) => resolveColor(get(name), fallback);
  const fxAttr = root?.getAttribute('data-fx');
  const fx: ThemeTokens['fx'] = fxAttr === 'low' || fxAttr === 'off' ? fxAttr : 'high';
  const fxScaled = (derived: string, full: number, soft: number) => {
    const v = get(derived);
    if (v) return num(v, full);
    return fx === 'off' ? 0 : fx === 'low' ? soft : full;
  };

  const tokens = {
    themeId: theme.id,
    fx,
    reducedMotion: root?.getAttribute('data-reduced-motion') === 'true',
    background: color('--render-bg', r.background),
    surface: color('--render-surface', r.surface),
    text: color('--render-text', r.text),
    textMuted: color('--render-text-muted', r.textMuted),
    line: color('--render-line', r.line),
    accent: color('--accent', r.accent),
    accent2: color('--accent-2', r.accent2),
    accentDeep: color('--accent-deep', r.background),
    success: color('--success', '#2de38f'),
    warning: color('--warning', '#ffd23f'),
    danger: color('--danger', '#ff5a5f'),
    info: color('--info', '#22d3ee'),
    gridAlpha: num(get('--render-grid-alpha'), r.gridAlpha),
    scanlines: fxScaled('--render-scanlines', r.scanlines, r.scanlinesSoft),
    glow: fxScaled('--render-glow', r.glow, r.glowSoft),
    fonts: {
      display: get('--font-display') || theme.tokens['--font-display'],
      pixel: get('--font-pixel') || theme.tokens['--font-pixel'],
      ui: get('--font-ui') || theme.tokens['--font-ui'],
      num: get('--font-num') || theme.tokens['--font-num'],
    },
  };
  // Materials: read from CSS in scope of `el` (so <GameStage data-game> nudges apply); without a DOM,
  // fall back to the theme definition. Unset (Delta Neon) = the game keeps its own palette.
  const materials: Partial<Record<MaterialKey, string>> = {};
  for (const key of MATERIAL_KEYS) {
    const raw = cs ? get(materialVar(key)) : (theme.materials?.[key] ?? '');
    if (raw) materials[key] = resolveColor(raw, raw);
  }
  return {
    ...tokens,
    materials,
    effects: { ...DEFAULT_EFFECTS, ...theme.effects },
    int: {
      background: colorToInt(tokens.background),
      surface: colorToInt(tokens.surface),
      text: colorToInt(tokens.text),
      textMuted: colorToInt(tokens.textMuted),
      line: colorToInt(tokens.line),
      accent: colorToInt(tokens.accent),
      accent2: colorToInt(tokens.accent2),
      accentDeep: colorToInt(tokens.accentDeep),
      success: colorToInt(tokens.success),
      warning: colorToInt(tokens.warning),
      danger: colorToInt(tokens.danger),
      info: colorToInt(tokens.info),
    },
  };
}
