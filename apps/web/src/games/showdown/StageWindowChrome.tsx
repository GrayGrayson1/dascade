/**
 * The stage window's chrome (stageWindow.ts): the Full screen button. A popup's address bar can't be
 * hidden; full screen hides it, along with the title bar.
 *
 *  - Out of the show: nothing pops up over the shared screen, not when the window opens and not when
 *    the mouse moves over it. The button stays invisible until you hover its corner or tab to it; F
 *    (stageWindow.ts) works without it, and the console's Stage window button says to press F.
 *  - Above every scene: the chrome layer sits over the Cinema layer (cinema.ts), so the button is
 *    there during a cartoon break too.
 *  - The click (or F, handled in stageWindow.ts) happens in the stage window itself: the browser
 *    wants a gesture in the window that goes full screen, and the console's doesn't carry over.
 *  - Operator chrome, not game art: DASCADE's theme tokens. The fade stops with reduced motion or
 *    effects off (showdown.css).
 */
import { Button, Kbd } from '@dascade/ui';
import { canFullscreen, toggleFullscreen, useStageFullscreen } from './stageWindow.ts';

export function StageWindowChrome({ host }: { host: HTMLElement }) {
  const doc = host.ownerDocument;
  const full = useStageFullscreen();

  if (!canFullscreen(doc)) return null;
  // The button leaves the page's full screen; the browser's own (F11) is left with F11.
  const leave = Boolean(doc.fullscreenElement);
  return (
    <div className="sd-wchrome" data-part="showdown-stage-chrome" data-full={full ? 'true' : undefined}>
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
