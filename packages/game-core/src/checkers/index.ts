/**
 * DAS Checkers engine — pure, deterministic American/English checkers (8×8).
 * Import as `@dascade/game-core/checkers`. Used by the server room (authority) and by
 * the client (legal-move hints only; the server validates every move).
 */
export * from './board.ts';
export * from './moves.ts';
export * from './game.ts';
