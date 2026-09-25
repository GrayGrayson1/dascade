import { useEffect, useState } from 'react';
import {
  DASKETCH_MSG,
  type DasketchPublicState,
  type DasketchSettings,
  type SketchAward,
  type SketchPrivate,
  type SketchTurnRecord,
} from '@dascade/shared/games/dasketch';
import { useGame, useLatestMessage } from '../../net/hooks.ts';
import { useApp } from '../../app/store.ts';

export function useSketchGame() {
  return useGame<DasketchPublicState, DasketchSettings>();
}

/** The private payload for the current turn (stale payloads from earlier turns are ignored). */
export function useSketchPrivate(turn: number): SketchPrivate | null {
  const priv = useLatestMessage<SketchPrivate>(DASKETCH_MSG.private);
  return priv && priv.turn === turn ? priv : null;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof matchMedia === 'function' ? matchMedia(query).matches : false));
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** Stacked layout: phones, portrait tablets and short landscape screens. */
export const COMPACT_QUERY = '(max-width: 760px), (orientation: portrait) and (max-width: 1100px), (max-height: 540px) and (orientation: landscape)';

/** Motion + effects preferences. `motion` false = no large motion; `particles` scales with fx. */
export function useSketchFx(): { motion: boolean; particles: number; fx: 'high' | 'low' | 'off' } {
  const reduced = useApp((s) => s.settings.reducedMotion);
  const fx = useApp((s) => s.settings.fx);
  return { motion: !reduced && fx !== 'off', particles: reduced || fx === 'off' ? 0 : fx === 'low' ? 10 : 28, fx };
}

export function parseJson<T>(json: string | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export const parseHistory = (json: string | undefined) => parseJson<SketchTurnRecord[]>(json, []);
export const parseAwards = (json: string | undefined) => parseJson<SketchAward[]>(json, []);
