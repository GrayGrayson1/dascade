/** Brick Blitz field colours from theme materials (render-only; Delta Neon = the original art). */
import { deepen, hasScreenMaterials, lighten, tint, type Materials } from '../_classics/palette.ts';

export interface FieldArt {
  top: string;
  mid: string;
  bottom: string;
  /** Background grid lines. */
  grid: string;
  /** Brick-zone ceiling line. */
  ceiling: string;
}

/** The original Delta Neon field (exact values). */
export const FIELD_ART: FieldArt = {
  top: '#0d0a22',
  mid: '#07061a',
  bottom: '#0a0716',
  grid: 'rgba(160, 150, 255, 0.05)',
  ceiling: 'rgba(124, 245, 255, 0.12)',
};

export function fieldArt(m: Materials): FieldArt {
  if (!hasScreenMaterials(m)) return FIELD_ART;
  const screen = m.screen ?? FIELD_ART.top;
  const glow = m.screenGlow ?? '#7cf5ff';
  return {
    top: screen,
    mid: deepen(screen, 0.35),
    bottom: deepen(screen, 0.2),
    grid: tint(lighten(glow, 0.3), 0.07),
    ceiling: tint(glow, 0.2),
  };
}
