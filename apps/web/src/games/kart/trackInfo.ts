/** UI-side track facts (biome labels for cards and the intro card). */
import type { KartTrackId } from '@dascade/shared/games/kart';

export type BiomeId = 'city' | 'desert' | 'harbor' | 'snow' | 'carnival' | 'factory' | 'sky' | 'cyber';

const BIOMES: Record<KartTrackId, BiomeId> = {
  'pixel-plaza': 'city',
  'dune-drift': 'desert',
  'harbor-hairpins': 'harbor',
  'frostbyte-pass': 'snow',
  'pinball-park': 'carnival',
  gearworks: 'factory',
  'skyway-sprint': 'sky',
  'midnight-mainframe': 'cyber',
};

export const BIOME_LABEL: Record<BiomeId, string> = {
  city: 'Neon city',
  desert: 'Desert',
  harbor: 'Harbor',
  snow: 'Mountain snow',
  carnival: 'Carnival',
  factory: 'Factory',
  sky: 'Above the clouds',
  cyber: 'Cyberspace',
};

export function trackBiome(id: KartTrackId): BiomeId {
  return BIOMES[id] ?? 'city';
}
