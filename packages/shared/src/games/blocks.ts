/**
 * Block Drop — shared contract. Locally simulated, server-verified (classics kit model 2):
 * the engine is @dascade/game-core/blocks; messages are the kit's (classics:*).
 */
import { z } from 'zod';
import type { ClassicsPublicState } from './classics.ts';

export const BLOCKS_MODES = ['marathon', 'blitz'] as const;
export type BlocksMode = (typeof BLOCKS_MODES)[number];

export const BLITZ_SECONDS = [120, 180, 300] as const;

export const BlocksSettingsSchema = z.object({
  /** marathon = play until the stack tops out; blitz = most points before the clock runs out. */
  mode: z.enum(BLOCKS_MODES),
  blitzSeconds: z.union([z.literal(120), z.literal(180), z.literal(300)]),
  startLevel: z.number().int().min(1).max(10),
});
export type BlocksSettings = z.infer<typeof BlocksSettingsSchema>;

export const DEFAULT_BLOCKS_SETTINGS: BlocksSettings = { mode: 'marathon', blitzSeconds: 180, startLevel: 1 };

/** High-score board for a settings combination. */
export function blocksBoardKey(s: Pick<BlocksSettings, 'mode' | 'blitzSeconds'>): string {
  return s.mode === 'blitz' ? `blitz-${Math.round(s.blitzSeconds / 60)}` : 'marathon';
}

export function blocksModeLabel(s: Pick<BlocksSettings, 'mode' | 'blitzSeconds'>): string {
  return s.mode === 'blitz' ? `Blitz ${Math.floor(s.blitzSeconds / 60)}:${String(s.blitzSeconds % 60).padStart(2, '0')}` : 'Marathon';
}

export interface BlocksPublicState extends ClassicsPublicState {
  /** Live stack previews per player (20×10 chars '0'–'7'), refreshed a few times a second. */
  boards: Record<string, string>;
}
