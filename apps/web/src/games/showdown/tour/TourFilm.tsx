/**
 * "Boo's Backstage Tour" — the Presenter Tour's film cut (/tutorial/showdown?film=1), made to be
 * recorded at 1920×1080 and shared: the same timeline as the tour, a little slower, with Boo (the
 * show's ghost host) narrating in speech bubbles and doing his bits, big captions for watching muted,
 * a curtain-up intro, chapter cards, a DASbot cameo and an end card.
 *
 * It plays by itself with the show's sounds and theme music (the recorder starts audio with a click).
 * ?voice=1 adds the voice-over cut: each line's clip, served by the recorder, plays on its beat and
 * the beat waits for it (narration.ts). The page reports its progress on window.__dascadeTourFilm for
 * the recorder. Nothing here talks to the server.
 */
import './tour.css';
import './film.css';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { GAME_CATALOG } from '@dascade/shared';
import type { ShowdownLook } from '@dascade/shared/games/showdown';
import { GameTheme, PixelIcon } from '@dascade/ui';
import { HostFigure } from '../Host.tsx';
import type { HostMood } from '../look.ts';
import { ShowSourceProvider } from '../source.ts';
import { themeMusic } from '../themeMusic.ts';
import { BigPicture, MeetingChat, ShareMock, StageWindow } from './Illustrations.tsx';
import { MockConsole } from './MockConsole.tsx';
import { FILM_INTRO, FILM_OUTRO, filmLines, narrate, preloadVoice, type FilmLine } from './narration.ts';
import { DEMO_SETTINGS, DEMO_SETTINGS_BEFORE, TOUR_CHAPTERS } from './script.ts';
import type { BooAct } from './timeline.ts';
import { Caption } from './TourPlayer.tsx';
import { useTour } from './useTour.ts';

const W = 1920;
const H = 1080;
/** The intro's length, each chapter card's, and the outro's steps (ms). */
const INTRO_MS = 8600;
const CARD_MS = 1900;
const OUTRO = { dasbot: 4400, boo: 4200, end: 7500 };

type Act = 'ready' | 'intro' | 'tour' | 'outro-dasbot' | 'outro-boo' | 'end' | 'done';

/** When each act began and each beat landed (performance.now()): the recorder lines its sound up by them. */
interface FilmMark {
  key: string;
  t: number;
}

declare global {
  interface Window {
    /** The film's state, for the recorder (.scratch tooling). */
    __dascadeTourFilm?: { act: Act; chapter: number; beat: number; lines: FilmLine[]; marks: FilmMark[]; start: () => void };
    /** Voice clip lengths (ms) by line key, set by the recorder for the voice-over cut. */
    __dascadeTourVoiceMs?: Record<string, number>;
  }
}

