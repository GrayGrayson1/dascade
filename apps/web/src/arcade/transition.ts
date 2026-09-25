/**
 * Cabinet ⇄ title-screen transitions. Uses the View Transitions API when the
 * browser has it (the cabinet screen morphs into the full-screen title art),
 * otherwise the caller falls back to a short CSS zoom. Always instant with
 * reduced motion.
 */
import { isGameId, type GameId } from '@dascade/shared';

const LAST_KEY = 'dascade:arcade:last';

export function rememberCabinet(id: GameId): void {
  try {
    sessionStorage.setItem(LAST_KEY, id);
  } catch {
    /* storage can be unavailable (private mode) */
  }
}

export function lastCabinet(): GameId | null {
  try {
    const v = sessionStorage.getItem(LAST_KEY);
    return isGameId(v) ? v : null;
  } catch {
    return null;
  }
}

type ViewTransitionDoc = Document & {
  startViewTransition?: (update: () => Promise<void> | void) => { finished: Promise<void>; ready: Promise<void> };
};

export function supportsViewTransitions(): boolean {
  return typeof (document as ViewTransitionDoc).startViewTransition === 'function';
}

/** Resolves once `selector` matches (or after `timeout` ms). Uses timers: rendering is paused inside a view transition. */
export function waitForElement(selector: string, timeout = 800): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const check = () => {
      if (document.querySelector(selector) || performance.now() - start > timeout) resolve();
      else setTimeout(check, 16);
    };
    check();
  });
}

/**
 * Runs `update` (a route change) inside a view transition tagged with
 * `html[data-vt=<kind>]`, waiting for `readySelector` before the new snapshot.
 * Returns false when view transitions aren't available.
 */
export function runViewTransition(kind: 'enter' | 'exit', update: () => void, readySelector: string): boolean {
  const doc = document as ViewTransitionDoc;
  if (typeof doc.startViewTransition !== 'function') return false;
  const root = document.documentElement;
  root.dataset.vt = kind;
  try {
    const vt = doc.startViewTransition(async () => {
      update();
      await waitForElement(readySelector);
    });
    const clear = () => {
      if (root.dataset.vt === kind) delete root.dataset.vt;
    };
    vt.finished.then(clear, clear);
  } catch {
    delete root.dataset.vt;
    update();
  }
  return true;
}
