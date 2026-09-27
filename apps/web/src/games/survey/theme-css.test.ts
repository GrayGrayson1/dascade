/**
 * Theme adapter contract for survey.css: every playfield material has today's colour as its fallback,
 * so Delta Neon (which defines no materials) renders exactly as before, and only real material keys
 * are referenced. Helper custom properties (`--x: …var(--mat-…)…`) may omit fallbacks — they are
 * invalid without materials — but wherever a helper is consumed it needs a fallback too (except
 * `color`, where invalid = inherited = the unthemed look).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MATERIAL_KEYS, materialVar } from '@dascade/ui';

const css = readFileSync(new URL('./survey.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const decls = [...css.matchAll(/([-\w]+)\s*:\s*([^;{}]+);/g)].map(([, prop, value]) => ({ prop: prop!, value: value! }));
const KIT_HELPERS = ['--pk-card-ink', '--pk-card-ink-muted', '--pk-stage-set'];
const helpers = new Set([...KIT_HELPERS, ...decls.filter((d) => d.prop.startsWith('--') && /var\(--mat-[a-z-]+\)/.test(d.value)).map((d) => d.prop)]);

describe('survey theme materials', () => {
  it('uses materials at all', () => {
    expect(css).toMatch(/var\(--mat-/);
  });
  it('references only known material keys', () => {
    const known = new Set(MATERIAL_KEYS.map(materialVar));
    for (const [, name] of css.matchAll(/var\((--mat-[a-z-]+)/g)) expect(known, name).toContain(name);
  });
  it('every material / helper used by a real property has a fallback', () => {
    for (const { prop, value } of decls) {
      if (prop.startsWith('--')) continue;
      expect(value, `${prop}: ${value}`).not.toMatch(/var\(--mat-[a-z-]+\)/);
      if (prop === 'color') continue;
      for (const h of helpers) expect(value, `${prop}: ${value}`).not.toContain(`var(${h})`);
    }
  });
  it('pills that sit on themed card stock take the card ink (rank-the-room tags, anonymity pill)', () => {
    // Regression: light "Your vote" / "You: 1" / "Answers are anonymous" text vanished on paper cards.
    expect(css).toMatch(/\.sv-rankrow \.sv-tag\s*\{[^}]*var\(--pk-card-ink/);
    expect(css).toMatch(/\.sv-anon\s*\{[^}]*--sv-anon-ink:\s*var\(--mat-card-ink\)[^}]*color:\s*var\(--sv-anon-ink,/);
  });
});
