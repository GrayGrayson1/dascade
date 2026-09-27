/**
 * Theme adapter contract for the party kit, Trivia and DASterpiece stylesheets: every playfield
 * material has today's colour as its fallback, so Delta Neon (which defines no materials) renders
 * exactly as before, and only real material keys are referenced. Helper custom properties
 * (`--x: …var(--mat-…)…`) may omit fallbacks — they are guaranteed-invalid without materials — but
 * wherever a helper is consumed it needs a fallback too (except `color`, where invalid = inherited =
 * the unthemed look).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MATERIAL_KEYS, materialVar } from '@dascade/ui';

const FILES = {
  party: new URL('./party.css', import.meta.url),
  trivia: new URL('../trivia/trivia.css', import.meta.url),
  masterpiece: new URL('../masterpiece/masterpiece.css', import.meta.url),
};
const KIT_HELPERS = ['--pk-card-ink', '--pk-card-ink-muted', '--pk-stage-set'];
const known = new Set(MATERIAL_KEYS.map(materialVar));

function parse(url: URL) {
  const css = readFileSync(url, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const decls = [...css.matchAll(/([-\w]+)\s*:\s*([^;{}]+);/g)].map(([, prop, value]) => ({ prop: prop!, value: value! }));
  const helpers = new Set([...KIT_HELPERS, ...decls.filter((d) => d.prop.startsWith('--') && /var\(--mat-[a-z-]+\)/.test(d.value)).map((d) => d.prop)]);
  return { css, decls, helpers };
}

for (const [name, url] of Object.entries(FILES)) {
  describe(`${name}.css theme materials`, () => {
    const { css, decls, helpers } = parse(url);
    it('uses materials', () => {
      expect(css).toMatch(/var\(--mat-/);
    });
    it('references only known material keys', () => {
      for (const [, v] of css.matchAll(/var\((--mat-[a-z-]+)/g)) expect(known, v).toContain(v);
    });
    it('every material / helper used by a real property has a fallback', () => {
      for (const { prop, value } of decls) {
        if (prop.startsWith('--')) continue;
        expect(value, `${prop}: ${value}`).not.toMatch(/var\(--mat-[a-z-]+\)/);
        if (prop === 'color') continue;
        for (const h of helpers) expect(value, `${prop}: ${value}`).not.toContain(`var(${h})`);
      }
    });
  });
}

describe('party kit stage set', () => {
  const { decls } = parse(FILES.party);
  it('is applied as an inset box-shadow that is `none` without materials', () => {
    expect(decls).toContainEqual({ prop: 'box-shadow', value: 'var(--pk-stage-set, none)' });
    const set = decls.find((d) => d.prop === '--pk-stage-set')!.value;
    expect(set).toContain('var(--mat-stage)');
    expect(set).toContain('var(--mat-stage-light)');
    expect(set.match(/inset/g)).toHaveLength(2);
  });
  it('keeps the answer-slot identity palette literal (meaning, not material)', () => {
    const slots = decls.filter((d) => /^--pk-slot-\d$/.test(d.prop)).map((d) => d.value);
    expect(slots).toEqual(['#ff4f81', '#22d3ee', '#ffd23f', '#2de38f', '#a78bfa', '#ff8a3d']);
  });
});
