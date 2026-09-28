/**
 * Starting quality tier for this device (the renderer's auto-quality steps it down after ~3 s of
 * slow frames, never up). Pure except for reading `navigator`/`matchMedia`/`window` when present.
 *
 *  - desktop / fine pointer with ≥ 4 GB → 'high'
 *  - phones and tablets (coarse pointer) → 'medium' (1.5× pixel ratio, MSAA) when they report ≥ 4 GB
 *    and ≥ 6 cores (or don't report: every current iPhone), else 'low'
 *  - anything reporting ≤ 2 GB or ≤ 2 cores → 'low'
 */
import type { KartQuality } from './types.ts';

export interface DeviceHints {
  coarse: boolean;
  memoryGb?: number;
  cores?: number;
}

export function qualityForDevice(h: DeviceHints): KartQuality {
  const mem = h.memoryGb;
  const cores = h.cores;
  if ((mem !== undefined && mem <= 2) || (cores !== undefined && cores <= 2)) return 'low';
  if (h.coarse) {
    if ((mem !== undefined && mem < 4) || (cores !== undefined && cores < 6)) return 'low';
    return 'medium';
  }
  if (mem !== undefined && mem < 4) return 'medium';
  return 'high';
}

export function recommendedKartQuality(): KartQuality {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const nav = typeof navigator !== 'undefined' ? (navigator as { deviceMemory?: number; hardwareConcurrency?: number }) : undefined;
  return qualityForDevice({ coarse, memoryGb: nav?.deviceMemory, cores: nav?.hardwareConcurrency });
}
