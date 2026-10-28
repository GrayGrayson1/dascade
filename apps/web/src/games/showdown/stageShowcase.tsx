/**
 * Presenter Showcase — the public stage the whole call watches (stage window, big-screen devices, the
 * console's preview). One big Top-10 board is the star: the host on the left, the board in the
 * middle, the round's status (clock, answers found, the special answer) on the right. Around it, full
 * stage scenes (scenes.tsx): the opening, each round's category card, the holding cards and the wrap.
 *
 * Moments, from the show feed (fx.ts), each keyed so it can repeat and never blocks the next one:
 *   - a wrong answer: an oversized circled ✕ slams in (a stage shake on big screens), gone in 1.4 s;
 *   - the special answer (or the presenter's Celebrate cue): the show's crescendo — lights up, a
 *     banner with the answer, Halloween-shaped confetti, bats, the board glowing, the host celebrating;
 *   - Reveal remaining: the lights dim, a "Revealing the rest…" strip, the hidden special tile in a
 *     pulsing spotlight during the drumroll; the swept tiles flip in as muted "late" tiles;
 *   - the whole board up: "Board complete!" (bigger when the crowd found everything);
 *   - a pick (PCK-01 D): the Spotlight overlay sweeps the audience's seats and lands on the person the
 *     server drew (PickerSpotlight.tsx), then the hot-seat podium holds their name in the host's
 *     column for the whole turn while Boo steps aside (HotSeat.tsx, VIS-02 C).
 *
 * Two-tier scoring (when the show scores the crowd or gives medals): called-it pops on flipped tiles
 * ("+9 · 6 called it"), medals pinned on the hot-seat podium, the Standings card between rounds, and
 * the paced finale — the Spotlight Stars, then the podium 3rd → 2nd → 1st (scenes.tsx, standings.ts).
 *
 * Display profiles (DSP-02 C, display.ts): the stage picks Stream-safe or Projector for the way it's
 * watched (`data-display` on the root; the CSS does the rest) and caps its particles on Stream-safe.
 * Its fonts are pinned to the show's (never the viewer's DASCADE theme).
 *
 * Public data only: the board, settings, the synchronized show state and the feed. Sizes are
 * container units (the stage is a size container), so 1920×1080, 1280×720, 4:3 and the console's
 * small preview all compose the same way.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  showTitle,
  type ShowdownBoardView,
  type ShowdownCard,
  type ShowdownFinale,
  type ShowdownFinaleStepKind,
  type ShowdownLook,
  type ShowdownSettings,
} from '@dascade/shared/games/showdown';
import { cx } from '@dascade/ui';
import { Board, SpecialGlyph } from './Board.tsx';
import { Backdrop, Bulbs } from './Decor.tsx';
import { HostFigure } from './Host.tsx';
import {
  LOOK_COPY,
  cardLine,
  categoryLine,
  farewellLine,
  fill,
  idleLine,
  landLine,
  openingLine,
  pickEndLine,
  pickLine,
  type HostLine,
  type HostMood,
  type LookCopy,
} from './look.ts';
import { useShowFeed, type ShowFeed } from './fx.ts';
import {
  formatClock,
  useBoard,
  useCard,
  useClock,
  useFinale,
  useFinaleStep,
  useMotion,
  useRehearsal,
  useSceneCard,
  useScoreboard,
  useShowCode,
  useShowPhase,
  useStandingsCard,
  useSweep,
  type ClockView,
  type MotionPrefs,
} from './state.ts';
import { BatBurst, Beams, Confetti, Reactions, useRecent } from './stageFx.tsx';
import { CardScene, CategoryScene, CinemaScene, FinaleScene, JoinHint, LobbyScene, OpeningScene, StandingsScene } from './scenes.tsx';
import { finaleView, placeWord } from './standings.ts';
import type { BoardPops } from './Board.tsx';
import { playersEqual } from '../../net/hooks.ts';
import { useShowSelector } from './source.ts';
import { SHOW_FONTS, useDisplay, type DisplayContext } from './display.ts';
import { PickerSpotlight, usePickMoment, type PickMoment } from './PickerSpotlight.tsx';
import { HotSeat, hotSeatUp } from './HotSeat.tsx';
import type { ShowdownDisplay } from '@dascade/shared/games/showdown';

export type ShowcaseScene = 'lobby' | 'card' | 'standings' | 'cinema' | 'opening' | 'category' | 'board' | 'finale';

/** How long each moment stays up (ms). */
const MISS_MS = 1400;
const CELEBRATE_MS = 4400;
const COMPLETE_MS = 4200;
/** The server's drumroll beat is 2.6 s; the spotlight ends anyway the moment the tile flips. */
const SUSPENSE_MS = 3400;
const TIMEUP_MS = 2600;
const FINALE_FX_MS = 6500;
/** A reaction batch this big (in 250 ms) is a cheering crowd: the host joins in. */
const CROWD_COUNT = 6;
const BUBBLE_MS = 5600;
/** When the host has walked on in the opening (matches sd-host-enter + the bubble delay in the CSS). */
const OPENING_HOST_MS = 4300;
const TALK_MS = 2600;
/** Stream-safe caps the particles at the "low" effects level. */
const STREAM_PARTICLES = 18;

