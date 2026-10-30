/**
 * DAS Checkers engines — pure and deterministic. American/English checkers (8×8) in board / moves /
 * game; the other draughts variants (8×8, 10×10, 12×12) in ./variants, with `checkersEngine(variant)`
 * as the one interface over all of them. Import as `@dascade/game-core/checkers`. Used by the server
 * room (authority) and by the client (legal-move hints only; the server validates every move).
 */
export * from './board.ts';
export * from './moves.ts';
export * from './game.ts';
export * from './variants/index.ts';
