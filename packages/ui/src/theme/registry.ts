/**
 * Theme registry. DASCADE ships exactly one theme (Delta Neon). Future aesthetic packs are
 * added to BUILT_IN_THEMES (or registered at runtime with registerTheme()); unknown or removed
 * ids always fall back to Delta Neon, so a stored preference can never break the app.
 */
import { DERIVED_TOKENS, FOUNDATION_TOKENS, OPTIONAL_THEME_TOKENS, RENDERER_TOKENS, THEME_TOKENS } from './tokens.ts';
import type { ThemeDefinition } from './types.ts';
import { DELTA_NEON } from './themes/delta-neon.ts';

export const DEFAULT_THEME_ID = 'delta-neon';

/** Themes that ship with DASCADE. Keep Delta Neon first (it is the CSS default in tokens.css). */
export const BUILT_IN_THEMES: readonly ThemeDefinition[] = [DELTA_NEON];

const registry = new Map<string, ThemeDefinition>(BUILT_IN_THEMES.map((t) => [t.id, t]));

const ID_RE = /^[a-z][a-z0-9-]{1,39}$/;
/** Characters that could end a declaration/rule or open markup inside the generated <style>. */
const UNSAFE_VALUE_RE = /[;{}<>]|\/\*|\*\/|\\/;

export function isSafeTokenValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 600 && !UNSAFE_VALUE_RE.test(value);
}

/** Every problem with a theme definition (empty array = valid). */
export function validateTheme(theme: ThemeDefinition): string[] {
  const problems: string[] = [];
  if (!ID_RE.test(theme.id ?? '')) problems.push(`id "${theme.id}" must be kebab-case (2–40 chars)`);
  if (!theme.name?.trim()) problems.push('name is required');
  if (typeof theme.description !== 'string') problems.push('description is required');
  if (theme.colorScheme !== 'dark' && theme.colorScheme !== 'light') problems.push('colorScheme must be "dark" or "light"');
  if (!isSafeTokenValue(theme.metaThemeColor)) problems.push('metaThemeColor must be a CSS colour');

  const tokens = (theme.tokens ?? {}) as Record<string, unknown>;
  for (const name of THEME_TOKENS) {
    if (!(name in tokens)) problems.push(`missing token ${name}`);
    else if (!isSafeTokenValue(tokens[name])) problems.push(`token ${name} has an empty or unsafe value`);
  }
  const required = new Set<string>(THEME_TOKENS);
  const derived = new Set<string>(DERIVED_TOKENS);
  const foundation = new Set<string>(FOUNDATION_TOKENS);
  for (const name of Object.keys(tokens)) {
    if (derived.has(name)) problems.push(`token ${name} is derived from settings — set its *-full/*-soft or --motion-* inputs instead`);
    else if (foundation.has(name)) problems.push(`token ${name} is a foundation token and is not themeable`);
    else if (!required.has(name)) problems.push(`unknown token ${name}`);
  }

  const optional = new Set<string>(OPTIONAL_THEME_TOKENS);
  for (const [name, value] of Object.entries(theme.overrides ?? {})) {
    if (!optional.has(name)) problems.push(`unknown override ${name}`);
    else if (!isSafeTokenValue(value)) problems.push(`override ${name} has an empty or unsafe value`);
  }

  const r = theme.renderer as unknown as Record<string, unknown> | undefined;
  if (!r) problems.push('renderer palette is required');
  else {
    for (const key of ['background', 'surface', 'text', 'textMuted', 'line', 'accent', 'accent2'] as const) {
      if (!isSafeTokenValue(r[key])) problems.push(`renderer.${key} must be a CSS colour`);
    }
    for (const key of ['gridAlpha', 'scanlines', 'scanlinesSoft'] as const) {
      const v = r[key];
      if (typeof v !== 'number' || !(v >= 0 && v <= 1)) problems.push(`renderer.${key} must be a number from 0 to 1`);
    }
    for (const key of ['glow', 'glowSoft'] as const) {
      const v = r[key];
      if (typeof v !== 'number' || !(v >= 0 && v <= 2)) problems.push(`renderer.${key} must be a number from 0 to 2`);
    }
    for (const key of Object.keys(r)) {
      if (!(key in RENDERER_TOKENS) && key !== 'accent' && key !== 'accent2') problems.push(`unknown renderer field ${key}`);
    }
  }
  return problems;
}

/** Adds (or replaces) a theme. Built-in themes can't be replaced. Throws with every problem found. */
export function registerTheme(theme: ThemeDefinition): ThemeDefinition {
  const problems = validateTheme(theme);
  if (problems.length) throw new Error(`Invalid theme "${theme?.id}": ${problems.join('; ')}`);
  if (BUILT_IN_THEMES.some((t) => t.id === theme.id)) throw new Error(`Theme "${theme.id}" is built in and can't be replaced`);
  registry.set(theme.id, theme);
  return theme;
}

/** Removes a runtime-registered theme (built-ins stay). */
export function unregisterTheme(id: string): boolean {
  if (BUILT_IN_THEMES.some((t) => t.id === id)) return false;
  return registry.delete(id);
}

export function listThemes(): ThemeDefinition[] {
  return [...registry.values()];
}

export function hasTheme(id: unknown): boolean {
  return typeof id === 'string' && registry.has(id);
}

/** The theme for `id`, or Delta Neon when the id is missing, unknown or removed. */
export function getTheme(id?: string | null): ThemeDefinition {
  return (typeof id === 'string' ? registry.get(id) : undefined) ?? DELTA_NEON;
}
