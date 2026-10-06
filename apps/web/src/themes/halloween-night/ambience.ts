import type { ThemePlace } from '../types.ts';

export interface AmbienceOptions {
  place: ThemePlace;
  /** Haunt intensity 0–1 (more frequent events when higher). */
  level?: number;
  enabled?: boolean;
}

/** Quiet floor ambience for Halloween Night (stub — filled in by the sounds work). */
export function useHalloweenAmbience(options: AmbienceOptions): void {
  void options;
}
