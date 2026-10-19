/**
 * The Presenter Tour: an animated, self-paced walk through running DAS-O-Ween Trivia, built from the
 * real show. The real stage (what the meeting sees) plays a scripted demo show beside a picture of
 * the presenter's console, where a cursor presses each control while a caption says what it does —
 * with the console's own button names (docs/DAS-O-WEEN-RUNBOOK.md).
 *
 * Nothing here talks to the server: the stage reads a demo source (source.ts), never the room, so a
 * tour opened from the live console leaves the live show alone. Sound is off until the viewer turns
 * it on, and then plays on this device only.
 *
 * Reduced motion or effects off: no auto-play — every beat is a still the viewer steps through.
 * Keys: Space play/pause (next step in stills), ←/→ chapters; Esc closes the tour's dialog.
 */
import './tour.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GAME_CATALOG } from '@dascade/shared';
import type { ShowdownLook } from '@dascade/shared/games/showdown';
import { Button, GameTheme, IconButton, Kbd, PixelIcon, Segmented } from '@dascade/ui';
import { HostFigure } from '../Host.tsx';
import { ShowSourceProvider } from '../source.ts';
import { useMotion } from '../state.ts';
import { BigPicture, MeetingChat, ShareMock, StageWindow } from './Illustrations.tsx';
import { MockConsole } from './MockConsole.tsx';
import { DEMO_SETTINGS, DEMO_SETTINGS_BEFORE, TOUR_CHAPTERS } from './script.ts';
import { beatsOf, chapterLength, parseCaption, tourLength } from './timeline.ts';
import { useTour, type Tour } from './useTour.ts';

/** The runbook, for reading after the tour. */
export const RUNBOOK_URL = 'https://github.com/GrayGrayson1/dascade/blob/main/docs/DAS-O-WEEN-RUNBOOK.md';

export interface TourPlayerProps {
  /** Start in this look (the viewer can switch). */
  look?: ShowdownLook;
  startChapter?: number;
  /** Close (the modal) or leave (the page). */
  onClose?: () => void;
  closeLabel?: string;
  /** The theme music may play (the standalone page — never inside a live room). */
  music?: boolean;
  /** Host the jukebox's control in the top bar (the standalone page: it has no shell toolbar). */
  jukeboxSlot?: boolean;
}

