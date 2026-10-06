/**
 * Lint for theme skins: every rule in apps/web/src/themes/<id>/skin.css must be scoped under
 * `:root[data-theme='<id>']`, so a loaded-but-inactive skin is inert. Used by skins.test.ts.
 *
 * Selectors may also start with `:where(:root[data-theme='<id>'])` / `:is(…)` (zero-specificity scope).
 * Allowed at-rules: @media / @supports / @container / @layer blocks (their rules are checked),
 * @font-face, @keyframes named `<id>-…` or with the theme's short alias (KEYFRAME_ALIASES),
 * @property --<id>-… / --<alias>… .
 * Everything else (@import, @page, unscoped @keyframes, bare selectors) is a violation.
 */

export interface ScopeViolation {
  line: number;
  message: string;
}

/** Short, collision-checked keyframe prefixes per theme (in addition to `<id>-`). */
export const KEYFRAME_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'delta-neon': ['dneon-'],
  'shareware-97': ['sw97-', 'sw-'],
  'corporate-98': ['c98-'],
  'cyber-cafe-01': ['cc01-', 'cc-'],
  'mall-arcade-92': ['ma92-', 'ma-'],
  'vhs-after-dark': ['vhs-', 'vh-'],
  'space-casino-2088': ['sc88-', 'sc-'],
  'lan-party': ['lan-', 'lp-'],
  'saturday-morning': ['satm-', 'sm-'],
  executive: ['exec-', 'ex-'],
  'neon-noir': ['nn-'],
  'halloween-night': ['hn-'],
};

export function keyframePrefixes(themeId: string): string[] {
  return [`${themeId}-`, ...(KEYFRAME_ALIASES[themeId] ?? [])];
}

const WRAPPERS = new Set(['media', 'supports', 'container', 'layer', 'scope', 'starting-style']);

function stripComments(css: string): string {
  // Keep newlines so line numbers stay right.
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Splits a selector list on top-level commas (not inside () or []). */
export function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = '';
  for (const ch of list) {
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function isScopedSelector(selector: string, themeId: string): boolean {
  const s = selector.replace(/\s+/g, ' ').trim();
  for (const q of ["'", '"']) {
    const root = `:root[data-theme=${q}${themeId}${q}]`;
    for (const prefix of [root, `:where(${root})`, `:is(${root})`]) {
      if (s.startsWith(prefix)) {
        const next = s.charAt(prefix.length);
        return next === '' || /[\s[:>+~.#]/.test(next);
      }
    }
  }
  return false;
}

/** Returns every scoping problem in a skin stylesheet (empty = OK). */
/** Every @keyframes name declared in a stylesheet (comments ignored). */
export function keyframeNames(css: string): string[] {
  return [...stripComments(css).matchAll(/@(?:-webkit-)?keyframes\s+["']?([\w-]+)/g)].map((m) => m[1]!);
}

export function checkSkinCss(css: string, themeId: string): ScopeViolation[] {
  const src = stripComments(css);
  const problems: ScopeViolation[] = [];
  let i = 0;
  const lineAt = (pos: number) => src.slice(0, pos).split('\n').length;

  /** Index just past the block that starts at src[open] === '{'. */
  const skipBlock = (open: number): number => {
    let depth = 0;
    let quote: string | null = null;
    for (let j = open; j < src.length; j++) {
      const ch = src[j]!;
      if (quote) {
        if (ch === '\\') j++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return j + 1;
      }
    }
    return src.length;
  };

  const parseList = (end: number): void => {
    while (i < end) {
      // Skip whitespace and stray semicolons.
      while (i < end && /[\s;]/.test(src[i]!)) i++;
      if (i >= end) return;
      const start = i;
      if (src[i] === '}') {
        i++;
        continue;
      }
      // Read the prelude up to '{' or ';'.
      let j = i;
      let quote: string | null = null;
      let depth = 0;
      for (; j < end; j++) {
        const ch = src[j]!;
        if (quote) {
          if (ch === quote) quote = null;
          continue;
        }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (depth === 0 && (ch === '{' || ch === ';')) break;
      }
      const prelude = src.slice(i, j).trim();
      const line = lineAt(start);
      if (src[j] === ';' || j >= end) {
        // Statement at-rule (@import, @charset, @layer a, b;).
        if (/^@charset\b/i.test(prelude) || /^@layer\b/i.test(prelude)) {
          /* harmless */
        } else if (prelude) problems.push({ line, message: `statement "${prelude.slice(0, 60)}" is not allowed in a skin` });
        i = j + 1;
        continue;
      }
      const blockEnd = skipBlock(j);
      if (prelude.startsWith('@')) {
        const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? '';
        const rest = prelude.slice(name.length + 1).trim();
        if (WRAPPERS.has(name)) {
          i = j + 1;
          parseList(blockEnd - 1);
          i = blockEnd;
          continue;
        }
        if (name === 'font-face') {
          // @font-face is document-wide by design: allowed
        } else if (name === 'keyframes' || name === '-webkit-keyframes') {
          const kf = rest.replace(/^["']|["']$/g, '');
          if (!keyframePrefixes(themeId).some((p) => kf.startsWith(p)))
            problems.push({ line, message: `@keyframes "${kf}" must be prefixed ${keyframePrefixes(themeId).join(' or ')}` });
        } else if (name === 'property') {
          if (!keyframePrefixes(themeId).some((p) => rest.startsWith(`--${p}`)))
            problems.push({ line, message: `@property ${rest} must be named --${themeId}-… (or the theme's alias)` });
        } else {
          problems.push({ line, message: `@${name} is not allowed in a skin` });
        }
        i = blockEnd;
        continue;
      }
      for (const sel of splitSelectors(prelude)) {
        if (!isScopedSelector(sel, themeId))
          problems.push({ line, message: `selector "${sel.slice(0, 80)}" is not scoped under :root[data-theme='${themeId}']` });
      }
      i = blockEnd;
    }
  };

  parseList(src.length);
  return problems;
}
