/**
 * DASCADE theme architecture (see docs/THEMING.md).
 * One shipped theme — Delta Neon — plus the contract future aesthetic packs plug into.
 */
export * from './tokens.ts';
export type { RendererPalette, ThemeDefinition, ThemeTokens } from './types.ts';
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
export { themeDeclarations, themeToCss } from './css.ts';
export { THEME_STYLE_ID, activeTheme, activeThemeId, applyTheme, onThemeChange, type ThemeDocument } from './apply.ts';
export { colorToInt, formatColor, parseCssColor, readThemeTokens, resolveColor, type Rgba, type StyleReader } from './read.ts';
export { subscribeThemeTokens, useThemeId, useThemeTokens } from './react.ts';
export { DELTA_NEON } from './themes/delta-neon.ts';
