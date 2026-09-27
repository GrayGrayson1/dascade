import { PixelIcon } from '@dascade/ui';
import type { ToastKind } from '@dascade/shared';
import { useApp } from '../app/store.ts';

const TOAST_ICON = { success: 'check', error: 'warning', warning: 'warning', info: 'info' } as const satisfies Record<ToastKind, string>;
const TOAST_LABEL: Record<ToastKind, string> = { success: 'Done', error: 'Error', warning: 'Heads up', info: 'Info' };

/** Global toast stack (kept dependency-light so the landing page doesn't pull in networking). */
export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
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
}
