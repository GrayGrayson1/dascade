/**
 * The undo toast (PRS-03 D): after a reversible action that hides or rewinds the board (Next or Skip
 * with answers still hidden, Restart round, Restart show) the console acts at once and offers an
 * Undo for at least 10 seconds (12 here, paused while you point at it or tab into it).
 *
 * The toast's Undo sends the room's existing `undo` act against the current board revision, and only
 * while the server still holds that very step: if anything else changed the board since (another
 * reveal, a Next, an Undo pressed elsewhere), the offer disappears instead of undoing the wrong thing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Kbd, PixelIcon } from '@dascade/ui';
import { UNDO_PENDING_MS, UNDO_TOAST_MS, undoOfferStatus, type UndoOffer } from './consoleSafety.ts';

export interface UndoToastApi {
  offer: UndoOffer | null;
  /** Offers an undo for the command just sent against `fromRev`. */
  open: (label: string, detail: string, fromRev: number) => void;
  dismiss: () => void;
}

/** Tracks the latest undo offer against the board (revision + undo steps on the server). */
export function useUndoOffer(rev: number, undoSteps: number): UndoToastApi {
  const [offer, setOffer] = useState<UndoOffer | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!offer) return;
    const status = undoOfferStatus(offer, rev, undoSteps);
    if (status === 'landed') setOffer({ ...offer, atRev: rev });
    else if (status === 'stale') setOffer(null);
  }, [offer, rev, undoSteps]);

  // A command that never landed (refused, or the connection dropped) takes its offer with it.
  const pending = offer !== null && offer.atRev === null;
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setOffer((o) => (o && o.atRev === null ? null : o)), UNDO_PENDING_MS);
    return () => clearTimeout(t);
  }, [pending]);

  const open = useCallback((label: string, detail: string, fromRev: number) => {
    setOffer({ id: ++seq.current, label, detail, fromRev, atRev: null });
  }, []);
  const dismiss = useCallback(() => setOffer(null), []);
  return useMemo(() => ({ offer, open, dismiss }), [offer, open, dismiss]);
}

/**
 * The toast itself. It counts down from 12 s once the action has landed; pointing at it or focusing
 * it pauses the countdown (time to read and decide).
 */
export function UndoToast({ api, onUndo }: { api: UndoToastApi; onUndo: () => void }) {
  const { offer, dismiss } = api;
  const ready = offer !== null && offer.atRev !== null;
  const [left, setLeft] = useState(UNDO_TOAST_MS);
  const [paused, setPaused] = useState(false);
  const id = offer?.id ?? 0;

  useEffect(() => {
    setLeft(UNDO_TOAST_MS);
  }, [id]);

  useEffect(() => {
    if (!ready || paused) return;
    let last = Date.now();
    const t = setInterval(() => {
      const now = Date.now();
      const dt = now - last;
      last = now;
      setLeft((l) => l - dt);
    }, 250);
    return () => clearInterval(t);
  }, [ready, paused, id]);

  useEffect(() => {
    if (ready && left <= 0) dismiss();
  }, [ready, left, dismiss]);

  if (!offer || !ready) return null;
  const seconds = Math.max(1, Math.ceil(left / 1000));
  return (
    <div
      className="sdc-undotoast"
      role="status"
      data-part="showdown-undo-toast"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <PixelIcon name="refresh" className="sdc-undotoast__icon" aria-hidden />
      <span className="sdc-undotoast__text">
        <b>{offer.label}</b>
        {offer.detail ? <span>{offer.detail}</span> : null}
      </span>
      <Button
        size="sm"
        variant="primary"
        icon="refresh"
        className="sdc-undotoast__undo"
        aria-label={`Undo: ${offer.label}`}
        onClick={() => {
          dismiss();
          onUndo();
        }}
      >
        Undo{' '}
        <span className="sdc-undotoast__left dc-num" aria-hidden>
          {paused ? '' : `${seconds} s`}
        </span>
        <Kbd>U</Kbd>
      </Button>
      <button type="button" className="sdc-undotoast__close" aria-label="Dismiss" onClick={dismiss}>
        <PixelIcon name="close" />
      </button>
      <i className="sdc-undotoast__bar" style={{ transform: `scaleX(${Math.max(0, left / UNDO_TOAST_MS)})` }} aria-hidden />
    </div>
  );
}
