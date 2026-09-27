import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_THEMES } from '@dascade/ui';
import { KEYFRAME_ALIASES, checkSkinCss, isScopedSelector, keyframeNames, splitSelectors } from './cssScope.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKIN_DIRS = readdirSync(HERE).filter((name) => statSync(join(HERE, name)).isDirectory());

describe('skin.css scoping lint', () => {
  it('there is a skin folder for every built-in theme', () => {
    for (const t of BUILT_IN_THEMES) expect(SKIN_DIRS, t.id).toContain(t.id);
  });

  for (const id of SKIN_DIRS) {
    it(`${id}/skin.css scopes every rule under :root[data-theme='${id}']`, () => {
      const css = readFileSync(join(HERE, id, 'skin.css'), 'utf8');
      const problems = checkSkinCss(css, id).map((p) => `skin.css:${p.line} ${p.message}`);
      expect(problems).toEqual([]);
    });
  }
});

describe('skin keyframes never collide', () => {
  it('keyframe aliases are unique across themes', () => {
    const all = Object.values(KEYFRAME_ALIASES).flat();
    expect(new Set(all).size).toBe(all.length);
    for (const t of BUILT_IN_THEMES) expect(KEYFRAME_ALIASES[t.id], t.id).toBeDefined();
  });

  it('no skin keyframe name is declared by another skin or by the app', () => {
    const appCss: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (p !== HERE) walk(p);
        } else if (name.endsWith('.css')) appCss.push(readFileSync(p, 'utf8'));
      }
    };
    walk(join(HERE, '..'));
    walk(join(HERE, '../../../../packages/ui/src'));
    const appNames = new Set(appCss.flatMap(keyframeNames));
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const id of SKIN_DIRS) {
      for (const kf of keyframeNames(readFileSync(join(HERE, id, 'skin.css'), 'utf8'))) {
        if (appNames.has(kf)) clashes.push(`${id}: ${kf} (app)`);
        const other = seen.get(kf);
        if (other && other !== id) clashes.push(`${id}: ${kf} (also ${other})`);
        seen.set(kf, id);
      }
    }
    expect(clashes).toEqual([]);
  });
});

describe('checkSkinCss', () => {
  const ok = (css: string) => expect(checkSkinCss(css, 'lan-party')).toEqual([]);
  const bad = (css: string) => expect(checkSkinCss(css, 'lan-party').length).toBeGreaterThan(0);

  it('accepts scoped rules, lists, compound root qualifiers and nesting', () => {
    ok(`:root[data-theme='lan-party'] .topbar { color: red; }`);
    ok(`:root[data-theme="lan-party"] .a, :root[data-theme='lan-party'] [data-part='lobby'] > h2 { x: 1 }`);
    ok(`:root[data-theme='lan-party'][data-fx='off'] .a { x: 1 }`);
    ok(`:root[data-theme='lan-party'] { --arcade-floor-bg: transparent; }`);
    ok(`:root[data-theme='lan-party'] .a { & .b { x: 1 } &:hover { y: 2 } }`);
    ok(`:where(:root[data-theme='lan-party']) .dc-btn { x: 1 }`);
    ok(`/* .unscoped { } */ :root[data-theme='lan-party'] .a::before { content: "{ not a block }"; }`);
  });

  it('accepts scoped rules inside @media / @supports / @container / @layer', () => {
    ok(`@media (max-width: 640px) { :root[data-theme='lan-party'] .a { x: 1 } }`);
    ok(`@supports (backdrop-filter: blur(2px)) { @media (hover: hover) { :root[data-theme='lan-party'] .a:hover { x: 1 } } }`);
    ok(`@layer skins { :root[data-theme='lan-party'] .a { x: 1 } }`);
  });

  it('accepts @font-face, theme-prefixed @keyframes and @property', () => {
    ok(`@font-face { font-family: 'LAN Mono'; src: url(x.woff2); }`);
    ok(`@keyframes lan-party-blink { from { opacity: 0 } to { opacity: 1 } }`);
    ok(`@keyframes lan-blink { from { opacity: 0 } to { opacity: 1 } }`);
    ok(`@property --lan-party-glow { syntax: '<number>'; inherits: false; initial-value: 0; }`);
  });

  it('rejects unscoped selectors, other themes and look-alikes', () => {
    bad(`.topbar { color: red; }`);
    bad(`:root .topbar { x: 1 }`);
    bad(`:root[data-theme='neon-noir'] .a { x: 1 }`);
    bad(`:root[data-theme='lan-party-2'] .a { x: 1 }`);
    bad(`:root[data-theme='lan-party'] .a, .b { x: 1 }`);
    bad(`html[data-theme='lan-party'] .a { x: 1 }`);
    bad(`@media (max-width: 640px) { .a { x: 1 } }`);
    bad(`:where(:root[data-theme='neon-noir']) .a { x: 1 }`);
  });

  it('rejects unprefixed keyframes, @import and other at-rules', () => {
    bad(`@keyframes blink { from { opacity: 0 } }`);
    bad(`@keyframes nn-rain { from { opacity: 0 } }`); // another theme's alias
    bad(`@import url('https://example.com/x.css');`);
    bad(`@page { margin: 0 }`);
    bad(`@property --glow { syntax: '<number>'; inherits: false; initial-value: 0; }`);
  });

  it('reports line numbers', () => {
    const [p] = checkSkinCss(`:root[data-theme='lan-party'] .a { x: 1 }\n\n.b { y: 2 }`, 'lan-party');
    expect(p?.line).toBe(3);
  });

  it('splits selector lists only at top-level commas', () => {
    expect(splitSelectors(`:root[data-theme='a'] :is(.x, .y), :root[data-theme='a'] [data-k="1,2"]`)).toHaveLength(2);
    expect(isScopedSelector(`:root[data-theme='a']:not(.x) .y`, 'a')).toBe(true);
  });
});

describe('skin generated content is silent for assistive tech', () => {
  // Skins are presentation only: a `content: 'Setup Wizard'` label would otherwise be read out and even join
  // accessible names (e.g. a heading). Every visible string needs an empty alt text companion
  // (`content: 'x'; content: 'x' / '';` — the first line is the fallback for browsers without alt text).
  const EMPTY = /^(['"])\s*\1$|^(none|normal)$/;
  for (const id of SKIN_DIRS) {
    it(`${id}/skin.css: every non-empty content string has empty alt text`, () => {
      const lines = readFileSync(join(HERE, id, 'skin.css'), 'utf8').split('\n');
      const problems: string[] = [];
      lines.forEach((line, i) => {
        const m = /^\s*content:\s*(.+?);\s*$/.exec(line);
        if (!m) return;
        const value = m[1]!.trim();
        if (EMPTY.test(value) || /\s\/\s*(['"])\s*\1\s*$/.test(value)) return;
        const next = lines[i + 1] ?? '';
        if (!/^\s*content:.*\s\/\s*(['"])\s*\1\s*;\s*$/.test(next)) problems.push(`skin.css:${i + 1} ${value}`);
      });
      expect(problems).toEqual([]);
    });
  }
});
