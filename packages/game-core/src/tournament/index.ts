/**
 * @dascade/game-core/tournament — the Tournament Center engine (pure, deterministic, injected Rng).
 * Formats: single / double elimination, round robin (Berger), Swiss (Dutch-style max-weight matching).
 */
export * from './types.ts';
export * from './engine.ts';
export * from './series.ts';
export * from './brackets.ts';
export * from './swiss.ts';
export * from './standings.ts';
export { maxWeightMatching, type WeightedEdge } from './matching.ts';
