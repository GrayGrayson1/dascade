/**
 * Themed microcopy (headings and flavour only — see packages/ui/src/theme/copy.ts).
 *
 *   const t = useThemeCopy();
 *   <h2>{t('results.title', 'Results')}</h2>
 *
 * Accessible names and anything tests rely on stay plain: pass the themed text as visible content
 * and keep the plain string in aria-label / visually-hidden text where it matters.
 * Values may contain {placeholders}; `fill(text, vars)` substitutes them ("{cabinets} CABINETS ONLINE").
 */
import { useCallback } from 'react';
import { getTheme, useThemeId, type ThemeCopyKey } from '@dascade/ui';

export type ThemeCopyFn = (key: ThemeCopyKey, fallback: string) => string;

/** The active theme's copy for `key`, or `fallback`. */
export function themeCopy(themeId: string, key: ThemeCopyKey, fallback: string): string {
  const value = getTheme(themeId).copy?.[key];
  return typeof value === 'string' && value.trim() ? value : fallback;
}

/** true when the active theme provides its own text for `key` (for optional flavour slots). */
export function hasThemeCopy(themeId: string, key: ThemeCopyKey): boolean {
  const value = getTheme(themeId).copy?.[key];
  return typeof value === 'string' && value.trim().length > 0;
}

export function useThemeCopy(): ThemeCopyFn {
  const id = useThemeId();
  return useCallback<ThemeCopyFn>((key, fallback) => themeCopy(id, key, fallback), [id]);
}

/** Optional flavour slot: the theme's text for `key`, or null (render nothing — Delta Neon's look). */
export function useThemeFlavour(key: ThemeCopyKey): string | null {
  const id = useThemeId();
  return hasThemeCopy(id, key) ? themeCopy(id, key, '') : null;
}

/** Replaces {name} placeholders (unknown names are left as-is). */
export function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{([a-z]+)\}/gi, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** Splits a "A|B|C" status value into trimmed, non-empty items. */
export function tickerItems(text: string | null | undefined): string[] {
  return (text ?? '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
}
