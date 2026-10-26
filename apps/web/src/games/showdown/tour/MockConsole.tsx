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
  type ShowdownBoardView,
  type ShowdownCard,
  type ShowdownLook,
} from '@dascade/shared/games/showdown';
import { Badge, Button, Kbd, PixelIcon, Spinner, cx, type IconName } from '@dascade/ui';
import { formatClock, useBoard, useCard, useClock, useFinale, useSweep, type ClockView } from '../state.ts';
import { DEMO_CODE, DEMO_ROUNDS, DEMO_SETTINGS, sheetRound } from './script.ts';
import type { DrawerTabId, LobbyTab, TourDialog, TourFrame } from './timeline.ts';

/** The console's size before the camera scales it (px). */
export const MOCK_W = 1120;
export const MOCK_H = 820;

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
  if (frame.screen === 'lobby') screen = <LobbyScreen look={look} tab={frame.tab} preset={frame.preset} stage={frame.stage} />;
  else if (frame.screen === 'results') screen = <ResultsScreen />;
  else screen = <ConsoleScreen look={look} frame={frame} landed={landed} />;
  return (
    <Camera
      w={MOCK_W}
      h={MOCK_H}
      point={frame.point}
      zoom={frame.zoom}
      keyHint={frame.key}
      landed={landed}
      pressed={pressed}
      motion={motion}
      screen={`${frame.screen}:${frame.tab}:${frame.dialog ?? ''}:${frame.drawer}:${frame.armed}:${frame.undo}`}
    >
      <div className="tour-mock sdc" data-look={look} data-screen={frame.screen}>
        {screen}
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

function LobbyScreen({ look, tab, preset, stage }: { look: ShowdownLook; tab: LobbyTab; preset: boolean; stage: boolean }) {
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
        {tab === 'settings' ? <SettingsTab preset={preset} /> : <SetupTab look={look} stage={stage} card={card} />}
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
                Two Top-10 boards with a celebration on #5, a 10-minute clock per round and the Halloween Night look.
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
              <PixelIcon name="check" /> DAS-O-Ween 2026 is loaded: <span className="dc-num">2</span> rounds. Check them with Edit your
              rounds.
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

function SetupTab({ look, stage, card }: { look: ShowdownLook; stage: boolean; card: ShowdownCard | null }) {
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
          <StageWindowMock stage={stage} label="Open stage window" />
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
    </div>
  );
}

function StageWindowMock({ stage, label, size }: { stage: boolean; label: string; size?: 'sm' }) {
  return (
    <Button
      size={size}
      variant={stage ? 'success' : 'primary'}
      icon={stage ? 'check' : 'maximize'}
      data-tour={size ? 'stage-window' : 'open-stage'}
    >
      {stage ? 'Stage window open' : label}
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
// The showcase console (PRS-01 A: sheet | rail | pinned preview over the drawer)
// ---------------------------------------------------------------------------

const STAGE_LABEL: Record<string, string> = { intro: 'Opening', title: 'Title card', live: 'Live', steal: 'Live', done: 'Board complete' };

const DRAWER_TABS: ReadonlyArray<{ id: DrawerTabId; label: string; icon: IconName }> = [
  { id: 'picker', label: 'Picker', icon: 'dice' },
  { id: 'sound', label: 'Sound', icon: 'music' },
  { id: 'cards', label: 'Cards', icon: 'eye' },
  { id: 'fix', label: 'Fix', icon: 'refresh' },
];

function ConsoleScreen({ look, frame, landed }: { look: ShowdownLook; frame: TourFrame; landed: number }) {
  const board = useBoard();
  const clock = useClock();
  const sweeping = useSweep();
  const card = useCard();
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
  return (
    <div className="tour-console" data-held={frame.held ? landed : undefined}>
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
        <StageWindowMock stage={frame.stage} label="Stage window" size="sm" />
        <Button size="sm" variant="danger" icon="flag" data-tour="end-show">
          End show
        </Button>
      </header>
      {card ? (
        <div className="sdc-cardup">
          <span aria-hidden>{SHOWDOWN_CARD_INFO[card].icon}</span>
          <span>
            <b>{SHOWDOWN_CARD_INFO[card].title}</b> is on the stage.
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
          <PickerMock />
        </div>
        <div className="tour-console__side">
          {frame.dialog ? <EndPanelMock kind={frame.dialog} board={board} look={look} holding={holding('end-hold')} /> : null}
          <div className="sdc-side__preview">
            <div className="tour-preview" aria-hidden>
              <span className="tour-preview__board">
                {board.slots.map((s, i) => (
                  <i key={i} data-on={s.revealed ? 'true' : undefined} />
                ))}
              </span>
            </div>
            <p className="sd-preview__caption">
              <PixelIcon name="eye" /> What the audience sees
            </p>
          </div>
          <section className="sd-panel sdc-drawer">
            <div className="sdc-drawer__tabs">
              {DRAWER_TABS.map((t) => (
                <span key={t.id} className={cx('sdc-drawer__tab', frame.drawer === t.id && 'is-on')} data-tour={`tab-${t.id}`}>
                  <PixelIcon name={t.icon} />
                  <span className="sdc-drawer__label">{t.label}</span>
                </span>
              ))}
            </div>
            <div className="sdc-drawer__body">
              <DrawerBodyMock tab={frame.drawer} card={card} holding={holding('restart-round')} />
            </div>
          </section>
          {frame.undo ? <UndoToastMock label={frame.undo} /> : null}
        </div>
      </div>
      {frame.toast === 'reload' ? <ReloadMock /> : frame.toast ? <div className="tour-toast">{frame.toast}</div> : null}
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

function PickerMock() {
  return (
    <section className="tour-picker" data-tour="pick">
      <span className="tour-picker__head">
        <span>
          <PixelIcon name="users" /> Picker
        </span>
        <span>
          <span className="dc-num">12</span> in the pool
        </span>
      </span>
      <Button variant="primary" block>
        Pick someone <Kbd>K</Kbd>
      </Button>
    </section>
  );
}

function DrawerBodyMock({ tab, card, holding }: { tab: DrawerTabId; card: ShowdownCard | null; holding: string | undefined }) {
  if (tab === 'sound')
    return (
      <div className="sdc-tab">
        <div className="sdc-tabsection">
          <h3 className="sd-panel__title">Sound cues</h3>
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
      </div>
    );
  if (tab === 'cards')
    return (
      <div className="sdc-tab">
        <div className="sdc-tabsection">
          <h3 className="sd-panel__title">Stage cards</h3>
          <CardsMock card={card} compact />
        </div>
      </div>
    );
  if (tab === 'fix')
    return (
      <div className="sdc-tab">
        <div className="sdc-tabsection sdc-fix">
          <h3 className="sd-panel__title">Fix a mistake</h3>
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
  return (
    <div className="sdc-tab tour-pickertab">
      <h3 className="sd-panel__title">
        <PixelIcon name="users" /> Picker
      </h3>
      <span className="tour-pickertab__row">
        <span>Pool</span> <b>12 people · Round 1</b>
      </span>
      <span className="tour-pickertab__row">
        <span>Hot seat</span> <b>Nobody</b>
      </span>
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
  return (
    <div className="tour-results">
      <section className="sd-panel sdc-afterpanel">
        <h3 className="sd-panel__title">Stage cards</h3>
        <p className="sd-muted">For the rest of the event: put up Prize time for the winners, then Thanks.</p>
        <CardsMock card={card} />
      </section>
      <div className="tour-results__row">
        <Button variant="primary" icon="refresh">
          Play again
        </Button>
        <Button variant="ghost" icon="leave">
          Back to cabinet
        </Button>
      </div>
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
  );
}
