/**
 * applyTheme(id): the only place that switches the active theme.
 *   - sets html[data-theme] (Delta Neon's values are the :root defaults in tokens.css)
 *   - injects the generated token CSS for any other theme (<style id="dc-theme">)
 *   - updates <meta name="theme-color">
 *   - notifies subscribers (useThemeTokens, canvas/Phaser renderers)
 * Unknown / removed ids fall back to Delta Neon. Safe to call before React renders and in
 * non-DOM environments (it then only records the choice).
 */
import { themeToCss } from './css.ts';
import { DEFAULT_THEME_ID, getTheme } from './registry.ts';
import type { ThemeDefinition } from './types.ts';

export const THEME_STYLE_ID = 'dc-theme';

/** The subset of `Document` applyTheme needs (lets tests pass a tiny fake). */
export interface ThemeDocument {
  documentElement: { setAttribute(name: string, value: string): void; getAttribute(name: string): string | null };
  head: { appendChild(node: unknown): unknown } | null;
  getElementById(id: string): { textContent: string | null; remove(): void } | null;
  createElement(tag: 'style'): { id: string; textContent: string | null; setAttribute(name: string, value: string): void };
  querySelector(selector: string): { setAttribute(name: string, value: string): void; getAttribute(name: string): string | null } | null;
}

type Listener = (theme: ThemeDefinition) => void;
const listeners = new Set<Listener>();
let activeId: string = DEFAULT_THEME_ID;

function defaultDocument(): ThemeDocument | null {
  return typeof document === 'undefined' ? null : (document as unknown as ThemeDocument);
}

export function applyTheme(id?: string | null, doc: ThemeDocument | null = defaultDocument()): ThemeDefinition {
  const theme = getTheme(id);
  if (doc) {
    // Called on every settings change (volume drags…): only touch the DOM when something changes.
    if (doc.documentElement.getAttribute('data-theme') !== theme.id) doc.documentElement.setAttribute('data-theme', theme.id);
    const existing = doc.getElementById(THEME_STYLE_ID);
    if (theme.id === DEFAULT_THEME_ID) {
      existing?.remove();
    } else {
      const css = themeToCss(theme);
      if (existing) {
        if (existing.textContent !== css) existing.textContent = css;
      } else {
        const style = doc.createElement('style');
        style.id = THEME_STYLE_ID;
        style.setAttribute('data-theme-id', theme.id);
        style.textContent = css;
        doc.head?.appendChild(style);
      }
    }
    const meta = doc.querySelector('meta[name="theme-color"]');
    if (meta && meta.getAttribute('content') !== theme.metaThemeColor) meta.setAttribute('content', theme.metaThemeColor);
  }
  const changed = activeId !== theme.id;
  activeId = theme.id;
  if (changed) for (const l of [...listeners]) l(theme);
  return theme;
}

/** Id of the theme applied last (Delta Neon until applyTheme runs). */
export function activeThemeId(): string {
  return activeId;
}

export function activeTheme(): ThemeDefinition {
  return getTheme(activeId);
}

/** Subscribe to theme switches. Returns an unsubscribe function. */
export function onThemeChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
