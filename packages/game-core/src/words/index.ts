/**
 * DASwords engine: pure, deterministic (injected Rng), framework-free. Server-side only in practice
 * (the client imports the tiny helpers in @dascade/shared/games/words instead).
 *
 *  dictionary.ts  WordDictionary (Map lookups + sorted-array prefix search), normalization, tiers
 *  blocklist.ts   office-safe blocklist + masking
 *  grid.ts        Letter Grid: original dice, board rolls, Qu handling, path validation, solver
 *  anagram.ts     Anagram Sprint: racks with a guaranteed long word, solver, scoring
 *  chain.ts       Word Chain: simultaneous links, hearts, burned words, next-link choice
 *  forbidden.ts   Forbidden Letter: answer checks, plural folding, letter choice
 *  categories.ts  Forbidden Letter categories (original, office-safe)
 *  hunt.ts        HuntRound (submissions, duplicates, limits, host verdicts) + markHunt (team/unique credit)
 */
export * from './dictionary.ts';
export * from './blocklist.ts';
export * from './grid.ts';
export * from './anagram.ts';
export * from './chain.ts';
export * from './forbidden.ts';
export * from './categories.ts';
export * from './hunt.ts';
