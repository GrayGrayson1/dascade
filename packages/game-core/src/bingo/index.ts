/**
 * DAS Bingo engine — pure and deterministic (inject an Rng; never Math.random()).
 *
 *  board.ts    board specs, 75-ball + text card generation, reproducible dealing, caller bag
 *  patterns.ts masks, the pattern library, explicit transforms, round resolution
 *  claims.ts   coverage and server-side claim validation (calls only; marks never count)
 *  setup.ts    bulk item parsing, setup validation and the published round plan
 */
export * from './board.ts';
export * from './patterns.ts';
export * from './claims.ts';
export * from './setup.ts';