export function TourFilm({
  look = 'halloween',
  startChapter = 0,
  narration = false,
}: {
  look?: ShowdownLook;
  startChapter?: number;
  narration?: boolean;
}) {
  const [act, setAct] = useState<Act>('ready');
  const marks = useRef<FilmMark[]>([]);
  const voiceMs = typeof window !== 'undefined' ? (window.__dascadeTourVoiceMs ?? {}) : {};
  const tour = useTour({
    chapters: TOUR_CHAPTERS,
    film: true,
    look,
    autoplay: false,
    startPaused: true,
    sound: act !== 'ready',
    music: true,
    startChapter,
    lead: CARD_MS,
    minHold: (key) => (narration && voiceMs[key] ? voiceMs[key] + 500 : 0),
    onLand: (key, beat) => {
      marks.current.push({ key, t: performance.now() });
      if (narration && beat.boo?.say) narrate(key);
    },
    onEnd: () => setAct('outro-dasbot'),
  });

  // The recorder (or a click) starts the film: the curtain goes up, then the tour plays.
  const start = useRef(() => {});
  start.current = () => {
    if (act !== 'ready') return;
    if (narration) preloadVoice();
    setAct('intro');
  };
  useEffect(() => {
    window.__dascadeTourFilm = {
      act,
      chapter: tour.chapter,
      beat: tour.beat,
      lines: filmLines(),
      marks: marks.current,
      start: () => start.current(),
    };
  }, [act, tour.chapter, tour.beat]);
  useEffect(() => () => void delete window.__dascadeTourFilm, []);

  useEffect(() => {
    if (act !== 'ready') marks.current.push({ key: act, t: performance.now() });
    let t: ReturnType<typeof setTimeout> | undefined;
    if (act === 'intro') {
      if (narration) narrate(FILM_INTRO.key);
      themeMusic.play(look);
      t = setTimeout(
        () => {
          setAct('tour');
          tour.play();
        },
        Math.max(INTRO_MS, (voiceMs[FILM_INTRO.key] ?? 0) + 700),
      );
    } else if (act === 'outro-dasbot') {
      if (narration) narrate(FILM_OUTRO[0]!.key);
      themeMusic.play('showtime');
      t = setTimeout(() => setAct('outro-boo'), Math.max(OUTRO.dasbot, (voiceMs[FILM_OUTRO[0]!.key] ?? 0) + 500));
    } else if (act === 'outro-boo') {
      if (narration) narrate(FILM_OUTRO[1]!.key);
      themeMusic.play(look);
      t = setTimeout(() => setAct('end'), Math.max(OUTRO.boo, (voiceMs[FILM_OUTRO[1]!.key] ?? 0) + 500));
    } else if (act === 'end') {
      if (narration) narrate(FILM_OUTRO[2]!.key);
      t = setTimeout(
        () => {
          themeMusic.stop();
          setAct('done');
        },
        Math.max(OUTRO.end, (voiceMs[FILM_OUTRO[2]!.key] ?? 0) + 4000),
      );
    }
    return () => clearTimeout(t);
  }, [act]); // eslint-disable-line react-hooks/exhaustive-deps

  const frame = tour.frame;
  const settings = { ...(frame.preset ? DEMO_SETTINGS : DEMO_SETTINGS_BEFORE), look };
  const chapter = TOUR_CHAPTERS[tour.chapter]!;
  const pressed = tour.phase === 'post' && frame.click;
  const card = act === 'tour' && tour.beat < 0;
  const outro = act === 'outro-dasbot' || act === 'outro-boo' || act === 'end' || act === 'done';

  let say = frame.boo.say;
  let mood: HostMood = frame.boo.mood;
  let bit: BooAct = frame.boo.act;
  if (act === 'ready' || act === 'intro') {
    say = act === 'intro' ? FILM_INTRO.text : '';
    mood = 'cheer';
    bit = 'float';
  } else if (card) {
    say = '';
    mood = 'happy';
    bit = 'float';
  }

  return (
    <Fit>
      <GameTheme
        accent={GAME_CATALOG.showdown.accent}
        className="tour film"
        data-look={look}
        data-motion="on"
        data-act={act}
        data-part="showdown-tour-film"
      >
        <div className="film__set" aria-hidden />
        <header className="film__top">
          <span className="film__logo">
            <span className="film__logoghost">
              <HostFigure look="halloween" mood="happy" talking={false} />
            </span>
            Boo’s Backstage Tour
          </span>
          <span className="film__chapter" key={tour.chapter}>
            <span className="film__chapnum dc-num">{tour.chapter + 1}</span> {chapter.film ?? chapter.title}
          </span>
          <span className="film__jukebox" data-jukebox-slot data-jukebox-variant="compact" />
          <ol className="film__dots" aria-hidden>
            {TOUR_CHAPTERS.map((c, i) => (
              <li key={c.id} data-state={i < tour.chapter ? 'done' : i === tour.chapter ? 'now' : undefined} />
            ))}
          </ol>
        </header>

        <ShowSourceProvider source={tour.source}>
          {frame.screen === 'diagram' ? (
            <div className="film__big tour__big">
              <BigPicture step={frame.step} look={look} settings={settings} title={DEMO_SETTINGS.title} motion />
            </div>
          ) : (
            <>
              <section className="film__console">
                <span className="film__label">
                  <PixelIcon name="lock" /> {frame.screen === 'share' ? 'Your meeting app' : 'Your console'}
                  <b>{frame.screen === 'share' ? 'share the stage window' : 'only you see this'}</b>
                </span>
                <div className="tour__console">
                  {frame.screen === 'share' ? (
                    <ShareMock step={frame.step} look={look} settings={settings} title={DEMO_SETTINGS.title} motion />
                  ) : (
                    <MockConsole look={look} frame={frame} landed={tour.landed} pressed={pressed} motion />
                  )}
                </div>
              </section>
              <section className="film__stage">
                <span className="film__label">
                  <PixelIcon name="eye" /> What the meeting sees
                </span>
                <StageWindow open={frame.stage} look={look} settings={settings} title={DEMO_SETTINGS.title} />
              </section>
              <div className="film__chat">
                <MeetingChat lines={frame.chat} />
              </div>
            </>
          )}
        </ShowSourceProvider>

        <div className="film__caption" data-empty={frame.caption && act === 'tour' && !card ? undefined : 'true'}>
          <p key={`${tour.chapter}:${frame.caption}`}>{act === 'tour' && !card ? <Caption text={frame.caption} /> : null}</p>
        </div>

        <Narrator look="halloween" mood={mood} act={bit} say={say} sayKey={`${act}:${tour.chapter}:${tour.beat}`} hidden={outro} />

        {card ? <ChapterCard index={tour.chapter} title={chapter.film ?? chapter.title} subtitle={chapter.title} /> : null}
        {act === 'ready' || act === 'intro' ? <Intro open={act === 'intro'} /> : null}
        {outro ? <Outro act={act} look={look} /> : null}
        {act === 'ready' ? (
          <button type="button" className="film__start" onClick={() => start.current()}>
            <PixelIcon name="play" /> Start the film
          </button>
        ) : null}
      </GameTheme>
    </Fit>
  );
}

