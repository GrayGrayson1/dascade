/**
 * Progressive haunting for Halloween Night: the hall gets spookier after dark and peaks on Halloween
 * night itself (the player's local time — presentation only, nothing is shared). The level only sets the
 * environment's budget: more ghosts and bats, thicker fog and a couple of extra floor props, always
 * capped by the visual-effects setting and reduced motion. One shared timer re-checks the level at the
 * next 06:00 / 18:00 / midnight (at most every 5 minutes); nothing reads the clock per frame.
 */
import { useSyncExternalStore } from 'react';
import { seasonClock } from '../seasonalController.ts';
import type { SkinRenderContext } from '../types.ts';

export type HauntLevel = 0 | 1 | 2;

export const HAUNT_RECHECK_MAX_MS = 5 * 60_000;

/** 0 by day · 1 after dark (18:00–06:00) · 2 on Halloween night (Oct 31, until dawn on Nov 1). */
export function hauntLevel(now: Date): HauntLevel {
  if (!Number.isFinite(now.getTime())) return 0;
  const h = now.getHours();
  const month = now.getMonth();
  const day = now.getDate();
  const dark = h >= 18 || h < 6;
  // Halloween night keeps going past midnight until dawn on Nov 1.
  const halloween = (month === 9 && day === 31) || (month === 10 && day === 1 && h < 6);
  return ((dark ? 1 : 0) + (halloween ? 1 : 0)) as HauntLevel;
}

/** Milliseconds until the level can next change (06:00, 18:00 or midnight), clamped to [1 s, 5 min]. */
export function msUntilHauntCheck(now: Date): number {
  if (!Number.isFinite(now.getTime())) return HAUNT_RECHECK_MAX_MS;
  const next = new Date(now.getTime());
  const h = now.getHours();
  if (h < 6) next.setHours(6, 0, 0, 0);
  else if (h < 18) next.setHours(18, 0, 0, 0);
  else next.setHours(24, 0, 0, 0);
  return Math.min(HAUNT_RECHECK_MAX_MS, Math.max(1000, next.getTime() - now.getTime()));
}

/** What the environment may draw for a level, after the player's settings and where they are. */
export interface HauntBudget {
  /** Canvas frame rate; 0 = paint one still frame (no loop). */
  fps: 0 | 12 | 24;
  ghosts: number;
  bats: number;
  leaves: number;
  /** Fog opacity, 0–1. */
  fog: number;
}

const BASE: Readonly<Record<HauntLevel, Omit<HauntBudget, 'fps'>>> = {
  0: { ghosts: 1, bats: 2, leaves: 4, fog: 0.55 },
  1: { ghosts: 2, bats: 4, leaves: 5, fog: 0.7 },
  2: { ghosts: 3, bats: 6, leaves: 6, fog: 0.85 },
};

export function hauntBudget(level: HauntLevel, o: SkinRenderContext): HauntBudget {
  // Inside a game the hall is just a quiet backdrop: no sprites, a little fog, no loop.
  if (o.place === 'game') return { fps: 0, ghosts: 0, bats: 0, leaves: 0, fog: 0.35 };
  const b = BASE[level];
  const floor = o.place === 'floor';
  const ghosts = floor ? b.ghosts : Math.min(b.ghosts, 1);
  const bats = floor ? b.bats : Math.min(b.bats, 2);
  const leaves = floor ? b.leaves : Math.min(b.leaves, 3);
  const fog = floor ? b.fog : b.fog * 0.85;
  if (o.fx === 'off') return { fps: 0, ghosts: Math.min(ghosts, 1), bats: 0, leaves: 0, fog: fog * 0.6 };
  if (o.reducedMotion) return { fps: 0, ghosts, bats: Math.min(bats, 2), leaves: 0, fog };
  if (o.fx === 'low') return { fps: 12, ghosts: Math.min(ghosts, 1), bats: Math.min(bats, 2), leaves: Math.min(leaves, 3), fog };
  return { fps: 24, ghosts, bats, leaves, fog };
}

// ---------------------------------------------------------------------------
// Shared level store (one timer for every subscriber)
// ---------------------------------------------------------------------------
// The real clock, or the seasonal QA date (`?season=2026-10-31T20:00` previews Halloween night).
let clock: () => Date = seasonClock;
let current: HauntLevel = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

/** Where "now" comes from (the seasonal QA override plugs its clock in here). */
export function setHauntClock(next: () => Date): void {
  clock = next;
  if (listeners.size) recheck();
}

function recheck(): void {
  const now = clock();
  if (timer) clearTimeout(timer);
  timer = setTimeout(recheck, msUntilHauntCheck(now));
  const next = hauntLevel(now);
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function onVisibility(): void {
  if (document.visibilityState === 'visible') recheck();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    recheck();
    document.addEventListener('visibilitychange', onVisibility);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    if (timer) clearTimeout(timer);
    timer = null;
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

function snapshot(): HauntLevel {
  // Before anyone subscribes, read the clock directly so the first render already has the right level.
  if (!listeners.size) current = hauntLevel(clock());
  return current;
}

/** React: the current haunt level (re-renders only when it changes). */
export function useHauntLevel(): HauntLevel {
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}
