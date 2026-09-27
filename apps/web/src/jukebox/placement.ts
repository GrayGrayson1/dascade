/**
 * Where the collapsed jukebox lives.
 *
 * 1. SLOT — a shell toolbar hosts it, so it can never cover anything:
 *      [data-jukebox-slot]           explicit host (any page may add one)
 *      .topbar__right                room top bar (inserted just before the Mute button)
 *      .shell-menu__actions          immersive games: an entry inside the floating shell menu
 * 2. FLOAT — pages without a shell toolbar (arcade floor, cabinet picker, title screen, tournaments):
 *    try a few corner/edge candidates and take the first whose box overlaps no visible content
 *    (controls, text, boards, canvases). Evaluated on navigation/resize only — never while scrolling —
 *    so it doesn't jump around.
 *
 * The geometry is pure (unit-tested in placement.test.ts); the DOM scan is a thin wrapper.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** mini = title + play/pause + next + open · pill = open + play/pause · tab = open only. */
export type FloatKind = 'mini' | 'pill' | 'tab';
export type Corner = 'bl' | 'br' | 'tl' | 'tr' | 'l' | 'r';

export interface FloatCandidate {
  kind: FloatKind;
  corner: Corner;
  box: Box;
}

export interface Viewport {
  w: number;
  h: number;
  /** Safe-area insets (px). */
  safe?: { top: number; right: number; bottom: number; left: number };
}

export const MINI_H = 44;
export const MINI_W = 264;
export const TAB = 44;
export const PILL_W = 92;
const GAP = 12;

export function intersects(a: Box, b: Box, pad = 0): boolean {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
}

/** Candidate boxes in preference order. The rich mini only where there's width for it. */
export function floatCandidates(vp: Viewport, wantMini: boolean): FloatCandidate[] {
  const s = vp.safe ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const left = GAP + s.left;
  const right = vp.w - GAP - s.right;
  const bottom = vp.h - GAP - s.bottom;
  const out: FloatCandidate[] = [];
  const miniW = Math.min(MINI_W, vp.w - 2 * GAP);
  if (wantMini && vp.w >= 700 && vp.h >= 480) {
    out.push({ kind: 'mini', corner: 'bl', box: { x: left, y: bottom - MINI_H, w: miniW, h: MINI_H } });
    out.push({ kind: 'mini', corner: 'br', box: { x: right - miniW, y: bottom - MINI_H, w: miniW, h: MINI_H } });
  }
  if (wantMini) {
    out.push({ kind: 'pill', corner: 'bl', box: { x: left, y: bottom - TAB, w: PILL_W, h: TAB } });
    out.push({ kind: 'pill', corner: 'br', box: { x: right - PILL_W, y: bottom - TAB, w: PILL_W, h: TAB } });
  }
  out.push({ kind: 'tab', corner: 'bl', box: { x: left, y: bottom - TAB, w: TAB, h: TAB } });
  out.push({ kind: 'tab', corner: 'br', box: { x: right - TAB, y: bottom - TAB, w: TAB, h: TAB } });
  // Screen edges, a few heights (preferring the lower-middle: below headers and board centres, above docks).
  for (const f of [0.62, 0.5, 0.74, 0.4, 0.84, 0.3]) {
    const y = Math.round(vp.h * f - TAB / 2);
    out.push({ kind: 'tab', corner: 'l', box: { x: s.left, y, w: TAB, h: TAB } });
    out.push({ kind: 'tab', corner: 'r', box: { x: vp.w - s.right - TAB, y, w: TAB, h: TAB } });
  }
  return out;
}

/** Overlap area of two boxes (0 when apart). */
export function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * First candidate that overlaps none of the obstacles (with `pad` breathing room). When nothing is
 * free, the TAB that hides the smallest share of anything: nicking 4 % of a big cabinet beats
 * covering half of a button (score = Σ covered fraction of each obstacle).
 */
export function choosePlacement(
  candidates: readonly FloatCandidate[],
  obstacles: readonly Box[],
  pad = 6,
): { candidate: FloatCandidate; clear: boolean } {
  for (const c of candidates) {
    if (!obstacles.some((o) => intersects(c.box, o, pad))) return { candidate: c, clear: true };
  }
  let best: FloatCandidate | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    if (c.kind !== 'tab') continue;
    const score = obstacles.reduce((sum, o) => sum + overlapArea(c.box, o) / Math.max(1, o.w * o.h), 0);
    if (score < bestScore - 1e-9) {
      best = c;
      bestScore = score;
    }
  }
  return { candidate: best ?? candidates[candidates.length - 1]!, clear: false };
}

// ---------------------------------------------------------------------------
// DOM side
// ---------------------------------------------------------------------------

/** Selector for anything that can host (or hide) the dock — watched by a MutationObserver. */
export const SLOT_WATCH_SELECTOR = '[data-jukebox-slot], .topbar__right, .shell-menu, .shell-menu__actions, .room[data-immersive="true"]';

/** Things a floating button must never sit on. */
const CONTENT_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  'summary',
  'label',
  '[role="button"]',
  '[role="tab"]',
  '[role="slider"]',
  '[role="link"]',
  '[tabindex]:not([tabindex="-1"])',
  'canvas',
  'img',
  'video',
  'svg',
  'h1',
  'h2',
  'h3',
  'h4',
  'p',
  'li',
  'kbd',
  '.dc-badge',
].join(',');

