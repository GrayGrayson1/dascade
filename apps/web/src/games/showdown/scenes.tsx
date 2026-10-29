/**
 * Presenter Showcase — the full-stage scenes around the board: the opening, a round's category card,
 * the holding cards (welcome, be right back, prize time, thanks — any phase), the lobby's holding
 * screen and the closing "That's a wrap!". Each is a composition of big type over the look's set; the
 * host is drawn by the stage (one figure that glides between scenes), never here.
 *
 * Two-tier scoring adds the Standings card (the top Guessers and, with medals after each round, the
 * Spotlight Stars), the paced finale (the medal ceremony, then the podium 3rd → 2nd → 1st, stepped by
 * the presenter) and the winners on Prize time.
 *
 * Everything is public (settings, the board's category, the finale, the scoreboard). Motion: the
 * entrances run only with motion on (stageShowcase.css gates them under [data-motion='on']); with
 * motion off a scene simply stands in its final state.
 */
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import {
  eventTitle,
  showTitle,
  type ShowdownBoardView,
  type ShowdownCard,
  type ShowdownFinale,
  type ShowdownLook,
  type ShowdownScoreRow,
  type ShowdownScoreboard,
  type ShowdownSettings,
  type ShowdownStar,
} from '@dascade/shared/games/showdown';
import { SpecialGlyph } from './Board.tsx';
import { LOOK_COPY, fill, joinAddress, type ShowcaseCopy } from './look.ts';
import {
  finaleView,
  medalCells,
  medalKindsHeld,
  medalLegend,
  medalWords,
  placeWord,
  podiumColumns,
  pointsLegend,
  type FinaleView,
  type LegendItem,
} from './standings.ts';
import { clipTime, useCinema } from './cinema.ts';
import { JoinTicket } from './qr.tsx';
import { awardSteps, fireworksAt, revealedPlaces, useAwards, type AwardPlace } from './awards.ts';
import { Fireworks } from './fireworks.tsx';
import { useShowExtras } from './source.ts';
import type { MotionPrefs } from './state.ts';

const len = (s: string) => Array.from(s).length;

