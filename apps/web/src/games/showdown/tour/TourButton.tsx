/**
 * "Watch the presenter tour": opens the Presenter Tour in a large dialog (the lobby's setup card,
 * the showcase console's top bar). The tour runs on its own demo stage, so opening it in the middle
 * of a live show never touches the show; the console's shortcut keys rest while the dialog is open.
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Button, Spinner } from '@dascade/ui';
import type { ShowdownLook } from '@dascade/shared/games/showdown';

const TourPlayer = lazy(() => import('./TourPlayer.tsx').then((m) => ({ default: m.TourPlayer })));

export function TourButton({
  look,
  label = 'Watch the presenter tour',
  size = 'md',
  compact = false,
}: {
  look: ShowdownLook;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size={size}
        variant="ghost"
        icon="help"
        onClick={() => setOpen(true)}
        data-part="showdown-tour-open"
        title="An animated walk through running the show (practice boards — nothing touches your show)"
        aria-label={compact ? label : undefined}
      >
        {compact ? <span className="sdc-lbl">Tour</span> : label}
      </Button>
      {open ? <TourDialog look={look} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function TourDialog({ look, onClose }: { look: ShowdownLook; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="tour-dialogbox"
      aria-label="Presenter tour"
      data-part="showdown-tour-dialog"
      onCancel={(e) => {
        e.preventDefault();
        close.current();
      }}
    >
      <Suspense
        fallback={
          <div className="tour-dialogbox__loading">
            <Spinner label="Loading the tour" />
          </div>
        }
      >
        <TourPlayer look={look} onClose={() => close.current()} />
      </Suspense>
    </dialog>
  );
}