interface ShowcaseStageProps {
  look: ShowdownLook;
  settings: ShowdownSettings | null;
  variant: 'screen' | 'preview';
  corner?: ReactNode;
  /** Where this stage is drawn, when the caller knows (otherwise display.ts works it out from the page). */
  display?: DisplayContext;
}

export function ShowcaseStage({ look, settings, variant, corner, display: displayContext }: ShowcaseStageProps) {
  const board = useBoard();
  const finale = useFinale();
  const phase = useShowPhase();
  const code = useShowCode();
  const card = useCard();
  const standings = useStandingsCard();
  const sceneCard = useSceneCard();
  const scoreboard = useScoreboard();
  const finaleStep = useFinaleStep();
  const sweep = useSweep();
  const rehearsal = useRehearsal();
  const clock = useClock();
  const feed = useShowFeed();
  const viewer = useMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const display = useDisplay(rootRef, settings?.display, displayContext);
  const motion = useStageMotion(viewer, display);
  const pick = usePickMoment();
  const nameOf = useNameOf(pick);
  const titles = useRoundTitles(board, code);
  const copy = LOOK_COPY[look];
  const show = settings ? showTitle(settings) : 'DAS Survey Showdown';

  const inShow = phase === 'PLAYING' && board !== null;
  const scene: ShowcaseScene = standings
    ? 'standings'
    : sceneCard === 'cinema'
      ? 'cinema'
      : card
        ? 'card'
        : inShow
          ? board.stage === 'intro'
            ? 'opening'
            : board.stage === 'title'
              ? 'category'
              : 'board'
          : phase === 'RESULTS' && finale
            ? 'finale'
            : 'lobby';
  const sceneAt = useSince(scene);
  const wipe = useSceneWipe(scene);
  // The podium holds the name on the board (a holding card or a title card hides it, the turn goes on).
  const podium = hotSeatUp(pick) && scene === 'board';
  // Two-tier scoring: pops on flipped tiles (Score the crowd + Called-it pops), medals on the podium.
  const pops = useMemo<BoardPops | null>(
    () => (settings?.points && settings.pops ? { gems: settings.gems, called: copy.showcase.popCalled } : null),
    [settings?.points, settings?.pops, settings?.gems, copy],
  );
  const medals = Boolean(settings && settings.medals !== 'never');
  const finaleKind = scene === 'finale' && finale ? finaleView(finale, finaleStep).kind : null;

  // ---- moments ----
  const miss = feed.last.miss;
  const missOn = useRecent(miss?.at, MISS_MS);
  const cel = feed.celebrate;
  const celebrating = useRecent(cel?.at, CELEBRATE_MS);
  const lastReveal = feed.last.reveal;
  // Only while that board is still the one up (a fast Next round never carries the flourish over).
  const clearedAt = lastReveal?.e.cleared && board?.stage === 'done' ? lastReveal.at : undefined;
  // A special answer that also completes the board: the banner first, then the board's flourish.
  const completeDelay = clearedAt !== undefined && cel && Math.abs(cel.at - clearedAt) < 250 ? 3600 : 0;
  const complete = useRecent(clearedAt, COMPLETE_MS + completeDelay) && scene === 'board';
  const suspense = feed.last.suspense;
  const suspenseSlot =
    useRecent(suspense?.at, SUSPENSE_MS) &&
    sweep &&
    board &&
    suspense &&
    board.slots[suspense.e.slot] &&
    !board.slots[suspense.e.slot]!.revealed
      ? suspense.e.slot
      : -1;
  const timeupOn = useRecent(feed.last.timeup?.at, TIMEUP_MS);
  const crowd = useRecent(feed.cheer && feed.cheer.count >= CROWD_COUNT ? feed.cheer.at : undefined, 1400);
  const finaleFx = useRecent(scene === 'finale' ? sceneAt : undefined, FINALE_FX_MS);
  // The podium's 1st place: the confetti again.
  const firstAt = useSince(finaleKind === 'first' ? 'first' : null);
  const firstFx = useRecent(firstAt, FINALE_FX_MS);

  const shake = missOn && motion.motion && variant === 'screen' && miss ? `${miss.e.round}:${miss.e.n}` : undefined;
  const found = board ? board.slots.filter((s) => s.revealed && !s.late).length : 0;
  const total = board?.slots.length ?? 0;

  return (
    <div
      ref={rootRef}
      className={cx('sd-stage', `sd-stage--${variant}`)}
      style={SHOW_FONTS as CSSProperties}
      data-mode="showcase"
      data-display={display}
      data-look={look}
      data-scene={scene}
      data-stage={inShow ? board.stage : phase === 'RESULTS' ? 'finale' : 'lobby'}
      data-motion={motion.motion ? 'on' : 'off'}
      data-fx={motion.fx}
      data-sweep={sweep && scene === 'board' ? 'true' : undefined}
      data-suspense={suspenseSlot >= 0 && scene === 'board' ? 'true' : undefined}
      data-celebrate={celebrating ? 'true' : undefined}
      data-shake={shake}
      data-picking={pick.phase !== 'idle' && pick.hotSeat ? pick.phase : undefined}
      data-hotseat={podium ? 'true' : undefined}
    >
      <Backdrop look={look} fx={motion.fx} />
      <Bulbs />
      <div className="sd-sc">
        {scene === 'board' && board ? (
          <BoardScene
            key={`board:${board.round}`}
            board={board}
            show={show}
            copy={copy}
            look={look}
            code={code}
            clock={clock}
            rehearsal={rehearsal}
            sweep={sweep}
            suspenseSlot={suspenseSlot}
            timeup={timeupOn}
            hotseat={podium ? <HotSeat moment={pick} board={board} copy={copy.showcase} medals={medals} /> : null}
            pops={pops}
          />
        ) : scene === 'standings' ? (
          <StandingsScene scoreboard={scoreboard} look={look} />
        ) : scene === 'cinema' ? (
          <CinemaScene look={look} />
        ) : scene === 'card' && card ? (
          <CardScene card={card} settings={settings} look={look} code={code} finale={phase === 'RESULTS' ? finale : null} />
        ) : scene === 'opening' ? (
          <OpeningScene settings={settings} look={look} code={code} rehearsal={rehearsal} />
        ) : scene === 'category' && board ? (
          <CategoryScene board={board} look={look} />
        ) : scene === 'finale' && finale ? (
          <FinaleScene finale={finale} settings={settings} look={look} titles={titles} step={finaleStep} />
        ) : (
          <LobbyScene settings={settings} look={look} code={code} rehearsal={rehearsal} />
        )}
      </div>
      <ShowHost
        look={look}
        copy={copy}
        scene={scene}
        board={board}
        card={card}
        finale={finale}
        show={show}
        feed={feed}
        celebrating={celebrating}
        miss={missOn}
        suspense={suspenseSlot >= 0}
        timeup={timeupOn}
        crowd={crowd}
        motion={motion.motion}
        pick={pick}
        nameOf={nameOf}
        finaleKind={finaleKind}
      />
      <PickerSpotlight moment={pick} copy={copy.showcase} motion={motion} />
      {missOn && miss ? <MissX key={`${miss.e.round}:${miss.e.n}:${miss.at}`} /> : null}
      {celebrating && cel ? (
        <Celebration key={cel.key} look={look} copy={copy} text={cel.slot >= 0 ? cel.text : ''} motion={motion} />
      ) : null}
      {complete && board ? (
        <Complete
          key={`complete:${clearedAt}`}
          copy={copy}
          found={found}
          total={total}
          delay={completeDelay}
          particles={celebrating ? 0 : motion.particles}
          look={look}
        />
      ) : null}
      {finaleFx && motion.particles > 0 ? <Confetti key={`finale:${sceneAt}`} count={motion.particles} look={look} big /> : null}
      {firstFx && !finaleFx && motion.particles > 0 ? <Confetti key={`first:${firstAt}`} count={motion.particles} look={look} big /> : null}
      <Reactions feed={feed} look={look} motion={motion} />
      {wipe !== null && motion.motion ? (
        <div key={wipe} className="sd-wipe" aria-hidden>
          <i />
          <i />
        </div>
      ) : null}
      {corner ? <div className="sd-stage__corner">{corner}</div> : null}
    </div>
  );
}

