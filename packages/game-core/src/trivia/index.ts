/**
 * DAStravaganza Trivia — pure engine + custom-pack tools. Import as `@dascade/game-core/trivia`.
 * The starter questions (answer keys!) are NOT exported here: the server imports them from
 * `@dascade/game-core/trivia/content`, so they never end up in the browser bundle.
 */
export * from './engine.ts';
export * from './pack.ts';
