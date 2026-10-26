/**
 * When the console's single-key shortcuts (K / D / A here) must stay quiet (pure, unit-tested):
 * a modifier or auto-repeat, typing in a field, or any dialog — a native `<dialog open>`, or an ARIA
 * dialog such as the jukebox player (`role="dialog" aria-modal="true"`) — over the console.
 */

/** The parts of an element the guard reads (a DOM Element satisfies it). */
export interface GuardElement {
  closest(selector: string): unknown;
  isContentEditable?: boolean;
  getClientRects?(): { length: number };
}

/** The parts of a keyboard event the guard reads. */
export interface GuardEvent {
  defaultPrevented: boolean;
  repeat: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  target: unknown;
}

/** The parts of a document the guard reads. */
export interface GuardDocument {
  querySelector(selector: string): unknown;
  querySelectorAll(selector: string): ArrayLike<unknown>;
}

const TYPING = 'input, textarea, select, [contenteditable]';
const DIALOG = 'dialog[open], [role="dialog"], [role="alertdialog"]';

const isElement = (x: unknown): x is GuardElement => Boolean(x) && typeof (x as GuardElement).closest === 'function';

/** Rendered (an element with no boxes — display:none, detached — doesn't block anything). */
function visible(el: unknown): boolean {
  const rects = (el as GuardElement | null)?.getClientRects?.();
  return rects ? rects.length > 0 : true;
}

export function shortcutBlockedBy(e: GuardEvent, doc: GuardDocument | null): boolean {
  if (e.defaultPrevented || e.repeat || e.altKey || e.metaKey || e.ctrlKey) return true;
  const t = e.target;
  if (isElement(t) && (t.closest(TYPING) || t.isContentEditable || t.closest(DIALOG))) return true;
  if (!doc) return false;
  if (doc.querySelector('dialog[open]')) return true;
  // A modal ARIA dialog anywhere on screen (the jukebox player, a confirm) owns the keyboard.
  return Array.from(doc.querySelectorAll('[aria-modal="true"]')).some(visible);
}