/** Text whose words never break inside (no "DAS-O- / WEEN" at a hyphen); lines wrap at the spaces. */
export function Words({ text }: { text: string }) {
  const parts = text.split(/\s+/).filter(Boolean);
  return (
    <>
      {parts.map((w, i) => (
        <Fragment key={i}>
          <span className="sd-word">{w}</span>
          {i < parts.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </>
  );
}

/** The show's title as marquee words ("DAS Survey Showdown" → "Survey", "Showdown": the badge says DAS). */
export function marqueeWords(title: string): string[] {
  const words = title
    .replace(/^DAS\s+/i, '')
    .split(/\s+/)
    .filter(Boolean);
  return words.length ? words : [title];
}

function Marquee({ title, className }: { title: string; className?: string }) {
  const words = marqueeWords(title);
  const longest = Math.max(...words.map(len));
  return (
    <h2
      className={`sd-scene__marquee ${className ?? ''}`}
      data-stack={words.length <= 3 ? 'true' : undefined}
      aria-label={title}
      style={{ '--wlen': Math.max(6, longest), '--words': words.length } as CSSProperties}
    >
      {words.map((w, i) => (
        <span key={i} className="sd-scene__word" data-text={w} style={{ '--w': i } as CSSProperties} aria-hidden>
          {w}
        </span>
      ))}
    </h2>
  );
}

/** The short join hint (phones are an optional extra in a showcase). */
export function JoinHint({
  code,
  look,
  className,
  short = false,
}: {
  code: string;
  look: ShowdownLook;
  className?: string;
  short?: boolean;
}) {
  if (!code) return null;
  const join = joinAddress(code);
  return (
    <div className={`sd-joinhint ${className ?? ''}`} data-short={short ? 'true' : undefined}>
      <span className="sd-joinhint__label">{short ? LOOK_COPY[look].showcase.playAlongShort : LOOK_COPY[look].showcase.playAlong}</span>
      <span className="sd-joinhint__addr">{join.short}</span>
      <span className="sd-joincard__code sd-joinhint__code" aria-label={`Room code ${code}`}>
        {code.split('').map((c, i) => (
          <span key={i}>{c}</span>
        ))}
      </span>
    </div>
  );
}

function Flourish() {
  return (
    <span className="sd-flourish" aria-hidden>
      <i />
      <SpecialGlyph />
      <i />
    </span>
  );
}

// ---------------------------------------------------------------------------

/** The opening: lights come up from dark, the DAS badge pops, the marquee title, the tagline. */
export function OpeningScene({
  settings,
  look,
  code,
  rehearsal,
}: {
  settings: ShowdownSettings | null;
  look: ShowdownLook;
  code: string;
  rehearsal: boolean;
}) {
  const show = settings ? showTitle(settings) : 'DAS Survey Showdown';
  const copy = LOOK_COPY[look].showcase;
  return (
    <section className="sd-scene sd-scene--opening" aria-label={show}>
      <div className="sd-scene__rays" aria-hidden />
      <div className="sd-scene__halo" aria-hidden />
      <div className="sd-scene__lockup">
        <span className="sd-logo-badge sd-scene__badge" aria-hidden>
          DAS
        </span>
        <Marquee title={show} />
        <p className="sd-scene__tagline">
          <Flourish />
          <span>{copy.tagline}</span>
          <Flourish />
        </p>
        {rehearsal ? <span className="sd-tag sd-scene__tag">{copy.rehearsal}</span> : null}
      </div>
      <JoinHint code={code} look={look} className="sd-scene__join" />
      <div className="sd-scene__dark" aria-hidden />
    </section>
  );
}

/** A round's title card, up for as long as the round sits on its title: the category, huge. */
export function CategoryScene({ board, look }: { board: ShowdownBoardView; look: ShowdownLook }) {
  const copy = LOOK_COPY[look].showcase;
  const n = board.round + 1;
  const last = board.totalRounds > 1 && n === board.totalRounds;
  const category = board.title || `Round ${n}`;
  return (
    <section className="sd-scene sd-scene--category" aria-label={`Round ${n}: ${category}`} key={board.round}>
      <div className="sd-scene__rays" aria-hidden />
      <div className="sd-scene__halo" aria-hidden />
      <div className="sd-plaque">
        <p className="sd-scene__kicker">
          {last ? (
            'Final round'
          ) : (
            <>
              Round <span className="sd-num">{n}</span>
              {board.totalRounds > 1 ? (
                <>
                  {' '}
                  of <span className="sd-num">{board.totalRounds}</span>
                </>
              ) : null}
            </>
          )}
        </p>
        <h2 className="sd-scene__category" style={{ '--len': Math.max(6, len(category)) } as CSSProperties}>
          <Words text={category} />
        </h2>
        {board.slots.length ? (
          <span className="sd-scene__chip">
            <SpecialGlyph />
            {fill(copy.topN, { n: board.slots.length })}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function CardArt({ card, look }: { card: ShowdownCard; look: ShowdownLook }): ReactNode {
  if (card === 'break') {
    return (
      <svg className="sd-cardart sd-cardart--hourglass" viewBox="0 0 80 110" aria-hidden focusable="false">
        <rect x="8" y="4" width="64" height="8" rx="4" className="sd-cardart__frame" />
        <rect x="8" y="98" width="64" height="8" rx="4" className="sd-cardart__frame" />
        <path
          d="M16 12 C16 40 36 46 36 55 C36 64 16 70 16 98 L64 98 C64 70 44 64 44 55 C44 46 64 40 64 12 Z"
          className="sd-cardart__glass"
        />
        <path className="sd-cardart__sand-top" d="M22 22 L58 22 C56 38 44 44 40 52 C36 44 24 38 22 22 Z" />
        <path className="sd-cardart__sand-bottom" d="M22 96 C26 84 34 78 40 76 C46 78 54 84 58 96 Z" />
        <line className="sd-cardart__stream" x1="40" y1="54" x2="40" y2="94" />
      </svg>
    );
  }
  if (card === 'prizes') {
    return (
      <svg className="sd-cardart sd-cardart--trophy" viewBox="0 0 120 120" aria-hidden focusable="false">
        <path d="M30 18 H90 V40 C90 62 76 76 60 78 C44 76 30 62 30 40 Z" className="sd-cardart__cup" />
        <path d="M30 26 H16 C14 46 24 56 36 58 M90 26 H104 C106 46 96 56 84 58" fill="none" className="sd-cardart__handle" />
        <rect x="52" y="78" width="16" height="16" className="sd-cardart__cup" />
        <rect x="36" y="94" width="48" height="14" rx="3" className="sd-cardart__base" />
        <path d="M40 22 Q42 52 58 70" fill="none" stroke="#ffffff" strokeOpacity="0.45" strokeWidth="4" strokeLinecap="round" />
        {look === 'halloween' ? (
          <g transform="translate(60 44)">
            <path d="M0 -14 C-1 -18 1 -20 4 -19" fill="none" stroke="#3f7a2a" strokeWidth="3" strokeLinecap="round" />
            <ellipse cx="-6" cy="0" rx="9" ry="12" fill="#e8650f" />
            <ellipse cx="6" cy="0" rx="9" ry="12" fill="#e8650f" />
            <ellipse cx="0" cy="0" rx="9" ry="13" fill="#ff8a24" />
            <path d="M-7 -3 l3.5 -4 l1.5 5 z M7 -3 l-3.5 -4 l-1.5 5 z M-7 4 Q0 10 7 4 Z" fill="#ffe08a" />
          </g>
        ) : (
          <path
            d="M60 28 l4.4 9.4 10.3 1.2 -7.6 7 2.1 10.1 -9.2 -5.2 -9.2 5.2 2.1 -10.1 -7.6 -7 10.3 -1.2 z"
            fill="#fff6d0"
            stroke="#b07a1a"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        )}
        <g className="sd-cardart__sparkles" fill="#fff8dc">
          <path d="M14 8 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2z" />
          <path d="M104 4 l1.6 4.4 4.4 1.6 -4.4 1.6 -1.6 4.4 -1.6 -4.4 -4.4 -1.6 4.4 -1.6z" />
          <path d="M108 84 l1.4 4 4 1.4 -4 1.4 -1.4 4 -1.4 -4 -4 -1.4 4 -1.4z" />
        </g>
      </svg>
    );
  }
  return null;
}

/** A holding card, in any phase: welcome / be right back / prize time / thanks. Prize time lists the finale's winners. */
export function CardScene({
  card,
  settings,
  look,
  code,
  finale = null,
  qr = false,
}: {
  card: ShowdownCard;
  settings: ShowdownSettings | null;
  look: ShowdownLook;
  code: string;
  finale?: ShowdownFinale | null;
  /** Draw the join QR (the stage window, the console, big screens; never phones): big on Welcome, medium on Be right back. */
  qr?: boolean;
}) {
  const show = settings ? showTitle(settings) : 'DAS Survey Showdown';
  const event = settings ? eventTitle(settings) : show;
  const c = LOOK_COPY[look].cards[card];
  const vars = { show, event };
  const kicker = fill(c.kicker, vars);
  const title = c.title ? fill(c.title, vars) : event;
  const sub = fill(c.sub, vars);
  const podium = finale?.podium ?? [];
  const stars = finale && (finale.medals ?? 'never') !== 'never' ? (finale.stars ?? []) : [];
  const winners = card === 'prizes' && (podium.length > 0 || stars.length > 0);
  const ticket = qr && code ? (card === 'welcome' ? 'big' : card === 'break' ? 'medium' : null) : null;
  return (
    <section
      className="sd-scene sd-scene--card"
      data-card={card}
      data-winners={winners ? 'true' : undefined}
      data-ticket={ticket ?? undefined}
      aria-label={title}
      key={card}
    >
      <div className="sd-scene__rays" aria-hidden />
      <div className="sd-scene__halo" aria-hidden />
      <div className="sd-scene__lockup sd-scene__lockup--card">
        <CardArt card={card} look={look} />
        {card === 'welcome' ? (
          <span className="sd-logo-badge sd-scene__badge" aria-hidden>
            DAS
          </span>
        ) : null}
        <p className="sd-scene__kicker">
          <Words text={kicker} />
        </p>
        <h2 className="sd-scene__headline" style={{ '--len': Math.max(6, len(title)) } as CSSProperties}>
          <Words text={title} />
        </h2>
        {winners ? null : (
          <p className="sd-scene__tagline">
            <Flourish />
            <span>{sub}</span>
            <Flourish />
          </p>
        )}
        {winners ? <PrizeWinners podium={podium} stars={stars} copy={LOOK_COPY[look].showcase} /> : null}
      </div>
      {ticket ? (
        <JoinTicket code={code} look={look} size={ticket} />
      ) : card === 'welcome' ? (
        <JoinHint code={code} look={look} className="sd-scene__join" />
      ) : null}
    </section>
  );
}

/**
 * Cinema (cinema.ts) as a stage draws it. The presenter's own screens show the frame with what's
 * playing (their stage window plays the video itself, in a layer over this). Every other screen
 * gets the cartoon-break card: the video lives only in the presenter's browser.
 */
export function CinemaScene({ look }: { look: ShowdownLook }) {
  const live = useCinema();
  // The Presenter Tour's pretend video (never the presenter's own clips).
  const cinema = useShowExtras().cinema ?? live;
  const copy = LOOK_COPY[look].showcase;
  const clip = cinema.clips.find((c) => c.id === cinema.clipId);
  if (clip) {
    const status = cinema.playing ? '▶ Playing' : cinema.ended ? 'The end' : 'Ready';
    return (
      <div className="sd-cinema sd-cinema--mock" data-frame={cinema.frame} data-look={look} data-part="showdown-cinema-preview">
        <p className="sd-cinema__marquee">Now showing · {copy.cinemaTitle}</p>
        <div className="sd-cinema__set">
          <span className="sd-cinema__drape sd-cinema__drape--l" />
          <span className="sd-cinema__drape sd-cinema__drape--r" />
          <div className="sd-cinema__glass">
            <p className="sd-cinema__mockplay">
              <b>{status}</b>
              <span className="sd-cinema__mockname">{clip.name}</span>
              <span className="sd-num">
                {clipTime(cinema.time)} / {clipTime(cinema.duration)}
              </span>
            </p>
          </div>
          <div className="sd-cinema__side" aria-hidden>
            <i className="sd-cinema__knob" />
            <i className="sd-cinema__knob" />
            <i className="sd-cinema__grille" />
          </div>
          <p className="sd-cinema__plaque">{copy.cinemaKicker}</p>
        </div>
      </div>
    );
  }
  return (
    <section className="sd-scene sd-scene--card" data-card="cinema" aria-label={copy.cinemaTitle}>
      <div className="sd-scene__rays" aria-hidden />
      <div className="sd-scene__halo" aria-hidden />
      <div className="sd-scene__lockup sd-scene__lockup--card">
        <CardArt card="break" look={look} />
        <p className="sd-scene__kicker">
          <Words text={copy.cinemaKicker} />
        </p>
        <h2 className="sd-scene__headline" style={{ '--len': Math.max(6, len(copy.cinemaTitle)) } as CSSProperties}>
          <Words text={copy.cinemaTitle} />
        </h2>
        <p className="sd-scene__tagline">
          <Flourish />
          <span>{copy.cinemaSub}</span>
          <Flourish />
        </p>
      </div>
    </section>
  );
}

/**
 * The awards ceremony (awards.ts) as a stage draws it. On the presenter's device (their stage window
 * and preview): the title card, then each category's podium (2nd, 1st, 3rd) as the console reveals
 * 3rd → 2nd → 1st, with each winner's photo and name, and fireworks over the last winner. Everywhere
 * else the awards live only in the presenter's browser: the "Awards on stage" card.
 */
export function AwardsScene({ look, motion }: { look: ShowdownLook; motion: MotionPrefs }) {
  const live = useAwards();
  // The Presenter Tour's pretend ceremony (never the presenter's own winners).
  const awards = useShowExtras().awards ?? live;
  const copy = LOOK_COPY[look].showcase;
  const steps = awardSteps(awards.categories);
  const at = Math.min(awards.at, steps.length - 1);
  const step = at >= 0 ? steps[at] : undefined;
  if (!step) {
    return (
      <section className="sd-scene sd-scene--card" data-card="awards" aria-label={copy.awardsAway}>
        <div className="sd-scene__rays" aria-hidden />
        <div className="sd-scene__halo" aria-hidden />
        <div className="sd-scene__lockup sd-scene__lockup--card">
          <CardArt card="prizes" look={look} />
          <p className="sd-scene__kicker">
            <Words text={copy.awardsTitle} />
          </p>
          <h2 className="sd-scene__headline" style={{ '--len': 16 } as CSSProperties}>
            <Words text="Awards on stage" />
          </h2>
          <p className="sd-scene__tagline">
            <Flourish />
            <span>Watch the Teams share</span>
            <Flourish />
          </p>
        </div>
      </section>
    );
  }
  if (step.kind === 'title' || step.kind === 'thanks') {
    return (
      <section
        className="sd-scene sd-scene--card sd-scene--awards"
        data-part="showdown-awards"
        data-step="title"
        aria-label={copy.awardsTitle}
      >
        <div className="sd-scene__rays" aria-hidden />
        <div className="sd-scene__halo" aria-hidden />
        <div className="sd-scene__lockup sd-scene__lockup--card">
          <CardArt card="prizes" look={look} />
          <h2 className="sd-scene__headline" style={{ '--len': Math.max(8, len(copy.awardsTitle)) } as CSSProperties}>
            <Words text={copy.awardsTitle} />
          </h2>
          <p className="sd-scene__tagline">
            <Flourish />
            <span>{copy.awardsSub}</span>
            <Flourish />
          </p>
        </div>
      </section>
    );
  }
  const category = awards.categories[step.cat];
  if (!category) return null;
  const shown = revealedPlaces(steps, at, step.cat);
  const columns = ([2, 1, 3] as const).filter((p) => category.places[p - 1].name.trim() !== '');
  return (
    <section
      className="sd-scene sd-scene--finale sd-scene--podium sd-scene--awards"
      data-part="showdown-awards"
      data-step={step.kind === 'place' ? `place-${step.place}` : 'category'}
      aria-label={category.title}
    >
      <div className="sd-scene__rays" aria-hidden />
      <div className="sd-scene__halo" aria-hidden />
      <div className="sd-scene__lockup sd-scene__lockup--finale">
        <p className="sd-scene__kicker">
          <Words text={copy.awardsTitle} />
        </p>
        <h2 className="sd-scene__headline sd-podium__title" style={{ '--len': Math.max(10, len(category.title)) } as CSSProperties}>
          <Words text={category.title} />
        </h2>
        <ol className="sd-podium sd-podium--awards" aria-label={category.title}>
          {columns.map((place: AwardPlace) => {
            const up = shown.has(place);
            const entry = category.places[place - 1];
            const photo = entry.photo ? awards.photos[entry.photo] : undefined;
            return (
              <li
                key={place}
                className="sd-podium__place"
                data-rank={place}
                data-up={up ? 'true' : undefined}
                aria-label={up ? `${placeWord(place)}: ${entry.name}` : `${placeWord(place)}: coming up`}
              >
                <div className="sd-podium__who" aria-hidden>
                  {up ? (
                    <>
                      <span className="sd-award__photo" data-empty={photo ? undefined : 'true'}>
                        {photo ? <img src={photo} alt="" /> : <span>{initials(entry.name)}</span>}
                      </span>
                      <span className="sd-podium__name">{entry.name}</span>
                    </>
                  ) : (
                    <>
                      <span className="sd-award__photo sd-award__photo--hidden">
                        <span>?</span>
                      </span>
                      <span className="sd-podium__name sd-podium__name--hidden">?</span>
                    </>
                  )}
                </div>
                <div className="sd-podium__block" aria-hidden>
                  <span className="sd-podium__rank">
                    <Nums text={placeWord(place)} />
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      {fireworksAt(steps, at) ? <Fireworks motion={motion} /> : null}
    </section>
  );
}

/** "Morgan R." → "MR" (a winner without a photo). */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => Array.from(w)[0]!.toUpperCase())
    .join('');
}

/** The lobby before the show (no card up): a holding screen with the event, the show and the code. */
export function LobbyScene({
  settings,
  look,
  code,
  rehearsal,
  qr = false,
}: {
  settings: ShowdownSettings | null;
  look: ShowdownLook;
  code: string;
  rehearsal: boolean;
  /** Draw the big join ticket (the stage window, the console, big screens; never phones). */
  qr?: boolean;
}) {
  const show = settings ? showTitle(settings) : 'DAS Survey Showdown';
  const event = settings ? eventTitle(settings) : show;
  const copy = LOOK_COPY[look].showcase;
  const ticket = qr && Boolean(code);
  return (
    <section className="sd-scene sd-scene--lobby" aria-label={show} data-ticket={ticket ? 'big' : undefined}>
      <div className="sd-scene__rays" aria-hidden />
      <div className="sd-scene__halo" aria-hidden />
      <div className="sd-scene__lockup">
        {event !== show ? (
          <p className="sd-scene__kicker">
            <Words text={event} />
          </p>
        ) : null}
        <span className="sd-logo-badge sd-scene__badge" aria-hidden>
          DAS
        </span>
        <Marquee title={show} className="sd-scene__marquee--lobby" />
        <p className="sd-scene__tagline">
          <Flourish />
          <span>{fill(copy.startsSoon, { show: 'The show' })}</span>
          <Flourish />
        </p>
        {rehearsal ? <span className="sd-tag sd-scene__tag">{copy.rehearsal}</span> : null}
      </div>
      {ticket ? <JoinTicket code={code} look={look} size="big" /> : <JoinHint code={code} look={look} className="sd-scene__join" />}
    </section>
  );
}

/**
 * The closing, paced by the presenter (the room's `finaleStep`): "That's a wrap!" with each round's
 * recap; then, with two-tier scoring, the Spotlight Stars ceremony and the podium, 3rd → 2nd → 1st.
 * Without a podium or medals it's the wrap alone (no team winner is ever invented).
 */
export function FinaleScene({
  finale,
  settings,
  look,
  titles,
  step = 0,
}: {
  finale: ShowdownFinale;
  settings: ShowdownSettings | null;
  look: ShowdownLook;
  titles: readonly string[];
  step?: number;
}) {
  const show = settings ? showTitle(settings) : 'DAS Survey Showdown';
  const copy = LOOK_COPY[look].showcase;
  const view = finaleView(finale, step);
  if (view.kind === 'medals') return <FinaleStars key="medals" stars={finale.stars ?? []} show={show} copy={copy} />;
  if (view.kind !== 'wrap') return <FinalePodium key="podium" podium={finale.podium ?? []} view={view} show={show} copy={copy} />;
  return (
    <section className="sd-scene sd-scene--finale" aria-label={copy.wrap}>
      <div className="sd-scene__rays" aria-hidden />
      <div className="sd-scene__halo" aria-hidden />
      <div className="sd-scene__lockup sd-scene__lockup--finale">
        <p className="sd-scene__kicker">
          <Words text={show} />
        </p>
        <h2 className="sd-scene__wrap">
          <Words text={copy.wrap} />
        </h2>
        <p className="sd-scene__tagline">
          <Flourish />
          <span>{copy.wrapSub}</span>
          <Flourish />
        </p>
        {finale.results.length ? (
          <ol className="sd-recap" aria-label="Rounds">
            {finale.results.map((r, i) => {
              const found = r.found ?? 0;
              const total = r.total ?? 0;
              const title = titles[r.index] ?? '';
              return (
                <li
                  key={r.index}
                  className="sd-recap__round"
                  data-perfect={total > 0 && found === total ? 'true' : undefined}
                  style={{ '--i': i, '--k': total > 0 ? found / total : 0 } as CSSProperties}
                >
                  <span className="sd-recap__label">
                    Round <span className="sd-num">{r.index + 1}</span>
                  </span>
                  <span className="sd-recap__title">{title || `Round ${r.index + 1}`}</span>
                  <span className="sd-recap__score">
                    <span className="sd-num sd-recap__found">{found}</span>
                    <span className="sd-recap__of">
                      /<span className="sd-num">{total}</span>
                    </span>
                  </span>
                  <span className="sd-recap__line">{fill(copy.recap, { found, total })}</span>
                  <span className="sd-recap__meter" aria-hidden>
                    <i />
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Two-tier scoring: the Standings card, the medal wall, the podium, Prize time's winners
// ---------------------------------------------------------------------------

/** Text with its numbers in the number face. */
function Nums({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\d+)/).map((part, i) =>
        /^\d+$/.test(part) ? (
          <span key={i} className="sd-num">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * The medal wall: names with their medals (icons and counts), Olympic order as given. Each kind anyone
 * holds gets a column, so the medals line up from row to row (a blank where someone has none). With
 * `split`, more than four names go in two columns (down the first, then the second).
 */
export function StarsWall({
  stars,
  max = 8,
  split = false,
  className,
}: {
  stars: readonly ShowdownStar[];
  max?: number;
  split?: boolean;
  className?: string;
}) {
  const shown = stars.slice(0, max);
  const kinds = medalKindsHeld(shown);
  const columns = split && shown.length > 4;
  return (
    <ol
      className={`sd-starwall ${className ?? ''}`}
      aria-label="Spotlight Stars"
      data-split={columns ? 'true' : undefined}
      style={{ '--kinds': kinds.length, '--rows': Math.ceil(shown.length / 2) } as CSSProperties}
    >
      {shown.map((star, i) => (
        <li
          key={star.playerId}
          className="sd-starwall__row"
          style={{ '--i': i } as CSSProperties}
          aria-label={`${star.name}: ${medalWords(star.medals)}`}
        >
          <span className="sd-starwall__name">{star.name}</span>
          <span className="sd-starwall__medals" aria-hidden>
            {medalCells(star.medals, kinds).map((m) => (
              <span key={m.kind} className="sd-starwall__medal" data-medal={m.kind} title={m.count ? m.title : undefined}>
                {m.count ? <span className="sd-starwall__icon">{m.icon}</span> : null}
                {m.count > 1 ? <span className="sd-num sd-starwall__count">×{m.count}</span> : null}
              </span>
            ))}
          </span>
        </li>
      ))}
    </ol>
  );
}

function LegendLine({ label, items }: { label: string; items: readonly LegendItem[] }) {
  return (
    <div className="sd-legend__line">
      <dt className="sd-legend__label">{label}</dt>
      {items.map((item) => (
        <dd key={item.key} className="sd-legend__item" data-key={item.key}>
          {item.icon ? (
            <span className="sd-legend__icon" role="img" aria-label={item.title}>
              {item.icon}
            </span>
          ) : null}
          <span>
            <Nums text={item.text} />
          </span>
        </dd>
      ))}
    </div>
  );
}

/** The key under the scores: how points add up and what earns each medal (in the columns' order: points, then medals). */
export function ScoreLegend({ medals, points, gems, copy }: { medals: boolean; points: boolean; gems: boolean; copy: ShowcaseCopy }) {
  if (!medals && !points) return null;
  return (
    <dl className="sd-legend" data-part="showdown-legend">
      {points ? <LegendLine label={copy.legendPoints} items={pointsLegend(gems)} /> : null}
      {medals ? <LegendLine label={copy.legendMedals} items={medalLegend()} /> : null}
    </dl>
  );
}

function StandingRows({ rows, copy }: { rows: readonly ShowdownScoreRow[]; copy: ShowcaseCopy }) {
  return (
    <ol className="sd-standings__list" aria-label={copy.standingsTitle}>
      {rows.map((row, i) => (
        <li
          key={row.playerId}
          className="sd-standings__row"
          data-rank={row.rank}
          style={{ '--i': i } as CSSProperties}
          aria-label={`${placeWord(row.rank)}: ${row.name}, ${row.points} ${copy.pts}`}
        >
          <span className="sd-standings__rank sd-num" aria-hidden>
            {row.rank}
          </span>
          <span className="sd-standings__name" aria-hidden>
            {row.name}
          </span>
          <span className="sd-standings__pts" aria-hidden>
            <span className="sd-num">{row.points}</span> {copy.pts}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The Standings card (between rounds): the top five Guessers and, with medals after each round, the
 * Spotlight Stars. With both, each gets its own column and heading (points and medals never mix),
 * under the card's name; a legend below says what earns each medal and how points add up. No join
 * ticket: the presenter shares this card to the meeting (the Join pop-up, J, is there for latecomers).
 */
export function StandingsScene({
  scoreboard,
  look,
  gems = false,
}: {
  scoreboard: ShowdownScoreboard | null;
  look: ShowdownLook;
  /** Hidden gems pay double (the legend says so). */
  gems?: boolean;
}) {
  const copy = LOOK_COPY[look].showcase;
  const points = Boolean(scoreboard?.points);
  const top = scoreboard?.points ? scoreboard.top : [];
  const stars = scoreboard && scoreboard.medals === 'round' ? scoreboard.stars : [];
  const both = points && stars.length > 0;
  const rows = top.length ? (
    <StandingRows rows={top} copy={copy} />
  ) : (
    <p className="sd-scene__tagline sd-standings__empty">{copy.standingsEmpty}</p>
  );
  const of =
    scoreboard?.points && scoreboard.of > top.length ? (
      <p className="sd-standings__of">
        <Nums text={fill(copy.standingsOf, { n: scoreboard.of })} />
      </p>
    ) : null;
  return (
    <section
      className="sd-scene sd-scene--card sd-scene--standings"
      data-part="showdown-standings"
      data-both={both ? 'true' : undefined}
      data-medals-only={!points && stars.length ? 'true' : undefined}
      aria-label={copy.standingsTitle}
    >
      <div className="sd-scene__rays" aria-hidden />
      <div className="sd-scene__halo" aria-hidden />
      <div className="sd-scene__lockup sd-scene__lockup--standings">
        {both ? (
          <h2 className="sd-scene__headline sd-standings__title">
            <Words text={copy.standingsKicker} />
          </h2>
        ) : (
          <>
            <p className="sd-scene__kicker">
              <Words text={copy.standingsKicker} />
            </p>
            <h2 className="sd-scene__headline sd-standings__title" style={{ '--len': 14 } as CSSProperties}>
              <Words text={points ? copy.standingsTitle : copy.stars} />
            </h2>
          </>
        )}
        {both ? (
          <div className="sd-standings">
            <div className="sd-standings__col" data-part="showdown-standings-points">
              <h3 className="sd-standings__head">
                <span className="sd-standings__sub">{copy.standingsTitle}</span>
                <span className="sd-standings__hint">{copy.pointsSub}</span>
              </h3>
              {rows}
            </div>
            <div className="sd-standings__col" data-part="showdown-standings-stars">
              <h3 className="sd-standings__head">
                <span className="sd-standings__sub">{copy.stars}</span>
                <span className="sd-standings__hint">{copy.starsSub}</span>
              </h3>
              <StarsWall stars={stars} max={5} />
            </div>
          </div>
        ) : (
          <div className="sd-standings">
            {points ? rows : null}
            {stars.length ? <StarsWall stars={stars} max={6} /> : null}
          </div>
        )}
        {of}
        <ScoreLegend medals={stars.length > 0} points={points} gems={gems} copy={copy} />
      </div>
    </section>
  );
}

/** The finale's medal ceremony. */
function FinaleStars({ stars, show, copy }: { stars: readonly ShowdownStar[]; show: string; copy: ShowcaseCopy }) {
  return (
    <section className="sd-scene sd-scene--finale sd-scene--stars" data-part="showdown-finale-stars" aria-label={copy.stars}>
      <div className="sd-scene__rays" aria-hidden />
      <div className="sd-scene__halo" aria-hidden />
      <div className="sd-scene__lockup sd-scene__lockup--finale">
        <p className="sd-scene__kicker">
          <Words text={show} />
        </p>
        <h2 className="sd-scene__headline" style={{ '--len': 16 } as CSSProperties}>
          <Words text={copy.stars} />
        </h2>
        <p className="sd-scene__tagline">
          <Flourish />
          <span>{copy.starsSub}</span>
          <Flourish />
        </p>
        <StarsWall stars={stars} max={8} split className="sd-starwall--finale" />
        <ScoreLegend medals points={false} gems={false} copy={copy} />
      </div>
    </section>
  );
}

/** The finale's podium: 2nd, 1st, 3rd; each place revealed in turn (3rd → 2nd → 1st), ties together. */
function FinalePodium({
  podium,
  view,
  show,
  copy,
}: {
  podium: readonly ShowdownScoreRow[];
  view: FinaleView;
  show: string;
  copy: ShowcaseCopy;
}) {
  const columns = podiumColumns(podium);
  return (
    <section
      className="sd-scene sd-scene--finale sd-scene--podium"
      data-part="showdown-finale-podium"
      data-step={view.kind}
      aria-label={copy.podium}
    >
      <div className="sd-scene__rays" aria-hidden />
      <div className="sd-scene__halo" aria-hidden />
      <div className="sd-scene__lockup sd-scene__lockup--finale">
        <p className="sd-scene__kicker">
          <Words text={show} />
        </p>
        <h2 className="sd-scene__headline sd-podium__title" style={{ '--len': 16 } as CSSProperties}>
          <Words text={copy.podium} />
        </h2>
        <ol className="sd-podium" aria-label={copy.podium}>
          {columns.map((col) => {
            const up = view.places.has(col.rank);
            return (
              <li
                key={col.rank}
                className="sd-podium__place"
                data-rank={col.rank}
                data-up={up ? 'true' : undefined}
                aria-label={
                  up
                    ? `${placeWord(col.rank)}: ${col.rows.map((r) => `${r.name}, ${r.points} ${copy.pts}`).join('; ')}`
                    : `${placeWord(col.rank)}: coming up`
                }
              >
                <div className="sd-podium__who" aria-hidden>
                  {up ? (
                    col.rows.map((r) => (
                      <span key={r.playerId} className="sd-podium__name">
                        {r.name}
                      </span>
                    ))
                  ) : (
                    <span className="sd-podium__name sd-podium__name--hidden">?</span>
                  )}
                  {up ? (
                    <span className="sd-podium__pts">
                      <span className="sd-num">{col.rows[0]!.points}</span> {copy.pts}
                    </span>
                  ) : null}
                </div>
                <div className="sd-podium__block" aria-hidden>
                  <span className="sd-podium__rank">
                    <Nums text={placeWord(col.rank)} />
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/** Prize time with the finale's winners: the podium and the medal winners. */
function PrizeWinners({
  podium,
  stars,
  copy,
}: {
  podium: readonly ShowdownScoreRow[];
  stars: readonly ShowdownStar[];
  copy: ShowcaseCopy;
}) {
  return (
    <div className="sd-prizes" data-part="showdown-prize-winners">
      {podium.length ? (
        <div className="sd-prizes__block">
          <p className="sd-standings__sub">{copy.podium}</p>
          <ol className="sd-prizes__list" aria-label={copy.podium}>
            {[...podium]
              .sort((a, b) => a.rank - b.rank)
              .map((r) => (
                <li key={r.playerId} className="sd-prizes__row" data-rank={r.rank}>
                  <span className="sd-prizes__place">
                    <Nums text={placeWord(r.rank)} />
                  </span>
                  <span className="sd-prizes__name">{r.name}</span>
                  <span className="sd-prizes__pts">
                    <span className="sd-num">{r.points}</span> {copy.pts}
                  </span>
                </li>
              ))}
          </ol>
        </div>
      ) : null}
      {stars.length ? (
        <div className="sd-prizes__block">
          <p className="sd-standings__sub">{copy.stars}</p>
          <StarsWall stars={stars} max={6} />
        </div>
      ) : null}
    </div>
  );
}
