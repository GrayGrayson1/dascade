/**
 * Track catalogue. Control points are hand-authored; everything else (spline,
 * gates, grid, bridges, scenery) is derived deterministically.
 */
import type { CircuitTrackId } from '@dascade/shared/games/circuit';
import { buildTrack, type Track, type TrackDef } from './track.ts';

export const TRACK_DEFS: Record<CircuitTrackId, TrackDef> = {
  'neon-loop': {
    id: 'neon-loop',
    name: 'Neon Loop',
    tagline: 'Flowing night circuit through the arcade district.',
    style: 'Fast & flowing',
    points: [
      [1800, 2720],
      [3500, 2720],
      [4120, 2450],
      [4260, 1850],
      [3980, 1360],
      [3480, 1420],
      [3140, 1180],
      [3220, 760],
      [2920, 370],
      [2000, 380],
      [1050, 330],
      [480, 600],
      [360, 1180],
      [650, 1590],
      [540, 2070],
      [620, 2560],
      [1050, 2720],
    ],
    halfWidth: 112,
    rumble: 14,
    runoff: 64,
    gates: 8,
    bridgeHalfLength: 260,
    theme: {
      ground: '#0b1020',
      road: '#1a1d2b',
      runoff: '#14202a',
      neonA: '#22d3ee',
      neonB: '#f97316',
      curb: '#f8f6ff',
      barrier: '#2a3350',
    },
    decorSeed: 7721,
    parLapMs: 18_000,
  },
  'skyline-switchback': {
    id: 'skyline-switchback',
    name: 'Skyline Switchback',
    tagline: 'Technical figure-eight with hairpins and a flyover.',
    style: 'Technical',
    points: [
      [1600, 2640],
      [2250, 2500],
      [2620, 1900],
      [2960, 1060],
      [3350, 820],
      [3880, 800],
      [4062, 858],
      [4130, 1015],
      [4062, 1172],
      [3880, 1230],
      [3470, 1290],
      [3230, 1510],
      [3300, 1830],
      [3090, 2110],
      [2860, 2080],
      [2400, 1650],
      [1750, 980],
      [1250, 720],
      [760, 780],
      [540, 1180],
      [760, 1580],
      [600, 2060],
      [820, 2560],
      [1150, 2660],
    ],
    halfWidth: 96,
    rumble: 12,
    runoff: 56,
    gates: 10,
    bridgeHalfLength: 250,
    theme: {
      ground: '#0d0b1d',
      road: '#1c1a2c',
      runoff: '#1b1830',
      neonA: '#f97316',
      neonB: '#22d3ee',
      curb: '#f8f6ff',
      barrier: '#33294d',
    },
    decorSeed: 90211,
    parLapMs: 17_600,
  },
};

const cache = new Map<CircuitTrackId, Track>();

/** Built tracks are immutable and cached. */
export function getTrack(id: CircuitTrackId): Track {
  let t = cache.get(id);
  if (!t) {
    t = buildTrack(TRACK_DEFS[id]);
    cache.set(id, t);
  }
  return t;
}
