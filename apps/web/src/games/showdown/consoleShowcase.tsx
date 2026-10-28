/**
 * The Presenter Showcase console — one person runs a Top-10 board for a crowd in a meeting, alone,
 * while reading the meeting chat. Built for one glance and one click (PRS-01 A, "Command Center"):
 *
 *   - the answer sheet on the left (the ten answers, the special one marked), with the rundown and
 *     this round's counts under it;
 *   - the rail: a huge WRONG, the round clock, Reveal remaining, Undo / Next and the picker;
 *   - the scene strip (Show · Cinema · Cards: what the stage window shows, so nobody re-shares in
 *     Teams), a pinned stage preview and a tabbed drawer under it (Picker, Sound, Cards, Cinema, Fix,
 *     Scores with two-tier scoring on, and for the crew: Names, Crew & log, Preflight), so nothing
 *     needs scrolling at 1280×720;
 *   - one "Next step" line that always says what to do now.
 *
 * Safety (PRS-02 D, PRS-03 D): every tile flips on the first click, except the special answer, which
 * arms and waits for TAKE SPECIAL (Space). Actions Undo can take back are press-and-hold (Restart
 * round / show, Reveal remaining while the clock runs) or act at once with an undo toast (Next or
 * Skip with answers still hidden). Ending the show — the one thing Undo can't bring back — takes an
 * inline two-step panel that names what's still hidden and a 1.2 s hold. No modal dialog mid-show.
 *
 * This is the presenter's private screen (PRS-05 C): a striped PRIVATE band, a red frame and the tab
 * title "🔒 PRESENTER — don't share". Only the presenter's connection ever receives the answer sheet.
 * Every command carries the board revision (or the round) it was made against, so a double click or
 * a stale view never applies twice.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import {
  SHOWDOWN_CUES,
  SHOWDOWN_CUE_INFO,
  SHOWDOWN_SONG_MS,
  SHOWDOWN_CARD_INFO,
  SHOWDOWN_MSG,
  SHOWDOWN_SCENE_INFO,
  SHOWDOWN_STANDINGS_CARD,
  showTitle,
  type ShowdownActPayload,
  type ShowdownBoardView,
  type ShowdownClockOp,
  type ShowdownCue,
  type ShowdownLook,
  type ShowdownPublicState,
  type ShowdownSettings,
  type ShowdownSheet,
  type ShowdownSheetRound,
} from '@dascade/shared/games/showdown';
import { Badge, Button, Kbd, PixelIcon, Toggle } from '@dascade/ui';
import { serverNow, session, useRoomMessage, useRoomSelector } from '../../net/hooks.ts';
import { sfx } from '../../audio/audio.ts';
import { Stage } from './Stage.tsx';
import { useShowFeed } from './fx.ts';
import { useStageWindow } from './stageWindow.ts';
import {
  AudioStatus,
  JoinQrTools,
  PresenterTools,
  PrivateBand,
  StageCards,
  StageWindowButton,
  putJoinPop,
  usePresenterWindowChrome,
} from './consoleParts.tsx';
import {
  formatClock,
  useBoard,
  useCard,
  useClock,
  useCrew,
  useEvent,
  usePass,
  usePicker,
  useRehearsal,
  useScoresView,
  useJoinPop,
  useSceneCard,
  useSheet,
  useShowSounds,
  useStandingsCard,
  useStation,
  useSweep,
  useThemeMusicPref,
  type PickerView,
} from './state.ts';
import {
  CREW_TAB_LABEL,
  CrewPanel,
  NamesPanel,
  PickerPanel,
  PickerStrip,
  PreflightPanel,
  ScoresPanel,
  SoundPanel,
  crewTabs,
} from './panels/index.ts';
import { StationBadge } from './StationBadge.tsx';
import { ConsoleDrawer, type DrawerTab } from './ConsoleDrawer.tsx';
import {
  ConsoleDashboard,
  LayoutSwitch,
  ToolStack,
  UNDER_RAIL,
  UNDER_SHEET,
  useConsoleLayout,
  useRoomyConsole,
  useToolFocus,
} from './ConsoleDashboard.tsx';
import { HoldButton, type HoldButtonHandle } from './HoldButton.tsx';
import { UndoToast, useUndoOffer } from './UndoToast.tsx';
import { EndShowPanel, type EndKind } from './EndShowPanel.tsx';
import {
  HOLD_MS,
  DIALOG_SELECTOR,
  armSpecial,
  armedStillValid,
  digitSlot,
  ignoreKey,
  isSpace,
  spaceOnArmed,
  sweepNeedsHold,
  tileAction,
  type ArmedSpecial,
} from './consoleSafety.ts';
import { TourButton } from './tour/TourButton.tsx';
import { CinemaPanel } from './panels/CinemaPanel.tsx';
import { AwardsPanel, startAwards } from './panels/AwardsPanel.tsx';
import { cinemaView, useCinema } from './cinema.ts';
import './chrome-showcase.css';

type BoardAct = 'begin' | 'question' | 'next' | 'undo' | 'finish' | 'restart' | 'reset';

const STAGE_LABEL: Record<string, string> = {
  intro: 'Opening',
  title: 'Title card',
  live: 'Live',
  steal: 'Live',
  done: 'Board complete',
};

/** The special answer's marker (the pumpkin is the DAS-O-Ween one). */
export const specialMark = (look: ShowdownLook) => (look === 'halloween' ? '🎃' : '⭐');

/**
 * Time's up on the round clock — re-renders its host only when that flips (not 4× a second like the
 * clock's own display).
 */
function useTimeUp(): boolean {
  const endsAt = useRoomSelector<ShowdownPublicState, number>((s) => s.clockEndsAt) ?? 0;
  const paused = useRoomSelector<ShowdownPublicState, number>((s) => s.clockLeft) ?? 0;
  const max = useRoomSelector<ShowdownPublicState, number>((s) => s.clockMax) ?? 0;
  const [, force] = useState(0);
  const left = endsAt > 0 ? endsAt - serverNow() : paused;
  const pending = endsAt > 0 && left > 0;
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => force((n) => n + 1), Math.max(0, endsAt - serverNow()) + 40);
    return () => clearTimeout(t);
  }, [pending, endsAt]);
  return max > 0 && left <= 0;
}

/**
 * Some dialog owns the keyboard: a native one, or a visible ARIA modal (the jukebox player is a
 * `div role="dialog" aria-modal`). The console's shortcuts rest until it closes.
 */
function dialogOpen(): boolean {
  if (document.querySelector('dialog[open]')) return true;
  for (const el of document.querySelectorAll<HTMLElement>('[aria-modal="true"]')) if (el.getClientRects().length > 0) return true;
  return false;
}

