/**
 * The Presenter Tour's console: a non-interactive picture of the presenter's screens — the lobby's
 * setup and settings, the showcase console and the results page — drawn with the console's own
 * classes, so it looks like the real thing. It reads the demo show through the stage hooks (inside
 * the tour's ShowSourceProvider) and the practice answers from the script. Its buttons never send
 * anything: the whole picture is inert and hidden from screen readers (the captions carry the words).
 *
 * A camera frames it: the whole console, or zoomed towards the control the tour points at, with an
 * animated cursor, a spotlight ring, a press ripple and the shortcut key.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  SHOWDOWN_CARDS,
  SHOWDOWN_CARD_INFO,
  SHOWDOWN_CUES,
  SHOWDOWN_CUE_INFO,
  SHOWDOWN_SCENE_INFO,
  finaleSteps,
  type ShowdownBoardView,
  type ShowdownCard,
  type ShowdownLook,
} from '@dascade/shared/games/showdown';
import { Badge, Button, Kbd, PixelIcon, Spinner, cx, type IconName } from '@dascade/ui';
import { serverNow } from '../../../net/hooks.ts';
import { awardSteps, type AwardCategory, type AwardStep, type AwardsView } from '../awards.ts';
import { CINEMA_FRAMES, clipTime, type CinemaView } from '../cinema.ts';
import { finaleStepWords } from '../panels/scores.ts';
import { useShowExtras, useShowSelector } from '../source.ts';
import { placeWord } from '../standings.ts';
import {
  formatClock,
  useBoard,
  useCard,
  useClock,
  useFinale,
  useFinaleStep,
  usePicker,
  useSceneCard,
  useStandingsCard,
  useSweep,
  type ClockView,
} from '../state.ts';
import { DEMO_CODE, DEMO_ROUNDS, DEMO_SETTINGS, sheetRound } from './script.ts';
import type { LobbyTab, ToolId, TourDialog, TourFrame } from './timeline.ts';
import '../panels/panels.css';
import '../panels/CinemaPanel.css';

/** The lobby's and the results page's size before the camera scales them (px). */
export const MOCK_W = 1120;
export const MOCK_H = 820;
/** The Dashboard console's: wide enough for the sheet, the rail and two columns of tools. */
export const DASH_W = 1400;
export const DASH_H = 960;

interface MockProps {
  look: ShowdownLook;
  frame: TourFrame;
  /** Changes when a beat lands (re-keys the press). */
  landed: number;
  /** The click of this beat has landed. */
  pressed: boolean;
  motion: boolean;
}

export function MockConsole({ look, frame, landed, pressed, motion }: MockProps) {
  let screen: ReactNode;
  if (frame.screen === 'lobby')
    screen = <LobbyScreen look={look} tab={frame.tab} preset={frame.preset} stage={frame.stage} full={frame.full} />;
  else if (frame.screen === 'results') screen = <ResultsScreen />;
  else screen = <ConsoleScreen look={look} frame={frame} landed={landed} />;
  const dash = frame.screen === 'console';
  return (
    <Camera
      w={dash ? DASH_W : MOCK_W}
      h={dash ? DASH_H : MOCK_H}
      point={frame.point}
      zoom={frame.zoom}
      keyHint={frame.key}
      landed={landed}
      pressed={pressed}
      motion={motion}
      screen={`${frame.screen}:${frame.tab}:${frame.dialog ?? ''}:${frame.tool}:${frame.armed}:${frame.undo}:${frame.full}`}
    >
      <div className="tour-mock sdc" data-look={look} data-screen={frame.screen}>
        {screen}
        {/* The console draws its own toasts; the lobby's (Copy QR image) float over it here. */}
        {frame.screen === 'lobby' && frame.toast ? <div className="tour-toast">{frame.toast}</div> : null}
      </div>
    </Camera>
  );
}

// ---------------------------------------------------------------------------
// The camera, the cursor and the spotlight
// ---------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An element's box in the canvas's own (unscaled) pixels. */
function canvasRect(el: HTMLElement, root: HTMLElement): Rect {
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== root) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

