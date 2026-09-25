/**
 * The Wheel of DAStiny stage (PLAYING / COUNTDOWN) and the phase switch.
 *
 * Timing is always derived from the server's spin plan and the synced clock:
 * the reveal fires when serverNow() passes startAt + durationMs, so every
 * screen (including late joiners who pick the spin up mid-flight) celebrates
 * the same winner at the same moment.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { computeArcs, initialRotation, normalizeSegments } from '@dascade/game-core/wheel';
import { WHEEL_MSG, type WheelPublicState, type WheelSettings, type WheelSnapshotSegment } from '@dascade/shared/games/wheel';
import { Button, IconButton, Kbd, Modal, PixelIcon, Tabs, cx } from '@dascade/ui';
import { useApp } from '../../app/store.ts';
import { sfx } from '../../audio/audio.ts';
import { serverNow, session, useCountdown, useGame } from '../../net/hooks.ts';
import { ChatPanel, GameStage } from '../../shell/common.tsx';
import { ConfettiLayer, type ConfettiHandle } from './Confetti.tsx';
import { ReadOnlyWheel, WheelEditor } from './Editor.tsx';
import { BehaviourBadges } from './Legend.tsx';
import { parseSnapshot, type WheelLayout } from './model.ts';
import { HistoryList, ParticipantList } from './Rail.tsx';
import { ResultsView } from './Results.tsx';
import { pegTick, spinLaunch, spinReveal } from './sound.ts';
import { WheelDisplay } from './WheelDisplay.tsx';
import type { RenderSpin } from './WheelRenderer.ts';

type SpinPhase = 'none' | 'lead' | 'spinning' | 'landed';
type RailTab = 'history' | 'wheel' | 'players' | 'chat';

/** Stale landings (joined long after) show the result quietly instead of celebrating. */
const REVEAL_FRESH_MS = 5_000;
const REVEAL_HOLD_MS = 9_000;

function phaseOf(spin: RenderSpin | null, now: number): SpinPhase {
  if (!spin) return 'none';
  if (now < spin.startAt) return 'lead';
  if (now < spin.startAt + spin.durationMs) return 'spinning';
  return 'landed';
}

/** Re-renders exactly at the spin's phase transitions (server clock). */
function useSpinPhase(spin: RenderSpin | null): SpinPhase {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const phase = phaseOf(spin, serverNow());
  useEffect(() => {
    if (!spin) return;
    const now = serverNow();
    const end = spin.startAt + spin.durationMs;
    const next = now < spin.startAt ? spin.startAt : now < end ? end : null;
    if (next === null) return;
    const t = setTimeout(bump, Math.max(0, next - now) + 4);
    return () => clearTimeout(t);
  });
  return phase;
}

export function WheelView() {
  const phase = useGame()?.phase;
  if (phase === 'RESULTS' || phase === 'ENDED') return <ResultsView />;
  return <PlayView />;
}

interface Reveal {
  key: string;
  seg: WheelSnapshotSegment;
  spunBy: string;
  spinNo: number;
}

