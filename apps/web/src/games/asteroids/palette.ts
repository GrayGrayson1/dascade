/** Asteroid Belt space colours from theme materials (render-only; Delta Neon = the original art). */
import { deepen, hasScreenMaterials, lighten, mix, screenColors, type Materials } from '../_classics/palette.ts';

export interface SpaceArt {
  spaceTop: string;
  spaceBottom: string;
  /** Three nebula clouds (drawn translucent). */
  nebulaA: string;
  nebulaB: string;
  nebulaC: string;
}

/** The original Delta Neon belt backdrop (exact values). */
export const SPACE_ART: SpaceArt = {
  spaceTop: '#0b0824',
  spaceBottom: '#04030d',
  nebulaA: '#6d28d9',
  nebulaB: '#0e7490',
  nebulaC: '#be185d',
};

export function spaceArt(m: Materials): SpaceArt {
  if (!hasScreenMaterials(m)) return SPACE_ART;
  const s = screenColors(m, { top: SPACE_ART.spaceTop, bottom: SPACE_ART.spaceBottom, glow: SPACE_ART.nebulaA });
  return {
    spaceTop: s.top,
    spaceBottom: s.bottom,
    nebulaA: s.glow,
    nebulaB: deepen(mix(s.glow, s.top, 0.35), 0.2),
    nebulaC: lighten(s.glow, 0.25),
  };
}
