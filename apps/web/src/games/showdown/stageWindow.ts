/**
 * The presenter's stage window: a second browser window (drag it onto the projector, go fullscreen)
 * that the presenter console renders the public stage into with a React portal.
 *
 * Why a portal and not a second connection: in the same browser a second tab would reclaim the
 * presenter's seat (seat tokens are shared per browser) and knock the console out. The window is just
 * another surface of the presenter's own page: it shows exactly the public stage, gets every update
 * instantly, plays no sound of its own (the console plays it once) and needs no join.
 *
 * The window starts as about:blank (same origin). We copy the page's stylesheets and <html>
 * attributes (theme, motion, effects) into it and keep them in sync, so it looks exactly like the app.
 * Devices that aren't the presenter's (a TV, a conference-room PC) use the big-screen link instead.
 */
import { useSyncExternalStore } from 'react';

export interface StageWindowState {
  /** Where the portal renders (null while closed). */
  container: HTMLElement | null;
  open: boolean;
}

let win: Window | null = null;
/** The stage window's document the stage was built in (a reload of that window replaces it). */
let doc: Document | null = null;
let title = '';
/** Sent the window to a fresh about:blank once (its page couldn't be reached); reset by a build. */
let renavigated = false;
let state: StageWindowState = { container: null, open: false };
const listeners = new Set<() => void>();
let cleanup: (() => void) | null = null;
let poll: ReturnType<typeof setInterval> | null = null;

function emit(next: StageWindowState): void {
  state = next;
  for (const l of [...listeners]) l();
}

const COPY_ATTR = 'data-sd-copy';
const SHEETS = 'link[rel="stylesheet"], style';

function copyRootAttributes(target: Document): void {
  const src = document.documentElement;
  const dst = target.documentElement;
  for (const attr of [...dst.attributes]) if (!src.hasAttribute(attr.name)) dst.removeAttribute(attr.name);
  for (const attr of [...src.attributes]) dst.setAttribute(attr.name, attr.value);
}

/**
 * Mirrors the page's stylesheets into the stage window one node at a time. Only what changed is
 * touched: re-copying every sheet (as a theme preview's <style> edit used to) reloaded each <link>,
 * and the projector flashed unstyled.
 */
function mirrorStyles(target: Document): (changed?: ReadonlySet<Node>) => void {
  const copies = new Map<Node, HTMLElement>();
  for (const old of [...target.head.querySelectorAll(`[${COPY_ATTR}]`)]) old.remove();
  return (changed = new Set()) => {
    const sources = [...document.head.querySelectorAll<HTMLElement>(SHEETS)];
    const live = new Set<Node>(sources);
    for (const [src, copy] of copies) {
      if (live.has(src)) continue;
      copy.remove();
      copies.delete(src);
    }
    // Back to front, so a new copy goes in front of the next sheet's copy: the cascade order holds.
    let next: HTMLElement | null = null;
    for (let i = sources.length - 1; i >= 0; i--) {
      const src = sources[i]!;
      const old = copies.get(src);
      if (old && !changed.has(src)) {
        next = old;
        continue;
      }
      const copy = target.importNode(src, true);
      copy.setAttribute(COPY_ATTR, '');
      target.head.insertBefore(copy, old ?? next);
      if (old) retire(old, copy);
      copies.set(src, copy);
      next = copy;
    }
  };
}

/** Drops a replaced copy once its successor applies: a <style> at once, a <link> when it has loaded. */
function retire(old: HTMLElement, fresh: HTMLElement): void {
  if (fresh.tagName !== 'LINK') return old.remove();
  const done = () => old.remove();
  fresh.addEventListener('load', done, { once: true });
  fresh.addEventListener('error', done, { once: true });
  setTimeout(done, 5000);
}

function prepare(w: Window): HTMLElement {
  const target = w.document;
  target.title = title;
  if (!target.head.querySelector('base')) {
    const base = target.createElement('base');
    base.href = `${location.origin}/`;
    target.head.prepend(base);
  }
  if (!target.head.querySelector('meta[name="viewport"]')) {
    const meta = target.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width, initial-scale=1';
    target.head.appendChild(meta);
  }
  copyRootAttributes(target);
  target.body.replaceChildren();
  target.body.className = 'sd-window';
  const root = target.createElement('div');
  root.className = 'sd-window__root';
  target.body.appendChild(root);
  return root;
}

