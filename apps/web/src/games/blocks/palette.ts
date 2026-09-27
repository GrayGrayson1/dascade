/** Block Drop well colours from theme materials (render-only; Delta Neon = the original art). */
import { hasScreenMaterials, lighten, screenColors, tint, type Materials } from '../_classics/palette.ts';

export interface WellArt {
  top: string;
  bottom: string;
  /** Grid lines between cells. */
  grid: string;
  /** Checker shown while the well is hidden (paused). */
  pausedInk: string;
}

/** The original Delta Neon well (exact values). */
export const WELL_ART: WellArt = {
  top: '#0b0a1d',
  bottom: '#05040d',
  grid: 'rgba(160, 150, 255, 0.07)',
  pausedInk: 'rgba(124, 245, 255, 0.05)',
};

export function wellArt(m: Materials): WellArt {
  if (!hasScreenMaterials(m)) return WELL_ART;
  const s = screenColors(m, { top: WELL_ART.top, bottom: WELL_ART.bottom, glow: '#7cf5ff' });
  return {
    top: s.top,
    bottom: s.bottom,
    grid: tint(lighten(s.glow, 0.3), 0.09),
    pausedInk: tint(s.glow, 0.07),
  };
}
