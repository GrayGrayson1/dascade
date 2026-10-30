/**
 * Draughts variants: N×N board geometry, the rule sets as data, a rules-driven move generator and
 * one engine interface over every variant (`checkersEngine(variant)`; American plays on the
 * original engine). Re-exported by `@dascade/game-core/checkers`.
 */
export * from './geometry.ts';
export * from './rules.ts';
export * from './moves.ts';
export * from './game.ts';
