/**
 * The phone companion's picker status (DSP-03 B, PCK-03 C), pure so it's tested on its own. Built only
 * from this participant's private `showdown:me` (`pool`, `picked`) and the public picker state; nothing
 * here can tell anyone else who skipped.
 */
import type { IconName } from '@dascade/ui';
import type { ShowdownMe } from '@dascade/shared/games/showdown';

export type PoolKey = 'hot' | 'skip' | 'excluded' | 'crew' | 'lap' | 'done' | 'in' | 'out';

export interface PoolStatus {
  key: PoolKey;
  icon: IconName;
  /** The headline (spoken by screen readers when it changes). */
  title: string;
  /** A second line for the full card ('' = none). */
  detail: string;
}

/** By name you can always be called up, whatever the random draw says (Brian, 2026-10-27). */
const BY_NAME = 'The presenter can still call you up by name.';

type Pool = Pick<NonNullable<ShowdownMe['pool']>, 'in' | 'skip' | 'done'> & Partial<NonNullable<ShowdownMe['pool']>>;

/**
 * What the pool card says. Being in the hot seat wins; then your own Skip me switch (your choice, so
 * it's what you see even if your turn already counted); then the presenter's or crew's Exclude; then
 * crew outside the random draw; then Fair mode's "you've had a turn" wait; then the pool. "Not in the
 * pool" never says why (a moderator may have hidden the seat).
 */
export function poolStatus(pool: Pool, picked: boolean, poolSize: number): PoolStatus {
  if (picked)
    return { key: 'hot', icon: 'star', title: 'You’re answering now', detail: 'Unmute and give your answer — the stage is on you.' };
  if (pool.skip)
    return {
      key: 'skip',
      icon: 'eye',
      title: 'Skip me is on — you’re out of the random draw',
      detail: `${BY_NAME} Only you can see this. Switch it off any time to get back in.`,
    };
  if (pool.excluded) return { key: 'excluded', icon: 'clock', title: 'You’re out of the random draw for now', detail: BY_NAME };
  if (pool.crewOut) return { key: 'crew', icon: 'crown', title: 'You’re crew — not in the random draw', detail: BY_NAME };
  if (!pool.in && pool.mode !== 'random' && (pool.turns ?? 0) > 0)
    return {
      key: 'lap',
      icon: 'check',
      title: 'You’ve had a turn — you’re back in once everyone has had one',
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
  if (pool.done)
    return {
      key: 'done',
      icon: 'check',
      title: 'Your turn’s done — you’re back in after the next pick',
      detail: 'Thanks for playing along!',
    };
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
