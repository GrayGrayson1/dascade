/** Pixel Paddle court colours from theme materials (render-only; Delta Neon = the original art). */
import { hasScreenMaterials, lighten, luminance, screenColors, tint, type Materials } from '../_classics/palette.ts';

export interface CourtArt {
  courtTop: string;
  courtBottom: string;
  /** Floor grid ink. */
  grid: string;
  /** Pixel centre line fill. */
  centre: string;
  /** Glow colour (centre pool, line and rail glows). */
  glow: string;
  /** Rail / centre-diamond colour. */
  line: string;
  /** Text drawn on the court ("YOUR SERVE"). */
  ink: string;
}

/** The original Delta Neon court (exact values). */
export const COURT_ART: CourtArt = {
  courtTop: '#07182a',
  courtBottom: '#030b15',
  grid: 'rgba(124, 245, 255, 0.045)',
  centre: 'rgba(214, 246, 255, 0.34)',
  glow: '#7cf5ff',
  line: '#d6f6ff',
  ink: '#f8f6ff',
};

export function courtArt(m: Materials): CourtArt {
  if (!hasScreenMaterials(m)) return COURT_ART;
  const s = screenColors(m, { top: COURT_ART.courtTop, bottom: COURT_ART.courtBottom, glow: COURT_ART.glow });
  const line = lighten(s.glow, 0.6);
  return {
    courtTop: s.top,
    courtBottom: s.bottom,
    grid: tint(s.glow, 0.06),
    centre: tint(line, 0.4),
    glow: s.glow,
    line,
    ink: luminance(s.top) > 0.45 ? '#07050f' : '#f8f6ff',
  };
}
