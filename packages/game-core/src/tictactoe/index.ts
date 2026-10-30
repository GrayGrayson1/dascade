/**
 * DAS Tic-Tac-Toe engine — pure, deterministic rules for all thirteen variants.
 * Import as `@dascade/game-core/tictactoe`. Used by the server room (authority) and by the client
 * (legal-move hints only; the server validates every move).
 */
export * from './lines.ts';
export * from './game.ts';
