/** Turns a ThemeDefinition into the CSS that applyTheme() injects for non-default themes. */
import { RENDERER_TOKENS, THEME_TOKENS } from './tokens.ts';
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
  return out;
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
  return `/* DASCADE theme: ${theme.name.replace(/\*\//g, '')} */\n:root[data-theme='${theme.id}'] {\n${body}\n}\n`;
}
