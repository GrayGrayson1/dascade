/**
 * The in-race menu (Esc / gamepad Start / the HUD pause button). In a solo race it pauses the race
 * (`kart:pause`); in a multiplayer race it says so plainly — the race continues underneath.
 *
 * A real modal dialog: focus moves to Resume when it opens, Tab stays inside it, Esc resumes, and
 * focus returns to where it was when it closes.
 */
import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { Button, PixelIcon } from '@dascade/ui';
import { useApp } from '../../../app/store.ts';
import { LeaveButton } from '../../../shell/common.tsx';
import type { KartController } from '../race/controller.ts';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function PauseMenu({ ctrl }: { ctrl: KartController }) {
  const ui = useSyncExternalStore(ctrl.subscribeUi, ctrl.getUi, ctrl.getUi);
  const openModal = useApp((s) => s.openModal);
  const ref = useRef<HTMLDivElement>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const open = ui.menuOpen;

  useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    resumeRef.current?.focus();
    // Keep keyboard focus inside the menu (unless a shell modal — settings, help — is on top of it).
    const onFocusIn = (e: FocusEvent) => {
      const el = ref.current;
      if (!el || !(e.target instanceof Node) || el.contains(e.target)) return;
      if (document.querySelector('dialog[open]')) return;
      resumeRef.current?.focus();
    };
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      if (returnTo && returnTo.isConnected && returnTo !== document.body) returnTo.focus();
      else (document.activeElement as HTMLElement | null)?.blur?.();
    };
  }, [open]);

  if (!open) return null;

  const paused = ui.paused;
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    if (e.key === 'Escape') {
      // Let an open "Leave room?" confirm take its own Esc.
      if (el.querySelector('[aria-label="Confirm leave"]')) return;
      e.stopPropagation();
      e.preventDefault();
      ctrl.closeMenu();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="kp-pause" data-part="pause-menu" onKeyDown={onKeyDown}>
      <div className="kp-pause__card" ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <span className="kp-pause__kicker">{ui.canPause ? (paused ? 'Race paused' : 'Pausing…') : 'Menu'}</span>
        <h2 id={titleId} className="kp-pause__title">
          {ui.canPause ? 'Paused' : 'Race menu'}
        </h2>
        {!ui.canPause ? (
          <p className="kp-pause__note">
            <PixelIcon name="clock" /> The race continues while this is open.
          </p>
        ) : null}
        <div className="kp-pause__actions">
          <Button ref={resumeRef} variant="primary" size="lg" icon="play" onClick={() => ctrl.closeMenu()}>
            {ui.canPause ? 'Resume' : 'Back to the race'}
          </Button>
          <Button variant="secondary" icon="gear" onClick={() => openModal('settings')}>
            Settings
          </Button>
          <Button variant="secondary" icon="help" onClick={() => openModal('help', 'kart')}>
            How to play
          </Button>
          <LeaveButton size="md" className="kp-pause__leave" />
        </div>
        <p className="kp-pause__hint">
          <kbd>Esc</kbd> to {ui.canPause ? 'resume' : 'close'}
        </p>
      </div>
    </div>
  );
}