/** Frames a fixed-size picture (w × h px) in its box: whole, or zoomed towards `point`, with the cursor. */
export function Camera({
  w: W,
  h: H,
  point,
  zoom,
  keyHint,
  landed,
  pressed,
  motion,
  screen,
  cursor: showCursor = true,
  children,
}: {
  point: string;
  zoom: number;
  keyHint: string;
  landed: number;
  pressed: boolean;
  motion: boolean;
  screen: string;
  /** Draw the cursor (pictures without one: the big-picture diagram). */
  cursor?: boolean;
  children: ReactNode;
  w: number;
  h: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [target, setTarget] = useState<Rect | null>(null);
  // The camera glides only once it has been placed: never a zoom in from nothing as it mounts.
  const [placed, setPlaced] = useState(false);
  useEffect(() => {
    if (!size.w || placed) return;
    const raf = requestAnimationFrame(() => setPlaced(true));
    return () => cancelAnimationFrame(raf);
  }, [size.w, placed]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const root = canvas.current;
    const el = point && root ? root.querySelector<HTMLElement>(`[data-tour="${point}"]`) : null;
    setTarget(el && root ? canvasRect(el, root) : null);
    // Every landing can change the picture under the cursor (Reveal remaining becomes its status).
  }, [point, screen, landed]);

  const base = size.w && size.h ? Math.min(size.w / W, size.h / H) : 0;
  const s = base * (target ? zoom : 1);
  const cx = target ? target.x + target.w / 2 : W / 2;
  const cy = target ? target.y + target.h / 2 : H / 2;
  const fit = (view: number, content: number, center: number) => {
    const span = content * s;
    if (span <= view) return (view - span) / 2;
    return Math.min(0, Math.max(view - span, view / 2 - center * s));
  };
  const tx = fit(size.w, W, cx);
  const ty = fit(size.h, H, cy);
  // The cursor rests at the bottom right when it isn't pointing at anything.
  const cursor = target
    ? { x: target.x + Math.min(target.w * 0.62, target.w - 10), y: target.y + target.h * 0.62 }
    : { x: W - 70, y: H - 50 };

  return (
    <div className="tour-cam" ref={box} data-motion={motion && placed ? 'on' : 'off'}>
      <div
        className="tour-cam__canvas"
        ref={canvas}
        style={{ width: W, height: H, transform: `translate(${tx}px, ${ty}px) scale(${s || 0.0001})` }}
      >
        {children}
        {target ? (
          <span
            className="tour-spot"
            style={{ left: target.x - 8, top: target.y - 8, width: target.w + 16, height: target.h + 16 } as CSSProperties}
            aria-hidden
          />
        ) : null}
        {target && pressed ? <span key={landed} className="tour-ripple" style={{ left: cursor.x, top: cursor.y }} aria-hidden /> : null}
        {showCursor ? (
          <span
            className="tour-cursor"
            data-pressed={pressed ? 'true' : undefined}
            style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
            aria-hidden
          >
            <svg viewBox="0 0 32 40" focusable="false">
              <path d="M3 2 L3 31 L10.5 24.5 L15.5 36 L21 33.6 L16 22.4 L26 22.4 Z" />
            </svg>
            {keyHint ? (
              <span key={`${landed}:${keyHint}`} className="tour-cursor__key">
                <span className="tour-cursor__or">or press</span> <kbd>{keyHint}</kbd>
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The lobby (Your setup / Settings)
// ---------------------------------------------------------------------------

function LobbyScreen({
  look,
  tab,
  preset,
  stage,
  full,
}: {
  look: ShowdownLook;
  tab: LobbyTab;
  preset: boolean;
  stage: boolean;
  full: boolean;
}) {
  const card = useCard();
  return (
    <div className="tour-lobby">
      <header className="tour-lobby__hero">
        <span className="tour-lobby__game">DAS Survey Showdown</span>
        <span className="tour-lobby__code">
          Room <b className="dc-num">{DEMO_CODE}</b>
        </span>
      </header>
      <nav className="tour-lobby__tabs">
        <span className="tour-tab">Players</span>
        <span className="tour-tab" data-on={tab === 'setup' ? 'true' : undefined} data-tour="tab-setup">
          Your setup
        </span>
        <span className="tour-tab" data-on={tab === 'settings' ? 'true' : undefined} data-tour="tab-settings">
          Settings
        </span>
        <span className="tour-tab">Chat</span>
      </nav>
      <div className="tour-lobby__body">
        {tab === 'settings' ? <SettingsTab preset={preset} /> : <SetupTab look={look} stage={stage} full={full} card={card} />}
      </div>
      <footer className="tour-lobby__foot">
        <span className="tour-lobby__who">
          <PixelIcon name="crown" /> You’re the presenter
        </span>
        <Button variant="primary" size="lg" icon="play" data-tour="start-game">
          Start game
        </Button>
      </footer>
    </div>
  );
}

function SettingsTab({ preset }: { preset: boolean }) {
  return (
    <div className="tour-settings">
      <div className="tour-field">
        <span className="dc-field__label">Format</span>
        <div className="tour-formats">
          <span className="tour-format">
            <PixelIcon name="users" /> Team Showdown
          </span>
          <span className="tour-format" data-on="true">
            <PixelIcon name="crown" /> Presenter Showcase
          </span>
        </div>
      </div>
      <section className="sdc-presets">
        <div className="sdc-presets__head">
          <span className="dc-field__label">Event presets</span>
          <span className="dc-field__hint">One click loads a ready-made show — its format, look, clock and rounds.</span>
        </div>
        <div className="sdc-presets__list">
          <div className="sdc-preset" data-on={preset ? 'true' : undefined}>
            <span className="sdc-preset__icon" aria-hidden>
              🎃
            </span>
            <span className="sdc-preset__body">
              <span className="sdc-preset__title">
                DAS-O-Ween 2026
                {preset ? (
                  <Badge color="var(--success)" icon="check">
                    Loaded
                  </Badge>
                ) : null}
              </span>
              <span className="sdc-preset__blurb">
                The show’s settings — Presenter Showcase, the Halloween Night look, a celebration on #5 and a 10-minute clock per round. The
                boards come from your show file.
              </span>
            </span>
            <Button size="sm" variant={preset ? 'ghost' : 'primary'} data-tour="preset-load">
              {preset ? 'Reload' : 'Load'}
            </Button>
          </div>
          <div className="sdc-preset" data-rehearsal="true">
            <span className="sdc-preset__icon" aria-hidden>
              🧪
            </span>
            <span className="sdc-preset__body">
              <span className="sdc-preset__title">DAS-O-Ween rehearsal (demo answers)</span>
              <span className="sdc-preset__blurb">The same show with two practice boards, to try every control.</span>
            </span>
            <Button size="sm" variant="secondary">
              Load
            </Button>
          </div>
        </div>
        <p className="sdc-presets__status">
          {preset ? (
            <>
              <PixelIcon name="check" /> DAS-O-Ween 2026’s settings with <span className="dc-num">2</span> rounds from your show file. Check
              them with Edit your rounds.
            </>
          ) : null}
        </p>
      </section>
      <div className="tour-field tour-field--row">
        <span className="tour-field__label">Show title</span>
        <span className="tour-input">{preset ? DEMO_SETTINGS.title : ''}</span>
      </div>
    </div>
  );
}

function SetupTab({ look, stage, full, card }: { look: ShowdownLook; stage: boolean; full: boolean; card: ShowdownCard | null }) {
  return (
    <div className="sdc-setup tour-setup">
      <p className="sdc-lead">
        <PixelIcon name="crown" />
        <span>
          <b>You’re the presenter.</b> Only you see the answers — on your console, never on the stage.
        </span>
      </p>
      <div className="sdc-teamsflow">
        <span className="dc-field__label">Run it in a Teams call</span>
        <ol className="sdc-steps">
          <li>
            <b>Open the stage window</b> — the show, without the answers.
          </li>
          <li>
            In Teams, <b>Share → Window</b>: pick the stage window and turn on <b>Include computer sound</b>.
          </li>
          <li>
            Press <b>Start game</b>. Keep this console on your own screen.
          </li>
        </ol>
        <div className="sd-row sd-row--wrap">
          <StageWindowMock stage={stage} full={full} label="Open stage window" />
          <Button variant="ghost" icon="copy">
            Big-screen link
          </Button>
        </div>
        <div className="sdc-setup__sound">
          <SoundMock look={look} />
        </div>
      </div>
      <div className="sdc-setup__cards">
        <span className="dc-field__label">Stage cards</span>
        <CardsMock card={card} />
      </div>
      <div className="sdc-setup__cards">
        <span className="dc-field__label">Join QR</span>
        <div>
          <span className="tour-qrcopy" data-tour="lobby-qr">
            <Button size="sm" variant="secondary" icon="copy">
              Copy QR image
            </Button>
            <Button size="sm" variant="ghost" icon="copy">
              Copy link
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}

function StageWindowMock({ stage, full = false, label, size }: { stage: boolean; full?: boolean; label: string; size?: 'sm' }) {
  // The console's button (consoleParts.tsx): it says so until the stage window is full screen.
  return (
    <Button
      size={size}
      variant={stage ? 'success' : 'primary'}
      icon={stage ? 'check' : 'maximize'}
      data-tour={size ? 'stage-window' : 'open-stage'}
    >
      {stage ? (full ? 'Stage full screen' : 'Stage open · press F in it') : label}
    </Button>
  );
}

function SoundMock({ look }: { look: ShowdownLook }) {
  return (
    <span className="sdc-audiobox" data-look={look}>
      <span className="sdc-audio" data-state="ok">
        <i aria-hidden /> Sound on
      </span>
      <Button size="sm" variant="ghost" icon="sound-on" data-tour="test-sound">
        Test sound
      </Button>
    </span>
  );
}

function CardsMock({ card, compact = false }: { card: ShowdownCard | null; compact?: boolean }) {
  return (
    <div className={cx('sdc-cards', compact && 'sdc-cards--compact')}>
      {SHOWDOWN_CARDS.map((c) => (
        <span key={c} className="sdc-card" aria-pressed={card === c} data-tour={`card-${c}`}>
          <span className="sdc-card__icon" aria-hidden>
            {SHOWDOWN_CARD_INFO[c].icon}
          </span>
          <span className="sdc-card__title">{SHOWDOWN_CARD_INFO[c].title}</span>
          {card === c ? <span className="sdc-card__on">On stage</span> : null}
        </span>
      ))}
      <span className="sdc-card sdc-card--off" aria-pressed={card === null} data-tour="card-off">
        <span className="sdc-card__icon" aria-hidden>
          ✕
        </span>
        <span className="sdc-card__title">Off</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The showcase console: the Dashboard (sheet | rail | every tool open in columns beside them)
// ---------------------------------------------------------------------------

const STAGE_LABEL: Record<string, string> = { intro: 'Opening', title: 'Title card', live: 'Live', steal: 'Live', done: 'Board complete' };

/** The Dashboard's tools as the console lists them (consoleShowcase.tsx), with the DAS-O-Ween preset's scoring on. */
const TOOLS: Readonly<Record<ToolId, { label: string; icon: IconName }>> = {
  picker: { label: 'Picker', icon: 'dice' },
  sound: { label: 'Sound', icon: 'music' },
  cards: { label: 'Cards', icon: 'eye' },
  cinema: { label: 'Cinema', icon: 'play' },
  awards: { label: 'Awards', icon: 'trophy' },
  fix: { label: 'Fix', icon: 'refresh' },
  scores: { label: 'Scores', icon: 'trophy' },
  names: { label: 'Names', icon: 'pencil' },
  crew: { label: 'Crew & log', icon: 'crown' },
  preflight: { label: 'Preflight', icon: 'check' },
};

/** The second tools column: the tall tools share it, so the one the tour shows stays open and the rest fold. */
const SECOND_COLUMN: readonly ToolId[] = ['cards', 'cinema', 'awards', 'fix', 'scores', 'names', 'crew', 'preflight'];

function ConsoleScreen({ look, frame, landed }: { look: ShowdownLook; frame: TourFrame; landed: number }) {
  const board = useBoard();
  const clock = useClock();
  const sweeping = useSweep();
  const card = useCard();
  const scene = useSceneCard();
  const standings = useStandingsCard();
  const extras = useShowExtras();
  const picker = usePicker();
  if (!board) return null;
  const hidden = board.slots.filter((s) => !s.revealed).length;
  const found = board.slots.filter((s) => s.revealed && !s.late).length;
  const last = board.round >= board.totalRounds - 1;
  const timeUp = clock.on && clock.left <= 0 && board.stage === 'live';
  const holdSweep = clock.running && !timeUp && board.stage === 'live' && hidden > 0;
  const where = board.round < 0 ? 'Before round 1' : `Round ${board.round + 1} of ${board.totalRounds}`;
  const armed = frame.armed && board.stage === 'live' && !board.slots[board.special]?.revealed;
  /** The control being held (its ring fills). */
  const holding = (name: string) => (frame.held && frame.point === name ? 'true' : undefined);
  // Cards stays open; the tool the tour shows opens under it (Cinema when it shows none of the tall ones).
  const shown: ToolId = frame.tool === 'awards' || frame.tool === 'fix' ? frame.tool : 'cinema';
  const open = (id: ToolId) => id === 'cards' || id === shown;
  const cinemaUp = scene === 'cinema';
  return (
    <div className="tour-console tour-dash" data-held={frame.held ? landed : undefined}>
      <div className="sdc-private-band">
        <span className="sdc-private-band__text">
          <PixelIcon name="lock" /> <b>PRIVATE</b> — presenter console · share the <b>STAGE</b> window, never this one
        </span>
      </div>
      <header className="sdc-bar">
        <span className="sd-live">
          <i aria-hidden /> Live
        </span>
        <div className="sdc-bar__title">
          <span className="sdc-bar__show">{DEMO_SETTINGS.title}</span>
          <span className="sdc-bar__where">
            <b>{where}</b>
            {board.round >= 0 ? ` · ${board.title}` : ''} · {STAGE_LABEL[board.stage] ?? board.stage}
          </span>
        </div>
        <span className="dc-spacer" />
        <SoundMock look={look} />
        <span className="sdc-bar__group">
          <span className="sdc-layout" data-tour="layout-switch">
            <span className="sdc-layout__opt" aria-pressed="true">
              Dashboard
            </span>
            <span className="sdc-layout__opt" aria-pressed="false">
              Classic
            </span>
          </span>
          <Button size="sm" variant="ghost" icon="help">
            Presenter tour
          </Button>
          <StageWindowMock stage={frame.stage} full={frame.full} label="Stage window" size="sm" />
        </span>
        <Button size="sm" variant="danger" icon="flag" data-tour="end-show">
          End show
        </Button>
      </header>
      {scene ? (
        <div className="sdc-cardup">
          <span aria-hidden>{SHOWDOWN_SCENE_INFO[scene].icon}</span>
          <span>
            <b>{SHOWDOWN_SCENE_INFO[scene].title}</b> is on the stage —{' '}
            {scene === 'awards'
              ? 'press Next in the Awards tab for each step.'
              : extras.cinema?.playing
                ? 'your video is playing.'
                : 'press Play in the Cinema tab.'}
          </span>
          <Button size="sm" variant="secondary">
            Back to the show <Kbd>B</Kbd>
          </Button>
        </div>
      ) : card ? (
        <div className="sdc-cardup">
          <span aria-hidden>{SHOWDOWN_CARD_INFO[card].icon}</span>
          <span>
            <b>{SHOWDOWN_CARD_INFO[card].title}</b> is on the stage — the audience can’t see the board right now.
          </span>
        </div>
      ) : standings ? (
        <div className="sdc-cardup">
          <span aria-hidden>🏆</span>
          <span>
            <b>The standings</b> are on the stage — the audience can’t see the board right now.
          </span>
        </div>
      ) : null}
      <NextStepMock board={board} hidden={hidden} found={found} last={last} timeUp={timeUp} sweeping={sweeping} armed={armed} look={look} />
      <div className="tour-console__main">
        <div className="tour-console__sheetcol">
          <div className="sdc-sheet">
            <SheetMock board={board} look={look} found={found} armed={armed} />
          </div>
        </div>
        <div className="tour-console__rail">
          <div className="sdc-wrongbox">
            <span className="sdc-wrong" data-tour="wrong" data-off={board.stage !== 'live' || sweeping ? 'true' : undefined}>
              <span className="sdc-wrong__x" aria-hidden>
                ✕
              </span>
              <span className="sdc-wrong__label">Wrong</span>
              <Kbd>X</Kbd>
            </span>
          </div>
          <ClockMock clock={clock} timeUp={timeUp} />
          <div className="sdc-sweep" data-on={sweeping ? 'true' : undefined} data-hold={holdSweep ? 'true' : undefined}>
            {sweeping ? (
              <span className="sdc-sweep__status" data-tour="sweep">
                <PixelIcon name="sparkle" /> Revealing… <span className="dc-num">{hidden}</span> to go
              </span>
            ) : (
              <Button
                variant={timeUp && hidden ? 'primary' : 'secondary'}
                size="lg"
                block
                icon={holdSweep ? undefined : 'sparkle'}
                className={holdSweep ? 'sdc-sweep__btn sdc-hold' : 'sdc-sweep__btn'}
                data-urgent={timeUp && hidden ? 'true' : undefined}
                data-tour="sweep"
                disabled={board.stage !== 'live' || !hidden}
              >
                {holdSweep ? <HoldRing /> : null}
                Reveal remaining {hidden && board.stage === 'live' ? <span className="sdc-sweep__count">({hidden})</span> : null}{' '}
                <Kbd>R</Kbd>
              </Button>
            )}
          </div>
          <div className="sdc-rail__row">
            <Button variant="secondary" icon="refresh" data-tour="undo">
              Undo <Kbd>U</Kbd>
            </Button>
            <Button
              variant={board.stage === 'done' ? 'primary' : 'ghost'}
              icon={board.stage === 'intro' ? 'play' : last ? 'flag' : 'arrow-right'}
              data-tour="next"
            >
              {board.stage === 'intro' ? 'Start round 1' : last ? 'Finish show' : 'Next round'} <Kbd>N</Kbd>
            </Button>
          </div>
          <PickerStripMock live={board.stage !== 'intro'} landed={landed} />
        </div>
        <div className="tour-dash__tools">
          {frame.dialog ? <EndPanelMock kind={frame.dialog} board={board} look={look} holding={holding('end-hold')} /> : null}
          <div className="tour-dash__col">
            <div className="sdc-side">
              <SceneStripMock scene={scene ?? (card || standings ? 'cards' : 'show')} />
              <div className="sdc-side__preview">
                <div className="tour-preview" aria-hidden data-scene={scene ?? undefined}>
                  {cinemaUp ? (
                    <span className="tour-preview__scene">🎬</span>
                  ) : scene === 'awards' ? (
                    <span className="tour-preview__scene">🏆</span>
                  ) : (
                    <span className="tour-preview__board">
                      {board.slots.map((s, i) => (
                        <i key={i} data-on={s.revealed ? 'true' : undefined} />
                      ))}
                    </span>
                  )}
                </div>
                <p className="sd-preview__caption">
                  <PixelIcon name="eye" /> What the audience sees{frame.stage ? ' (live in the stage window)' : ''}
                </p>
              </div>
            </div>
            <ToolMock id="picker" open alert={picker.hotName ? `${picker.hotName} is up` : undefined}>
              <PickerToolMock />
            </ToolMock>
            <ToolMock id="sound" open>
              <SoundToolMock />
            </ToolMock>
          </div>
          <div className="tour-dash__col">
            {SECOND_COLUMN.map((id) => (
              <ToolMock
                key={id}
                id={id}
                open={open(id)}
                alert={
                  id === 'cinema' && cinemaUp
                    ? 'Cinema is on the stage'
                    : id === 'awards' && scene === 'awards'
                      ? 'The awards are on the stage'
                      : undefined
                }
              >
                {id === 'cards' ? (
                  <CardsToolMock card={card} standings={standings} />
                ) : id === 'cinema' ? (
                  <CinemaToolMock cinema={extras.cinema ?? null} up={cinemaUp} />
                ) : id === 'awards' ? (
                  <AwardsToolMock awards={extras.awards ?? null} />
                ) : id === 'fix' ? (
                  <FixToolMock holding={holding('restart-round')} />
                ) : null}
              </ToolMock>
            ))}
          </div>
          {frame.undo ? <UndoToastMock label={frame.undo} /> : null}
        </div>
      </div>
      {frame.toast === 'reload' ? <ReloadMock /> : frame.toast ? <div className="tour-toast">{frame.toast}</div> : null}
    </div>
  );
}

/** One Dashboard tool: its title bar (click to fold) over its panel. */
function ToolMock({ id, open, alert, children }: { id: ToolId; open: boolean; alert?: string; children?: ReactNode }) {
  const t = TOOLS[id];
  return (
    <section className="sd-panel sdc-tool" data-tool={id} data-open={open ? 'true' : undefined}>
      <h3 className="sdc-tool__head">
        <span className="sdc-tool__fold" data-tour={`tool-${id}`}>
          <PixelIcon name={t.icon} />
          <span className="sdc-tool__name">{t.label}</span>
          {alert ? <span className="sdc-tool__alert">{alert}</span> : null}
          <PixelIcon name={open ? 'chevron-up' : 'chevron-down'} className="sdc-tool__chev" />
        </span>
      </h3>
      {open && children ? <div className="sdc-tool__body">{children}</div> : null}
    </section>
  );
}

/** The scene strip over the preview: what the stage window shows. */
function SceneStripMock({ scene }: { scene: 'show' | 'cinema' | 'awards' | 'cards' }) {
  return (
    <div className="sdc-scenes">
      <span className="sdc-scene" aria-pressed={scene === 'show'} data-tour="scene-show">
        <PixelIcon name="star" /> Show <Kbd>B</Kbd>
      </span>
      <span className="sdc-scene" aria-pressed={scene === 'cinema'} data-tour="scene-cinema">
        <PixelIcon name="play" /> Cinema <Kbd>V</Kbd>
      </span>
      <span className="sdc-scene" aria-pressed={scene === 'awards'} data-tour="scene-awards">
        <PixelIcon name="trophy" /> Awards
      </span>
      <span className="sdc-scene" aria-pressed={scene === 'cards'} data-tour="scene-cards">
        <PixelIcon name="copy" /> Cards
      </span>
    </div>
  );
}

/** The hold ring (filled by CSS while its button is held in the picture). */
function HoldRing() {
  return (
    <span className="sdc-hold__ring tour-holdring" aria-hidden>
      <svg viewBox="0 0 20 20" focusable="false">
        <circle cx="10" cy="10" r="8" />
        <circle cx="10" cy="10" r="8" className="sdc-hold__arc" />
      </svg>
    </span>
  );
}

/** The rail's picker: Pick someone / Spotlight…, then the name first ("on stage in 2 s"), then Mark done / No answer. */
function PickerStripMock({ live, landed }: { live: boolean; landed: number }) {
  const picker = usePicker();
  const [, tick] = useState(0);
  const now = serverNow();
  const heads = Boolean(picker.hotSeat) && picker.landAt > now;
  // Re-draw when the stage lands on them (heads → answering).
  useEffect(() => {
    if (!heads) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.max(0, picker.landAt - serverNow()) + 30);
    return () => clearTimeout(t);
  }, [heads, picker.landAt, landed]);
  const onSeat = Boolean(picker.hotSeat);
  return (
    <section className="sdp-strip" data-phase={onSeat ? (heads ? 'heads' : 'answering') : 'ready'} data-tour="pick-strip">
      <header className="sdp-strip__head">
        <h3 className="sdp-strip__title">
          <PixelIcon name="users" /> Picker
        </h3>
        <span className="sdp-strip__pool">
          <span className="dc-num">{picker.poolSize}</span> in the pool
        </span>
      </header>
      {onSeat ? (
        <>
          <p className="sdp-hot" data-state={heads ? 'heads' : 'answering'}>
            <b className="sdp-hot__name">{picker.hotName}</b>{' '}
            <span className="sdp-hot__line">
              {heads ? (
                <>
                  on stage in <span className="dc-num">{Math.max(1, Math.ceil((picker.landAt - now) / 1000))}</span> s
                </>
              ) : (
                'is answering'
              )}
            </span>
          </p>
          <div className="sdp-strip__row">
            <Button variant="success" icon="check" data-tour="pick-done">
              Mark done <Kbd>D</Kbd>
            </Button>
            <Button variant="secondary" data-tour="pick-noanswer">
              No answer <Kbd>A</Kbd>
            </Button>
          </div>
        </>
      ) : (
        <div className="sdp-strip__row sdp-strip__row--pick">
          <Button variant="primary" block className="sdp-strip__pick" disabled={!live} data-tour="pick">
            Pick someone <Kbd>K</Kbd>
          </Button>
          <Button variant="secondary" block icon="star" disabled={!live} data-tour="spotlight">
            Spotlight… <Kbd>F</Kbd>
          </Button>
        </div>
      )}
    </section>
  );
}

/** The Picker tool: the pool, the hot seat and everyone, with Spotlight and Exclude. */
function PickerToolMock() {
  const picker = usePicker();
  const guests = useShowSelector((s) => s.players) ?? {};
  const people = Object.values(guests)
    .sort((a, b) => a.joinOrder - b.joinOrder)
    .slice(0, 4);
  return (
    <div className="sdc-tab tour-pickertab">
      <span className="tour-pickertab__row">
        <span>Mode</span> <b>Fair mode</b>
      </span>
      <span className="tour-pickertab__row">
        <span>Pool</span>{' '}
        <b>
          <span className="dc-num">{picker.poolSize}</span> people · Round 1
        </b>
      </span>
      <span className="tour-pickertab__row">
        <span>Hot seat</span> <b>{picker.hotName || 'Nobody'}</b>
      </span>
      <ul className="tour-people">
        {people.map((p, i) => (
          <li key={p.id}>
            <span className="tour-people__name">{p.name}</span>
            {picker.done[p.id] ? <Badge>Done</Badge> : null}
            <span className="dc-btn dc-btn--ghost dc-btn--sm">Spotlight</span>
            <span className="dc-btn dc-btn--secondary dc-btn--sm" data-tour={i === 3 ? 'picker-exclude' : undefined}>
              Exclude
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The Sound tool: the cues (Celebrate! first) and the sound station. */
function SoundToolMock() {
  return (
    <div className="sdc-tab">
      <p className="tour-station">
        <span className="sdc-audio" data-state="ok">
          <i aria-hidden /> Sound: this console ✓
        </span>
      </p>
      <div className="sdc-cues">
        <span className="sdc-cue sdc-cue--big" data-tour="celebrate">
          <span aria-hidden>🎉</span> Celebrate! <Kbd>C</Kbd>
        </span>
        {SHOWDOWN_CUES.filter((c) => c !== 'celebrate').map((c) => (
          <span key={c} className="sdc-cue">
            <span aria-hidden>{SHOWDOWN_CUE_INFO[c].icon}</span>
            {SHOWDOWN_CUE_INFO[c].title}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The Cards tool: the stage cards, the join QR (Copy QR image, Copy link, the Join pop-up) and the standings. */
function CardsToolMock({ card, standings }: { card: ShowdownCard | null; standings: boolean }) {
  return (
    <div className="sdc-tab">
      <CardsMock card={card} compact />
      <div className="tour-qr">
        <span className="tour-qr__code" aria-hidden>
          {QR_DOTS.map((on, i) => (
            <i key={i} data-on={on ? 'true' : undefined} />
          ))}
        </span>
        <span className="tour-qr__btns">
          <Button size="sm" variant="secondary" icon="copy" data-tour="qr-copy">
            Copy QR image
          </Button>
          <Button size="sm" variant="ghost" icon="copy" data-tour="link-copy">
            Copy link
          </Button>
          <Button size="sm" variant="secondary" icon="maximize" data-tour="join-pop">
            Join pop-up <Kbd>J</Kbd>
          </Button>
        </span>
      </div>
      <Button size="sm" variant={standings ? 'primary' : 'secondary'} icon="trophy" data-tour="standings">
        {standings ? 'Hide standings' : 'Show standings'}
      </Button>
    </div>
  );
}

/** A little QR-looking square (a picture: the real one is drawn from the room's join link). */
const QR_DOTS: readonly boolean[] = Array.from({ length: 81 }, (_, i) => {
  const x = i % 9;
  const y = Math.floor(i / 9);
  const finder = (x < 3 && y < 3) || (x > 5 && y < 3) || (x < 3 && y > 5);
  return finder || (x * 7 + y * 3 + x * y) % 3 === 0;
});

/** The Cinema tool: the loaded videos, the frame, and the transport once Cinema is on the stage. */
function CinemaToolMock({ cinema, up }: { cinema: CinemaView | null; up: boolean }) {
  const clip = cinema?.clips.find((c) => c.id === cinema.clipId) ?? null;
  const frame = cinema?.frame ?? 'tv';
  const time = cinema?.time ?? 0;
  const total = cinema?.duration ?? 0;
  return (
    <div className="sdc-tab sdc-cinema tour-cinema">
      <div className="tour-cinema__row">
        <Button size="sm" variant="secondary" icon="plus" data-tour="cinema-load">
          Load video…
        </Button>
        {clip ? (
          <span className="sdc-cinema__clip is-on tour-cinema__clip">
            <span className="sdc-cinema__mark" aria-hidden />
            <span className="sdc-cinema__name">{clip.name}</span>
            <span className="sdc-cinema__tag">{up && cinema?.playing ? 'On air' : 'Plays next'}</span>
          </span>
        ) : (
          <span className="sd-muted">From this computer: never uploaded.</span>
        )}
      </div>
      <div className="sdc-cinema__frames" data-tour="cinema-frame">
        {CINEMA_FRAMES.map((f) => (
          <span key={f.id} className="sdc-card" aria-pressed={frame === f.id}>
            <span className="sdc-card__title">{f.title}</span>
          </span>
        ))}
      </div>
      <div className="sdc-cinema__seek" data-tour="cinema-seek">
        <span className="dc-num sdc-cinema__time">{clipTime(time)}</span>
        <span className="tour-seek" aria-hidden>
          <i style={{ transform: `scaleX(${total > 0 ? Math.min(1, time / total) : 0})` }} />
        </span>
        <span className="dc-num sdc-cinema__time">{clip ? clipTime(total) : '—'}</span>
      </div>
      <div className="sdc-cinema__transport">
        {up ? (
          <>
            <Button size="sm" variant="ghost" icon="arrow-left" data-tour="cinema-back10">
              <span className="dc-num">10 s</span>
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={cinema?.playing ? 'pause' : 'play'}
              className="sdc-cinema__main"
              data-tour="cinema-play"
            >
              {cinema?.playing ? 'Pause' : 'Play'}
            </Button>
            <Button size="sm" variant="ghost" iconRight="arrow-right" data-tour="cinema-fwd10">
              <span className="dc-num">10 s</span>
            </Button>
            <Button size="sm" variant="ghost" icon="refresh">
              Restart
            </Button>
            <Button size="sm" variant="secondary" icon="arrow-left" data-tour="cinema-back">
              Back to the show <Kbd>B</Kbd>
            </Button>
          </>
        ) : (
          <Button size="sm" variant="primary" icon="play" className="sdc-cinema__up" data-tour="cinema-up">
            Put Cinema on the stage <Kbd>V</Kbd>
          </Button>
        )}
      </div>
    </div>
  );
}

/** The Awards tool: the ceremony's controls over one award's three places (names, photos optional). */
function AwardsToolMock({ awards }: { awards: AwardsView | null }) {
  const categories = awards?.categories ?? [];
  const steps = awardSteps(categories);
  const at = awards?.at ?? -1;
  const next = steps[at + 1];
  const winners = categories.reduce((n, c) => n + c.places.filter((p) => p.name.trim()).length, 0);
  const first = categories[0];
  return (
    <div className="sdc-tab tour-awards">
      {at >= 0 ? (
        <span className="tour-awards__run">
          <Button size="sm" variant="ghost" icon="arrow-left">
            Back
          </Button>
          <Button size="sm" variant="primary" icon={next?.kind === 'place' ? 'trophy' : 'arrow-right'} data-tour="awards-next">
            {next ? `Next: ${awardStepWords(next, categories)}` : 'That’s the whole ceremony'}
          </Button>
        </span>
      ) : (
        <span className="tour-awards__run">
          <span className="sd-muted">
            Nothing shows on the share until you press Start. <span className="dc-num">{winners}</span> winners ready.
          </span>
          <Button size="sm" variant="primary" icon="trophy" data-tour="awards-start">
            Start the ceremony
          </Button>
        </span>
      )}
      {first ? (
        <div className="tour-awards__cat" data-tour="awards-names">
          <b>{first.title}</b>
          {first.places.map((p, i) => (
            <span key={i} className="tour-awards__place">
              <span className="tour-awards__photo" aria-hidden>
                {p.photo ? '🖼️' : <PixelIcon name="plus" />}
              </span>
              <span className="tour-awards__rank dc-num">{i + 1}</span>
              <span className="tour-input">{p.name}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The Fix tool: restart the round or the show (press and hold), and the presenter tools. */
function FixToolMock({ holding }: { holding: string | undefined }) {
  return (
    <div className="sdc-tab">
      <div className="sdc-tabsection sdc-fix">
        <div className="sdc-fix__btns">
          <span className="dc-btn dc-btn--secondary sdc-hold" data-tour="restart-round" data-holding={holding}>
            <HoldRing /> Restart this round
          </span>
          <span className="dc-btn dc-btn--secondary sdc-hold">
            <HoldRing /> Restart the whole show
          </span>
        </div>
        <p className="sd-muted">Press and hold to restart. Both can be undone.</p>
      </div>
      <div className="sd-panel sd-tools tour-tools">
        <span className="sd-panel__title">
          <PixelIcon name="crown" /> Presenter tools
        </span>
        <Button size="sm" icon="copy" data-tour="presenter-link">
          Copy presenter link
        </Button>
      </div>
    </div>
  );
}

function NextStepMock({
  board,
  hidden,
  found,
  last,
  timeUp,
  sweeping,
  armed,
  look,
}: {
  board: ShowdownBoardView;
  hidden: number;
  found: number;
  last: boolean;
  timeUp: boolean;
  sweeping: boolean;
  armed: boolean;
  look: ShowdownLook;
}) {
  let text: ReactNode;
  let action: ReactNode = null;
  let tone = 'go';
  let label = 'Next step';
  const total = board.slots.length;
  if (armed) {
    tone = 'armed';
    label = 'Special armed';
    const round = sheetRound(board);
    text = (
      <>
        <span aria-hidden>{look === 'halloween' ? '🎃' : '⭐'}</span> <b>#{board.special + 1}</b> {round.answers[board.special]?.text} is
        armed — nobody sees it yet. Build the suspense, then take it.
      </>
    );
    action = (
      <>
        <Button variant="secondary" icon="close">
          Disarm <Kbd>Esc</Kbd>
        </Button>
        <Button variant="primary" size="lg" icon="play" className="sdc-take" data-tour="take-special">
          Take special <Kbd>Space</Kbd>
        </Button>
      </>
    );
  } else if (board.stage === 'intro') {
    text = 'The opening is on the stage. Welcome everyone, then start round 1.';
    action = (
      <Button variant="primary" size="lg" icon="play" data-tour="next-step">
        Start round 1 <Kbd>Q</Kbd>
      </Button>
    );
  } else if (board.stage === 'title') {
    text = (
      <>
        Round {board.round + 1}’s title card is up — <b>{board.title}</b>. Show the question when you’re ready — the 10-minute clock starts
        with it.
      </>
    );
    action = (
      <Button variant="primary" size="lg" icon="eye" data-tour="next-step">
        Show the question <Kbd>Q</Kbd>
      </Button>
    );
  } else if (board.stage === 'live' && sweeping) {
    tone = 'live';
    text = (
      <>
        Revealing the rest, #{total} up to #1 — <span className="dc-num">{hidden}</span> to go. Enjoy the drumroll.
      </>
    );
  } else if (board.stage === 'live' && timeUp) {
    tone = 'alert';
    text = (
      <>
        <b>Time’s up</b> — wrap up the last guesses, then Reveal remaining. Nothing flips until you say so.
      </>
    );
  } else if (board.stage === 'live') {
    tone = 'live';
    text = (
      <>
        Read the chat: click the answer someone names, or press <b>Wrong</b>.{' '}
        <span className="sdc-next__count">
          <span className="dc-num">{found}</span> of <span className="dc-num">{total}</span> found
        </span>
      </>
    );
  } else {
    tone = 'done';
    text = last ? (
      <>
        The whole board is up — that was the last one. Finish the show, then put up <b>Prize time</b> or <b>Thanks</b>.
      </>
    ) : (
      <>
        The whole board is up (<span className="dc-num">{found}</span> found). Then go to round {board.round + 2}.
      </>
    );
  }
  return (
    <div className="sdc-next" data-tone={tone}>
      <span className="sdc-next__label">{label}</span>
      <p className="sdc-next__text">{text}</p>
      {action ? <span className="sdc-next__action">{action}</span> : null}
    </div>
  );
}

function SheetMock({ board, look, found, armed }: { board: ShowdownBoardView; look: ShowdownLook; found: number; armed: boolean }) {
  const intro = board.stage === 'intro';
  const round = intro ? DEMO_ROUNDS[0] : sheetRound(board);
  const mark = look === 'halloween' ? '🎃' : '⭐';
  const meta = intro
    ? 'A preview to get ready — the answers unlock when round 1 starts.'
    : board.stage === 'title'
      ? 'The question isn’t on the stage yet — clicking an answer shows it first.'
      : `According to ${round.source}`;
  return (
    <section className="sd-panel sdc-sheetpanel tour-sheet" data-stage={board.stage} data-tour="sheet">
      <header className="sdc-sheet__head">
        <h3 className="sd-panel__title">
          <PixelIcon name="lock" /> {intro ? 'Up first' : 'Answer sheet'} <span className="sdc-private">Only you see this</span>
        </h3>
        {!intro ? (
          <span className="sdc-found">
            <span className="dc-num">{found}</span>/<span className="dc-num">{round.answers.length}</span> found
          </span>
        ) : null}
      </header>
      <p className="sdc-sheet__prompt" data-hidden={board.stage === 'title' || intro ? 'true' : undefined}>
        <span className="sdc-sheet__q">
          R{intro ? 1 : board.round + 1} · {round.title}
        </span>
        <span className="sdc-sheet__qtext">{round.prompt}</span>
        <span className="sdc-sheet__source" data-hint={intro || board.stage === 'title' ? 'true' : undefined}>
          {meta}
        </span>
      </p>
      <ol className="sdc-answers" style={{ '--rows': 5 } as CSSProperties}>
        {round.answers.map((a, i) => {
          const slot = board.slots[i];
          const revealed = !intro && Boolean(slot?.revealed);
          const late = revealed && Boolean(slot?.late);
          const special = i === round.special;
          const isArmed = special && armed && !revealed;
          return (
            <li key={i}>
              <span
                className="sdc-answer"
                data-revealed={revealed ? 'true' : undefined}
                data-late={late ? 'true' : undefined}
                data-special={special ? 'true' : undefined}
                data-armed={isArmed ? 'true' : undefined}
                data-tour={`answer-${i + 1}`}
              >
                <span className="sdc-answer__num">{i + 1}</span>
                <span className="sdc-answer__body">
                  <span className="sdc-answer__text">{a.text}</span>
                  <span className="sdc-answer__meta">
                    <span className="sdc-answer__note">{a.note}</span>
                  </span>
                </span>
                {revealed ? (
                  <span className="sdc-answer__action" aria-hidden>
                    <PixelIcon name="check" /> {late ? 'Shown' : 'Found'}
                  </span>
                ) : isArmed ? (
                  <span className="sdc-answer__action sdc-answer__armed" aria-hidden>
                    Armed · take <Kbd>Space</Kbd>
                  </span>
                ) : special ? (
                  <span className="sdc-answer__action sdc-answer__special" aria-hidden>
                    Special <span>{mark}</span>
                  </span>
                ) : (
                  <span className="sdc-answer__action sdc-answer__reveal" aria-hidden>
                    {intro ? <PixelIcon name="lock" /> : 'Reveal'}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ClockMock({ clock, timeUp }: { clock: ClockView; timeUp: boolean }) {
  const pct = clock.on && clock.max > 0 ? Math.max(0, Math.min(1, clock.left / clock.max)) : 0;
  return (
    <div className="sd-panel sdc-clock" data-state={!clock.on ? 'off' : timeUp ? 'up' : clock.running ? 'running' : 'paused'}>
      <div className="sdc-clock__main">
        <span className="sdc-clock__readout">
          <span className="sdc-clock__head">
            <span className="sdc-clock__title">
              <PixelIcon name="clock" size={11} /> Round clock
            </span>
            <span className="sdc-clock__state">{!clock.on ? 'Off' : timeUp ? 'Time’s up' : clock.running ? 'Running' : 'Paused'}</span>
          </span>
          <span className="sdc-clock__time">{clock.on ? formatClock(clock.left) : '—'}</span>
        </span>
        <Button
          className="sdc-clock__go"
          variant={clock.on && !clock.running && clock.left > 0 ? 'primary' : 'secondary'}
          icon={clock.running ? 'pause' : 'play'}
          data-tour="clock-go"
        >
          {clock.running ? 'Pause' : 'Start'} <Kbd>P</Kbd>
        </Button>
      </div>
      <span className="sdc-clock__bar" aria-hidden>
        <i style={{ transform: `scaleX(${pct})` }} />
      </span>
      <div className="sdc-clock__btns">
        <span className="sdc-mini" data-tour="clock-plus">
          +1 min
        </span>
        <span className="sdc-mini" data-tour="clock-minus">
          −1 min
        </span>
        <span className="sdc-mini">Reset</span>
      </div>
    </div>
  );
}

/** End show / Finish show: the inline two-step panel (it names what's still hidden; a 1.2 s hold confirms). */
function EndPanelMock({
  kind,
  board,
  look,
  holding,
}: {
  kind: TourDialog;
  board: ShowdownBoardView;
  look: ShowdownLook;
  holding: string | undefined;
}) {
  const finish = kind === 'finish';
  const round = sheetRound(board);
  const hidden = board.stage === 'live' ? board.slots.map((s, i) => (s.revealed ? -1 : i)).filter((i) => i >= 0) : [];
  const mark = look === 'halloween' ? '🎃' : '⭐';
  return (
    <div className="sdc-endpanel tour-endpanel" data-kind={kind}>
      <h3 className="sdc-endpanel__title">
        <PixelIcon name="flag" /> {finish ? 'Finish the show?' : 'End the show for everyone?'}
      </h3>
      <p className="sdc-endpanel__state">
        {board.stage === 'title'
          ? `Round ${board.round + 1} hasn’t been played yet — its answers stay hidden.`
          : hidden.length
            ? `${hidden.length} answer${hidden.length === 1 ? ' is' : 's are'} still hidden on this board:`
            : finish
              ? 'That was the last board, and every answer is up.'
              : 'Every answer on this board is up.'}
      </p>
      {hidden.length ? (
        <ol className="sdc-endpanel__hidden">
          {hidden.map((i) => (
            <li key={i}>
              <span className="sdc-endpanel__n dc-num">{i + 1}</span>
              <span className="sdc-endpanel__t">{round.answers[i]?.text}</span>
              {i === round.special ? (
                <span className="sdc-endpanel__sp">
                  Special <span aria-hidden>{mark}</span>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      <p className="sdc-endpanel__what">
        Every screen goes to the closing screen. <b>This can’t be undone</b> — Undo won’t bring the show back.
      </p>
      <div className="sdc-endpanel__actions">
        <Button variant="secondary" data-tour="end-keep">
          Keep playing
        </Button>
        <span className="dc-btn dc-btn--danger sdc-hold tour-endhold" data-tour="end-hold" data-holding={holding}>
          <HoldRing /> {finish ? 'Hold to finish the show' : 'Hold to end the show'}
        </span>
      </div>
    </div>
  );
}

function UndoToastMock({ label }: { label: string }) {
  return (
    <div className="sdc-undotoast" data-tour="undo-toast">
      <PixelIcon name="refresh" className="sdc-undotoast__icon" />
      <span className="sdc-undotoast__text">
        <b>{label}</b>
        <span>Changed your mind? Undo.</span>
      </span>
      <span className="dc-btn dc-btn--primary dc-btn--sm sdc-undotoast__undo">
        <PixelIcon name="refresh" /> Undo <span className="sdc-undotoast__left dc-num">12 s</span>
      </span>
      <i className="sdc-undotoast__bar tour-undobar" />
    </div>
  );
}

/** The console reloading, and coming back exactly where it was. */
function ReloadMock() {
  return (
    <>
      <div className="tour-reload" aria-hidden>
        <span className="tour-reload__bar">
          <PixelIcon name="refresh" /> dascade.onrender.com/room/<b>CODE</b>
        </span>
        <Spinner label="Reloading" />
      </div>
      <span className="tour-reload__badge" aria-hidden>
        <PixelIcon name="crown" /> Still the presenter, right where you were
      </span>
    </>
  );
}

// ---------------------------------------------------------------------------
// The results page (after Finish show)
// ---------------------------------------------------------------------------

function ResultsScreen() {
  const card = useCard();
  const finale = useFinale();
  const step = useFinaleStep();
  const extras = useShowExtras();
  const steps = finaleSteps(finale);
  const at = Math.max(0, Math.min(step, steps.length - 1));
  const next = steps[at + 1];
  return (
    <div className="tour-results">
      <div className="tour-results__cols">
        <div className="tour-results__col">
          {steps.length > 1 ? (
            <section className="sd-panel sdc-finalectl">
              <h3 className="sd-panel__title">
                <PixelIcon name="trophy" /> The finale
              </h3>
              <p className="sdc-finalectl__now">
                On the stage: <b>{finaleStepWords(steps[at]!)}</b> · step <span className="dc-num">{at + 1}</span> of{' '}
                <span className="dc-num">{steps.length}</span>
              </p>
              <div className="sd-row sd-row--wrap">
                <Button variant="ghost" icon="arrow-left">
                  Back
                </Button>
                <Button variant="primary" icon={next === 'first' ? 'trophy' : 'arrow-right'} data-tour="finale-next">
                  {next ? `Next: ${finaleStepWords(next)}` : 'That’s the whole finale'}
                </Button>
              </div>
              <div className="sd-row sd-row--wrap" data-tour="scores-download">
                <Button size="sm" variant="secondary" icon="share">
                  Download CSV
                </Button>
                <Button size="sm" variant="ghost" icon="share">
                  Download JSON
                </Button>
              </div>
            </section>
          ) : null}
          <section className="sd-panel sdc-afterpanel">
            <h3 className="sd-panel__title" data-tour="results-awards">
              Awards
            </h3>
            <AwardsToolMock awards={extras.awards ?? null} />
          </section>
        </div>
        <div className="tour-results__col">
          <section className="sd-panel sdc-afterpanel">
            <h3 className="sd-panel__title">Stage cards</h3>
            <p className="sd-muted">For the rest of the event: put up Prize time for the winners, then Thanks.</p>
            <CardsMock card={card} compact />
          </section>
          <section className="sd-panel sdc-closing">
            <p className="sdc-closing__title">That’s a wrap!</p>
            <p className="sdc-closing__sub">Thanks for playing {DEMO_SETTINGS.title}!</p>
            <ul className="sdc-closing__rounds">
              {(finale?.results ?? []).map((r) => (
                <li key={r.index}>
                  <span className="sdc-closing__r">Round {r.index + 1}</span>
                  <span>
                    The crowd found {r.found} of {r.total}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

/** The ceremony's next step in words (as AwardsPanel says it). */
function awardStepWords(step: AwardStep | undefined, categories: readonly AwardCategory[]): string {
  if (!step) return '';
  switch (step.kind) {
    case 'title':
      return 'the awards’ title card';
    case 'category':
      return categories[step.cat]?.title ?? 'the next award';
    case 'place':
      return `${placeWord(step.place)} place · ${categories[step.cat]?.title ?? ''}`;
    case 'thanks':
      return 'Thanks for playing';
  }
}