/** A notice left in the stage window when the console page goes away (reload, navigation). */
function orphan(w: Window): void {
  try {
    const target = w.document;
    const note = target.createElement('div');
    note.className = 'sd-window__orphan';
    note.textContent = 'The presenter console was closed or reloaded. Press “Stage window” in the console to reconnect this screen.';
    target.body.replaceChildren(note);
  } catch {
    /* the window is gone */
  }
}

function watch(w: Window): () => void {
  const sync = mirrorStyles(w.document);
  sync();
  const headObserver = new MutationObserver((records) => {
    // Added and removed sheets show up in the walk; an edited one (a theme's <style>, dev hot reload) is re-copied.
    const changed = new Set<Node>();
    for (const r of records) {
      if (r.target === document.head) continue;
      let node: Node | null = r.target;
      while (node && node.parentNode !== document.head) node = node.parentNode;
      if (node) changed.add(node);
    }
    sync(changed);
  });
  headObserver.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'media', 'rel', 'disabled'] });
  const rootObserver = new MutationObserver(() => copyRootAttributes(w.document));
  rootObserver.observe(document.documentElement, { attributes: true });
  const onUnload = () => orphan(w);
  window.addEventListener('pagehide', onUnload);
  // The stage window itself unloads: closed (dropped at once) or reloaded (rebuilt in its new page).
  const onStageHide = () => {
    setTimeout(check, 50);
    setTimeout(check, 400);
  };
  w.addEventListener('pagehide', onStageHide);
  return () => {
    headObserver.disconnect();
    rootObserver.disconnect();
    window.removeEventListener('pagehide', onUnload);
    try {
      w.removeEventListener('pagehide', onStageHide);
    } catch {
      /* closed or navigated away */
    }
  };
}

/** Builds the stage in the window's current page. False when that page can't be reached (yet). */
function build(w: Window): boolean {
  try {
    const container = prepare(w);
    cleanup?.();
    cleanup = watch(w);
    doc = w.document;
    renavigated = false;
    emit({ container, open: true });
    return true;
  } catch {
    return false;
  }
}

/** Keeps the stage window attached: drops it once closed, and rebuilds the stage after it reloads. */
function check(): void {
  if (!win) return;
  if (win.closed) return closeStageWindow(false);
  let current: Document | null = null;
  try {
    current = win.document;
  } catch {
    /* a page from another origin */
  }
  if (current && current === doc) return;
  if (current && build(win)) return;
  if (state.container) emit({ container: null, open: true });
  if (renavigated) return;
  // Whatever page the window ended up on, a fresh about:blank opened from here is ours to build in.
  renavigated = true;
  try {
    win.location.replace('about:blank');
  } catch {
    /* refused: the next check tries again */
  }
}

/**
 * Opens (or re-attaches to) the stage window. Must run inside a click: browsers block pop-ups that
 * don't come from a user gesture. Returns false when the window was blocked.
 */
export function openStageWindow(code: string, showTitle: string): boolean {
  const name = `dascade-showdown-stage-${code}`;
  let w: Window | null;
  try {
    w = window.open('', name, 'popup=yes,width=1280,height=760');
  } catch {
    w = null;
  }
  if (!w) return false;
  win = w;
  title = `${showTitle} — Stage`;
  doc = null;
  renavigated = false;
  if (!build(w)) check();
  if (poll) clearInterval(poll);
  poll = setInterval(check, 1000);
  try {
    w.focus();
  } catch {
    /* focus may be refused */
  }
  return true;
}

export function closeStageWindow(closeIt = true): void {
  cleanup?.();
  cleanup = null;
  if (poll) clearInterval(poll);
  poll = null;
  if (closeIt && win && !win.closed) {
    try {
      win.close();
    } catch {
      /* already gone */
    }
  }
  win = null;
  doc = null;
  if (state.open) emit({ container: null, open: false });
}

export function useStageWindow(): StageWindowState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
    () => state,
  );
}

/** The Fullscreen API is usable here (not on iPhone Safari, where the button is hidden). */
export function canFullscreen(): boolean {
  return typeof document !== 'undefined' && document.fullscreenEnabled === true;
}

/** Fullscreen for the document an element lives in (works inside the stage window too). */
export function toggleFullscreen(el: HTMLElement): void {
  const doc = el.ownerDocument;
  try {
    const done = doc.fullscreenElement ? doc.exitFullscreen() : doc.documentElement.requestFullscreen();
    // Refused (no user gesture, not allowed): nothing to do, but don't leave a rejection unhandled.
    void done.catch(() => undefined);
  } catch {
    /* fullscreen not available */
  }
}