/** How long the scene curtain stays (it opens in about a second; stageShowcase.css). */
const WIPE_MS = 1300;

/**
 * The scene curtain (Scenes A): switching what the stage shows — the Show, a card (or the
 * standings), Cinema — opens a curtain in the show's look on the new scene. Not when a stage first
 * appears, and the caller skips it without motion (reduced motion, effects off).
 */
function useSceneWipe(scene: ShowcaseScene): number | null {
  const group = scene === 'card' || scene === 'standings' ? 'cards' : scene === 'cinema' ? 'cinema' : 'show';
  const last = useRef(group);
  const [at, setAt] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (last.current === group) return;
    last.current = group;
    setAt(performance.now());
  }, [group]);
  const on = useRecent(at ?? undefined, WIPE_MS);
  return on ? at : null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The viewer's motion settings, as this stage uses them: Stream-safe caps the particles (and the bats,
 * the beams) at the "low" effects level — a Teams share spends its bitrate on the board, not confetti.
 */
function useStageMotion(viewer: MotionPrefs, display: ShowdownDisplay): MotionPrefs {
  const { motion, fx, reduced, particles } = viewer;
  return useMemo(
    () =>
      display === 'stream'
        ? { motion, reduced, fx: fx === 'high' ? 'low' : fx, particles: Math.min(particles, STREAM_PARTICLES) }
        : { motion, reduced, fx, particles },
    [display, motion, fx, reduced, particles],
  );
}

