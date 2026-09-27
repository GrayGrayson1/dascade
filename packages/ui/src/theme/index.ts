/**
 * DASCADE theme architecture (see docs/THEMING.md).
 * Eleven shipped themes (Delta Neon is the default): tokens + materials + effects + copy.
 */
export * from './tokens.ts';
export * from './materials.ts';
export * from './copy.ts';
export type { RendererPalette, ThemeDefinition, ThemeMeta, ThemeTokens } from './types.ts';
export {
  BUILT_IN_THEMES,
  DEFAULT_THEME_ID,
  getTheme,
  hasTheme,
  listThemes,
  registerTheme,
  unregisterTheme,
  validateTheme,
} from './registry.ts';
export { gameMaterialsCss, themeDeclarations, themeToCss } from './css.ts';
export { THEME_STYLE_ID, activeTheme, activeThemeId, applyTheme, onThemeChange, type ThemeDocument } from './apply.ts';
export { colorToInt, formatColor, parseCssColor, readThemeTokens, resolveColor, type Rgba, type StyleReader } from './read.ts';
export { subscribeThemeTokens, useThemeId, useThemeTokens } from './react.ts';
export { watchThemeTokens, type WatchThemeOptions } from './watch.ts';
export { DELTA_NEON } from './themes/delta-neon.ts';
