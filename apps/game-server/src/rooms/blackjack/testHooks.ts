/**
 * DASjack 21 test hooks, read from the environment once per room.
 *
 *  - DASCADE_BJ_PACE  — animation pacing multiplier (0 < x ≤ 4). Cosmetic only; honoured
 *                       whenever NODE_ENV is not "production".
 *  - DASCADE_BJ_STACK — "As,Kd,9h,7c|8s,8d,…": per-round cards stacked on top of the shoe.
 *                       This decides outcomes, so it is honoured ONLY when NODE_ENV is
 *                       explicitly "test" or "development". Production, staging and an unset
 *                       NODE_ENV (e.g. `pnpm start`, which also loads ../../.env) ignore it.
 *
 * No client message can reach any of this: it is read from process.env at room creation.
 */
import { isCardCode } from '@dascade/game-core/cards';

export interface BlackjackTestHooks {
  /** Multiplier applied to every animation delay (1 = real pacing). */
  pace: number;
  /** Whether stacked cards may be placed on top of the shoe. */
  stacking: boolean;
  /** Per-round stacks from DASCADE_BJ_STACK (empty unless `stacking`). */
  stacks: string[][];
}

type Env = Record<string, string | undefined>;

export function readTestHooks(env: Env): BlackjackTestHooks {
  const mode = env.NODE_ENV;
  const pace = mode === 'production' ? 1 : readPace(env.DASCADE_BJ_PACE);
  const stacking = mode === 'test' || mode === 'development';
  return { pace, stacking, stacks: stacking ? readStacks(env.DASCADE_BJ_STACK) : [] };
}

function readPace(raw: string | undefined): number {
  const v = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(v) && v > 0 && v <= 4 ? v : 1;
}

function readStacks(raw: string | undefined): string[][] {
  if (!raw) return [];
  return raw
    .split('|')
    .map((round) =>
      round
        .split(',')
        .map((c) => c.trim())
        .filter(isCardCode),
    )
    .filter((r) => r.length > 0);
}