export function TourPlayer({
  look: initialLook = 'halloween',
  startChapter = 0,
  onClose,
  closeLabel = 'Close the tour',
  music = false,
  jukeboxSlot = false,
}: TourPlayerProps) {
  const motion = useMotion();
  const [look, setLook] = useState<ShowdownLook>(initialLook);
  const [sound, setSound] = useState(false);
  const tour = useTour({ chapters: TOUR_CHAPTERS, film: false, look, autoplay: motion.motion, sound, music, startChapter });
  const still = !motion.motion;
  const root = useRef<HTMLDivElement>(null);
  useTourKeys(tour, still, root);
  // Reduced motion (or effects off) switched on mid-tour: stop where we are; the viewer steps on.
  const pause = tour.pause;
  useEffect(() => {
    if (still) pause();
  }, [still, pause]);

  const frame = tour.frame;
  const settings = { ...(frame.preset ? DEMO_SETTINGS : DEMO_SETTINGS_BEFORE), look };
  const chapter = TOUR_CHAPTERS[tour.chapter]!;
  const pressed = tour.phase === 'post' && frame.click;
  const total = beatsOf(chapter, false).length;

  return (
    <GameTheme
      accent={GAME_CATALOG.showdown.accent}
      className="tour"
      data-look={look}
      data-motion={motion.motion ? 'on' : 'off'}
      data-part="showdown-tour"
    >
      <div ref={root} className="tour__inner" data-screen={frame.screen} data-chapter={chapter.id}>
        <header className="tour__top">
          <span className="tour__brand">
            <span className="tour__ghost" aria-hidden>
              <HostFigure look={look} mood="happy" talking={false} />
            </span>
            <span className="tour__brandtext">
              <span className="tour__kicker">Presenter tour</span>
              <span className="tour__name">{DEMO_SETTINGS.title}</span>
            </span>
            <span className="tour__demo">Practice boards · nothing here touches a live show</span>
          </span>
          <span className="tour__opts">
            {jukeboxSlot ? <span className="tour__jukebox" data-jukebox-slot data-jukebox-variant="compact" /> : null}
            <Segmented
              label="Look"
              value={look}
              onChange={(v) => setLook(v)}
              options={[
                { value: 'halloween', label: 'Halloween' },
                { value: 'showtime', label: 'Showtime' },
              ]}
            />
            <IconButton
              icon={sound ? 'sound-on' : 'sound-off'}
              label={sound ? 'Tour sound on (this device only) — turn it off' : 'Tour sound off — hear the show’s sounds'}
              variant={sound ? 'secondary' : 'ghost'}
              aria-pressed={sound}
              data-part="showdown-tour-sound"
              onClick={() => setSound(!sound)}
            />
            {onClose ? (
              <Button size="sm" variant="ghost" icon="close" onClick={onClose} data-part="showdown-tour-close">
                {closeLabel}
              </Button>
            ) : null}
          </span>
        </header>

        <ShowSourceProvider source={tour.source}>
          <div className="tour__main">
            {frame.screen === 'diagram' ? (
              <div className="tour__big" aria-hidden>
                <BigPicture step={frame.step} look={look} settings={settings} title={DEMO_SETTINGS.title} motion={motion.motion} />
              </div>
            ) : (
              <>
                <section className="tour__panel tour__panel--console">
                  <h2 className="tour__label">
                    <PixelIcon name="lock" /> {frame.screen === 'share' ? 'Your meeting app' : 'Your console'}
                    <span className="tour__label-note">{frame.screen === 'share' ? 'Share the stage window' : 'Only you see this'}</span>
                  </h2>
                  <div className="tour__console" aria-hidden inert>
                    {frame.screen === 'share' ? (
                      <ShareMock step={frame.step} look={look} settings={settings} title={DEMO_SETTINGS.title} motion={motion.motion} />
                    ) : (
                      <MockConsole look={look} frame={frame} landed={tour.landed} pressed={pressed} motion={motion.motion} />
                    )}
                  </div>
                </section>
                <section className="tour__panel tour__panel--meeting">
                  <h2 className="tour__label">
                    <PixelIcon name="eye" /> What the meeting sees
                  </h2>
                  <div className="tour__stage" aria-hidden inert>
                    <StageWindow open={frame.stage} look={look} settings={settings} title={DEMO_SETTINGS.title} />
                  </div>
                  <MeetingChat lines={frame.chat} />
                </section>
              </>
            )}
          </div>
        </ShowSourceProvider>

        <div className="tour__caption" data-part="showdown-tour-caption">
          <span className="tour__host" data-mood={frame.boo.mood} aria-hidden>
            <HostFigure look={look} mood={frame.boo.mood} talking={false} />
          </span>
          <p className="tour__captext" aria-live="polite" key={`${tour.chapter}:${frame.caption}`}>
            <Caption text={frame.caption} />
          </p>
        </div>

        <footer className="tour__controls">
          <div className="tour__buttons">
            <IconButton
              icon="arrow-left"
              label="Previous chapter"
              onClick={() => tour.goChapter(tour.chapter - 1)}
              disabled={tour.chapter === 0}
            />
            {still ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={tour.prev}
                  disabled={tour.chapter === 0 && tour.beat <= 0}
                  data-part="showdown-tour-prev-step"
                >
                  Back
                </Button>
                <span className="tour__stepcount" aria-live="off">
                  Step <span className="dc-num">{Math.max(1, tour.beat + 1)}</span>/<span className="dc-num">{total}</span>
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  iconRight="arrow-right"
                  onClick={tour.next}
                  disabled={tour.chapter === TOUR_CHAPTERS.length - 1 && tour.beat >= total - 1}
                  data-part="showdown-tour-next-step"
                >
                  Next step
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                size="sm"
                icon={tour.playing ? 'pause' : 'play'}
                onClick={tour.toggle}
                data-part="showdown-tour-play"
              >
                {tour.playing ? 'Pause' : tour.done ? 'Watch again' : 'Play'}
              </Button>
            )}
            <IconButton
              icon="arrow-right"
              label="Next chapter"
              onClick={() => tour.goChapter(tour.chapter + 1)}
              disabled={tour.chapter === TOUR_CHAPTERS.length - 1}
            />
            <IconButton icon="refresh" label="Replay this chapter" onClick={tour.restart} />
          </div>
          <ChapterRail tour={tour} />
          <p className="tour__hint">
            {still ? (
              <>
                <Kbd>Space</Kbd> next step · <Kbd>←</Kbd> <Kbd>→</Kbd> chapters
              </>
            ) : (
              <>
                <Kbd>Space</Kbd> play/pause · <Kbd>←</Kbd> <Kbd>→</Kbd> chapters · about {minutes(tourLength(TOUR_CHAPTERS, false))} min
              </>
            )}
          </p>
        </footer>

        {tour.done ? (
          <div className="tour__done" role="dialog" aria-label="End of the tour">
            <span className="tour__donehost" aria-hidden>
              <HostFigure look={look} mood="bye" talking={false} />
            </span>
            <p className="tour__donetitle">You’re ready to run the show!</p>
            <p className="tour__donesub">
              The runbook has every detail — and this tour is a click away in the console (<b>Tour</b>, in the top bar).
            </p>
            <span className="tour__doneactions">
              <Button variant="primary" icon="refresh" onClick={tour.play}>
                Watch again
              </Button>
              <a className="dc-btn dc-btn--secondary" href={RUNBOOK_URL} target="_blank" rel="noreferrer">
                <PixelIcon name="info" /> Read the runbook
              </a>
              {onClose ? (
                <Button variant="ghost" onClick={onClose}>
                  {closeLabel}
                </Button>
              ) : null}
            </span>
          </div>
        ) : null}
      </div>
    </GameTheme>
  );
}