const hiddenCount = (b: ShowdownBoardView | null) => (b ? b.slots.filter((s) => !s.revealed).length : 0);
const isLast = (b: ShowdownBoardView) => b.round >= b.totalRounds - 1;
const canSweep = (b: ShowdownBoardView, sweeping: boolean) => b.stage === 'live' && !sweeping && hiddenCount(b) > 0;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Two-tier scoring shows at all (Score the crowd, or medals that aren't Never). */
const scoringOn = (s: ShowdownSettings | null) => Boolean(s && s.mode === 'showcase' && (s.points || (s.medals ?? 'never') !== 'never'));
/** The Standings card is offered between rounds (Standings + paced finale, not Just the finale). */
const standingsOffered = (s: ShowdownSettings | null) => scoringOn(s) && (s?.reveal ?? 'standings') === 'standings';
const putStandings = (on: boolean) => session.send(SHOWDOWN_MSG.card, { card: on ? SHOWDOWN_STANDINGS_CARD : '' });

export function ShowcaseConsole({ look, settings, code }: { look: ShowdownLook; settings: ShowdownSettings | null; code: string }) {
  usePresenterWindowChrome();
  const board = useBoard();
  const sheet = useSheet();
  const pass = usePass();
  const sweeping = useSweep();
  const rehearsal = useRehearsal();
  const card = useCard();
  const standingsUp = useStandingsCard();
  const sceneCard = useSceneCard();
  const joinUp = useJoinPop() === 'in';
  const cinema = useCinema();
  const scoresView = useScoresView();
  const timeUp = useTimeUp();
  const picker = usePicker();
  const event = useEvent();
  const station = useStation();
  const crew = useCrew();
  const crewTabIds = crewTabs(crew?.perms ?? []);
  const running = useRoomSelector<ShowdownPublicState, boolean>((s) => (s.clockEndsAt ?? 0) > 0) ?? false;
  const clockMax = useRoomSelector<ShowdownPublicState, number>((s) => s.clockMax) ?? 0;
  const stageWin = useStageWindow();
  const title = settings ? showTitle(settings) : 'DAS Survey Showdown';

  const [armed, setArmedState] = useState<ArmedSpecial | null>(null);
  const [panel, setPanel] = useState<EndKind | null>(null);
  const [announce, setAnnounce] = useState('');
  const [drawerFocus, setDrawerFocus] = useState({ id: '', n: 0 });
  const layout = useConsoleLayout();
  const roomy = useRoomyConsole();
  useToolFocus(layout === 'dashboard' ? drawerFocus : undefined);
  const openTab = useCallback((id: string) => setDrawerFocus((f) => ({ id, n: f.n + 1 })), []);
  const undo = useUndoOffer(board?.rev ?? -1, sheet?.undo ?? 0);
  const sweepHold = useRef<HoldButtonHandle>(null);
  const panelOpener = useRef<HTMLElement | null>(null);
  const armedRef = useRef<ArmedSpecial | null>(null);

  const stageUp = Boolean(card || standingsUp || sceneCard);
  const live = useRef({ board, sheet, sweeping, running, timeUp, picker, panel, stageUp, sceneCard, joinUp });
  live.current = { board, sheet, sweeping, running, timeUp, picker, panel, stageUp, sceneCard, joinUp };

  const setArmed = useCallback((next: ArmedSpecial | null) => {
    armedRef.current = next;
    setArmedState(next);
  }, []);

  const send = useCallback((payload: ShowdownActPayload) => session.send(SHOWDOWN_MSG.act, payload), []);
  const act = useCallback(
    (a: BoardAct) => {
      const b = live.current.board;
      if (b) send({ a, rev: b.rev });
    },
    [send],
  );
  const reveal = useCallback(
    (slot: number) => {
      const b = live.current.board;
      // Reveals name the round on screen (not the revision): a late one never flips the next board.
      if (b) send({ a: 'reveal', slot, round: b.round });
    },
    [send],
  );
  const miss = useCallback(() => {
    const b = live.current.board;
    if (b) send({ a: 'miss', round: b.round });
  }, [send]);
  const clockOp = useCallback((op: ShowdownClockOp) => send({ a: 'clock', op }), [send]);
  const cue = useCallback((c: ShowdownCue) => session.send(SHOWDOWN_MSG.cue, { cue: c }), []);
  const halt = useCallback(() => send({ a: 'halt' }), [send]);

  // ---- Scenes A: what the stage window shows (B = Show, V = Cinema); the server pauses the round clock on leaving Show ----
  const goScene = useCallback(
    (to: 'show' | 'cinema' | 'awards') => {
      if (to === 'show') {
        if (!live.current.stageUp) return;
        sfx('select');
        session.send(SHOWDOWN_MSG.card, { card: '' });
        setAnnounce('Back to the show: the board is on the stage.');
        return;
      }
      if (to === 'awards') {
        if (live.current.sceneCard === 'awards') return;
        if (!startAwards()) {
          openTab('awards');
          setAnnounce('Fill in the winners first (Awards tab).');
          return;
        }
        openTab('awards');
        setAnnounce('The awards are on the stage. Press Next for each step.');
        return;
      }
      const c = cinemaView();
      if (!c.clipId || !c.window) {
        openTab('cinema');
        setAnnounce(!c.window ? 'Open the stage window first: the video plays there.' : 'Load a video first (Cinema tab).');
        return;
      }
      if (live.current.sceneCard === 'cinema') return;
      sfx('select');
      session.send(SHOWDOWN_MSG.card, { card: 'cinema' });
      openTab('cinema');
      setAnnounce('Cinema is on the stage. Press Play when you’re ready.');
    },
    [openTab],
  );

  // ---- PRS-02: the special arms; TAKE SPECIAL (Space) sends it ----
  const onTile = useCallback(
    (slot: number) => {
      const { board: b, sweeping: on } = live.current;
      if (!b) return;
      const what = tileAction(b, slot, on);
      if (what === 'reveal') reveal(slot);
      else if (what === 'arm' && !armedRef.current) {
        setArmed(armSpecial(b, slot, on));
        setAnnounce(
          `Special answer number ${slot + 1} armed. Nobody sees it yet. Press Space or Take special to reveal it; Escape disarms.`,
        );
      }
    },
    [reveal, setArmed],
  );
  const take = useCallback(() => {
    const a = armedRef.current;
    if (!a) return;
    setArmed(null);
    reveal(a.slot);
  }, [reveal, setArmed]);
  const disarm = useCallback(() => {
    if (!armedRef.current) return;
    setArmed(null);
    setAnnounce('Special answer disarmed.');
  }, [setArmed]);
  // The armed special stands only on its own round and stage, outside a sweep, while it's hidden.
  useEffect(() => {
    if (armed && !armedStillValid(armed, board, sweeping)) {
      setArmed(null);
      setAnnounce('Special answer disarmed.');
    }
  }, [armed, board, sweeping, setArmed]);

  // ---- PRS-03: holds, the End show panel, the undo toast ----
  const sweepNow = useCallback(() => {
    const { board: b, sweeping: on } = live.current;
    if (b && canSweep(b, on)) send({ a: 'sweep', round: b.round });
  }, [send]);

  const openPanel = useCallback((kind: EndKind) => {
    const active = document.activeElement;
    if (!live.current.panel) panelOpener.current = active instanceof HTMLElement ? active : null;
    setPanel(kind);
  }, []);
  const closePanel = useCallback(() => {
    setPanel(null);
    const opener = panelOpener.current;
    const active = document.activeElement;
    // Back to the button that opened it (if focus was in the panel, or nowhere).
    requestAnimationFrame(() => {
      if (opener?.isConnected && (!active || active === document.body || active.closest('.sdc-endpanel'))) opener.focus();
    });
  }, []);
  // The panel belongs to the board it was opened on.
  const panelRound = board?.round;
  useEffect(() => {
    setPanel(null);
  }, [panelRound]);

  /** Next: start round 1, or the next round — at once, with an undo toast when answers stay hidden. */
  const requestNext = useCallback(() => {
    const b = live.current.board;
    if (!b) return;
    if (b.stage === 'intro') return act('begin');
    if (isLast(b)) return openPanel('finish');
    const hidden = hiddenCount(b);
    if (hidden > 0) {
      if (b.stage === 'title') undo.open(`Skipped round ${b.round + 1}`, 'Its answers stay hidden.', b.rev);
      else undo.open(`Moved on to round ${b.round + 2}`, `${plural(hidden, 'answer')} stayed hidden.`, b.rev);
    }
    act('next');
  }, [act, openPanel, undo]);

  const restartRound = useCallback(() => {
    const b = live.current.board;
    if (!b || b.round < 0) return;
    undo.open(`Round ${b.round + 1} restarted`, 'Every answer went back under its tile.', b.rev);
    act('restart');
  }, [act, undo]);
  const restartShow = useCallback(() => {
    const b = live.current.board;
    if (!b || b.stage === 'intro') return;
    undo.open('The show went back to the opening', 'Every board is hidden again.', b.rev);
    act('reset');
  }, [act, undo]);

  // Keyboard shortcuts: no auto-repeat, no chords, ignored while typing or with a dialog open, and a
  // key only sends what its button would allow (a refused command would just beep). The picker's
  // K / D / A belong to the PickerStrip in the rail (its own listener; a handled key arrives here
  // default-prevented and is ignored).
  //
  // The listeners mount once: the commands they call change identity (the undo offer moves on), so
  // they're read through a ref — a re-subscribe mid-hold would lose R's keyup and let the sweep fire.
  const keyActs = useRef({ act, onTile, take, disarm, miss, halt, sweepNow, requestNext, cue, clockOp, goScene });
  keyActs.current = { act, onTile, take, disarm, miss, halt, sweepNow, requestNext, cue, clockOp, goScene };
  /** Space took the special: its keyup mustn't also press whatever button has focus. */
  const swallowSpace = useRef(false);
  /** R is being held (Reveal remaining while the clock runs). */
  const rHeld = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ignoreKey(e)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable]') || t.isContentEditable || t.closest(DIALOG_SELECTOR))) return;
      if (dialogOpen()) return;
      const cur = live.current;
      const run = keyActs.current;
      const b = cur.board;
      if (!b) return;
      const k = e.key.toLowerCase();
      const slot = digitSlot(e);
      if (slot !== null) run.onTile(slot);
      else if (isSpace(e)) {
        // Space keeps its usual meaning (press the focused button) unless the special is armed and
        // focus is nowhere in particular (or on the sheet).
        if (!armedRef.current || spaceOnArmed(t) !== 'take') return;
        swallowSpace.current = true;
        run.take();
      } else if (k === 'escape') {
        if (armedRef.current) run.disarm();
        else if (cur.sweeping) run.halt();
        else return;
      } else if (k === 'x') {
        if (b.stage === 'live' && !cur.sweeping) run.miss();
      } else if (k === 'r') {
        if (cur.sweeping) run.halt();
        else if (!canSweep(b, cur.sweeping)) return;
        else if (sweepNeedsHold(cur.running, cur.timeUp)) {
          // While the clock runs, R is a hold (keyup before 0.8 s cancels) — never an instant sweep.
          if (!sweepHold.current) return;
          rHeld.current = true;
          sweepHold.current.start();
        } else run.sweepNow();
      } else if (k === 'b') {
        if (!cur.stageUp) return;
        run.goScene('show');
      } else if (k === 'v') run.goScene('cinema');
      else if (k === 'j') putJoinPop(!cur.joinUp);
      else if (k === 'c') run.cue('celebrate');
      else if (k === 'p') {
        if (b.stage === 'intro') return;
        run.clockOp(cur.running ? 'pause' : 'start');
      } else if (k === 'q') {
        if (b.stage === 'intro') run.act('begin');
        else if (b.stage === 'title') run.act('question');
        else return;
      } else if (k === 'n') run.requestNext();
      else if (k === 'u') {
        if ((cur.sheet?.undo ?? 0) > 0) run.act('undo');
        else return;
      } else return;
      e.preventDefault();
    };
    const onUp = (e: KeyboardEvent) => {
      if (isSpace(e) && swallowSpace.current) {
        swallowSpace.current = false;
        e.preventDefault();
      }
      if (rHeld.current && e.key.toLowerCase() === 'r') {
        rHeld.current = false;
        sweepHold.current?.cancel();
      }
    };
    const onBlur = () => {
      if (rHeld.current) sweepHold.current?.cancel();
      rHeld.current = false;
      swallowSpace.current = false;
    };
    window.addEventListener('keydown', onKey);
    // Capture: before the focused button's own keyup (where Space would press it).
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // The stage preview re-renders on its own feed; keep it out of the console's re-renders.
  const preview = useMemo(() => <Stage look={look} settings={settings} variant="preview" />, [look, settings]);

  if (!board) return null;
  const stage = board.stage;
  const hidden = hiddenCount(board);
  const found = board.slots.filter((s) => s.revealed && !s.late).length;
  const last = isLast(board);
  const roundTitle = board.title || sheet?.title || '';
  const where = board.round < 0 ? 'Before round 1' : `Round ${board.round + 1} of ${board.totalRounds}`;
  const needsHold = sweepNeedsHold(running, timeUp);
  const armedView = armed && armedStillValid(armed, board, sweeping) ? armed : null;
  const armedText = armedView && sheet && sheet.round === board.round ? (sheet.answers[armedView.slot]?.text ?? '') : '';

  const tabs: DrawerTab[] = [
    {
      id: 'picker',
      label: 'Picker',
      icon: 'dice',
      alert: picker.hotSeat ? `${picker.hotName || 'someone'} is up` : undefined,
      render: () => <PickerPanel look={look} board={board} />,
    },
    { id: 'sound', label: 'Sound', icon: 'music', render: () => <SoundTab look={look} onCue={cue} /> },
    {
      id: 'cards',
      label: 'Cards',
      icon: 'eye',
      alert: card
        ? `${SHOWDOWN_CARD_INFO[card].title} is on the stage`
        : standingsUp
          ? 'The standings are on the stage'
          : joinUp
            ? 'The Join pop-up is up'
            : undefined,
      render: () => <CardsTab code={code} onClock={clockOp} standings={standingsOffered(settings)} />,
    },
    {
      id: 'cinema',
      label: 'Cinema',
      icon: 'play',
      alert: sceneCard === 'cinema' ? 'Cinema is on the stage' : undefined,
      render: () => <CinemaPanel onScene={(on) => goScene(on ? 'cinema' : 'show')} />,
    },
    {
      id: 'awards',
      label: 'Awards',
      icon: 'trophy',
      alert: sceneCard === 'awards' ? 'The awards are on the stage' : undefined,
      render: () => <AwardsPanel />,
    },
    {
      id: 'fix',
      label: 'Fix',
      icon: 'refresh',
      render: () => (
        <FixTab
          board={board}
          code={code}
          pass={pass}
          onRestartRound={restartRound}
          onRestartShow={restartShow}
          onUndo={() => act('undo')}
        />
      ),
    },
  ];
  if (settings?.audience) tabs.push({ id: 'guesses', label: 'Guesses', icon: 'chat', render: () => <AudienceGuesses sheet={sheet} /> });
  if (scoringOn(settings) || scoresView)
    tabs.push({ id: 'scores', label: 'Scores', icon: 'trophy', render: () => <ScoresPanel look={look} code={code} /> });
  // Crew tabs, only for those allowed (the server sends the permissions and checks every action again).
  if (crewTabIds.includes('names')) tabs.push({ id: 'names', label: CREW_TAB_LABEL.names, icon: 'pencil', render: () => <NamesPanel /> });
  if (crewTabIds.includes('crew'))
    tabs.push({ id: 'crew', label: CREW_TAB_LABEL.crew, icon: 'crown', render: () => <CrewPanel code={code} /> });
  if (crewTabIds.includes('preflight'))
    tabs.push({
      id: 'preflight',
      label: CREW_TAB_LABEL.preflight,
      icon: 'check',
      render: () => <PreflightPanel look={look} code={code} title={title} />,
    });

  // The Dashboard's tools: on a big, tall screen the statuses and logs go under the answer sheet and the
  // small tools under the rail; the rest (all of them otherwise) in the columns beside.
  const under = layout === 'dashboard' && roomy;
  const sheetTools = under ? tabs.filter((t) => UNDER_SHEET.includes(t.id)) : [];
  const railTools = under ? tabs.filter((t) => UNDER_RAIL.includes(t.id)) : [];
  const sideTools = under ? tabs.filter((t) => !UNDER_SHEET.includes(t.id) && !UNDER_RAIL.includes(t.id)) : tabs;

  // The stage preview, its scene strip and End show's confirm: over the drawer (Classic), or first in the
  // first tools column (Dashboard).
  const side = (
    <>
      {panel ? (
        <EndShowPanel
          kind={panel}
          board={board}
          sheet={sheet}
          look={look}
          sweeping={sweeping}
          revealNeedsHold={needsHold}
          onClose={closePanel}
          onRevealFirst={() => {
            setPanel(null);
            sweepNow();
          }}
          onConfirm={() => {
            setPanel(null);
            act(panel === 'finish' ? 'next' : 'finish');
          }}
        />
      ) : null}
      <SceneStrip scene={sceneCard ?? (card || standingsUp ? 'cards' : 'show')} onScene={goScene} onCards={() => openTab('cards')} />
      <div className="sdc-side__preview" data-part="showdown-preview">
        <div className="sd-preview" aria-hidden inert>
          {preview}
        </div>
        <p className="sd-preview__caption">
          <PixelIcon name="eye" /> What the audience sees
          {stageWin.open ? ' (live in the stage window)' : ' — open the stage window to share it'}
        </p>
      </div>
    </>
  );

  return (
    <div
      className="sd-console sdc"
      data-look={look}
      data-stage={stage}
      data-armed={armedView ? 'true' : undefined}
      data-part="showdown-console"
      data-mode="showcase"
      data-layout={layout}
    >
      <PrivateBand />
      <header className="sdc-bar">
        <span className="sd-live" aria-label="Live show">
          <i aria-hidden /> Live
        </span>
        <div className="sdc-bar__title">
          <span className="sdc-bar__show">{title}</span>
          <span className="sdc-bar__where">
            <b>{where}</b>
            {roundTitle && board.round >= 0 ? ` · ${roundTitle}` : ''} · {STAGE_LABEL[stage] ?? stage}
          </span>
        </div>
        {rehearsal ? (
          <Badge className="sdc-rehearsal" color="var(--warning)" solid title="Practice boards — the real show’s answers are not loaded">
            Rehearsal
          </Badge>
        ) : null}
        <span className="dc-spacer" />
        {event ? <StationBadge compact /> : null}
        {!event || station.mine ? <AudioStatus look={look} /> : null}
        <span className="sdc-bar__group">
          <LayoutSwitch />
          <TourButton look={look} size="sm" compact label="Presenter tour" />
          <StageWindowButton code={code} title={title} size="sm" openLabel="Stage window" />
        </span>
        <Button
          size="sm"
          variant="danger"
          icon="flag"
          aria-expanded={panel === 'end'}
          data-part="showdown-end-show"
          onClick={() => (panel === 'end' ? closePanel() : openPanel('end'))}
        >
          End show
        </Button>
      </header>

      {sceneCard ? (
        <div className="sdc-cardup" role="status" data-part="showdown-scene-up">
          <span aria-hidden>{SHOWDOWN_SCENE_INFO[sceneCard].icon}</span>
          <span>
            <b>{SHOWDOWN_SCENE_INFO[sceneCard].title}</b> is on the stage —{' '}
            {sceneCard === 'awards'
              ? 'press Next in the Awards tab for each step.'
              : cinema.playing
                ? 'your video is playing.'
                : cinema.ended
                  ? 'the video ended.'
                  : 'press Play in the Cinema tab.'}
          </span>
          <Button size="sm" variant="secondary" onClick={() => goScene('show')}>
            Back to the show <Kbd>B</Kbd>
          </Button>
        </div>
      ) : card ? (
        <div className="sdc-cardup" role="status">
          <span aria-hidden>{SHOWDOWN_CARD_INFO[card].icon}</span>
          <span>
            <b>{SHOWDOWN_CARD_INFO[card].title}</b> is on the stage — the audience can’t see the board right now.
          </span>
          <Button size="sm" variant="secondary" onClick={() => session.send(SHOWDOWN_MSG.card, { card: '' })}>
            Take it down
          </Button>
        </div>
      ) : standingsUp ? (
        <div className="sdc-cardup" role="status" data-part="showdown-standings-up">
          <span aria-hidden>🏆</span>
          <span>
            <b>The standings</b> are on the stage — the audience can’t see the board right now.
          </span>
          <Button size="sm" variant="secondary" onClick={() => putStandings(false)}>
            Take it down
          </Button>
        </div>
      ) : null}

      <NextStep
        board={board}
        hidden={hidden}
        found={found}
        last={last}
        timeUp={timeUp}
        sweeping={sweeping}
        minutes={Math.round(clockMax / 60_000)}
        armed={armedView ? { slot: armedView.slot, text: armedText, mark: specialMark(look) } : null}
        standings={standingsOffered(settings) ? (standingsUp ? 'up' : 'offer') : null}
        onAct={act}
        onNext={requestNext}
        onSweep={sweepNow}
        onHalt={halt}
        onTake={take}
        onDisarm={disarm}
      />

      <div className="sdc-main">
        <div className="sdc-sheetcol">
          <section className="sdc-sheet" aria-label="Answer sheet" data-part="showdown-sheet">
            <AnswerSheet board={board} sheet={sheet} look={look} found={found} armed={armedView?.slot ?? -1} onTile={onTile} />
          </section>
          <RoundStrip board={board} sheet={sheet} look={look} found={found} picker={picker} />
          <ToolStack tabs={sheetTools} where="sheet" />
        </div>

        <section className="sdc-rail" aria-label="Show controls">
          <WrongButton board={board} sweeping={sweeping} onMiss={miss} />
          <ClockPanel stage={stage} timeUp={timeUp} sweeping={sweeping} onOp={clockOp} />
          <SweepButton
            board={board}
            hidden={hidden}
            sweeping={sweeping}
            timeUp={timeUp}
            needsHold={needsHold}
            holdRef={sweepHold}
            onSweep={sweepNow}
            onHalt={halt}
          />
          <div className="sdc-rail__row">
            <Button
              variant="secondary"
              icon="refresh"
              disabled={(sheet?.undo ?? 0) === 0}
              onClick={() => act('undo')}
              title={`${sheet?.undo ?? 0} step${sheet?.undo === 1 ? '' : 's'} to undo`}
              data-part="showdown-undo"
            >
              Undo <Kbd>U</Kbd>
            </Button>
            <Button
              variant={stage === 'done' ? 'primary' : 'ghost'}
              icon={stage === 'intro' ? 'play' : last ? 'flag' : 'arrow-right'}
              onClick={requestNext}
              aria-expanded={last && stage !== 'intro' ? panel === 'finish' : undefined}
              data-part="showdown-next"
            >
              {stage === 'intro' ? 'Start round 1' : last ? 'Finish show' : 'Next round'} <Kbd>N</Kbd>
            </Button>
          </div>
          <div className="sdc-rail__picker" data-part="showdown-picker-slot">
            <PickerStrip look={look} board={board} />
          </div>
          <ToolStack tabs={railTools} where="rail" />
        </section>

        {layout === 'dashboard' ? (
          <>
            <ConsoleDashboard
              tabs={sideTools}
              lead={
                <section className="sdc-side" aria-label="Stage preview">
                  {side}
                </section>
              }
            />
            <UndoToast api={undo} onUndo={() => act('undo')} />
          </>
        ) : (
          <section className="sdc-side" aria-label="Stage preview and tools">
            {side}
            <ConsoleDrawer tabs={tabs} focus={drawerFocus} />
            <UndoToast api={undo} onUndo={() => act('undo')} />
          </section>
        )}
      </div>

      <Dock board={board} hidden={hidden} sweeping={sweeping} needsHold={needsHold} onMiss={miss} onSweep={sweepNow} onHalt={halt} />

      <footer className="sd-console__keys sdc-keys" aria-label="Keyboard shortcuts">
        <span>
          <Kbd>1</Kbd>–<Kbd>0</Kbd> reveal
        </span>
        <span>
          special: its key arms, <Kbd>Space</Kbd> takes, <Kbd>Esc</Kbd> disarms
        </span>
        <span>
          <Kbd>X</Kbd> wrong
        </span>
        <span>
          <Kbd>R</Kbd> reveal remaining (hold if the clock runs)
        </span>
        <span>
          <Kbd>C</Kbd> celebrate
        </span>
        <span>
          <Kbd>P</Kbd> clock
        </span>
        <span>
          <Kbd>Q</Kbd> start / question
        </span>
        <span>
          <Kbd>N</Kbd> next
        </span>
        <span>
          <Kbd>U</Kbd> undo
        </span>
        <span>
          <Kbd>K</Kbd> pick
        </span>
        <span>
          <Kbd>D</Kbd> done
        </span>
        <span>
          <Kbd>A</Kbd> no answer
        </span>
      </footer>

      <p className="visually-hidden" role="status" aria-live="polite" data-part="showdown-console-announce">
        {announce}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function NextStep({
  board,
  hidden,
  found,
  last,
  timeUp,
  sweeping,
  minutes,
  armed,
  standings,
  onAct,
  onNext,
  onSweep,
  onHalt,
  onTake,
  onDisarm,
}: {
  board: ShowdownBoardView;
  hidden: number;
  found: number;
  last: boolean;
  timeUp: boolean;
  sweeping: boolean;
  minutes: number;
  armed: { slot: number; text: string; mark: string } | null;
  /** Two-tier scoring: Show standings is offered between rounds ('up' = it's on the stage now). */
  standings: 'offer' | 'up' | null;
  onAct: (a: BoardAct) => void;
  onNext: () => void;
  onSweep: () => void;
  onHalt: () => void;
  onTake: () => void;
  onDisarm: () => void;
}) {
  const total = board.slots.length;
  let text: ReactNode;
  let action: ReactNode = null;
  let tone: 'go' | 'live' | 'alert' | 'done' | 'armed' = 'go';
  let label = 'Next step';
  if (armed) {
    tone = 'armed';
    label = 'Special armed';
    text = (
      <>
        <span aria-hidden>{armed.mark}</span> <b>#{armed.slot + 1}</b>
        {armed.text ? <> {armed.text}</> : null} is armed — nobody sees it yet. Build the suspense, then take it.
      </>
    );
    action = (
      <>
        <Button variant="secondary" icon="close" onClick={onDisarm} data-part="showdown-disarm-special">
          Disarm <Kbd>Esc</Kbd>
        </Button>
        <Button variant="primary" size="lg" icon="play" className="sdc-take" onClick={onTake} data-part="showdown-take-special">
          Take special <Kbd>Space</Kbd>
        </Button>
      </>
    );
  } else
    switch (board.stage) {
      case 'intro':
        text = 'The opening is on the stage. Welcome everyone, then start round 1.';
        action = (
          <Button variant="primary" size="lg" icon="play" onClick={() => onAct('begin')}>
            Start round 1 <Kbd>Q</Kbd>
          </Button>
        );
        break;
      case 'title':
        text = (
          <>
            Round {board.round + 1}’s title card is up
            {board.title ? (
              <>
                {' '}
                — <b>{board.title}</b>
              </>
            ) : null}
            . Show the question when you’re ready
            {minutes > 0 ? ` — the ${minutes}-minute clock starts with it.` : '.'}
          </>
        );
        action = (
          <Button variant="primary" size="lg" icon="eye" onClick={() => onAct('question')}>
            Show the question <Kbd>Q</Kbd>
          </Button>
        );
        break;
      case 'live':
      case 'steal':
        if (sweeping) {
          tone = 'live';
          text = (
            <>
              Revealing the rest, #{total} up to #1 — <span className="dc-num">{hidden}</span> to go. Enjoy the drumroll.
            </>
          );
          action = (
            <Button variant="secondary" size="lg" icon="pause" onClick={onHalt}>
              Stop <Kbd>Esc</Kbd>
            </Button>
          );
        } else if (timeUp) {
          tone = 'alert';
          text = (
            <>
              <b>Time’s up</b> — wrap up the last guesses, then Reveal remaining. Nothing flips until you say so.
            </>
          );
          action = hidden ? (
            <Button variant="primary" size="lg" icon="sparkle" onClick={onSweep}>
              Reveal remaining (<span className="dc-num">{hidden}</span>) <Kbd>R</Kbd>
            </Button>
          ) : null;
        } else {
          tone = 'live';
          text = (
            <>
              Read the chat: click the answer someone names, or press <b>Wrong</b>.{' '}
              <span className="sdc-next__count">
                <span className="dc-num">{found}</span> of <span className="dc-num">{total}</span> found
              </span>
            </>
          );
        }
        break;
      case 'done':
        tone = 'done';
        text = last ? (
          <>
            The whole board is up — that was the last one. Finish the show, then put up <b>Prize time</b> or <b>Thanks</b>.
          </>
        ) : (
          <>
            The whole board is up (<span className="dc-num">{found}</span> found). Take a breath — or put up <b>Be right back</b> — then go
            to round {board.round + 2}.
          </>
        );
        action = (
          <>
            {standings && !last ? (
              <Button
                variant="secondary"
                icon="trophy"
                aria-pressed={standings === 'up'}
                onClick={() => putStandings(standings !== 'up')}
                data-part="showdown-show-standings"
              >
                {standings === 'up' ? 'Hide standings' : 'Show standings'}
              </Button>
            ) : null}
            <Button variant="primary" size="lg" icon={last ? 'flag' : 'arrow-right'} onClick={onNext}>
              {last ? 'Finish the show' : 'Next round'} <Kbd>N</Kbd>
            </Button>
          </>
        );
        break;
    }
  return (
    <div className="sdc-next" data-tone={tone} role="status" data-part="showdown-next-step">
      <span className="sdc-next__label">{label}</span>
      <p className="sdc-next__text">{text}</p>
      {action ? <span className="sdc-next__action">{action}</span> : null}
    </div>
  );
}

function AnswerSheet({
  board,
  sheet,
  look,
  found,
  armed,
  onTile,
}: {
  board: ShowdownBoardView;
  sheet: ShowdownSheet | null;
  look: ShowdownLook;
  found: number;
  armed: number;
  onTile: (slot: number) => void;
}) {
  const intro = board.stage === 'intro';
  // Before round 1, the first round's answers as a read-only preview (to get ready).
  const upNext: ShowdownSheetRound | null = intro ? (sheet?.rundown[0] ?? null) : null;
  if (!sheet || (intro && !upNext)) {
    return (
      <div className="sd-panel sdc-sheetpanel">
        <h3 className="sd-panel__title">
          <PixelIcon name="lock" /> Answer sheet
        </h3>
        <p className="sd-muted">The answers appear here — and only here — once round 1 starts.</p>
      </div>
    );
  }
  const answers = intro ? upNext!.answers.map((a) => ({ ...a, revealed: false, guessed: 0 })) : sheet.answers;
  const special = intro ? upNext!.special : sheet.special;
  const prompt = intro ? upNext!.prompt : sheet.prompt;
  const title = intro ? upNext!.title : sheet.title;
  const source = intro ? upNext!.source : sheet.source;
  const roundNo = intro ? 1 : sheet.round + 1;
  const open = board.stage === 'title' || board.stage === 'live';
  const rows = Math.ceil(answers.length / 2);
  const mark = specialMark(look);
  const meta = intro
    ? 'A preview to get ready — the answers unlock when round 1 starts.'
    : board.stage === 'title'
      ? 'The question isn’t on the stage yet — clicking an answer shows it first.'
      : source
        ? `According to ${source}`
        : '';
  return (
    <div className="sd-panel sdc-sheetpanel" data-stage={board.stage}>
      <header className="sdc-sheet__head">
        <h3 className="sd-panel__title">
          <PixelIcon name="lock" /> {intro ? 'Up first' : 'Answer sheet'} <span className="sdc-private">Only you see this</span>
        </h3>
        {!intro ? (
          <span className="sdc-found" aria-label={`${found} of ${answers.length} found`}>
            <span className="dc-num">{found}</span>/<span className="dc-num">{answers.length}</span> found
          </span>
        ) : null}
      </header>
      <p className="sdc-sheet__prompt" data-hidden={board.stage === 'title' || intro ? 'true' : undefined}>
        <span className="sdc-sheet__q">
          R{roundNo}
          {title ? ` · ${title}` : ''}
        </span>
        <span className="sdc-sheet__qtext">{prompt}</span>
        {meta ? (
          <span className="sdc-sheet__source" data-hint={intro || board.stage === 'title' ? 'true' : undefined}>
            {meta}
          </span>
        ) : null}
      </p>
      <ol className="sdc-answers" style={{ '--rows': rows } as CSSProperties}>
        {answers.map((a, i) => {
          const slot = board.slots[i];
          const revealed = !intro && (slot?.revealed ?? a.revealed);
          const late = revealed && Boolean(slot?.late);
          const isSpecial = i === special;
          const isArmed = i === armed && !revealed;
          const n = i + 1;
          return (
            <li key={i}>
              <button
                type="button"
                className="sdc-answer"
                data-part="showdown-answer"
                data-slot={i}
                data-revealed={revealed ? 'true' : undefined}
                data-late={late ? 'true' : undefined}
                data-special={isSpecial ? 'true' : undefined}
                data-armed={isArmed ? 'true' : undefined}
                disabled={revealed || !open}
                onClick={() => onTile(i)}
                aria-label={
                  revealed
                    ? `Answer ${n}: ${a.text}, revealed`
                    : isArmed
                      ? `Answer ${n}: ${a.text} (special answer), armed — press Space or Take special to reveal it`
                      : `Reveal answer ${n}: ${a.text}${isSpecial ? ' (special answer)' : ''}`
                }
              >
                <span className="sdc-answer__num">{n}</span>
                <span className="sdc-answer__body">
                  <span className="sdc-answer__text">{a.text}</span>
                  {a.note || a.aliases.length ? (
                    <span className="sdc-answer__meta">
                      {a.note ? <span className="sdc-answer__note">{a.note}</span> : null}
                      {a.aliases.length ? <span className="sdc-answer__aliases">also: {a.aliases.join(', ')}</span> : null}
                    </span>
                  ) : null}
                </span>
                {a.guessed > 0 ? (
                  <span className="sdc-answer__guessed" title={`${a.guessed} in the audience guessed this`}>
                    <PixelIcon name="users" size={12} />
                    <span className="dc-num">{a.guessed}</span>
                  </span>
                ) : null}
                {revealed ? (
                  <span className="sdc-answer__action" aria-hidden>
                    <PixelIcon name="check" /> {late ? 'Shown' : 'Found'}
                  </span>
                ) : isArmed ? (
                  <span className="sdc-answer__action sdc-answer__armed" aria-hidden>
                    Armed · take <Kbd>Space</Kbd>
                  </span>
                ) : isSpecial ? (
                  <span className="sdc-answer__action sdc-answer__special" aria-hidden>
                    Special <span>{mark}</span>
                  </span>
                ) : (
                  <span className="sdc-answer__action sdc-answer__reveal" aria-hidden>
                    {intro ? <PixelIcon name="lock" /> : 'Reveal'}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Under the sheet: the rundown and this round's counts (found, wrong, picked). */
function RoundStrip({
  board,
  sheet,
  look,
  found,
  picker,
}: {
  board: ShowdownBoardView;
  sheet: ShowdownSheet | null;
  look: ShowdownLook;
  found: number;
  picker: PickerView;
}) {
  const feed = useShowFeed();
  const lastMiss = feed.last.miss;
  const misses = lastMiss && lastMiss.e.round === board.round ? lastMiss.e.n : 0;
  const picked = Object.keys(picker.done).length + (picker.hotSeat && !picker.done[picker.hotSeat] ? 1 : 0);
  const rounds = sheet?.rundown ?? [];
  const mark = specialMark(look);
  const status = (i: number) => {
    const res = board.results.find((r) => r.index === i);
    if (i < board.round || (i === board.round && board.stage === 'done'))
      return res?.total ? `${res.found ?? 0}/${res.total} found` : 'Done';
    if (i === board.round) return board.stage === 'title' ? 'Title card' : 'Now';
    return 'Up next';
  };
  return (
    <div className="sdc-strip">
      {rounds.length ? (
        <section className="sd-panel sdc-strip__rundown" aria-label="Rundown">
          <h3 className="sdc-strip__label">Rundown</h3>
          <ol className="sdc-strip__rounds">
            {rounds.map((r) => (
              <li key={r.index} data-state={r.index < board.round ? 'done' : r.index === board.round ? 'now' : 'next'}>
                <b className="dc-num">R{r.index + 1}</b>
                <span className="sdc-strip__title">{r.title || r.prompt}</span>
                <span className="sdc-strip__status">{status(r.index)}</span>
              </li>
            ))}
          </ol>
          <details className="sdc-strip__all">
            <summary>Every round’s answers</summary>
            <ol>
              {rounds.map((r) => (
                <li key={r.index}>
                  <span className="sd-rundown__q">
                    R{r.index + 1}
                    {r.title ? ` · ${r.title}` : ''}
                  </span>{' '}
                  <span className="sd-rundown__prompt">{r.prompt}</span>
                  <span className="sd-rundown__answers">
                    {r.answers.map((a, i) => `${i + 1}. ${a.text}${i === r.special ? ` ${mark}` : ''}`).join(' · ')}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        </section>
      ) : null}
      <section className="sd-panel sdc-strip__counts" aria-label="This round">
        <h3 className="sdc-strip__label">This round</h3>
        <div className="sdc-strip__stats">
          <span>
            <b className="dc-num">{found}</b> found
          </span>
          <span>
            <b className="dc-num">{misses}</b> wrong
          </span>
          <span>
            <b className="dc-num">{picked}</b> picked
          </span>
        </div>
      </section>
    </div>
  );
}

/** The wrong-answer buzzer: the ✕ and the buzzer on every screen. As often as people miss. */
function WrongButton({ board, sweeping, onMiss }: { board: ShowdownBoardView; sweeping: boolean; onMiss: () => void }) {
  const feed = useShowFeed();
  const last = feed.last.miss;
  const misses = last && last.e.round === board.round ? last.e.n : 0;
  const enabled = board.stage === 'live' && !sweeping;
  /** Re-keys the press pulse on every wrong answer that landed (the button itself keeps its focus). */
  const flash = last && last.e.round === board.round ? last.at : 0;
  return (
    <div className="sdc-wrongbox">
      <button
        type="button"
        className="sdc-wrong"
        data-part="showdown-wrong"
        disabled={!enabled}
        onClick={onMiss}
        aria-label="Wrong answer (buzzer and ✕ on the stage)"
      >
        {flash ? <span key={flash} className="sdc-wrong__pulse" aria-hidden /> : null}
        <span className="sdc-wrong__x" aria-hidden>
          ✕
        </span>
        <span className="sdc-wrong__label">Wrong</span>
        <Kbd>X</Kbd>
      </button>
      <span className="sdc-wrongbox__note" aria-live="polite">
        {board.stage === 'title'
          ? 'Show the question first'
          : board.stage === 'done'
            ? 'Every answer is up'
            : sweeping
              ? 'Revealing the rest…'
              : misses
                ? `${misses} wrong this round`
                : 'Buzz any guess that isn’t on the board'}
      </span>
    </div>
  );
}

function ClockPanel({
  stage,
  timeUp,
  sweeping,
  onOp,
}: {
  stage: ShowdownBoardView['stage'];
  timeUp: boolean;
  sweeping: boolean;
  onOp: (op: ShowdownClockOp) => void;
}) {
  const clock = useClock();
  const ready = stage !== 'intro';
  /** Starting the clock is the thing to do only while guessing is on (it starts with the question anyway). */
  const startMatters = stage === 'live' && !sweeping && !clock.running && clock.left > 0;
  const over = clock.on && clock.left < 0;
  const pct = clock.on && clock.max > 0 ? Math.max(0, Math.min(1, clock.left / clock.max)) : 0;
  return (
    <div
      className="sd-panel sdc-clock"
      data-state={!clock.on ? 'off' : timeUp ? 'up' : clock.running ? 'running' : 'paused'}
      data-part="showdown-clock"
    >
      {clock.on ? (
        <>
          <div className="sdc-clock__main">
            <span className="sdc-clock__readout">
              <span className="sdc-clock__head">
                <h3 className="sdc-clock__title">
                  <PixelIcon name="clock" size={11} /> Round clock
                </h3>
                <span className="sdc-clock__state">{timeUp ? 'Time’s up' : clock.running ? 'Running' : 'Paused'}</span>
              </span>
              <span
                className="sdc-clock__time"
                role="timer"
                aria-label={over ? `Overtime ${formatClock(clock.left)}` : `${formatClock(clock.left)} left`}
              >
                {formatClock(clock.left)}
              </span>
            </span>
            <Button
              className="sdc-clock__go"
              variant={startMatters ? 'primary' : 'secondary'}
              icon={clock.running ? 'pause' : 'play'}
              disabled={!ready}
              onClick={() => onOp(clock.running ? 'pause' : 'start')}
              aria-label={clock.running ? 'Pause clock' : 'Start clock'}
            >
              {clock.running ? 'Pause' : 'Start'} <Kbd>P</Kbd>
            </Button>
          </div>
          <span className="sdc-clock__bar" aria-hidden>
            <i style={{ transform: `scaleX(${pct})` }} />
          </span>
          <div className="sdc-clock__btns">
            <button type="button" className="sdc-mini" disabled={!ready} onClick={() => onOp('plus')} aria-label="Add one minute">
              +1 min
            </button>
            <button type="button" className="sdc-mini" disabled={!ready} onClick={() => onOp('minus')} aria-label="Take one minute off">
              −1 min
            </button>
            <button
              type="button"
              className="sdc-mini"
              disabled={!ready}
              onClick={() => onOp('reset')}
              aria-label="Reset the clock to full time (paused)"
            >
              Reset
            </button>
          </div>
        </>
      ) : (
        <>
          <h3 className="sdc-clock__title">
            <PixelIcon name="clock" size={11} /> Round clock <span className="sdc-clock__state">Off</span>
          </h3>
          <p className="sd-muted">This show has no round clock.</p>
          <Button size="sm" variant="secondary" icon="clock" disabled={!ready} onClick={() => onOp('start')}>
            Start a clock now
          </Button>
        </>
      )}
    </div>
  );
}

function SweepButton({
  board,
  hidden,
  sweeping,
  timeUp,
  needsHold,
  holdRef,
  onSweep,
  onHalt,
}: {
  board: ShowdownBoardView;
  hidden: number;
  sweeping: boolean;
  timeUp: boolean;
  needsHold: boolean;
  holdRef: RefObject<HoldButtonHandle | null>;
  onSweep: () => void;
  onHalt: () => void;
}) {
  if (sweeping) {
    return (
      <div className="sdc-sweep" data-on="true">
        <span className="sdc-sweep__status" role="status">
          <PixelIcon name="sparkle" /> Revealing… <span className="dc-num">{hidden}</span> to go
        </span>
        <Button variant="secondary" icon="pause" block onClick={onHalt}>
          Stop revealing <Kbd>Esc</Kbd>
        </Button>
      </div>
    );
  }
  const can = board.stage === 'live' && hidden > 0;
  const count = can ? (
    <span className="sdc-sweep__count">
      (<span className="dc-num">{hidden}</span>)
    </span>
  ) : null;
  return (
    <div className="sdc-sweep" data-hold={can && needsHold ? 'true' : undefined}>
      {can && needsHold ? (
        <HoldButton
          ref={holdRef}
          ms={HOLD_MS}
          variant="secondary"
          size="lg"
          block
          kbd="R"
          label={`Reveal remaining (${hidden}) — hold, the clock is still running`}
          onFire={onSweep}
          className="sdc-sweep__btn"
          data-part="showdown-sweep"
        >
          Reveal remaining {count}
        </HoldButton>
      ) : (
        <Button
          variant={timeUp && can ? 'primary' : 'secondary'}
          size="lg"
          block
          icon="sparkle"
          disabled={!can}
          onClick={onSweep}
          className="sdc-sweep__btn"
          data-urgent={timeUp && can ? 'true' : undefined}
          data-part="showdown-sweep"
        >
          Reveal remaining {count} <Kbd>R</Kbd>
        </Button>
      )}
      <span className="sdc-sweep__hint">
        {can
          ? needsHold
            ? 'The clock is running: press and hold (or hold R)'
            : `#${board.slots.length} → #1, a drumroll before the special one`
          : board.stage === 'done'
            ? 'Every answer is up'
            : 'Once the question is up'}
      </span>
    </div>
  );
}

function CuePanel({ onCue }: { onCue: (c: ShowdownCue) => void }) {
  return (
    <div className="sdc-tabsection">
      <h3 className="sd-panel__title">Sound cues</h3>
      <div className="sdc-cues">
        <button type="button" className="sdc-cue sdc-cue--big" onClick={() => onCue('celebrate')}>
          <span aria-hidden>{SHOWDOWN_CUE_INFO.celebrate.icon}</span> Celebrate! <Kbd>C</Kbd>
        </button>
        {SHOWDOWN_CUES.filter((c) => c !== 'celebrate').map((c) =>
          c === 'pickAnswer' ? (
            <SongCue key={c} onCue={onCue} />
          ) : (
            <button key={c} type="button" className="sdc-cue" onClick={() => onCue(c)}>
              <span aria-hidden>{SHOWDOWN_CUE_INFO[c].icon}</span>
              {SHOWDOWN_CUE_INFO[c].title}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

/** "Pick the Answer": a ~10 s song, so it reads "Playing…" (and can't be stacked) until it's done. */
function SongCue({ onCue }: { onCue: (c: ShowdownCue) => void }) {
  const [playingUntil, setPlayingUntil] = useState(0);
  useRoomMessage<{ cue: ShowdownCue }>(SHOWDOWN_MSG.cue, ({ cue }) => {
    if (cue === 'pickAnswer') setPlayingUntil(Date.now() + SHOWDOWN_SONG_MS);
  });
  useEffect(() => {
    if (!playingUntil) return;
    const t = setTimeout(() => setPlayingUntil(0), Math.max(0, playingUntil - Date.now()));
    return () => clearTimeout(t);
  }, [playingUntil]);
  const playing = playingUntil > 0;
  return (
    <button type="button" className="sdc-cue" disabled={playing} aria-live="polite" onClick={() => onCue('pickAnswer')}>
      <span aria-hidden>{SHOWDOWN_CUE_INFO.pickAnswer.icon}</span>
      {playing ? 'Playing…' : SHOWDOWN_CUE_INFO.pickAnswer.title}
    </button>
  );
}

/** Drawer → Sound: the sound station (event rooms), the cue buttons and this device's sound switches. */
function SoundTab({ look, onCue }: { look: ShowdownLook; onCue: (c: ShowdownCue) => void }) {
  const [sounds, setSounds] = useShowSounds('presenter');
  const [music, setMusic] = useThemeMusicPref();
  return (
    <div className="sdc-tab">
      <SoundPanel look={look} />
      <CuePanel onCue={onCue} />
      <div className="sdc-tabsection sdc-soundswitches">
        <h3 className="sd-panel__title">This device</h3>
        <Toggle label="Show sounds on this device" checked={sounds} onChange={setSounds} />
        <Toggle label="Theme music (opening, title and holding cards)" checked={music} onChange={setMusic} />
      </div>
    </div>
  );
}

/** Drawer → Cards: the holding cards, and whether the stage shows the clock. */
function CardsTab({ code, onClock, standings }: { code: string; onClock: (op: ShowdownClockOp) => void; standings: boolean }) {
  const clock = useClock();
  const standingsUp = useStandingsCard();
  return (
    <div className="sdc-tab">
      <div className="sdc-tabsection">
        <h3 className="sd-panel__title">Stage cards</h3>
        <StageCards compact />
      </div>
      <div className="sdc-tabsection">
        <h3 className="sd-panel__title">Join QR</h3>
        <p className="sd-muted">
          The Join pop-up puts the QR over the board for 20 seconds, for latecomers. Copy the image for the Teams chat.
        </p>
        <JoinQrTools code={code} popup />
      </div>
      {standings ? (
        <div className="sdc-tabsection">
          <h3 className="sd-panel__title">Standings</h3>
          <p className="sd-muted">
            The top five Guessers and the Spotlight Stars on every stage — best between rounds. Phones show each person their own rank.
          </p>
          <Button
            variant={standingsUp ? 'primary' : 'secondary'}
            icon="trophy"
            aria-pressed={standingsUp}
            onClick={() => putStandings(!standingsUp)}
            data-part="showdown-standings-card"
          >
            {standingsUp ? 'Hide standings' : 'Show standings'}
          </Button>
        </div>
      ) : null}
      {clock.on ? (
        <div className="sdc-tabsection">
          <Toggle label="Show the clock on the stage" checked={clock.stage} onChange={(on) => onClock(on ? 'show' : 'hide')} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The scene strip (Scenes A): what the stage window shows. Show = the board (B); Cinema = the
 * presenter's video (V); Cards = the holding cards (opens the Cards tab). One window on the share all
 * hour: nobody re-shares in Teams.
 */
function SceneStrip({
  scene,
  onScene,
  onCards,
}: {
  scene: 'show' | 'cinema' | 'awards' | 'cards';
  onScene: (to: 'show' | 'cinema' | 'awards') => void;
  onCards: () => void;
}) {
  return (
    <div className="sdc-scenes" role="group" aria-label="Stage scene" data-part="showdown-scenes">
      <button type="button" className="sdc-scene" aria-pressed={scene === 'show'} onClick={() => onScene('show')} data-scene="show">
        <PixelIcon name="star" aria-hidden /> Show <Kbd>B</Kbd>
      </button>
      <button type="button" className="sdc-scene" aria-pressed={scene === 'cinema'} onClick={() => onScene('cinema')} data-scene="cinema">
        <PixelIcon name="play" aria-hidden /> Cinema <Kbd>V</Kbd>
      </button>
      <button type="button" className="sdc-scene" aria-pressed={scene === 'awards'} onClick={() => onScene('awards')} data-scene="awards">
        <PixelIcon name="trophy" aria-hidden /> Awards
      </button>
      <button type="button" className="sdc-scene" aria-pressed={scene === 'cards'} onClick={onCards} data-scene="cards">
        <PixelIcon name="copy" aria-hidden /> Cards
      </button>
    </div>
  );
}

/** Drawer → Fix: restart the round or the show (press and hold; both can be undone), presenter tools. */
function FixTab({
  board,
  code,
  pass,
  onRestartRound,
  onRestartShow,
  onUndo,
}: {
  board: ShowdownBoardView;
  code: string;
  pass: string | null;
  onRestartRound: () => void;
  onRestartShow: () => void;
  onUndo: () => void;
}) {
  const undoSteps = useSheet()?.undo ?? 0;
  return (
    <div className="sdc-tab">
      <div className="sdc-tabsection sdc-fix">
        <h3 className="sd-panel__title">Fix a mistake</h3>
        <div className="sdc-fix__btns">
          <HoldButton
            ms={HOLD_MS}
            variant="secondary"
            icon="refresh"
            label="Restart this round"
            disabled={board.round < 0}
            onFire={onRestartRound}
            data-part="showdown-restart-round"
          >
            Restart this round
          </HoldButton>
          <HoldButton
            ms={HOLD_MS}
            variant="secondary"
            icon="refresh"
            label="Restart the whole show"
            disabled={board.stage === 'intro'}
            onFire={onRestartShow}
            data-part="showdown-restart-show"
          >
            Restart the whole show
          </HoldButton>
          <Button variant="ghost" icon="refresh" disabled={undoSteps === 0} onClick={onUndo}>
            Undo the last step <Kbd>U</Kbd>
          </Button>
        </div>
        <p className="sd-muted">
          Press and hold to restart. Both can be undone: an Undo stays up for 12 seconds, and <Kbd>U</Kbd> steps back one action at a time.
        </p>
      </div>
      <PresenterTools code={code} pass={pass} />
    </div>
  );
}

function AudienceGuesses({ sheet }: { sheet: ShowdownSheet | null }) {
  const guessesIn = useRoomSelector<ShowdownPublicState, number>((s) => s.guessesIn) ?? 0;
  const cloud = sheet?.cloud ?? [];
  return (
    <div className="sdc-tab">
      <h3 className="sd-panel__title">
        Phone guesses <Badge>{guessesIn}</Badge>
      </h3>
      {cloud.length === 0 ? (
        <p className="sd-muted">While the question is up, phones can lock in private guesses. The most popular show here.</p>
      ) : (
        <ol className="sd-cloud">
          {cloud.map((c, i) => (
            <li key={i} data-hit={c.slot >= 0 ? 'true' : undefined}>
              <span className="sd-cloud__text">{c.text}</span>
              {c.slot >= 0 ? (
                <span className="sd-cloud__slot">#{c.slot + 1}</span>
              ) : (
                <span className="sd-cloud__miss">not on the board</span>
              )}
              <span className="sd-num sd-cloud__count">{c.count}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Narrow screens: the buzzer and Reveal remaining stay at the bottom of the screen while you scroll the sheet. */
function Dock({
  board,
  hidden,
  sweeping,
  needsHold,
  onMiss,
  onSweep,
  onHalt,
}: {
  board: ShowdownBoardView;
  hidden: number;
  sweeping: boolean;
  needsHold: boolean;
  onMiss: () => void;
  onSweep: () => void;
  onHalt: () => void;
}) {
  const clock = useClock();
  const live = board.stage === 'live';
  const can = live && hidden > 0;
  return (
    <div className="sdc-dock" aria-label="Quick controls">
      <button type="button" className="sdc-wrong sdc-wrong--dock" disabled={!live || sweeping} onClick={onMiss} aria-label="Wrong answer">
        <span className="sdc-wrong__x" aria-hidden>
          ✕
        </span>
        <span className="sdc-wrong__label">Wrong</span>
      </button>
      {clock.on ? (
        <span className="sdc-dock__clock dc-num" data-over={clock.left <= 0 ? 'true' : undefined}>
          {formatClock(clock.left)}
        </span>
      ) : null}
      {sweeping ? (
        <Button variant="secondary" icon="pause" onClick={onHalt}>
          Stop
        </Button>
      ) : can && needsHold ? (
        <HoldButton ms={HOLD_MS} variant="secondary" label="Reveal the rest — hold, the clock is still running" onFire={onSweep}>
          Hold: reveal rest
        </HoldButton>
      ) : (
        <Button variant="secondary" icon="sparkle" disabled={!can} onClick={onSweep}>
          Reveal rest
        </Button>
      )}
    </div>
  );
}