/** Containers that read as a block (plaques, cards, panels): obstacles only while they're not page-sized. */
const BLOCK_SELECTOR = '[data-part], .dc-panel, .dc-card, section, aside, nav, header, footer, form, table, dialog[open]';

/** Generic elements that may carry loose text. */
const TEXT_SELECTOR = 'span, div, small, strong, em, b, i, td, th, dd, dt, figcaption, time, output, blockquote';

function isDecorative(el: Element): boolean {
  if (el.closest('[aria-hidden="true"], [data-jukebox], .dc-toasts, [inert]')) return true;
  return false;
}

/** Visible content boxes in the viewport that could collide with a candidate. */
export function scanObstacles(root: ParentNode, vp: Viewport, near: readonly Box[]): Box[] {
  const out: Box[] = [];
  const area = vp.w * vp.h;
  collect(root.querySelectorAll(CONTENT_SELECTOR), 0.7, false);
  collect(root.querySelectorAll(BLOCK_SELECTOR), 0.35, true);
  collectText(root.querySelectorAll(TEXT_SELECTOR));
  return out;

  /** Loose text in generic elements (footnotes, labels in spans/divs): the text's own line boxes. */
  function collectText(nodes: NodeListOf<Element>): void {
    const range = typeof document !== 'undefined' ? document.createRange() : null;
    if (!range) return;
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const box = { x: r.left, y: r.top, w: r.width, h: r.height };
      if (!near.some((n) => intersects(n, box, 8))) continue;
      if (isDecorative(el)) continue;
      for (const child of el.childNodes) {
        if (child.nodeType !== 3 || !child.textContent?.trim()) continue;
        range.selectNodeContents(child);
        for (const tr of range.getClientRects()) {
          const tb = { x: tr.left, y: tr.top, w: tr.width, h: tr.height };
          if (tb.w < 1 || !near.some((n) => intersects(n, tb, 8))) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) break;
          out.push(tb);
        }
      }
    }
  }

  function collect(nodes: NodeListOf<Element>, maxShare: number, mustPaint: boolean): void {
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.bottom <= 0 || r.right <= 0 || r.top >= vp.h || r.left >= vp.w) continue;
      const box = { x: r.left, y: r.top, w: r.width, h: r.height };
      // Only look closer at elements near a candidate (cheap geometric pre-filter first).
      if (!near.some((n) => intersects(n, box, 8))) continue;
      // Full-viewport layers (ambient environments, attract backdrops, page frames) aren't content.
      if (box.w * box.h > area * maxShare) continue;
      if (isDecorative(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || Number(cs.opacity) < 0.05) continue;
      // A layout-only wrapper (full-width footer strip, grid row) isn't a surface — only its content is.
      if (mustPaint && (box.w >= vp.w * 0.9 || !paints(cs))) continue;
      out.push(box);
    }
  }
}

function paints(cs: CSSStyleDeclaration): boolean {
  if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
  const bg = cs.backgroundColor;
  if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) return true;
  return ['top', 'right', 'bottom', 'left'].some(
    (side) => parseFloat(cs.getPropertyValue(`border-${side}-width`)) > 0 && cs.getPropertyValue(`border-${side}-style`) !== 'none',
  );
}

export function readSafeArea(): Required<Viewport>['safe'] {
  const cs = getComputedStyle(document.documentElement);
  const px = (name: string) => {
    const n = parseFloat(cs.getPropertyValue(name));
    return Number.isFinite(n) ? n : 0;
  };
  // --safe-* tokens are env() expressions; the resolved value of a custom property keeps the text, so
  // fall back to 0 when it can't be parsed (the gap already keeps us off the notch in practice).
  return { top: px('--safe-top'), right: px('--safe-right'), bottom: px('--safe-bottom'), left: px('--safe-left') };
}

export type DockSlot = { kind: 'slot' | 'topbar' | 'menu'; host: HTMLElement } | { kind: 'hidden'; host: null };

/** Finds (or creates) the toolbar host for the dock; `hidden` = stay out of the way; null = float. */
export function findSlotHost(doc: Document, current: HTMLElement | null): DockSlot | null {
  const explicit = doc.querySelector<HTMLElement>('[data-jukebox-slot]');
  if (explicit) return { kind: 'slot', host: explicit };
  const topbar = doc.querySelector<HTMLElement>('.topbar__right');
  if (topbar) return { kind: 'topbar', host: ensureHost(topbar, current, topbarAnchor(topbar)) };
  const menu = doc.querySelector<HTMLElement>('.shell-menu__actions');
  if (menu) return { kind: 'menu', host: ensureHost(menu, current, menu.querySelector('.shell-menu__leave')) };
  // Immersive game with its menu closed: the game owns every pixel — no floating button at all.
  if (doc.querySelector('.shell-menu, .room[data-immersive="true"]')) return { kind: 'hidden', host: null };
  return null;
}

function topbarAnchor(bar: HTMLElement): Element | null {
  return bar.querySelector('button[aria-label="Mute"], button[aria-label="Unmute"]') ?? bar.querySelector('button[aria-label="Settings"]');
}

/** Our own <span> inside a foreign toolbar (React never touches nodes it didn't create). */
function ensureHost(parent: HTMLElement, current: HTMLElement | null, before: Element | null): HTMLElement {
  if (current && current.parentElement === parent) return current;
  const host = doc0(parent).createElement('span');
  host.className = 'jb-host';
  host.setAttribute('data-jukebox-host', '');
  parent.insertBefore(host, before && before.parentElement === parent ? before : null);
  return host;
}

function doc0(el: Element): Document {
  return el.ownerDocument;
}
