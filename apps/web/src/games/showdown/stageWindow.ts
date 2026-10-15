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
let state: StageWindowState = { container: null, open: false };
const listeners = new Set<() => void>();
let cleanup: (() => void) | null = null;
let poll: ReturnType<typeof setInterval> | null = null;

function emit(next: StageWindowState): void {
  state = next;
  for (const l of [...listeners]) l();
}

const COPY_ATTR = 'data-sd-copy';

function copyRootAttributes(doc: Document): void {
  const src = document.documentElement;
  const dst = doc.documentElement;
  for (const attr of [...dst.attributes]) if (!src.hasAttribute(attr.name)) dst.removeAttribute(attr.name);
  for (const attr of [...src.attributes]) dst.setAttribute(attr.name, attr.value);
}

function copyStyles(doc: Document): void {
  for (const old of [...doc.head.querySelectorAll(`[${COPY_ATTR}]`)]) old.remove();
  for (const node of document.head.querySelectorAll('link[rel="stylesheet"], style')) appendStyle(doc, node);
}

function appendStyle(doc: Document, node: Node): void {
  if (!(node instanceof HTMLElement)) return;
  if (!(node.tagName === 'STYLE' || (node.tagName === 'LINK' && (node as HTMLLinkElement).rel === 'stylesheet'))) return;
  const copy = doc.importNode(node, true) as HTMLElement;
  copy.setAttribute(COPY_ATTR, '');
  doc.head.appendChild(copy);
}

function prepare(w: Window, title: string): HTMLElement {
  const doc = w.document;
  doc.title = title;
  if (!doc.head.querySelector('base')) {
    const base = doc.createElement('base');
    base.href = `${location.origin}/`;
    doc.head.prepend(base);
  }
  if (!doc.head.querySelector('meta[name="viewport"]')) {
    const meta = doc.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width, initial-scale=1';
    doc.head.appendChild(meta);
  }
  copyRootAttributes(doc);
  copyStyles(doc);
  doc.body.replaceChildren();
  doc.body.className = 'sd-window';
  const root = doc.createElement('div');
  root.className = 'sd-window__root';
  doc.body.appendChild(root);
  return root;
}

/** A notice left in the stage window when the console page goes away (reload, navigation). */
function orphan(w: Window): void {
  try {
    const doc = w.document;
    const note = doc.createElement('div');
    note.className = 'sd-window__orphan';
    note.textContent = 'The presenter console was closed or reloaded. Press “Stage window” in the console to reconnect this screen.';
    doc.body.replaceChildren(note);
  } catch {
    /* the window is gone */
  }
}

function watch(w: Window): () => void {
  const headObserver = new MutationObserver((records) => {
    // Removed sheets (a theme's skin when switching) or edited ones (dev hot reload): resync the set.
    if (records.some((r) => r.type === 'characterData' || r.removedNodes.length > 0 || r.target !== document.head)) {
      copyStyles(w.document);
      return;
    }
    for (const r of records) for (const node of r.addedNodes) appendStyle(w.document, node);
  });
  headObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
  const rootObserver = new MutationObserver(() => copyRootAttributes(w.document));
  rootObserver.observe(document.documentElement, { attributes: true });
  const onUnload = () => orphan(w);
  window.addEventListener('pagehide', onUnload);
  return () => {
    headObserver.disconnect();
    rootObserver.disconnect();
    window.removeEventListener('pagehide', onUnload);
  };
}

/**
 * Opens (or re-attaches to) the stage window. Must run inside a click: browsers block pop-ups that
 * don't come from a user gesture. Returns false when the window was blocked.
 */
export function openStageWindow(code: string, title: string): boolean {
  const name = `dascade-showdown-stage-${code}`;
  let w: Window | null;
  try {
    w = window.open('', name, 'popup=yes,width=1280,height=760');
  } catch {
    w = null;
  }
  if (!w) return false;
  cleanup?.();
  win = w;
  const container = prepare(w, `${title} — Stage`);
  cleanup = watch(w);
  if (poll) clearInterval(poll);
  poll = setInterval(() => {
    if (!win || win.closed) closeStageWindow(false);
  }, 1000);
  w.addEventListener('pagehide', () => setTimeout(() => (win?.closed ? closeStageWindow(false) : undefined), 50));
  emit({ container, open: true });
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
