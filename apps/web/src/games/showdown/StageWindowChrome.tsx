/**
 * The stage window's chrome (stageWindow.ts): the Full screen button and, when the window opens and
 * isn't full screen yet, a hint that says how to get the browser bar off the Teams share. A popup's
 * address bar can't be hidden; full screen hides it, along with the title bar.
 *
 *  - Out of the show: both show for a few seconds when the window opens and whenever the mouse moves
 *    over it, then hide (hovering the corner or tabbing to the button brings the button back). Going
 *    full screen hides them at once, so the share is clean from the first frame.
 *  - Above every scene: the chrome layer sits over the Cinema layer (cinema.ts), so the button is
 *    there during a cartoon break too.
 *  - The click (or F, handled in stageWindow.ts) happens in the stage window itself: the browser
 *    wants a gesture in the window that goes full screen, and the console's doesn't carry over.
 *  - Operator chrome, not game art: DASCADE's theme tokens. The fade stops with reduced motion or
 *    effects off (showdown.css).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Kbd, PixelIcon } from '@dascade/ui';
import { canFullscreen, toggleFullscreen, useStageFullscreen } from './stageWindow.ts';

/** How long the hint stays up when the window opens (ms). */
export const HINT_MS = 8000;
/** How long the chrome stays up after the mouse last moved over the window (ms). */
export const AWAKE_MS = 3000;

/**
 * When each chrome layer was first drawn: the window opened (or was rebuilt in a reloaded page). A
 * stage that only re-mounts in the same window (the console back after a moment without its room)
 * doesn't bring the opening hint back mid-show.
 */
const openedAt = new WeakMap<HTMLElement, number>();

export function StageWindowChrome({ host }: { host: HTMLElement }) {
  const doc = host.ownerDocument;
  const full = useStageFullscreen();
  const [awake, setAwake] = useState(false);
  const until = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const wake = useCallback((ms: number) => {
    const next = Date.now() + ms;
    // Never cut a longer stay short (a move during the opening hint), and don't reschedule on every pixel.
    if (next <= until.current + 200) return;
    until.current = next;
    setAwake(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAwake(false), ms);
  }, []);

  // Up when the window opens, then whenever the mouse moves over it.
  useEffect(() => {
    if (!openedAt.has(host)) openedAt.set(host, Date.now());
    const left = openedAt.get(host)! + HINT_MS - Date.now();
    if (left > 0) wake(left);
    const onMove = () => wake(AWAKE_MS);
    doc.addEventListener('pointermove', onMove);
    doc.addEventListener('pointerdown', onMove);
    return () => {
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerdown', onMove);
      clearTimeout(timer.current);
      until.current = 0;
    };
  }, [host, doc, wake]);

  // Full screen: out of the picture at once (the next mouse move brings the button back to leave it).
  useEffect(() => {
    if (!full) return;
    clearTimeout(timer.current);
    until.current = 0;
    setAwake(false);
  }, [full]);

  if (!canFullscreen(doc)) return null;
  // The button leaves the page's full screen; the browser's own (F11) is left with F11.
  const leave = Boolean(doc.fullscreenElement);
  return (
    <div
      className="sd-wchrome"
      data-part="showdown-stage-chrome"
      data-awake={awake ? 'true' : undefined}
      data-full={full ? 'true' : undefined}
    >
      {full ? null : (
        <button
          type="button"
          className="sd-wchrome__hint"
          data-part="showdown-fullscreen-hint"
          tabIndex={awake ? 0 : -1}
          aria-hidden={awake ? undefined : true}
          onClick={(e) => toggleFullscreen(e.currentTarget)}
        >
          <PixelIcon name="maximize" size={24} />
          <span className="sd-wchrome__hint-text">
            <b>Click here or press F for full screen</b>
            <span>It hides the browser bar on the share. F11 works too; Esc leaves full screen.</span>
          </span>
        </button>
      )}
      <Button
        size="sm"
        variant="secondary"
        icon="maximize"
        className="sd-wchrome__button sd-fullscreen"
        data-part="showdown-fullscreen"
        title={leave ? 'Leave full screen (Esc or F)' : 'Full screen: hides the browser bar (F)'}
        onClick={(e) => toggleFullscreen(e.currentTarget)}
      >
        {leave ? 'Exit full screen' : 'Full screen'} <Kbd>F</Kbd>
      </Button>
    </div>
  );
}
