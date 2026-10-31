/**
 * DAS Reversi engine — pure, deterministic rules for all ten variants.
 * Import as `@dascade/game-core/reversi`. Used by the server room (authority) and by the client
 * (legal-move hints and previews only; the server validates every move).
 */
export * from './game.ts';
