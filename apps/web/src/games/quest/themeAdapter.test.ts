import { describe, expect, it } from 'vitest';
import { parseCssColor } from '@dascade/ui';
import { createSceneGrade, hasMaterials, installGrade, sceneEffects, sceneTint, type QuestMaterials } from './themeAdapter.ts';

const VHS: QuestMaterials = {
  sky: '#070a18',
  skyHorizon: '#26244a',
  ground: '#2a2d3c',
  groundDeep: '#171922',
  groundEdge: '#ff5c9d',
  screen: '#03040a',
  screenGlow: '#6aa8ff',
  bezel: '#11131c',
  paper: '#f3ead3',
  paperInk: '#1b1c28',
  paperEdge: '#cfc2a0',
};

/** A neutral dark material slice (shape of the scaffold material set). */
const NEUTRAL: QuestMaterials = { sky: '#0a0816', skyHorizon: '#2e2856', ground: '#3d2f5c', groundDeep: '#231e42', groundEdge: '#a78bfa', screen: '#05040b', screenGlow: '#22d3ee', bezel: '#19152f' };

const lum = (c: string) => {
  const p = parseCssColor(c)!;
  return 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b;
};
const dist = (a: string, b: string) => {
  const x = parseCssColor(a)!;
  const y = parseCssColor(b)!;
  return Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b);
};

describe('quest theme adapter', () => {
  it('Delta Neon (no materials): no grade, authored colours, own tint, no overlays', () => {
    expect(hasMaterials({})).toBe(false);
    expect(createSceneGrade({})).toBeNull();
    expect(sceneTint({}, '#a3e635')).toBe('#a3e635');
    expect(sceneEffects({}, { crt: 0.35, grain: 0.15 }, 'high')).toEqual({ crt: 0, grain: 0 });
  });

  it('too few ramp roles → identity (null grade)', () => {
    expect(createSceneGrade({ paper: '#ffffff', screen: '#000000' })).toBeNull();
  });

  it('materials present → used: the ramp is built from the theme and colours move toward it', () => {
    const grade = createSceneGrade(VHS)!;
    expect(grade).not.toBeNull();
    expect(grade.ramp).toContain('#6aa8ff');
    expect(grade.ramp).toContain('#03040a');
    // A neutral office wall adopts the theme's world…
    const wall = '#131130';
    expect(grade.map(wall)).not.toBe(wall);
    expect(dist(grade.map(wall), '#171922')).toBeLessThan(dist(wall, '#171922') + 1);
    // …alpha survives, unparseable values pass through.
    expect(grade.map('rgba(255,255,255,0.08)')).toMatch(/^rgba\(.*,0\.08\)$/);
    expect(grade.map('not-a-colour')).toBe('not-a-colour');
  });

  it('keeps light/dark structure (luminance order) so scenes stay readable', () => {
    const grade = createSceneGrade(NEUTRAL)!;
    const ladder = ['#05040c', '#15122e', '#3b3563', '#8f88b3', '#e9e4ff'];
    const mapped = ladder.map((c) => lum(grade.map(c)));
    for (let i = 1; i < mapped.length; i++) expect(mapped[i]!).toBeGreaterThan(mapped[i - 1]!);
  });

  it('meaning colours stay distinct: saturated light sources keep their hue', () => {
    const grade = createSceneGrade(VHS)!;
    const lights = ['#a3e635', '#22d3ee', '#ff4fd8', '#ffd23f', '#ff5a5f'].map((c) => grade.map(c));
    for (let i = 0; i < lights.length; i++) for (let j = i + 1; j < lights.length; j++) expect(dist(lights[i]!, lights[j]!)).toBeGreaterThan(40);
  });

  it('scene frame tint leans to the theme screen glow', () => {
    const t = sceneTint(VHS, '#a3e635');
    expect(t).not.toBe('#a3e635');
    expect(dist(t, '#6aa8ff')).toBeLessThan(dist('#a3e635', '#6aa8ff'));
  });

  it('decorative effects scale with fx and switch off', () => {
    expect(sceneEffects(VHS, { crt: 0.6, grain: 0.4 }, 'high')).toEqual({ crt: 0.6, grain: 0.4 });
    expect(sceneEffects(VHS, { crt: 0.6, grain: 0.4 }, 'low')).toEqual({ crt: 0.3, grain: 0.2 });
    expect(sceneEffects(VHS, { crt: 0.6, grain: 0.4 }, 'off')).toEqual({ crt: 0, grain: 0 });
  });

  it('installGrade routes fillStyle and gradient stops through the grade; null = passthrough; uninstall restores', () => {
    const seen: string[] = [];
    const stops: string[] = [];
    class FakeCtx {
      private v: unknown = '#000000';
      get fillStyle() {
        return this.v;
      }
      set fillStyle(v: unknown) {
        this.v = v;
        if (typeof v === 'string') seen.push(v);
      }
      createRadialGradient() {
        return { addColorStop: (_o: number, c: string) => stops.push(c) };
      }
      createLinearGradient() {
        return { addColorStop: (_o: number, c: string) => stops.push(c) };
      }
    }
    const ctx = new FakeCtx() as unknown as CanvasRenderingContext2D;
    let grade = createSceneGrade(VHS);
    const off = installGrade(ctx, () => grade);
    ctx.fillStyle = '#131130';
    expect(seen.at(-1)).toBe(grade!.map('#131130'));
    ctx.createRadialGradient(0, 0, 0, 0, 0, 1).addColorStop(0, '#131130');
    expect(stops.at(-1)).toBe(grade!.map('#131130'));
    grade = null; // theme switched back to Delta Neon: exact authored colour
    ctx.fillStyle = '#131130';
    expect(seen.at(-1)).toBe('#131130');
    off();
    expect(Object.getOwnPropertyNames(ctx)).not.toContain('createRadialGradient');
    grade = createSceneGrade(VHS);
    ctx.fillStyle = '#131130';
    expect(seen.at(-1)).toBe('#131130');
  });
});
