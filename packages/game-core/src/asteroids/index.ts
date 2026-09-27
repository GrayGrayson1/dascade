/**
 * @dascade/game-core/asteroids — pure, deterministic engine for Asteroid Run: the shared
 * ship flight model (server + client prediction), the world simulation (rocks, splits,
 * waves, shields, lives, power-ups, co-op revive), binary snapshots and an autopilot.
 */
export * from './ship.ts';
export * from './world.ts';
export * from './snapshot.ts';
export * from './bot.ts';
