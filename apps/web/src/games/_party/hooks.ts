/**
 * Party kit client hooks.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PartyPodium, PartyPublicView } from '@dascade/shared/party';
import { useCountdown, useGame, useLatestMessage, useRoomSelector } from '../../net/hooks.ts';
import { useApp } from '../../app/store.ts';
import { sfx } from '../../audio/audio.ts';

/** useGame() typed for party states. */
export function usePartyGame<S extends PartyPublicView, Settings = Record<string, unknown>>() {
  return useGame<S, Settings>();
}

export interface PartyFx {
  /** Large motion allowed (not reduced motion, fx not off). */
  motion: boolean;
  /** Particle budget (0 when reduced motion / fx off). */
  particles: number;
  fx: 'high' | 'low' | 'off';
  reduced: boolean;
}

/** Motion + effects preferences (honour these in every animation). */
export function usePartyFx(): PartyFx {
  const reduced = useApp((s) => s.settings.reducedMotion);
  const fx = useApp((s) => s.settings.fx);
  return { motion: !reduced && fx !== 'off', particles: reduced || fx === 'off' ? 0 : fx === 'low' ? 14 : 44, fx, reduced };
}

export interface StageTimerInfo {
  remainingMs: number;
  /** 1 → 0 over the stage. */
  fraction: number;
  seconds: number;
  paused: boolean;
  timed: boolean;
}

/** Remaining time of the current party stage (paused-aware). `smooth` updates every frame. */
export function useStageTimer(smooth = false): StageTimerInfo {
  const endsAt = useRoomSelector<PartyPublicView, number>((s) => s.phaseEndsAt) ?? 0;
  const stageMs = useRoomSelector<PartyPublicView, number>((s) => s.stageMs) ?? 0;
  const paused = useRoomSelector<PartyPublicView, boolean>((s) => s.paused) ?? false;
  const pausedMs = useRoomSelector<PartyPublicView, number>((s) => s.pausedMs) ?? 0;
  const live = useCountdown(paused ? 0 : endsAt, smooth);
  const remainingMs = paused ? pausedMs : live;
  const total = Math.max(stageMs, remainingMs, 1);
  return {
    remainingMs,
    fraction: stageMs > 0 ? Math.max(0, Math.min(1, remainingMs / total)) : 0,
    seconds: Math.ceil(remainingMs / 1000),
    paused,
    timed: stageMs > 0 && (endsAt > 0 || paused),
  };
}

/**
 * Latest private payload of `type` (replayed after reconnect). With `seq`, payloads for another
 * prompt are ignored (they belong to an earlier question).
 */
export function useLatestPrivate<T extends { seq?: number }>(type: string, seq?: number): T | null {
  const payload = useLatestMessage<T>(type);
  if (!payload) return null;
  if (seq !== undefined && payload.seq !== undefined && payload.seq !== seq) return null;
  return payload;
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

/** Phones + narrow tablets (single-column party layout). */
export const PARTY_COMPACT_QUERY = '(max-width: 899px)';

export function parseJson<T>(json: string | undefined | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/** Parsed podium (null until the match ends). */
export function usePodium(): PartyPodium | null {
  const json = useRoomSelector<PartyPublicView, string>((s) => s.podiumJson);
  return useMemo(() => parseJson<PartyPodium | null>(json, null), [json]);
}

/**
 * Plays a soft tick for each of the last `from` seconds of a timed stage (once per second, never
 * while paused). Respects mute/volume via sfx().
 */
export function useTimerTicks(enabled: boolean, from = 5): void {
  const { seconds, timed, paused } = useStageTimer();
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled || !timed || paused) {
      last.current = null;
      return;
    }
    if (seconds > 0 && seconds <= from && last.current !== seconds) {
      last.current = seconds;
      sfx('tick', 200);
    }
  }, [enabled, seconds, timed, paused, from]);
}

/** Animated integer count-up (instant when motion is off). */
export function useCountUp(target: number, from: number, durationMs = 900, key: unknown = null): number {
  const { motion } = usePartyFx();
  const [value, setValue] = useState(motion ? from : target);
  useEffect(() => {
    if (!motion || from === target) {
      setValue(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    setValue(from);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // `key` restarts the animation for a new reveal even when numbers repeat.
  }, [target, from, durationMs, motion, key]);
  return value;
}
