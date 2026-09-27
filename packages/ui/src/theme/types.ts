import type { OptionalThemeToken, ThemeToken } from './tokens.ts';

/** Colours and intensities for Canvas 2D / Phaser renderers (which can't read CSS directly). */
export interface RendererPalette {
  /** Scene clear colour (--render-bg). */
  background: string;
  /** Panels/tiles drawn inside a canvas (--render-surface). */
  surface: string;
  /** Primary text drawn on a canvas (--render-text). */
  text: string;
  /** Secondary text (--render-text-muted). */
  textMuted: string;
  /** Grid / rule lines, drawn at `gridAlpha` (--render-line). */
  line: string;
  /** Default accent (a game's own accent replaces it inside its stage). */
  accent: string;
  accent2: string;
  /** Alpha for grid lines, 0–1. */
  gridAlpha: number;
  /** Scanline darkening, 0–1, at visual effects "high" / "low" ("off" = 0). */
  scanlines: number;
  scanlinesSoft: number;
  /** Glow multiplier (shadowBlur, bloom, additive halos) at "high" / "low" ("off" = 0). 0–2. */
  glow: number;
  glowSoft: number;
}

export interface ThemeDefinition {
  /** kebab-case, stable forever (stored in user settings). */
  id: string;
  name: string;
  description: string;
  colorScheme: 'dark' | 'light';
  /** Browser UI colour (<meta name="theme-color">). */
  metaThemeColor: string;
  /** Every required token (palette + semantic). */
  tokens: Readonly<Record<ThemeToken, string>>;
  /** Fixed-value replacements for accent-following recipes. */
  overrides?: Readonly<Partial<Record<OptionalThemeToken, string>>>;
  renderer: Readonly<RendererPalette>;
}

/** Resolved, ready-to-draw values for a renderer (see readThemeTokens()). */
export interface ThemeTokens {
  themeId: string;
  fx: 'high' | 'low' | 'off';
  reducedMotion: boolean;
  /** CSS colour strings, normalised to #rrggbb / rgba() where possible. */
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  line: string;
  /** The accent in scope of the element that was read (a game's accent inside its stage). */
  accent: string;
  accent2: string;
  accentDeep: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  gridAlpha: number;
  /** Already scaled by the visual-effects setting (0 when effects are off). */
  scanlines: number;
  /** Already scaled by the visual-effects setting (0 when effects are off). */
  glow: number;
  fonts: { display: string; pixel: string; ui: string; num: string };
  /** 0xRRGGBB integers for Phaser (`scene.cameras.main.setBackgroundColor`, `graphics.fillStyle`). */
  int: {
    background: number;
    surface: number;
    text: number;
    textMuted: number;
    line: number;
    accent: number;
    accent2: number;
    accentDeep: number;
    success: number;
    warning: number;
    danger: number;
    info: number;
  };
}
