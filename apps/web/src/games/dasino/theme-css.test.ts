/**
 * Theme contract for dasino.css.
 * - Casino-floor chrome (panels, nav, ticker, balance, floor cards, gold/status text on them) reads
 *   `--dn-theme-*` hooks whose fallbacks are today's exact Delta Neon values. Only the non-Delta-Neon
 *   rule sets the hooks, so Delta Neon renders exactly as before and every other theme gets its own
 *   surfaces and inks.
 * - Playfield materials keep today's colour as their fallback (Delta Neon defines no materials).
 * - Meaningful colours (roulette red, gold art accents) stay literal.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MATERIAL_KEYS, materialVar } from '@dascade/ui';

const css = readFileSync(new URL('./dasino.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const block = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
};
const declsOf = (body: string) => Object.fromEntries([...body.matchAll(/(--[-\w]+)\s*:\s*([^;]+);/g)].map(([, p, v]) => [p!, v!.trim()]));

/** The casino chrome before theming (Delta Neon), hook by hook. */
const DELTA_NEON_CHROME: Record<string, string> = {
  '--dn-panel': 'var(--dn-theme-panel, rgba(12, 7, 26, 0.8))',
  '--dn-nav-bg': 'var(--dn-theme-nav, rgba(8, 4, 18, 0.75))',
  '--dn-ticker-bg': 'var(--dn-theme-ticker, rgba(6, 3, 14, 0.72))',
  '--dn-balance-top': 'var(--dn-theme-raised, #2c1654)',
  '--dn-balance-bottom': 'var(--dn-theme-raised-deep, #140a29)',
  '--dn-card-top': 'var(--dn-theme-card, #150b2b)',
  '--dn-card-bottom': 'var(--dn-theme-card-deep, #0b0617)',
  '--dn-gold-ink': 'var(--dn-theme-gold-ink, #ffd23f)',
  '--dn-gold-ink-soft': 'var(--dn-theme-gold-ink, #ffe79a)',
  '--dn-up-ink': 'var(--dn-theme-up-ink, var(--green))',
  '--dn-live-ink': 'var(--dn-theme-up-ink, #b7ffcf)',
  '--dn-down-ink': 'var(--dn-theme-down-ink, #ff7a82)',
  '--dn-urgent-ink': 'var(--dn-theme-down-ink, #ffb3b6)',
  '--dn-inset': 'var(--dn-theme-inset, rgba(0, 0, 0, 0.38))',
  '--dn-inset-strong': 'var(--dn-theme-inset-strong, rgba(0, 0, 0, 0.4))',
};
const THEMED = ":root[data-theme]:not([data-theme='delta-neon']) .dn";

describe('dasino casino chrome follows the theme, Delta Neon unchanged', () => {
  const root = declsOf(block('.dn'));
  const themed = declsOf(block(THEMED));

  it('every chrome value is a --dn-theme-* hook with the exact Delta Neon value as its fallback', () => {
    for (const [prop, value] of Object.entries(DELTA_NEON_CHROME)) expect(root[prop], prop).toBe(value);
  });

  it('only the non-Delta-Neon rule sets the hooks, each from theme tokens', () => {
    const hooks = new Set([...css.matchAll(/(--dn-theme-[a-z-]+)\s*:/g)].map(([, h]) => h!));
    const used = new Set(Object.values(DELTA_NEON_CHROME).map((v) => /var\((--dn-theme-[a-z-]+)/.exec(v)![1]!));
    expect([...hooks].sort()).toEqual([...used].sort());
    for (const hook of used) {
      expect(themed[hook], hook).toMatch(/var\(--(panel-bg|hud-bg|bg-\d|warning|success|danger|text-0)\)/);
      expect([...css.matchAll(new RegExp(`${hook}\\s*:`, 'g'))], hook).toHaveLength(1);
    }
  });

  it('meaningful colours stay literal: roulette red, gold and violet art', () => {
    expect(root['--dn-red']).toBe('#e3345f');
    expect(root['--dn-gold']).toBe('#ffd23f');
    expect(root['--dn-violet']).toBe('#c084fc');
  });

  it('the chrome surfaces read the hooks instead of their old literals', () => {
    expect(block('.dn-nav')).toContain('background: var(--dn-nav-bg)');
    expect(block('.dn-ticker')).toContain('background: var(--dn-ticker-bg)');
    expect(block('.dn-balance')).toContain('linear-gradient(180deg, var(--dn-balance-top), var(--dn-balance-bottom))');
    expect(block('.dn-card')).toContain('linear-gradient(180deg, var(--dn-card-top), var(--dn-card-bottom) 75%)');
    expect(block('.dn-balance__value')).toContain('color: var(--dn-gold-ink)');
    const gone = [
      'linear-gradient(180deg, #2c1654, #140a29)',
      'linear-gradient(180deg, #150b2b, #0b0617',
      'background: rgba(8, 4, 18, 0.75)',
      'background: rgba(6, 3, 14, 0.72)',
      'background: rgba(0, 0, 0, 0.38)',
    ];
    for (const literal of gone) expect(css, literal).not.toContain(literal);
  });

  it('lifted (light) ink is kept for DASino art only, never for the themed chrome', () => {
    const lifts = [...css.matchAll(/:root\[data-theme\]:not\(\[data-theme='delta-neon'\]\) \.dn :is\(([^)]*)\)/g)].map(([, list]) => list!);
    expect(lifts.length).toBeGreaterThan(0);
    for (const list of lifts) {
      for (const chrome of ['.dn-glass', '.dn-nav', '.dn-ticker', '.dn-balance', '.dn-card,', '.dn-card)']) expect(`${list})`, chrome).not.toContain(chrome);
      expect(list).toContain('.dn-roulette__felt');
    }
  });
});

describe('dasino theme materials', () => {
  const decls = [...css.matchAll(/([-\w]+)\s*:\s*([^;{}]+);/g)].map(([, prop, value]) => ({ prop: prop!, value: value! }));

  it('references only known material keys', () => {
    const known = new Set(MATERIAL_KEYS.map(materialVar));
    for (const [, name] of css.matchAll(/var\((--mat-[a-z-]+)/g)) expect(known, name).toContain(name);
  });

  it('every material used by a real property has a fallback', () => {
    for (const { prop, value } of decls) {
      if (prop.startsWith('--')) continue;
      expect(value, `${prop}: ${value}`).not.toMatch(/var\(--mat-[a-z-]+\)/);
    }
  });
});
