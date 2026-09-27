import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PixelIcon } from '@dascade/ui';
import type { ToastKind } from '@dascade/shared';
import { useApp } from '../app/store.ts';

const TOAST_ICON = { success: 'check', error: 'warning', warning: 'warning', info: 'info' } as const satisfies Record<ToastKind, string>;
const TOAST_LABEL: Record<ToastKind, string> = { success: 'Done', error: 'Error', warning: 'Heads up', info: 'Info' };

function isModal(dialog: HTMLDialogElement): boolean {
  try {
    return dialog.matches(':modal');
  } catch {
    return true; // no :modal support: DASCADE only opens dialogs with showModal()
  }
}

/**
 * The modal <dialog> on top, or null. While one is open everything outside it sits under its
 * backdrop and is inert (toasts would be dimmed, undismissable and hidden from screen readers), so
 * the toast stack renders inside it — in the top layer — until it closes.
 */
function useTopModalDialog(): HTMLDialogElement | null {
  const [host, setHost] = useState<HTMLDialogElement | null>(null);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    // Most recently opened last (top-layer order), seeded with whatever is open already (DOM order).
    let stack = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'));
    const update = () => {
      stack = stack.filter((d) => d.open && d.isConnected);
      const top = [...stack].reverse().find(isModal) ?? null;
      setHost((prev) => (prev === top ? prev : top));
    };
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (!(r.target instanceof HTMLDialogElement)) continue;
        stack = stack.filter((d) => d !== r.target);
        if (r.target.open) stack.push(r.target);
      }
      update();
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['open'], subtree: true });
    update();
    return () => observer.disconnect();
  }, []);
  return host;
}

/** Global toast stack (kept dependency-light so the landing page doesn't pull in networking). */
export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  const dialog = useTopModalDialog();
  const stack = (
    <div className="dc-toasts" data-part="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="dc-toast" data-part="toast" data-kind={t.kind}>
          <PixelIcon className="dc-toast__icon" name={TOAST_ICON[t.kind] ?? 'info'} />
          <span className="visually-hidden">{TOAST_LABEL[t.kind] ?? 'Info'}: </span>
          <span className="dc-toast__text">{t.text}</span>
          <button type="button" className="dc-toast__close" aria-label="Dismiss notification" title="Dismiss" onClick={() => dismiss(t.id)}>
            <PixelIcon name="close" />
          </button>
        </div>
      ))}
    </div>
  );
  return dialog ? createPortal(stack, dialog) : stack;
}