/** The 1920×1080 film, scaled to fit the window (the recorder uses exactly 1920×1080). */
function Fit({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / W, window.innerHeight / H));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return (
    <main className="film-page" id="main">
      <div className="film-page__canvas" style={{ width: W, height: H, transform: `scale(${scale})` }}>
        {children}
      </div>
    </main>
  );
}

/** Boo, narrating from the bottom left: his line in a bubble, his bit as an animation. */
function Narrator({
  look,
  mood,
  act,
  say,
  sayKey,
  hidden,
}: {
  look: ShowdownLook;
  mood: HostMood;
  act: BooAct;
  say: string;
  sayKey: string;
  hidden: boolean;
}) {
  return (
    <div className="film-boo" data-act={act} data-hidden={hidden ? 'true' : undefined}>
      {say ? (
        <p className="film-boo__bubble" key={sayKey}>
          {say}
        </p>
      ) : null}
      <div className="film-boo__body" key={`${act}:${sayKey}`}>
        <span className="film-boo__fig sd-stage" data-motion="on" data-look={look}>
          <HostFigure look={look} mood={mood} talking={Boolean(say)} />
        </span>
        <Props act={act} />
      </div>
    </div>
  );
}

/** Boo's props for his bits: a drum kit, a watch, dizzy stars, a big "!". */
function Props({ act }: { act: BooAct }) {
  if (act === 'drums') {
    return (
      <svg className="film-prop film-prop--drums" viewBox="0 0 220 140" aria-hidden focusable="false">
        <ellipse cx="110" cy="54" rx="92" ry="22" fill="#f4e9ff" stroke="#5b3d99" strokeWidth="5" />
        <path d="M18 54 V112 Q110 150 202 112 V54" fill="#ff8a1f" stroke="#5b3d99" strokeWidth="5" />
        <path d="M18 70 L60 120 L104 70 L148 124 L202 70" fill="none" stroke="#ffe08a" strokeWidth="5" />
        <g className="film-prop__stick film-prop__stick--l">
          <line x1="40" y1="-20" x2="96" y2="46" stroke="#e8c48a" strokeWidth="8" strokeLinecap="round" />
          <circle cx="96" cy="46" r="7" fill="#fff6e0" />
        </g>
        <g className="film-prop__stick film-prop__stick--r">
          <line x1="180" y1="-20" x2="124" y2="46" stroke="#e8c48a" strokeWidth="8" strokeLinecap="round" />
          <circle cx="124" cy="46" r="7" fill="#fff6e0" />
        </g>
      </svg>
    );
  }
  if (act === 'watch') {
    return (
      <svg className="film-prop film-prop--watch" viewBox="0 0 90 120" aria-hidden focusable="false">
        <path d="M45 6 V20" stroke="#c9a14a" strokeWidth="6" strokeLinecap="round" />
        <circle cx="45" cy="64" r="40" fill="#ffd36b" stroke="#a87b1f" strokeWidth="6" />
        <circle cx="45" cy="64" r="31" fill="#fffaf0" />
        <line className="film-prop__hand" x1="45" y1="64" x2="45" y2="40" stroke="#1b0f33" strokeWidth="5" strokeLinecap="round" />
        <line x1="45" y1="64" x2="62" y2="64" stroke="#1b0f33" strokeWidth="5" strokeLinecap="round" />
        <circle cx="45" cy="64" r="4" fill="#ff8a1f" />
      </svg>
    );
  }
  if (act === 'faint') {
    return (
      <span className="film-prop film-prop--stars" aria-hidden>
        <i>★</i>
        <i>✦</i>
        <i>★</i>
      </span>
    );
  }
  if (act === 'jump') {
    return (
      <span className="film-prop film-prop--bang" aria-hidden>
        !
      </span>
    );
  }
  if (act === 'cover') {
    return (
      <span className="film-prop film-prop--nopeek" aria-hidden>
        no peeking!
      </span>
    );
  }
  return null;
}

