/**
 * Theme switching with a transition: load the target skin FIRST, cover the screen with a short
 * overlay in the target theme's `effects.transition` style, apply the theme while covered, reveal.
 *
 * Guarantees
 *   - one overlay, ever: a single state machine drives it; rapid repeated switches retarget the
 *     running transition (the newest choice wins) instead of stacking overlays or timers.
 *   - total ≤ ~700 ms (cover 300 + hold ≤ 2 frames + reveal 360); reduced motion / fx MINIMAL use a
 *     ≤ 150 ms fade.
 *   - it only changes `settings.theme`: no route remount, no session/room access, no audio calls.
 */
import { DEFAULT_EFFECTS, getTheme, type ThemeEffects } from '@dascade/ui';

export type TransitionStyle = ThemeEffects['transition'];
export type TransitionPhase = 'idle' | 'cover' | 'covered' | 'reveal';

export interface TransitionState {
  phase: TransitionPhase;
  style: TransitionStyle;
  /** Theme being switched to (the overlay tints itself with its swatches). */
  target: string | null;
  coverMs: number;
  revealMs: number;
  /** Increments per transition run (lets the overlay restart its CSS animations). */
  run: number;
}

export interface SwitcherDeps {
  /** Current theme preference (settings.theme). */
  current(): string;
  /** Persist + apply the theme (updateSettings({ theme })). */
  apply(id: string): void;
  /** Resolves when the skin is ready (or gave up) — must never reject. */
  load(id: string): Promise<unknown>;
  /** true → short fade instead of the themed transition. */
  calm(): boolean;
  /** Wait for the applied styles to paint (two animation frames in the browser). */
  settle?(): Promise<void>;
  sleep?(ms: number): Promise<void>;
}

export const TIMING = {
  coverMs: 300,
  revealMs: 360,
  calmCoverMs: 60,
  calmRevealMs: 90,
  /** Give up waiting for a slow skin chunk after this long (the theme applies token-only). */
  loadTimeoutMs: 1500,
} as const;

export function transitionStyleFor(id: string): TransitionStyle {
  return getTheme(id).effects?.transition ?? DEFAULT_EFFECTS.transition;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface ThemeSwitcher {
  /** Switch with a transition (or instantly when `animate` is false). Resolves when the reveal ends. */
  switchTo(id: string, opts?: { animate?: boolean }): Promise<void>;
  getState(): TransitionState;
  subscribe(listener: () => void): () => void;
  /** true while a transition is running. */
  busy(): boolean;
}

export function createThemeSwitcher(deps: SwitcherDeps): ThemeSwitcher {
  const sleep = deps.sleep ?? defaultSleep;
  const settle = deps.settle ?? (() => sleep(16));
  let state: TransitionState = { phase: 'idle', style: 'fade', target: null, coverMs: 0, revealMs: 0, run: 0 };
  const listeners = new Set<() => void>();
  let desired: string | null = null;
  let running: Promise<void> | null = null;

  const set = (patch: Partial<TransitionState>) => {
    state = { ...state, ...patch };
    for (const l of [...listeners]) l();
  };

  const withTimeout = (p: Promise<unknown>, ms: number) =>
    new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      void sleep(ms).then(finish);
      void p.then(finish, finish);
    });

  async function drive(): Promise<void> {
    try {
      while (desired !== null && (desired !== deps.current() || state.phase === 'covered')) {
        const target = desired;
        await withTimeout(deps.load(target), TIMING.loadTimeoutMs);
        if (desired !== target) continue; // retargeted while loading
        if (target === deps.current() && state.phase !== 'covered') break;
        const calm = deps.calm();
        const coverMs = calm ? TIMING.calmCoverMs : TIMING.coverMs;
        const revealMs = calm ? TIMING.calmRevealMs : TIMING.revealMs;
        if (state.phase !== 'covered') {
          set({ phase: 'cover', style: calm ? 'fade' : transitionStyleFor(target), target, coverMs, revealMs, run: state.run + 1 });
          await sleep(coverMs);
          set({ phase: 'covered' });
        }
        if (desired !== target) continue; // stays covered; the loop applies the newest choice
        if (deps.current() !== target) deps.apply(target);
        await settle();
        if (desired !== target) continue;
        set({ phase: 'reveal', target, revealMs });
        await sleep(revealMs);
        if (desired === target) desired = null;
        set({ phase: 'idle' });
      }
    } finally {
      desired = null;
      if (state.phase !== 'idle') set({ phase: 'idle' });
      running = null;
    }
  }

  return {
    switchTo(id, opts) {
      if (opts?.animate === false) {
        desired = null;
        if (deps.current() !== id) deps.apply(id);
        return running ?? Promise.resolve();
      }
      desired = id;
      if (!running) {
        if (id === deps.current() && state.phase === 'idle') {
          desired = null;
          return Promise.resolve();
        }
        running = drive();
      }
      return running;
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    busy: () => running !== null,
  };
}
