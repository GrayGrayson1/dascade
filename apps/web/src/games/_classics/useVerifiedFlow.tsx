/**
 * The whole client flow of a verified (model 2) Classics game in one hook + one overlay helper:
 *  - owns a VerifiedRunClient (attach/detach), its phase, solo pause (auto-pause on hidden tab,
 *    paused after a reload-resume), verified personal bests, Start / Restart;
 *  - verifiedOverlay() picks the right kit card for the moment: instructions, READY/GO,
 *    pause, verifying, game over (solo: Retry; race: waiting for others), race countdown.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { GameId } from '@dascade/shared';
import { CLASSICS_MSG } from '@dascade/shared/games/classics';
import { Button } from '@dascade/ui';
import type { ClassicsSim, SimFactory } from '@dascade/game-core/classics/shared';
import { useRoomSelector } from '../../net/hooks.ts';
import { session } from '../../net/session.ts';
import { CountdownCard, GameOverCard, InstructionsCard, PauseCard, type FinalResult } from './cards.tsx';
import type { ClassicsGameInfo } from './ClassicsShell.tsx';
import { classicSfx } from './sfx.ts';
import { useClassicsMeta, useMyId, useMyStanding, usePersonalBest, useStandings } from './useClassics.ts';
import { VerifiedRunClient } from './VerifiedRunClient.ts';

export function useVerifiedFlow<S extends ClassicsSim>(gameId: GameId, factory: SimFactory<S>, onNewRun?: (sim: S | null) => void) {
  const [run] = useState(() => new VerifiedRunClient<S>(factory));
  const runPhase = useSyncExternalStore(
    (cb) => run.subscribe(cb),
    () => run.phase,
  );
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const meta = useClassicsMeta();
  const me = useMyId();
  const mine = useMyStanding();
  const rows = useStandings();
  const phase = useRoomSelector((s) => s.phase);
  const isSpectator = useRoomSelector((s) => Boolean(me && s.players?.[me]?.spectator)) ?? false;
  const solo = Boolean(meta?.solo);
  const soloRef = useRef(solo);
  soloRef.current = solo;
  const board = run.ticket?.board ?? meta?.board ?? '';
  const [best, submitBest] = usePersonalBest(gameId, board);
  const simRef = useRef<S | null>(null);
  const newRunRef = useRef(onNewRun);
  newRunRef.current = onNewRun;

  useEffect(() => {
    run.attach();
    return () => run.detach();
  }, [run]);

  // Solo: pause when the tab is hidden.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && soloRef.current && run.phase === 'running') setPaused(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [run]);

  // New run: let the game reset its renderer; a run rebuilt after a reload starts paused (solo).
  useEffect(() => {
    if (run.sim !== simRef.current) {
      simRef.current = run.sim;
      newRunRef.current?.(run.sim);
      setPaused(Boolean(run.resumed && solo && run.phase === 'running'));
    }
  }, [runPhase, run, solo]);

  const verdict = run.verdict;
  const [improved, setImproved] = useState<string | null>(null);
  useEffect(() => {
    if (verdict && verdict.reason !== 'rejected' && submitBest(verdict.score)) setImproved(verdict.runId);
  }, [verdict, submitBest]);

  const start = useCallback(() => {
    classicSfx('launch');
    session.send(CLASSICS_MSG.start, {});
  }, []);
  const restart = useCallback(() => {
    setPaused(false);
    session.send(CLASSICS_MSG.quit, {});
    session.send(CLASSICS_MSG.start, {});
  }, []);
  /** Toggle pause (solo, while a run is live). Returns whether it toggled. */
  const togglePause = useCallback(() => {
    if (!soloRef.current || (run.phase !== 'running' && !pausedRef.current)) return false;
    classicSfx('pause');
    setPaused((p) => !p);
    return true;
  }, [run]);

  const status = mine?.status ?? 'idle';
  /** Finished early in a race and chose to watch the others (the game shows the leader's board). */
  const [watching, setWatching] = useState(false);
  useEffect(() => {
    if (status !== 'over') setWatching(false);
  }, [status]);
  const racing = !solo && (phase === 'COUNTDOWN' || phase === 'PLAYING');
  const live = runPhase === 'running' || runPhase === 'waiting';
  return {
    run,
    runPhase,
    paused,
    setPaused,
    pausedRef,
    togglePause,
    meta,
    me,
    mine,
    rows,
    phase,
    isSpectator,
    solo,
    board,
    best,
    improved,
    verdict,
    start,
    restart,
    status,
    racing,
    live,
    watching: watching && status === 'over',
    setWatching,
  };
}

export type VerifiedFlow<S extends ClassicsSim> = ReturnType<typeof useVerifiedFlow<S>>;

export interface OverlayOptions {
  /** Final result card data (built from the verdict). */
  result: FinalResult | null;
  /** Extra content on the instructions card (e.g. a mode picker). */
  instructionsExtra?: ReactNode;
  /** Subtitle under the race countdown. */
  countdownSub?: ReactNode;
  /** Solo lead-in shows READY… GO instead of numbers. */
  readyLead?: boolean;
}

export function verifiedOverlay<S extends ClassicsSim>(flow: VerifiedFlow<S>, info: ClassicsGameInfo, opts: OverlayOptions): ReactNode {
  const { run, runPhase, paused, setPaused, meta, phase, isSpectator, solo, status, racing, best, rows, start, restart } = flow;
  if (isSpectator) {
    return phase === 'COUNTDOWN' && meta?.startAt ? <CountdownCard startAt={meta.startAt} label="Race starts" /> : null;
  }
  if (solo) {
    if (status === 'ready' || status === 'idle') return <InstructionsCard info={info} onStart={start} best={best} extra={opts.instructionsExtra} />;
    if (status === 'playing') {
      if (runPhase === 'waiting' && run.ticket) return <CountdownCard startAt={run.ticket.startAt} ready={opts.readyLead !== false} label="" />;
      if (runPhase === 'running' && paused) return <PauseCard info={info} onResume={() => setPaused(false)} onRestart={restart} />;
      if (runPhase === 'ended') return <GameOverCard info={info} result={null} verifying />;
      if (runPhase === 'verified') return <GameOverCard info={info} result={opts.result} onRetry={start} personalBest={best} />;
      return null;
    }
    if (status === 'over') return <GameOverCard info={info} result={opts.result} verifying={!opts.result} onRetry={start} personalBest={best} />;
    return null;
  }
  if (!racing) return null;
  if (phase === 'COUNTDOWN' || (runPhase === 'waiting' && meta?.startAt)) {
    return meta?.startAt ? <CountdownCard startAt={meta.startAt} label="Race starts" sub={opts.countdownSub} /> : null;
  }
  if (runPhase === 'ended' || runPhase === 'verified' || status === 'over') {
    const still = rows.filter((r) => r.status === 'playing').length;
    if (flow.watching && still > 0) return null;
    return (
      <GameOverCard
        info={info}
        result={opts.result}
        verifying={!opts.result}
        personalBest={best}
        waiting={
          still > 0 ? (
            <span>
              Waiting for {still} player{still === 1 ? '' : 's'} still playing…
            </span>
          ) : null
        }
        footer={
          still > 0 && status === 'over' ? (
            <Button variant="ghost" size="sm" icon="eye" onClick={() => flow.setWatching(true)}>
              Watch the race
            </Button>
          ) : null
        }
      />
    );
  }
  return null;
}
