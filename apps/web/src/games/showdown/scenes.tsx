/**
 * Presenter Showcase — the full-stage scenes around the board: the opening, a round's category card,
 * the holding cards (welcome, be right back, prize time, thanks — any phase), the lobby's holding
 * screen and the closing "That's a wrap!". Each is a composition of big type over the look's set; the
 * host is drawn by the stage (one figure that glides between scenes), never here.
 *
 * Everything is public (settings, the board's category, the finale's found/total). Motion: the
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
  type ShowdownSettings,
} from '@dascade/shared/games/showdown';
import { SpecialGlyph } from './Board.tsx';
import { LOOK_COPY, fill, joinAddress } from './look.ts';

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
  const words = title.replace(/^DAS\s+/i, '').split(/\s+/).filter(Boolean);
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
export function JoinHint({ code, look, className, short = false }: { code: string; look: ShowdownLook; className?: string; short?: boolean }) {
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
export function OpeningScene({ settings, look, code, rehearsal }: { settings: ShowdownSettings | null; look: ShowdownLook; code: string; rehearsal: boolean }) {
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
        <path d="M16 12 C16 40 36 46 36 55 C36 64 16 70 16 98 L64 98 C64 70 44 64 44 55 C44 46 64 40 64 12 Z" className="sd-cardart__glass" />
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
          <path d="M60 28 l4.4 9.4 10.3 1.2 -7.6 7 2.1 10.1 -9.2 -5.2 -9.2 5.2 2.1 -10.1 -7.6 -7 10.3 -1.2 z" fill="#fff6d0" stroke="#b07a1a" strokeWidth="1.5" strokeLinejoin="round" />
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

/** A holding card, in any phase: welcome / be right back / prize time / thanks. */
export function CardScene({ card, settings, look, code }: { card: ShowdownCard; settings: ShowdownSettings | null; look: ShowdownLook; code: string }) {
  const show = settings ? showTitle(settings) : 'DAS Survey Showdown';
  const event = settings ? eventTitle(settings) : show;
  const c = LOOK_COPY[look].cards[card];
  const vars = { show, event };
  const kicker = fill(c.kicker, vars);
  const title = c.title ? fill(c.title, vars) : event;
  const sub = fill(c.sub, vars);
  return (
    <section className="sd-scene sd-scene--card" data-card={card} aria-label={title} key={card}>
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
        <p className="sd-scene__tagline">
          <Flourish />
          <span>{sub}</span>
          <Flourish />
        </p>
      </div>
      {card === 'welcome' ? <JoinHint code={code} look={look} className="sd-scene__join" /> : null}
    </section>
  );
}

/** The lobby before the show (no card up): a holding screen with the event, the show and the code. */
export function LobbyScene({ settings, look, code, rehearsal }: { settings: ShowdownSettings | null; look: ShowdownLook; code: string; rehearsal: boolean }) {
  const show = settings ? showTitle(settings) : 'DAS Survey Showdown';
  const event = settings ? eventTitle(settings) : show;
  const copy = LOOK_COPY[look].showcase;
  return (
    <section className="sd-scene sd-scene--lobby" aria-label={show}>
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
      <JoinHint code={code} look={look} className="sd-scene__join" />
    </section>
  );
}

/** "That's a wrap!" — the closing: the show's title and a recap of each round. No winner. */
export function FinaleScene({ finale, settings, look, titles }: { finale: ShowdownFinale; settings: ShowdownSettings | null; look: ShowdownLook; titles: readonly string[] }) {
  const show = settings ? showTitle(settings) : 'DAS Survey Showdown';
  const copy = LOOK_COPY[look].showcase;
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
