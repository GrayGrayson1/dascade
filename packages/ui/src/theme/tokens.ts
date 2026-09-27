/**
 * The DASCADE theme token contract.
 *
 * - THEME_TOKEN_GROUPS: every token a theme MUST define (palette + semantic layers of tokens.css),
 *   grouped by what they restyle. The Delta Neon values live in styles/tokens.css and
 *   themes/delta-neon.ts (kept identical by a unit test).
 * - OPTIONAL_THEME_TOKENS: replacements for accent-following recipes. Unset in Delta Neon, so
 *   components fall back to the recipe that follows each game's accent. A theme sets them to fixed
 *   values (e.g. grey bevelled primary buttons) — they resolve at :root, so don't use var(--accent).
 * - DERIVED_TOKENS: scaled by the visual-effects (data-fx) and reduced-motion settings. Components
 *   read them; themes never set them (they set the *-full / *-soft / --motion-* inputs instead).
 * - FOUNDATION_TOKENS: scales and layout metrics shared by every theme (never themed).
 * - Renderer tokens (--render-*) are generated from ThemeDefinition.renderer.
 */

export const THEME_TOKEN_GROUPS = {
  /** Raw colours. Games and legacy CSS reference these directly, so every theme redefines them. */
  palette: [
    '--theme-color-scheme',
    '--bg-0',
    '--bg-1',
    '--bg-2',
    '--bg-3',
    '--bg-4',
    '--bg-5',
    '--glass',
    '--glass-strong',
    '--glass-light',
    '--line',
    '--line-strong',
    '--line-bright',
    '--text-0',
    '--text-1',
    '--text-2',
    '--text-3',
    '--text-inverse',
    '--pink',
    '--cyan',
    '--yellow',
    '--green',
    '--orange',
    '--purple',
    '--red',
    '--blue',
    '--lime',
    '--shade',
    '--light',
  ],
  status: ['--success', '--warning', '--danger', '--info'],
  /** Default (non-game) accent. Game rooms override these three on their stage via <GameTheme>. */
  accent: ['--accent', '--accent-2', '--accent-deep', '--accent-ink'],
  page: ['--page-bg', '--page-fg', '--focus-ring', '--scrollbar-thumb'],
  typography: ['--font-display', '--font-pixel', '--font-ui', '--font-tech', '--font-num', '--heading-tracking', '--label-tracking'],
  shape: ['--px', '--radius-sm', '--radius', '--radius-lg'],
  shadows: ['--shadow-1', '--shadow-2', '--shadow-3'],
  glow: [
    '--glow-sm-full',
    '--glow-md-full',
    '--glow-lg-full',
    '--text-glow-full',
    '--glow-sm-soft',
    '--glow-md-soft',
    '--glow-lg-soft',
    '--text-glow-soft',
  ],
  motion: ['--ease-out', '--ease-in-out', '--ease-spring', '--motion-1', '--motion-2', '--motion-3', '--motion-4'],
  surfaces: ['--surface-sunken', '--surface-sunken-soft', '--surface-raised', '--surface-hover'],
  /** Panels, dialogs and their window chrome (title bar, corner brackets, backdrop). */
  windows: [
    '--panel-bg',
    '--panel-bg-solid',
    '--panel-bg-opaque',
    '--panel-sheen',
    '--panel-border',
    '--panel-border-width',
    '--panel-radius',
    '--panel-shadow',
    '--panel-blur',
    '--panel-divider',
    '--titlebar-bg',
    '--titlebar-fg',
    '--titlebar-font',
    '--titlebar-size',
    '--titlebar-tracking',
    '--titlebar-transform',
    '--titlebar-marker-size',
    '--bracket-size',
    '--bracket-width',
    '--overlay-scrim',
    '--overlay-blur',
  ],
  buttons: [
    '--button-font',
    '--button-tracking',
    '--button-radius',
    '--button-edge-width',
    '--button-bevel-hi',
    '--button-bevel-lo',
    '--button-hover-filter',
    '--button-press-offset',
    '--button-bg',
    '--button-bg-2',
    '--button-fg',
    '--button-edge',
    '--button-danger-bg',
    '--button-danger-bg-2',
    '--button-danger-fg',
    '--button-danger-edge',
    '--button-success-bg',
    '--button-success-bg-2',
    '--button-success-fg',
    '--button-success-edge',
    '--button-gold-bg',
    '--button-gold-bg-2',
    '--button-gold-fg',
    '--button-gold-edge',
  ],
  controls: [
    '--input-bg',
    '--input-fg',
    '--input-border',
    '--input-border-hover',
    '--input-radius',
    '--input-inset',
    '--input-placeholder',
    '--control-track',
    '--control-track-edge',
  ],
  /** Top bar, sticky action docks, mobile tab strips, toasts. */
  shell: [
    '--shell-bar-bg',
    '--shell-bar-border',
    '--shell-bar-blur',
    '--shell-bar-rule-opacity',
    '--shell-bar-solid',
    '--shell-dock-bg',
    '--shell-dock-border',
    '--shell-dock-shadow',
    '--shell-dock-blur',
    '--toast-bg',
    '--toast-shadow',
  ],
  /** In-game chrome: scoreboards, timers, status strips over a game stage. */
  hud: ['--hud-bg', '--hud-bg-strong', '--hud-border', '--hud-fg', '--hud-muted', '--hud-radius', '--hud-shadow', '--hud-blur'],
  /** Arcade floor + cabinet body/screen chrome (per-cabinet ART keeps its catalog accents). */
  cabinet: [
    '--arcade-floor-bg',
    '--cabinet-body',
    '--cabinet-body-2',
    '--cabinet-edge',
    '--cabinet-bezel',
    '--cabinet-screen-bg',
    '--cabinet-glass',
    '--cabinet-screen-inset',
    '--cabinet-shadow',
  ],
  marquee: ['--marquee-font', '--marquee-ink', '--marquee-outline', '--marquee-sheen', '--marquee-tracking'],
  /** Pixel grid, CRT scanlines, film grain, vignette. */
  textures: [
    '--scanline-ink',
    '--scanline-pitch',
    '--scanline-opacity-full',
    '--scanline-opacity-soft',
    '--grid-ink',
    '--grid-size',
    '--noise-opacity',
    '--vignette-edge',
  ],
} as const satisfies Record<string, readonly `--${string}`[]>;

