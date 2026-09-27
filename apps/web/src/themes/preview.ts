/**
 * Live picker previews: each theme's tokens scoped to `[data-theme-preview='<id>']`, so a mini
 * preview renders with THAT theme's own palette, fonts, radii and materials while another theme is
 * active. Generated on demand when a picker opens (one <style>, ref-counted), removed when the last
 * picker closes — nothing stays in the document while no picker is open.
 */
import { listThemes, themeDeclarations, type ThemeDefinition } from '@dascade/ui';

export const PREVIEW_STYLE_ID = 'dc-theme-previews';

/** Derived tokens resolve at :root from the ROOT theme's inputs; re-derive them in the preview scope (FULL fx). */
const DERIVED_IN_SCOPE: Array<[string, string]> = [
  ['--glow-sm', 'var(--glow-sm-full)'],
  ['--glow-md', 'var(--glow-md-full)'],
  ['--glow-lg', 'var(--glow-lg-full)'],
  ['--text-glow', 'var(--text-glow-full)'],
  ['--scanline-opacity', 'var(--scanline-opacity-full)'],
];

export function previewCss(theme: ThemeDefinition): string {
  const decls = [...themeDeclarations(theme), ...DERIVED_IN_SCOPE].map(([k, v]) => `  ${k}: ${v};`).join('\n');
  return `[data-theme-preview='${theme.id}'] {\n${decls}\n}\n`;
}

export function allPreviewCss(themes: readonly ThemeDefinition[] = listThemes()): string {
  return themes.map(previewCss).join('');
}

let refs = 0;

/** Injects the preview CSS (once) and returns a release function; the style is removed at zero refs. */
export function acquirePreviewStyles(doc: Document = document): () => void {
  refs++;
  let el = doc.getElementById(PREVIEW_STYLE_ID);
  if (!el) {
    el = doc.createElement('style');
    el.id = PREVIEW_STYLE_ID;
    doc.head.appendChild(el);
  }
  const css = allPreviewCss();
  if (el.textContent !== css) el.textContent = css; // picks up runtime-registered themes
  let released = false;
  return () => {
    if (released) return;
    released = true;
    refs = Math.max(0, refs - 1);
    if (refs === 0) doc.getElementById(PREVIEW_STYLE_ID)?.remove();
  };
}

/** Test helper. */
export function previewRefCount(): number {
  return refs;
}
