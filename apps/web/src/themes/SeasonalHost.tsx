/**
 * SeasonalHost — mounted once at the App root (after the routes, so it comes after the floor in the
 * tab order). Two jobs (logic in seasonal.ts):
 *
 *   - the season's end: an invite-activated Halloween Night goes back to the previous theme once
 *     October is over (checked when settings are ready and whenever the tab comes back; never mid-match);
 *   - October's invite on the arcade floor: a small card (not a dialog, no autofocus) that waits until
 *     nothing else is open — modals, the claw close-up, the expanded jukebox, the theme picker, a theme
 *     transition — and appears a moment after the floor settles.
 *
 * An always-present, visually hidden status line announces the invite once and exposes its state
 * (`data-state`) so tests can wait for it deterministically.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Button, getTheme, hasTheme } from '@dascade/ui';
import { useApp } from '../app/store.ts';
import { useClaw } from '../arcade/clawInventory.ts';
import { sfx } from '../audio/audio.ts';
import { useJukebox } from '../audio/jukebox/store.ts';
import { useTopModalDialog } from '../shell/Toasts.tsx';
import { useThemeTransition } from './controller.ts';
import { PumpkinGlyph } from './ExitHalloween.tsx';
import { useThemePlace } from './place.ts';
import { useThemePickerOpen } from './pickerStore.ts';
import { HALLOWEEN_THEME_ID, shouldInvite } from './seasonal.ts';
import { seasonNow, seasonal } from './seasonalController.ts';
import './seasonal.css';

/** The invite appears this long after the floor becomes eligible (and nothing else is open). */
const SHOW_DELAY_MS = 1200;

type InviteState = 'off' | 'idle' | 'ineligible' | 'waiting' | 'blocked' | 'shown';

const ANNOUNCEMENT = 'Halloween is here: you’re invited to try the Halloween Night theme.';

/** Bottom of the floor HUD (px), so the card sits just under it whatever height a skin gives it. */
function useHeaderBottom(active: boolean): number | null {
  const [bottom, setBottom] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!active) return;
    const header = document.querySelector<HTMLElement>('[data-part="arcade-header"]');
    if (!header) return;
    const measure = () => setBottom(Math.max(0, Math.round(header.getBoundingClientRect().bottom)));
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(header);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [active]);
  return bottom;
}

export function SeasonalHost() {
  const ready = useApp((s) => s.settingsReady);
  const theme = useApp((s) => s.settings.theme);
  const prefs = useApp((s) => s.settings.seasonal);
  const modal = useApp((s) => s.modal);
  const place = useThemePlace();
  const pickerOpen = useThemePickerOpen();
  const clawOpen = useClaw((s) => s.open !== null);
  const jukeboxOpen = useJukebox((s) => s.expanded);
  const transitioning = useThemeTransition().phase !== 'idle';
  const topModal = useTopModalDialog() !== null;
  const [accepted, setAccepted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [announced, setAnnounced] = useState(false);
  const cardRef = useRef<HTMLElement>(null);

  // The season's end (an invite-activated Halloween Night goes back), never in the middle of a match.
  useEffect(() => {
    if (!ready || place === 'game') return;
    void seasonal.checkSeasonEnd().catch(() => undefined);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void seasonal.checkSeasonEnd().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [ready, place]);

  const now = seasonNow();
  const eligible = ready && now !== null && !accepted && hasTheme(HALLOWEEN_THEME_ID) && shouldInvite(prefs, now, place, theme);
  const blocked = modal !== null || pickerOpen || clawOpen || jukeboxOpen || transitioning || topModal;

  useEffect(() => {
    if (!eligible || blocked) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [eligible, blocked]);

  const shown = visible && eligible && !blocked;
  useEffect(() => {
    if (shown) setAnnounced(true);
  }, [shown]);

  const top = useHeaderBottom(shown);
  const state: InviteState =
    now === null ? 'off' : !ready ? 'idle' : !eligible ? 'ineligible' : blocked ? 'blocked' : shown ? 'shown' : 'waiting';

  /** Focus was in the card (keyboard): hand it to the HUD's theme button once the card is gone. */
  const leaveCard = () => {
    const hadFocus = !!cardRef.current?.contains(document.activeElement);
    setVisible(false);
    if (hadFocus) requestAnimationFrame(() => document.querySelector<HTMLElement>('.af-hud [data-part="theme-button"]')?.focus());
  };

  return (
    <>
      <div className="visually-hidden" role="status" aria-live="polite" data-part="seasonal-status" data-state={state}>
        {announced && state !== 'ineligible' && state !== 'off' ? ANNOUNCEMENT : ''}
      </div>
      {shown ? (
        <aside
          ref={cardRef}
          className="ssn-invite"
          data-part="seasonal-invite"
          aria-labelledby="ssn-invite-title"
          style={
            {
              '--ssn-accent': getTheme(HALLOWEEN_THEME_ID).meta.swatches[2],
              ...(top !== null ? { '--ssn-top': `${top + 8}px` } : null),
            } as CSSProperties
          }
        >
          <PumpkinGlyph className="ssn-invite__glyph" size={36} />
          <div className="ssn-invite__text">
            <h2 id="ssn-invite-title" className="ssn-invite__title">
              Halloween is here — haunt the arcade?
            </h2>
            <p className="ssn-invite__body">
              Halloween Night brings spooky claw prizes, a Trick-or-Treat wheel and friendly ghosts. Just for you — switch back any time.
            </p>
          </div>
          <div className="ssn-invite__actions">
            <Button
              variant="primary"
              onClick={() => {
                sfx('select');
                setAccepted(true);
                leaveCard();
                void seasonal.accept().catch(() => undefined);
              }}
            >
              Turn on Halloween
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                sfx('click');
                leaveCard();
                seasonal.dismiss();
              }}
            >
              Not now
            </Button>
          </div>
        </aside>
      ) : null}
    </>
  );
}