export type ThemeTokenGroup = keyof typeof THEME_TOKEN_GROUPS;
export type ThemeToken = (typeof THEME_TOKEN_GROUPS)[ThemeTokenGroup][number];

/** Every token a theme must define, in declaration order. */
export const THEME_TOKENS: readonly ThemeToken[] = Object.values(THEME_TOKEN_GROUPS).flat() as ThemeToken[];

/** Optional replacements for accent-following component recipes (unset in Delta Neon). */
export const OPTIONAL_THEME_TOKENS = [
  '--title-shadow',
  '--button-primary-bg',
  '--button-primary-bg-2',
  '--button-primary-fg',
  '--button-primary-edge',
  '--button-primary-glow',
  '--button-secondary-edge',
  '--bracket-color',
  '--titlebar-marker',
  '--panel-glow-border',
  '--panel-glow-shadow',
  /** Accent used by toggles, sliders, tabs, segmented controls, progress bars and input focus. */
  '--control-accent',
  /** Text on --control-accent (selected segmented item). */
  '--control-accent-ink',
  '--input-focus-ring',
  '--game-backdrop',
  '--shell-bar-rule',
  /**
   * Screen backdrops a theme can make translucent (or `transparent`) so its Environment layer shows
   * through. Unset = today's cabinet-tinted backdrops. (The floor uses the required --arcade-floor-bg.)
   */
  '--entry-backdrop',
  '--picker-backdrop',
] as const;
export type OptionalThemeToken = (typeof OPTIONAL_THEME_TOKENS)[number];

/** Settings-scaled tokens (data-fx / data-reduced-motion). Read them; never set them in a theme. */
export const DERIVED_TOKENS = [
  '--glow-sm',
  '--glow-md',
  '--glow-lg',
  '--text-glow',
  '--scanline-opacity',
  '--render-glow',
  '--render-scanlines',
  '--dur-1',
  '--dur-2',
  '--dur-3',
  '--dur-4',
] as const;

/** Shared scales and layout metrics (never themed). */
export const FOUNDATION_TOKENS = [
  '--fs-2xs',
  '--fs-xs',
  '--fs-sm',
  '--fs-md',
  '--fs-lg',
  '--fs-xl',
  '--fs-2xl',
  '--fs-3xl',
  '--fs-4xl',
  '--fs-5xl',
  '--sp-1',
  '--sp-2',
  '--sp-3',
  '--sp-4',
  '--sp-5',
  '--sp-6',
  '--sp-8',
  '--sp-10',
  '--sp-12',
  '--sp-16',
  '--z-game',
  '--z-hud',
  '--z-shell',
  '--z-overlay',
  '--z-modal',
  '--z-toast',
  '--topbar-h',
  '--safe-top',
  '--safe-right',
  '--safe-bottom',
  '--safe-left',
  '--content-max',
] as const;

/** CSS custom properties generated from ThemeDefinition.renderer. */
export const RENDERER_TOKENS = {
  background: '--render-bg',
  surface: '--render-surface',
  text: '--render-text',
  textMuted: '--render-text-muted',
  line: '--render-line',
  gridAlpha: '--render-grid-alpha',
  scanlines: '--render-scanlines-full',
  scanlinesSoft: '--render-scanlines-soft',
  glow: '--render-glow-full',
  glowSoft: '--render-glow-soft',
} as const;