/**
 * Players' names for the host's pick lines ("Thanks, Priya!"). The room's feed has no names, so the
 * stage fills them in; someone who left mid-turn is still remembered from the hot seat.
 */
function useNameOf(pick: PickMoment): (playerId: string) => string {
  const players = useShowSelector((s) => s.players, playersEqual);
  const lastHot = useRef({ id: '', name: '' });
  if (pick.hotSeat && pick.name) lastHot.current = { id: pick.hotSeat, name: pick.name };
  return useCallback((id: string) => players?.[id]?.name ?? (id && id === lastHot.current.id ? lastHot.current.name : ''), [players]);
}

/** The performance.now() time `key` last changed (undefined for a null key). */
function useSince(key: string | null): number | undefined {
  const [since, setSince] = useState<{ key: string; at: number } | null>(null);
  useLayoutEffect(() => {
    if (key !== null && since?.key !== key) setSince({ key, at: performance.now() });
  }, [key, since?.key]);
  return key !== null && since?.key === key ? since.at : undefined;
}

/**
 * Each round's category, remembered on this device while the show runs: the finale has the found
 * counts but not the titles (a screen that joins at the very end shows "Round 1", "Round 2"…).
 */
const ROUND_TITLES = new Map<string, string[]>();

function useRoundTitles(board: ShowdownBoardView | null, code: string): readonly string[] {
  const round = board?.round ?? -1;
  const title = board?.title ?? '';
  const [, force] = useState(0);
  useLayoutEffect(() => {
    if (!code || round < 0 || !title) return;
    const list = ROUND_TITLES.get(code) ?? [];
    if (list[round] === title) return;
    const next = [...list];
    next[round] = title;
    ROUND_TITLES.set(code, next);
    force((n) => n + 1);
  }, [code, round, title]);
  return ROUND_TITLES.get(code) ?? [];
}

// ---------------------------------------------------------------------------
// The board scene
// ---------------------------------------------------------------------------