function Intro({ open }: { open: boolean }) {
  return (
    <div className="film-intro" data-open={open ? 'true' : undefined}>
      <div className="film-intro__curtain film-intro__curtain--l" />
      <div className="film-intro__curtain film-intro__curtain--r" />
      <div className="film-intro__title">
        <span className="film-intro__kicker">DAS-O-Ween Trivia · the presenter’s guide</span>
        <h1 className="film-intro__name">
          Boo’s
          <br />
          Backstage Tour
        </h1>
        <span className="film-intro__sub">How to run the show, step by step</span>
      </div>
    </div>
  );
}

function ChapterCard({ index, title, subtitle }: { index: number; title: string; subtitle: string }) {
  return (
    <div className="film-card" key={index}>
      <span className="film-card__num">
        Chapter <span className="dc-num">{index + 1}</span>
      </span>
      <span className="film-card__title">{title}</span>
      {subtitle !== title ? <span className="film-card__sub">{subtitle}</span> : null}
    </div>
  );
}

function Outro({ act, look }: { act: Act; look: ShowdownLook }) {
  const end = act === 'end' || act === 'done';
  return (
    <div className="film-outro" data-act={act}>
      <div className="film-outro__hosts">
        <div className="film-outro__host film-outro__host--boo sd-stage" data-motion="on" data-look="halloween">
          {act === 'outro-boo' ? <p className="film-boo__bubble film-outro__bubble">{FILM_OUTRO[1]!.text}</p> : null}
          <HostFigure look="halloween" mood={act === 'outro-dasbot' ? 'startled' : end ? 'bye' : 'oops'} talking={act === 'outro-boo'} />
        </div>
        {!end ? (
          <div className="film-outro__host film-outro__host--bot sd-stage" data-motion="on" data-look="showtime">
            {act === 'outro-dasbot' ? (
              <p className="film-boo__bubble film-outro__bubble film-outro__bubble--bot">{FILM_OUTRO[0]!.text}</p>
            ) : null}
            <HostFigure look="showtime" mood={act === 'outro-dasbot' ? 'cheer' : 'happy'} talking={act === 'outro-dasbot'} />
          </div>
        ) : null}
      </div>
      {end ? (
        <div className="film-end" data-look={look}>
          <p className="film-end__title">You’re ready!</p>
          <p className="film-end__sub">{FILM_OUTRO[2]!.text}</p>
          <ul className="film-end__links">
            <li>
              <PixelIcon name="help" />
              Watch the in-app tour any time: <b>dascade.onrender.com/tutorial/showdown</b>, or press <b>Tour</b> in the console.
            </li>
            <li>
              <PixelIcon name="info" />
              Every detail is in the runbook: <b>docs/DAS-O-WEEN-RUNBOOK.md</b> in the DASCADE repo.
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}
