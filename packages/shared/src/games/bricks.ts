/**
 * Brick Blitz — shared contract. Locally simulated, server-verified (classics kit model 2):
 * the engine is @dascade/game-core/bricks; messages are the kit's (classics:*).
 */
import { z } from 'zod';
import type { ClassicsPublicState } from './classics.ts';

export const BRICKS_MODES = ['arcade', 'blitz'] as const;
export type BricksMode = (typeof BRICKS_MODES)[number];
export const BRICKS_BLITZ_SECONDS = [180, 300] as const;

export const BricksSettingsSchema = z.object({
  /** arcade = until the last life is lost; blitz = most points before the clock runs out. */
  mode: z.enum(BRICKS_MODES),
  blitzSeconds: z.union([z.literal(180), z.literal(300)]),
});
export type BricksSettings = z.infer<typeof BricksSettingsSchema>;

export const DEFAULT_BRICKS_SETTINGS: BricksSettings = { mode: 'arcade', blitzSeconds: 180 };

export function bricksBoardKey(s: Pick<BricksSettings, 'mode' | 'blitzSeconds'>): string {
  return s.mode === 'blitz' ? `blitz-${Math.round(s.blitzSeconds / 60)}` : 'arcade';
}

export interface BricksPublicState extends ClassicsPublicState {
  /**
   * Live field previews per player: "<level>:<rows>:<cells>" where cells is rows × 12 chars
   * ('.' empty, else the brick kind N/A/X/S/P). Refreshed a few times a second.
   */
  fields: Record<string, string>;
}