/** "3½": a length in minutes, to the nearest half. */
function minutes(ms: number): string {
  const halves = Math.max(1, Math.round(ms / 30_000));
  return `${Math.floor(halves / 2) || ''}${halves % 2 ? '½' : ''}` || '0';
}

/** A caption: plain words, the console's control names as chips, keys as keycaps. */
export function Caption({ text }: { text: string }) {
  const parts = parseCaption(text);
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (part.kind === 'text') {
      // Punctuation right after a chip stays on the chip's line.
      const prev = parts[i - 1];
      const glued = prev && prev.kind !== 'text' ? (/^[,.;:!?…)]+/.exec(part.text)?.[0] ?? '') : '';
      const rest = part.text.slice(glued.length);
      if (rest) out.push(<span key={i}>{rest}</span>);
      return;
    }
    const next = parts[i + 1];
    const tail = next?.kind === 'text' ? (/^[,.;:!?…)]+/.exec(next.text)?.[0] ?? '') : '';
    out.push(
      <span key={i} className="tour-cap__glue">
        {part.kind === 'button' ? (
          <span className="tour-cap__btn">{part.text}</span>
        ) : part.kind === 'key' ? (
          <Kbd>{part.text}</Kbd>
        ) : part.kind === 'app' ? (
          <em className="tour-cap__app">{part.text}</em>
        ) : (
          <b>{part.text}</b>
        )}
        {tail}
      </span>,
    );
  });
  return <>{out}</>;
}

function ChapterRail({ tour }: { tour: Tour }) {
  const [, tick] = useState(0);
  // The current chapter's progress bar moves while it plays.
  useEffect(() => {
    if (!tour.playing) return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [tour.playing]);
  return (
    <ol className="tour__rail" aria-label="Chapters">
      {TOUR_CHAPTERS.map((c, i) => {
        const now = i === tour.chapter;
        const progress = now ? Math.min(1, tour.elapsed() / Math.max(1, chapterLength(c, false))) : i < tour.chapter ? 1 : 0;
        return (
          <li key={c.id}>
            <button
              type="button"
              className="tour__chip"
              aria-current={now ? 'step' : undefined}
              data-seen={i < tour.chapter ? 'true' : undefined}
              onClick={() => tour.goChapter(i)}
              title={c.title}
            >
              <span className="tour__chipnum dc-num">{i + 1}</span>
              <span className="tour__chiptitle">{c.title}</span>
              <span className="tour__chipbar" aria-hidden>
                <i style={{ transform: `scaleX(${progress})` }} />
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Space: play/pause (next step in stills); ←/→: chapters. Never while typing or on a focused control's own keys. */
function useTourKeys(tour: Tour, still: boolean, root: React.RefObject<HTMLDivElement | null>) {
  const live = useRef({ tour, still });
  live.current = { tour, still };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
      const el = root.current;
      if (!el?.isConnected) return;
      const t = e.target as HTMLElement | null;
      // Inside a dialog (the tour's modal), only keys aimed at the tour count.
      const dialog = el.closest('dialog');
      if (dialog && t && !dialog.contains(t)) return;
      // Typing, or a control with keys of its own (the Look switch moves with the arrows).
      if (t?.closest('input, textarea, select, [contenteditable], [role="radiogroup"], [role="tablist"]')) return;
      const { tour: cur, still: stills } = live.current;
      if (e.key === ' ' || e.code === 'Space') {
        if (t?.closest('button, a, [role="radio"]')) return;
        if (stills) cur.next();
        else cur.toggle();
      } else if (e.key === 'ArrowRight') cur.goChapter(cur.chapter + 1);
      else if (e.key === 'ArrowLeft') cur.goChapter(cur.chapter - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [root]);
}
