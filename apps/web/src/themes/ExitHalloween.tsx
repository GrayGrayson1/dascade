/**
 * "Exit Halloween": a clearly labelled way back while Halloween Night is the chosen theme (however it
 * was switched on). Goes back to the remembered previous theme (Delta Neon when there's none), after a
 * light confirmation so a stray tap doesn't drop the costume party.
 *
 *   variant 'hud'   — a pumpkin button next to the floor HUD's theme button (wide screens only: the
 *                     smaller HUDs are full; there the theme button opens the sheet that has 'panel')
 *   variant 'panel' — a row in Settings → Display and at the top of the Themes sheet
 */
import { useEffect, useId, useRef, useState } from 'react';
import { Button, cx, getTheme, hasTheme } from '@dascade/ui';
import { useApp } from '../app/store.ts';
import { sfx } from '../audio/audio.ts';
import { HALLOWEEN_THEME_ID, restoreTarget } from './seasonal.ts';
import { seasonal } from './seasonalController.ts';
import './seasonal.css';

// prettier-ignore
const PUMPKIN =
  'M6 0h2v1H6zM5 1h2v1H5zM2 2h8v1H2zM1 3h10v1H1zM0 4h12v1H0zM0 5h2v1H0zM4 5h4v1H4zM10 5h2v1h-2zM0 6h3v1H0zM4 6h4v1H4zM9 6h3v1H9z' +
  'M0 7h12v1H0zM0 8h2v1H0zM3 8h6v1H3zM10 8h2v1h-2zM0 9h3v1H0zM9 9h3v1H9zM1 10h10v1H1zM2 11h8v1H2z';

/** A carved pixel pumpkin (decorative; currentColor). */
export function PumpkinGlyph({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <svg
      className={cx('ssn-pumpkin', className)}
      viewBox="0 0 12 12"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      shapeRendering="crispEdges"
    >
      <path d={PUMPKIN} fill="currentColor" />
    </svg>
  );
}

/** Name of the theme "Exit Halloween" goes back to (re-renders when the record changes). */
function useExitTargetName(): string {
  const target = useApp((s) => restoreTarget(s.settings.seasonal, hasTheme));
  return getTheme(target).name;
}

export function ExitHalloweenButton({ variant }: { variant: 'hud' | 'panel' }) {
  // The saved choice (not the applied theme), so an orphaned id can still be exited.
  const on = useApp((s) => s.settings.theme === HALLOWEEN_THEME_ID);
  if (!on) return null;
  return variant === 'hud' ? <HudExit /> : <PanelExit />;
}

function HudExit() {
  const name = useExitTargetName();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const exitRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    exitRef.current?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const exit = async () => {
    if (busy) return;
    setBusy(true);
    sfx('select');
    try {
      await seasonal.exit();
    } finally {
      setBusy(false);
    }
    // This button is gone with Halloween: hand focus to the theme button beside it.
    document.querySelector<HTMLElement>('.af-hud [data-part="theme-button"]')?.focus();
  };

  return (
    <span
      ref={rootRef}
      className="ssn-exit ssn-exit--hud"
      data-part="exit-halloween"
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return;
        e.stopPropagation();
        close();
      }}
      onBlur={(e) => {
        if (open && !rootRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="dc-btn dc-btn--ghost dc-btn--icon ssn-exit__trigger"
        aria-label="Exit Halloween"
        title="Exit Halloween"
        aria-expanded={open}
        aria-controls={open ? `${id}-confirm` : undefined}
        onClick={() => {
          sfx('click');
          setOpen((o) => !o);
        }}
      >
        <PumpkinGlyph />
      </button>
      {open ? (
        <div id={`${id}-confirm`} className="ssn-exit__confirm" role="group" aria-labelledby={`${id}-q`}>
          <p id={`${id}-q`} className="ssn-exit__question">
            Back to {name}?
          </p>
          <div className="ssn-exit__actions">
            <Button ref={exitRef} variant="primary" loading={busy} onClick={() => void exit()}>
              Exit
            </Button>
            <Button variant="ghost" onClick={close}>
              Stay spooky
            </Button>
          </div>
        </div>
      ) : null}
    </span>
  );
}

function PanelExit() {
  const name = useExitTargetName();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const exitRef = useRef<HTMLButtonElement>(null);
  /** Where focus goes after the row swaps: the confirm's Exit, or back to "Exit Halloween". */
  const focusNext = useRef<'exit' | 'start' | null>(null);
  const id = useId();

  useEffect(() => {
    const target = focusNext.current === 'exit' ? exitRef.current : focusNext.current === 'start' ? startRef.current : null;
    focusNext.current = null;
    target?.focus();
  }, [confirming]);

  const exit = async () => {
    if (busy) return;
    setBusy(true);
    const dialog = rootRef.current?.closest('dialog') ?? null;
    sfx('select');
    try {
      await seasonal.exit();
    } finally {
      setBusy(false);
    }
    // This row is gone with Halloween: focus the newly selected theme in the picker below it (its option,
    // not the first checked radio — Visual effects' segments are radios too), once more after a frame
    // in case the picker was still catching up.
    const picked = () => dialog?.querySelector<HTMLElement>('[data-theme-option][aria-checked="true"]');
    picked()?.focus();
    requestAnimationFrame(() => {
      if (!dialog?.contains(document.activeElement)) picked()?.focus();
    });
  };

  return (
    <div ref={rootRef} className="dc-field ssn-exit ssn-exit--panel" data-part="exit-halloween">
      <span className="dc-field__label">Halloween</span>
      {confirming ? (
        <div className="ssn-exit__row" role="group" aria-labelledby={`${id}-q`}>
          <span id={`${id}-q`} className="ssn-exit__question">
            Back to {name}?
          </span>
          <span className="ssn-exit__actions">
            <Button ref={exitRef} variant="primary" loading={busy} onClick={() => void exit()}>
              Exit
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                focusNext.current = 'start';
                setConfirming(false);
              }}
            >
              Stay spooky
            </Button>
          </span>
        </div>
      ) : (
        <div className="ssn-exit__row">
          <span className="ssn-exit__note">Halloween Night is on.</span>
          <Button
            ref={startRef}
            className="ssn-exit__start"
            onClick={() => {
              sfx('click');
              focusNext.current = 'exit';
              setConfirming(true);
            }}
          >
            <PumpkinGlyph size={16} />
            Exit Halloween
          </Button>
        </div>
      )}
    </div>
  );
}