function BoardScene({
  board,
  show,
  copy,
  look,
  code,
  clock,
  rehearsal,
  sweep,
  suspenseSlot,
  timeup,
  hotseat,
  pops,
}: {
  board: ShowdownBoardView;
  show: string;
  copy: LookCopy;
  look: ShowdownLook;
  code: string;
  clock: ClockView;
  rehearsal: boolean;
  sweep: boolean;
  suspenseSlot: number;
  timeup: boolean;
  /** The hot-seat podium (in the host's column, never over the board). */
  hotseat: ReactNode;
  /** Called-it pops on flipped tiles (null = off). */
  pops: BoardPops | null;
}) {
  const sc = copy.showcase;
  const n = board.round + 1;
  const last = board.totalRounds > 1 && n === board.totalRounds;
  return (
    <div className="sd-sc__board">
      <header className="sd-sc__top">
        <div className="sd-sc__brand">
          <span className="sd-logo-badge" aria-hidden>
            DAS
          </span>
          <span className="sd-sc__show" style={{ '--len': Array.from(show).length } as CSSProperties}>
            {show}
          </span>
          {rehearsal ? <span className="sd-tag">{sc.rehearsal}</span> : null}
        </div>
        {sweep ? (
          <div className="sd-sc__strip" data-suspense={suspenseSlot >= 0 ? 'true' : undefined} role="status">
            <SpecialGlyph />
            <span>{suspenseSlot >= 0 ? sc.suspense : sc.sweeping}</span>
          </div>
        ) : null}
        <span className="sd-sc__roundpill" aria-label={board.title ? `Round ${n}: ${board.title}` : `Round ${n}`}>
          {last ? (
            'Final round'
          ) : (
            <>
              Round <span className="sd-num">{n}</span>
              {board.totalRounds > 1 ? (
                <span className="sd-sc__of">
                  {' '}
                  of <span className="sd-num">{board.totalRounds}</span>
                </span>
              ) : null}
            </>
          )}
        </span>
      </header>
      <div className="sd-sc__main">
        <div className="sd-sc__hostcol" data-hot={hotseat ? 'true' : undefined}>
          {hotseat}
        </div>
        <section className="sd-sc__center">
          <header className="sd-sc__header">
            {board.source ? (
              <p className="sd-sc__kicker">
                {sc.according} {board.source}…
              </p>
            ) : null}
            <h2 className="sd-sc__prompt" style={{ '--len': Array.from(board.prompt).length } as CSSProperties}>
              {board.prompt}
            </h2>
          </header>
          <div className="sd-sc__frame">
            <Board board={board} spotlight={suspenseSlot} specialLabel={sc.special} creditLabel={sc.calledBy} pops={pops} />
          </div>
        </section>
        <StatusColumn board={board} copy={copy} look={look} code={code} clock={clock} timeup={timeup} />
      </div>
    </div>
  );
}

function StatusColumn({
  board,
  copy,
  look,
  code,
  clock,
  timeup,
}: {
  board: ShowdownBoardView;
  copy: LookCopy;
  look: ShowdownLook;
  code: string;
  clock: ClockView;
  timeup: boolean;
}) {
  const sc = copy.showcase;
  const found = board.slots.filter((s) => s.revealed && !s.late).length;
  const total = board.slots.length;
  const special = board.special >= 0 ? board.slots[board.special] : undefined;
  const clockShown = clock.on && clock.stage && board.stage === 'live';
  return (
    <aside className="sd-status" aria-label="Round status">
      {clockShown ? <StageClock clock={clock} copy={copy} timeup={timeup} /> : null}
      <div className="sd-status__card sd-found" data-done={board.stage === 'done' ? 'true' : undefined}>
        <span className="sd-found__nums">
          <span className="sd-num sd-found__n">{found}</span>
          <span className="sd-found__of">
            /<span className="sd-num">{total}</span>
          </span>
        </span>
        <span className="sd-status__label">{sc.found}</span>
        <span className="sd-found__pips" aria-hidden>
          {board.slots.map((s, i) => (
            <i
              key={i}
              data-on={s.revealed && !s.late ? 'true' : undefined}
              data-late={s.revealed && s.late ? 'true' : undefined}
              data-special={i === board.special ? 'true' : undefined}
            />
          ))}
        </span>
      </div>
      {special ? (
        <div className="sd-status__card sd-specialcard" data-up={special.revealed ? (special.late ? 'late' : 'found') : undefined}>
          <SpecialGlyph />
          <span className="sd-specialcard__slot">
            #<span className="sd-num">{board.special + 1}</span>
          </span>
          <span className="sd-status__label">{special.revealed ? (special.late ? 'Revealed' : 'Found!') : sc.special}</span>
        </div>
      ) : null}
      <JoinHint code={code} look={look} className="sd-status__join" short />
    </aside>
  );
}

