/** Neon Snake arena colours from theme materials (render-only; Delta Neon = the original art). */
import { hasScreenMaterials, lighten, screenColors, tint, type Materials } from '../_classics/palette.ts';

export interface ArenaArt {
  floorTop: string;
  floorBottom: string;
  /** Faint checker squares. */
  checker: string;
  /** Dot lattice at cell corners. */
  lattice: string;
  /** Centre pool of light (inner stop; the outer stop is the same colour at 0 alpha). */
  pool: string;
  poolClear: string;
  /** Arena rim stroke. */
  rim: string;
}

/** The original Delta Neon arena (exact values). */
export const ARENA_ART: ArenaArt = {
  floorTop: '#04140c',
  floorBottom: '#020906',
  checker: 'rgba(120, 255, 190, 0.018)',
  lattice: 'rgba(120, 255, 190, 0.10)',
  pool: 'rgba(94, 242, 181, 0.08)',
  poolClear: 'rgba(94, 242, 181, 0)',
  rim: 'rgba(45, 227, 143, 0.55)',
};

export function arenaArt(m: Materials): ArenaArt {
  if (!hasScreenMaterials(m)) return ARENA_ART;
  const s = screenColors(m, { top: ARENA_ART.floorTop, bottom: ARENA_ART.floorBottom, glow: '#2de38f' });
  const dots = lighten(s.glow, 0.35);
  return {
    floorTop: s.top,
    floorBottom: s.bottom,
    checker: tint(dots, 0.025),
    lattice: tint(dots, 0.14),
    pool: tint(s.glow, 0.08),
    poolClear: tint(s.glow, 0),
    rim: tint(s.glow, 0.6),
  };
}
