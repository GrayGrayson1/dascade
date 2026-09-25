import { PixelIcon } from '@dascade/ui';
import { useApp } from '../app/store.ts';

/** Global toast stack (kept dependency-light so the landing page doesn't pull in networking). */
export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="dc-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="dc-toast" data-kind={t.kind} onClick={() => dismiss(t.id)}>
          <PixelIcon
            className="dc-toast__icon"
            name={t.kind === 'success' ? 'check' : t.kind === 'error' ? 'warning' : t.kind === 'warning' ? 'warning' : 'info'}
          />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