function StageClock({ clock, copy, timeup }: { clock: ClockView; copy: LookCopy; timeup: boolean }) {
  const over = clock.left <= 0;
  const warn = !over && clock.left <= 60_000;
  const k = clock.max > 0 ? Math.max(0, Math.min(1, clock.left / clock.max)) : 0;
  const text = formatClock(Math.max(0, clock.left));
  return (
    <div
      className="sd-status__card sd-clock"
      data-warn={warn ? 'true' : undefined}
      data-over={over ? 'true' : undefined}
      data-paused={clock.running ? undefined : 'true'}
      data-timeup={timeup ? 'true' : undefined}
      role="timer"
      aria-label={over ? copy.showcase.finalGuesses : `${text} left`}
    >
      <span className="sd-clock__dial">
        <svg className="sd-clock__ring" viewBox="0 0 100 100" aria-hidden focusable="false">
          <circle className="sd-clock__track" cx="50" cy="50" r="44" />
          <circle className="sd-clock__arc" cx="50" cy="50" r="44" pathLength={1} style={{ '--k': k } as CSSProperties} />
        </svg>
        {over ? (
          <span className="sd-clock__final" aria-hidden>
            {copy.showcase.finalGuesses}
          </span>
        ) : (
          <span className="sd-num sd-clock__time" aria-hidden>
            {text}
          </span>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The host (one figure for every scene: it glides between them)
// ---------------------------------------------------------------------------

function ShowHost({
  look,
  copy,
  scene,
  board,
  card,
  finale,
  show,
  feed,
  celebrating,
  miss,
  suspense,
  timeup,
  crowd,
  motion,
  pick,
  nameOf,
  finaleKind,
}: {
  look: ShowdownLook;
  copy: LookCopy;
  scene: ShowcaseScene;
  board: ShowdownBoardView | null;
  card: ShowdownCard | null;
  finale: ShowdownFinale | null;
  show: string;
  feed: ShowFeed;
  celebrating: boolean;
  miss: boolean;
  suspense: boolean;
  timeup: boolean;
  crowd: boolean;
  motion: boolean;
  pick: PickMoment;
  nameOf: (playerId: string) => string;
  /** The paced finale's step on screen (null outside the finale). */
  finaleKind: ShowdownFinaleStepKind | null;
}) {
  const fresh = useRecent(feed.line ? feed.lineAt : undefined, BUBBLE_MS);
  let ev = fresh ? feed.line : null;
  // The room's feed thanks people without a name (it doesn't know players): say it with their name.
  const ended = feed.last.pickEnd;
  if (ev && ended && ev.key === `pickEnd:${ended.e.drawNo}:${ended.e.how}`) ev = pickEndLine(look, ended.e, nameOf(ended.e.playerId)) ?? ev;
  // A cue (Celebrate!, applause…) speaks over any scene; otherwise each scene has its own words.
  const cue = ev && ev.key.startsWith('cue:') ? ev : null;
  let line: HostLine | null;
  if (scene === 'card' && card) line = cue ?? cardLine(look, card);
  else if (scene === 'standings') line = cue ?? { key: 'standings', text: copy.showcase.standingsHost, mood: 'happy' };
  else if (scene === 'cinema') line = cue ?? { key: 'cinema', text: copy.showcase.cinemaHost, mood: 'happy' };
  else if (scene === 'finale' && finale && finaleKind === 'medals')
    line = cue ?? { key: 'finale:medals', text: copy.showcase.starsHost, mood: 'cheer' };
  else if (scene === 'finale' && finale && finaleKind && finaleKind !== 'wrap') {
    const place = finaleKind === 'first' ? 1 : finaleKind === 'second' ? 2 : 3;
    line = cue ?? {
      key: `finale:${finaleKind}`,
      text: fill(copy.showcase.podiumHost, { place: placeWord(place) }),
      mood: place === 1 ? 'celebrate' : 'wow',
    };
  } else if (scene === 'finale' && finale) line = cue ?? farewellLine(look, finale);
  else if (scene === 'lobby') line = cue ?? cardLine(look, 'welcome');
  else if (scene === 'opening') line = ev && !/^(intro|reset|undo):/.test(ev.key) ? ev : openingLine(look, show);
  else if (scene === 'category' && board) line = ev && !/^(round|restart|undo):/.test(ev.key) ? ev : categoryLine(look, board);
  // The pick, over the board: the search (never the name), then the landing calls them up.
  else if (pick.phase === 'sweep') line = ev && ev.key === `pick:${pick.drawNo}` ? ev : pickLine(look, { drawNo: pick.drawNo });
  else if (pick.phase === 'card') line = landLine(look, pick.drawNo, pick.name);
  else line = ev ?? (feed.line ? null : idleLine(look, board, ['', ''], show));
  const at = useSince(line?.key ?? null);
  // The opening's welcome waits for the host to walk on (stageShowcase.css delays the bubble to match).
  const delay = scene === 'opening' && motion ? OPENING_HOST_MS : 0;
  const visible = useRecent(at, BUBBLE_MS + delay);
  const talking = useRecent(at, TALK_MS + delay);
  let mood: HostMood = visible && line ? line.mood : 'idle';
  if (celebrating) mood = 'celebrate';
  else if (suspense) mood = 'peek';
  else if (miss) mood = 'shiver';
  else if (timeup) mood = 'startled';
  const cheering = crowd && (mood === 'idle' || mood === 'happy');
  return (
    <div className="sd-sc-host" data-scene={scene} aria-live="polite">
      {line && visible ? (
        <p key={line.key} className="sd-bubble sd-sc-host__bubble">
          {line.text}
        </p>
      ) : null}
      <div className="sd-host" data-mood={mood}>
        <HostFigure look={look} mood={mood} talking={talking && visible} crowd={cheering} />
        <span className="sd-host__plate">
          {copy.hostTitle}: <b>{copy.hostName}</b>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Moments
// ---------------------------------------------------------------------------

/** A wrong answer: an oversized circled ✕ slams in, then it's gone. */
function MissX() {
  return (
    <div className="sd-miss" role="img" aria-label="Wrong answer">
      <i className="sd-miss__flash" aria-hidden />
      <i className="sd-miss__shock" aria-hidden />
      <svg className="sd-miss__x" viewBox="0 0 120 120" aria-hidden focusable="false">
        <circle className="sd-miss__ring" cx="60" cy="60" r="50" />
        <path className="sd-miss__cross" d="M38 38 L82 82 M82 38 L38 82" />
      </svg>
    </div>
  );
}

/** THE moment: the special answer (or the presenter's Celebrate cue). */
function Celebration({ look, copy, text, motion }: { look: ShowdownLook; copy: LookCopy; text: string; motion: MotionPrefs }) {
  const sc = copy.showcase;
  return (
    <div className="sd-celebrate" data-cue={text ? undefined : 'true'} role="status">
      {motion.motion ? <Beams look={look} /> : null}
      <i className="sd-celebrate__flash" aria-hidden />
      <div className="sd-celebrate__banner">
        <span className="sd-celebrate__head">
          <SpecialGlyph />
          <span className="sd-celebrate__title">{text ? sc.specialBanner : sc.cueBanner}</span>
          <SpecialGlyph />
        </span>
        {text ? (
          <span className="sd-celebrate__answer" style={{ '--len': Math.max(8, Array.from(text).length) } as CSSProperties}>
            {text}
          </span>
        ) : null}
      </div>
      {motion.particles > 0 && look === 'halloween' ? <BatBurst count={motion.fx === 'high' ? 8 : 4} /> : null}
      {motion.particles > 0 ? <Confetti count={motion.particles} look={look} big /> : null}
    </div>
  );
}

/** The whole board is up. */
function Complete({
  copy,
  found,
  total,
  delay,
  particles,
  look,
}: {
  copy: LookCopy;
  found: number;
  total: number;
  delay: number;
  particles: number;
  look: ShowdownLook;
}) {
  const sc = copy.showcase;
  const all = found === total && total > 0;
  return (
    <div className="sd-complete" data-all={all ? 'true' : undefined} style={{ '--delay': `${delay}ms` } as CSSProperties} role="status">
      <span className="sd-complete__title">{all ? sc.allFound : sc.complete}</span>
      <span className="sd-complete__sub">
        {fill(sc.completeSub, { found, total })
          .split(/(\d+)/)
          .map((part, i) =>
            /^\d+$/.test(part) ? (
              <span key={i} className="sd-num">
                {part}
              </span>
            ) : (
              part
            ),
          )}
      </span>
      {particles > 0 && !delay ? <Confetti count={all ? particles : Math.round(particles * 0.6)} look={look} big={all} /> : null}
    </div>
  );
}
