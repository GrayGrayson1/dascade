/**
 * The phone companion's picker status (DSP-03 B, PCK-03 C), pure so it's tested on its own. Built only
 * from this participant's private `showdown:me` (`pool`, `picked`) and the public picker state; nothing
 * here can tell anyone else who skipped.
 */
import type { IconName } from '@dascade/ui';
import type { ShowdownMe } from '@dascade/shared/games/showdown';

export type PoolKey = 'hot' | 'skip' | 'done' | 'in' | 'out';

export interface PoolStatus {
  key: PoolKey;
  icon: IconName;
  /** The headline (spoken by screen readers when it changes). */
  title: string;
  /** A second line for the full card ('' = none). */
  detail: string;
}

/**
 * What the pool card says. Being in the hot seat wins; then your own Skip me switch (your choice, so
 * it's what you see even if your turn already counted); then a counted turn; then the pool. "Not in the
 * pool" never says why (a moderator may have hidden the seat).
 */
export function poolStatus(pool: NonNullable<ShowdownMe['pool']>, picked: boolean, poolSize: number): PoolStatus {
  if (picked)
    return { key: 'hot', icon: 'star', title: 'You’re answering now', detail: 'Unmute and give your answer — the stage is on you.' };
  if (pool.skip)
    return {
      key: 'skip',
      icon: 'eye',
      title: 'Skip me is on — you won’t be picked',
      detail: 'Only you can see this. Switch it off any time to get back in.',
    };
  if (pool.done)
    return {
      key: 'done',
      icon: 'check',
      title: 'Your turn’s done this round — you’re back in next round',
      detail: 'Thanks for playing along!',
    };
  if (pool.in) {
    const others = Math.max(0, poolSize - 1);
    return {
      key: 'in',
      icon: 'users',
      title: 'You’re in the pool — you might be picked',
      detail:
        poolSize > 1
          ? `You and ${others} other${others === 1 ? '' : 's'} could be picked next. Rather not? Switch on Skip me.`
          : 'Rather not? Switch on Skip me.',
    };
  }
  return { key: 'out', icon: 'clock', title: 'You’re not in the pool right now', detail: '' };
}

/** "You're up" waits for the stage: the picked phone never runs ahead of the landing (`landAt`). */
export function hasLanded(landAt: number, now: number): boolean {
  return landAt > 0 && now >= landAt;
}

/** Vibrate only for a pick that just landed (not when a phone reloads in the middle of a turn). */
export const BUZZ_FRESH_MS = 8000;

export function shouldBuzz(landAt: number, now: number): boolean {
  return hasLanded(landAt, now) && now - landAt < BUZZ_FRESH_MS;
}