function PlayView() {
  const game = useGame<WheelPublicState, WheelSettings>();
  const reducedMotion = useApp((s) => s.settings.reducedMotion);
  const stageRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const confettiRef = useRef<ConfettiHandle>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [tab, setTab] = useState<RailTab>('history');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const landedKey = useRef<string | null>(null);
  const launchedKey = useRef<string | null>(null);

  const state = game?.state;
  const settings = game?.settings;
  const spin = state?.spin;
  const segmentsSetting = settings?.segments;
  const sliceSetting = settings?.sliceMode ?? 'equal';

  const settingsLayout = useMemo<WheelLayout>(() => ({ segments: normalizeSegments(segmentsSetting ?? []), sliceMode: sliceSetting }), [segmentsSetting, sliceSetting]);
  const snapshot = useMemo(() => parseSnapshot(spin?.snapshotJson), [spin?.snapshotJson]);
  const renderSpin = useMemo<RenderSpin | null>(
    () =>
      spin && spin.spinId > 0 && spin.startAt > 0
        ? { key: `${spin.spinId}:${spin.startAt}`, startAt: spin.startAt, durationMs: spin.durationMs, fromRotation: spin.fromRotation, toRotation: spin.toRotation }
        : null,
    [spin?.spinId, spin?.startAt, spin?.durationMs, spin?.fromRotation, spin?.toRotation], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const spinPhase = useSpinPhase(renderSpin);
  const winnerIndex = spin?.winnerIndex ?? -1;
  const spunByName = spin?.spunByName ?? '';
  const spinId = spin?.spinId ?? 0;

  // New spin: clear the old reveal and play the launch.
  useEffect(() => {
    if (!renderSpin || (spinPhase !== 'lead' && spinPhase !== 'spinning')) return;
    setReveal((r) => (r && r.key !== renderSpin.key ? null : r));
    if (spinPhase === 'spinning' && launchedKey.current !== renderSpin.key) {
      launchedKey.current = renderSpin.key;
      if (serverNow() - renderSpin.startAt < 700) spinLaunch();
    }
  }, [renderSpin, spinPhase]);

  // Landing: the same moment on every screen.
  useEffect(() => {
    if (!renderSpin || spinPhase !== 'landed' || !snapshot) return;
    if (landedKey.current === renderSpin.key) return;
    landedKey.current = renderSpin.key;
    const seg = snapshot.segments[winnerIndex];
    if (!seg) return;
    const late = serverNow() - (renderSpin.startAt + renderSpin.durationMs);
    if (late > REVEAL_FRESH_MS) return;
    setReveal({ key: renderSpin.key, seg, spunBy: spunByName, spinNo: spinId });
    spinReveal();
    const { fx: fxNow, reducedMotion: reduced } = useApp.getState().settings;
    if (!reduced && fxNow !== 'off') {
      const layer = stageRef.current?.getBoundingClientRect();
      const wheel = stageRef.current?.querySelector('.wh-wheel')?.getBoundingClientRect();
      const origin =
        layer && wheel && layer.width > 0 && layer.height > 0
          ? { x: (wheel.left + wheel.width / 2 - layer.left) / layer.width, y: (wheel.top + wheel.height * 0.1 - layer.top) / layer.height }
          : undefined;
      confettiRef.current?.burst([seg.color, '#ffb020', '#ff4f81', '#fff4d6'], origin);
    }
    if (!reduced && fxNow === 'high' && stageRef.current) {
      const el = stageRef.current;
      el.classList.remove('wh-shake');
      void el.offsetWidth;
      el.classList.add('wh-shake');
      setTimeout(() => el.classList.remove('wh-shake'), 520);
    }
  }, [renderSpin, spinPhase, snapshot, winnerIndex, spunByName, spinId]);

  // Auto-dismiss the reveal card.
  useEffect(() => {
    if (!reveal) return;
    const t = setTimeout(() => setReveal((r) => (r?.key === reveal.key ? null : r)), REVEAL_HOLD_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setReveal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [reveal]);

  const cooldownLeft = useCountdown(state?.nextSpinAt ?? 0);

  // The lobby may have been scrolled; the stage always opens at the top.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const isHost = game?.isHost ?? false;
  const isSpectator = game?.isSpectator ?? false;
  const inFlight = spinPhase === 'lead' || spinPhase === 'spinning' || spin?.status === 'spinning';
  const canRole = !isSpectator && (isHost || settings?.spinPermission === 'anyone');
  const empty = settingsLayout.segments.length === 0;
  const reason = !game
    ? 'Connecting…'
    : game.phase !== 'PLAYING'
      ? 'Get ready…'
      : isSpectator
        ? isHost && settings?.spinPermission !== 'anyone'
          ? 'You are spectating: set “Who can spin” to Anyone'
          : 'Spectators watch the show'
        : !canRole
          ? 'The host spins this wheel'
          : inFlight
            ? 'Spinning…'
            : empty
              ? 'Add options to spin'
              : cooldownLeft > 0
                ? 'Next spin in a moment…'
                : null;

  const doSpin = useCallback(() => {
    if (reason) return;
    sfx('click');
    session.send(WHEEL_MSG.spin, {});
  }, [reason]);
  const spinRef = useRef(doSpin);
  spinRef.current = doSpin;

  // Space / Enter spins when focus isn't in a control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== ' ' && e.key !== 'Enter') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, a, summary, [contenteditable="true"], dialog, [role="tab"]')) return;
      e.preventDefault();
      spinRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openEditor = () => {
    setTab('wheel');
    // Stacked layout: the rail sits below the stage, so bring it into view.
    if (window.matchMedia('(max-width: 860px)').matches) {
      requestAnimationFrame(() => railRef.current?.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' }));
    }
  };

  const onPointer = useCallback((seg: WheelSnapshotSegment | null) => {
    const el = readoutRef.current;
    if (!el) return;
    el.textContent = seg ? (seg.label && seg.emoji ? `${seg.emoji} ${seg.label}` : seg.label || seg.emoji) : '—';
    el.parentElement?.style.setProperty('--c', seg?.color ?? '#ffb020');
  }, []);

  if (!game || !state || !settings || !spin) return null;

  const showSnapshot =
    !!snapshot && !!renderSpin && (spinPhase === 'lead' || spinPhase === 'spinning' || spin.status === 'spinning' || reveal?.key === renderSpin.key);
  const layout: WheelLayout = showSnapshot && snapshot ? snapshot : settingsLayout;
  const rest = spin.spinId === 0 ? initialRotation(computeArcs(settingsLayout.segments, settingsLayout.sliceMode)) : state.restRotation;
  const highlight = reveal && showSnapshot ? { id: reveal.seg.id, color: reveal.seg.color } : null;
  const wheelLabel = `Prize wheel with ${layout.segments.length} option${layout.segments.length === 1 ? '' : 's'}${
    layout.segments.length ? `: ${layout.segments.slice(0, 12).map((s) => s.label || s.emoji).join(', ')}${layout.segments.length > 12 ? '…' : ''}` : ''
  }`;
  const title = settings.title || 'Spin the wheel';
  const hostName = game.players.find((p) => p.isHost)?.name ?? 'the host';
  const editorLocked = inFlight ? 'Editing pauses while the wheel spins.' : null;

  const tabs: Array<{ value: RailTab; label: ReactNode }> = [
    {
      value: 'history',
      label: (
        <>
          Results{state.history.length ? ' ' : null}{state.history.length ? <span className="wh-count">{state.history.length}</span> : null}
        </>
      ),
    },
    { value: 'wheel', label: isHost ? 'Edit wheel' : 'Options' },
    {
      value: 'players',
      label: (
        <>
          People{' '}<span className="wh-count">{game.players.length}</span>
        </>
      ),
    },
    { value: 'chat', label: 'Chat' },
  ];

  return (
    <GameStage gameId="wheel" className="wh wh-play" style={{ '--wh-win': reveal?.seg.color ?? 'var(--accent)' } as CSSProperties}>
      <div className="wh-play__grid">
        <section className="wh-stage" ref={stageRef} data-spinning={inFlight ? 'true' : undefined} data-revealed={reveal ? 'true' : undefined} aria-label="Wheel stage">
          <div className="wh-stage__lights" aria-hidden>
            <i className="wh-beam wh-beam--l" />
            <i className="wh-beam wh-beam--r" />
            <i className="wh-floor" />
          </div>

          <header className="wh-head">
            <div className="wh-head__title">
              <span className="wh-head__kicker dc-pixel">Wheel of DAStiny</span>
              <h1 className="wh-title">{title}</h1>
            </div>
            <div className="wh-head__side">
              <BehaviourBadges settings={settings} />
              {isHost ? (
                <div className="wh-head__actions">
                  <Button size="sm" variant="secondary" icon="pencil" onClick={openEditor} className="wh-head__edit">
                    Edit wheel
                  </Button>
                  <Button size="sm" variant="ghost" icon="flag" disabled={inFlight} onClick={() => setConfirmEnd(true)}>
                    End session
                  </Button>
                </div>
              ) : null}
            </div>
          </header>

          <div className="wh-stage__wheel">
            <WheelDisplay
              layout={layout}
              rest={rest}
              spin={renderSpin}
              highlight={highlight}
              label={wheelLabel}
              hubActive={!reason}
              onHubClick={doSpin}
              onTick={pegTick}
              onPointer={onPointer}
              hoverLabels
            >
              {reducedMotion && inFlight && renderSpin ? <ReducedSpinBadge spin={renderSpin} /> : null}
              {reveal ? <ResultCard reveal={reveal} onClose={() => setReveal(null)} /> : null}
            </WheelDisplay>
          </div>

          <div className="wh-controls">
            <div className="wh-readout" aria-hidden>
              <PixelIcon name="chevron-up" className="wh-readout__arrow" />
              <span ref={readoutRef} className="wh-readout__text">
                —
              </span>
            </div>
            {canRole ? (
              <Button variant="primary" size="xl" className="wh-spin" aria-label="Spin the wheel" disabled={!!reason} onClick={doSpin}>
                <span className="wh-spin__text">{inFlight ? 'Spinning' : 'SPIN'}</span>
              </Button>
            ) : (
              <div className="wh-waiting" role="status" data-testid="wheel-waiting" data-live={inFlight ? 'true' : undefined}>
                <PixelIcon name={inFlight ? 'sparkle' : isSpectator ? 'eye' : 'crown'} className="wh-waiting__icon" />
                <span className="wh-waiting__text">
                  {inFlight
                    ? `${spunByName || hostName} is spinning…`
                    : isSpectator && settings.spinPermission === 'anyone'
                      ? 'Spectating · players spin this wheel'
                      : `${isSpectator ? 'Spectating · ' : ''}Waiting for ${hostName} to spin`}
                </span>
              </div>
            )}
            <p className="wh-controls__hint" aria-live="polite" hidden={!canRole}>
              {reason ? (
                reason
              ) : (
                <>
                  <span className="wh-hint--keys">
                    Press <Kbd>Space</Kbd> or click the hub
                  </span>
                  <span className="wh-hint--touch">Tap SPIN or the star in the middle</span>
                </>
              )}
            </p>
          </div>
          <ConfettiLayer ref={confettiRef} />
          <div className="visually-hidden" aria-live="assertive">
            {reveal ? `The wheel landed on ${reveal.seg.label || reveal.seg.emoji}.` : ''}
          </div>
        </section>

        <aside className="wh-rail" aria-label="Wheel details" ref={railRef}>
          <Tabs label="Wheel panels" value={tab} onChange={setTab} tabs={tabs} className="wh-rail__tabs" />
          <div className={cx('wh-rail__body', tab === 'chat' && 'wh-rail__body--chat')}>
            {tab === 'history' ? (
              <HistoryList
                history={state.history}
                total={state.totalSpins}
                canReset={isHost}
                resetDisabled={inFlight}
                onReset={() => session.send(WHEEL_MSG.resetHistory, {})}
              />
            ) : tab === 'wheel' ? (
              isHost ? (
                <WheelEditor settings={settings} canEdit={!inFlight} update={(patch) => session.lobby.settings(patch)} lockedReason={editorLocked} />
              ) : (
                <ReadOnlyWheel settings={settings} lastWinnerId={state.lastWinnerId} />
              )
            ) : tab === 'players' ? (
              <ParticipantList players={game.players} meId={game.playerId} anyoneCanSpin={settings.spinPermission === 'anyone'} />
            ) : (
              <ChatPanel placeholder="Cheer, groan, trash-talk…" />
            )}
          </div>
        </aside>
      </div>

      <Modal
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        title="End this session?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmEnd(false)}>
              Keep spinning
            </Button>
            <Button
              variant="primary"
              icon="flag"
              onClick={() => {
                setConfirmEnd(false);
                session.send(WHEEL_MSG.end, {});
              }}
            >
              Show the summary
            </Button>
          </>
        }
      >
        <p>Everyone sees the session summary: every result, a tally and who spun. You can start a fresh session from there.</p>
      </Modal>
    </GameStage>
  );
}

function ReducedSpinBadge({ spin }: { spin: RenderSpin }) {
  const left = useCountdown(spin.startAt + spin.durationMs);
  return (
    <div className="wh-deciding" role="status">
      <span className="dc-pixel">Deciding</span>
      <strong className="dc-num">{Math.max(1, Math.ceil(left / 1000))}</strong>
    </div>
  );
}

function ResultCard({ reveal, onClose }: { reveal: Reveal; onClose: () => void }) {
  const { seg } = reveal;
  const label = seg.label || seg.emoji;
  const long = label.length > 22;
  return (
    <div className="wh-result" style={{ '--c': seg.color } as CSSProperties}>
      <div className="wh-result__card">
        <IconButton icon="close" label="Dismiss result" size="sm" className="wh-result__close" onClick={onClose} />
        <span className="wh-result__kicker dc-pixel">The wheel has spoken</span>
        {seg.emoji && seg.label ? (
          <span className="wh-result__emoji" aria-hidden>
            {seg.emoji}
          </span>
        ) : null}
        <strong className={cx('wh-result__label', long && 'wh-result__label--long')} data-testid="wheel-result">
          {label}
        </strong>
        <span className="wh-result__by">
          Spin #{reveal.spinNo} · spun by {reveal.spunBy}
        </span>
      </div>
    </div>
  );
}
