/** Turns a ThemeDefinition into the CSS that applyTheme() injects for non-default themes. */
import { RENDERER_TOKENS, THEME_TOKENS } from './tokens.ts';
import { MATERIAL_KEYS, materialVar } from './materials.ts';
import { isSafeTokenValue } from './registry.ts';
import type { ThemeDefinition } from './types.ts';

/** Every custom property a theme sets, as [name, value] pairs (tokens, overrides, renderer). */
export function themeDeclarations(theme: ThemeDefinition): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const push = (name: string, value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) out.push([name, String(value)]);
    else if (isSafeTokenValue(value)) out.push([name, value.trim()]);
  };
  for (const name of THEME_TOKENS) push(name, theme.tokens[name]);
  for (const [name, value] of Object.entries(theme.overrides ?? {})) push(name, value);
  for (const [field, name] of Object.entries(RENDERER_TOKENS)) push(name, theme.renderer[field as keyof typeof RENDERER_TOKENS]);
  if (theme.materials) for (const key of MATERIAL_KEYS) push(materialVar(key), theme.materials[key]);
  return out;
}

const GAME_ID_RE = /^[a-z][a-z0-9-]{1,39}$/;

/** Per-game material nudges as `:root[data-theme='<id>'] [data-game='<game>'] { … }` rules. */
export function gameMaterialsCss(theme: ThemeDefinition, scope = `:root[data-theme='${theme.id}']`): string {
  let css = '';
  for (const [gameId, mats] of Object.entries(theme.gameMaterials ?? {})) {
    if (!GAME_ID_RE.test(gameId)) continue;
    const body = Object.entries(mats)
      .filter(([key, value]) => (MATERIAL_KEYS as readonly string[]).includes(key) && isSafeTokenValue(value))
      .map(([key, value]) => `  ${materialVar(key as (typeof MATERIAL_KEYS)[number])}: ${String(value).trim()};`)
      .join('\n');
    if (body) css += `${scope} [data-game='${gameId}'] {\n${body}\n}\n`;
  }
  return css;
}

/**
 * `:root[data-theme='<id>'] { … }` for the theme. Specificity (0,2,0) beats the :root defaults in
 * tokens.css regardless of stylesheet order; fx / reduced-motion rules only touch derived tokens,
 * which themes never set, so they keep working.
 */
export function themeToCss(theme: ThemeDefinition): string {
  const body = themeDeclarations(theme)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  return `/* DASCADE theme: ${theme.name.replace(/\*\//g, '')} */\n:root[data-theme='${theme.id}'] {\n${body}\n}\n${gameMaterialsCss(theme)}`;
}
