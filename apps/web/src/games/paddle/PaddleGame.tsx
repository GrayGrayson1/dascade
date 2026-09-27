/**
 * Pixel Paddle game view: the Classics shell around a canvas court, with solo practice
 * (instructions → READY → game → verified result → retry) and network duels (countdown →
 * game → results). Input: mouse (point), touch (drag anywhere / deck buttons), keyboard
 * (W/S, ↑/↓, Space) and gamepad (stick / d-pad, A) — all steer the same predicted paddle.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CLASSICS_MSG, type RunVerdict } from '@dascade/shared/games/classics';
import {
  PADDLE_AI_LABELS,
  PADDLE_AI_LEVELS,
  PADDLE_MSG,
  PADDLE_SPEEDS,
  PADDLE_SPEED_LABELS,
  PADDLE_TARGETS,
  type PaddleEventPayload,
  type PaddlePublicState,
  type PaddleSettings,
} from '@dascade/shared/games/paddle';
import { PADDLE, type Side } from '@dascade/game-core/paddle';
import { Badge, Segmented } from '@dascade/ui';
import { sfx } from '../../audio/audio.ts';
import { useLatestMessage, useRoomMessage, useRoomSelector, useSettings } from '../../net/hooks.ts';
import { serverNow, session, useSessionStore } from '../../net/session.ts';
import {
  ClassicsShell,
  CountdownCard,
  GameOverCard,
  HudStat,
  InfoCard,
  InstructionsCard,
  IntentInput,
  PauseCard,
  TouchButton,
  TouchDeck,
  classicSfx,
  toLogical,
  useCanvasSurface,
  useFixedLoop,
  useMyStanding,
  usePersonalBest,
  type ClassicsGameInfo,
  type FinalResult,
} from '../_classics/index.ts';
import { PaddleNet } from './net.ts';
import { usePast } from './usePast.ts';
import { PADDLE_ART, PaddleRenderer } from './render.ts';

export const PADDLE_INFO: ClassicsGameInfo = {
  gameId: 'paddle',
  howTo: [
    { icon: 'flag', text: 'Keep the ball out of your goal. First to the target score wins.' },
    { icon: 'bolt', text: 'Where the ball meets your paddle sets its angle — the edges send it steep. Moving adds a little spin.' },
    { icon: 'sparkle', text: 'Every return speeds the rally up. Serve swaps every two points (every point at deuce).' },
  ],
  keys: [
    { keys: ['W', 'S', '↑', '↓'], action: 'Move paddle' },
    { keys: ['Space'], action: 'Serve' },
    { keys: ['Mouse'], action: 'Point to move · click to serve' },
    { keys: ['P'], action: 'Pause (solo)' },
  ],
  touch: ['Drag anywhere on the court (or the pad) to move', 'Tap Serve — or tap the court — to launch'],
  statLabel: 'Rally',
};

type Intent = 'up' | 'down' | 'left' | 'right' | 'serve' | 'pause';
const INTENTS = {
  keys: { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], serve: ['Space'], pause: ['KeyP', 'Escape'] },
  buttons: { up: [12], down: [13], left: [14], right: [15], serve: [0, 1], pause: [9] },
  stick: { y: ['up', 'down'] as const, x: ['left', 'right'] as const },
} as const;

/** Portrait screens get a vertical court (your goal at the bottom). */
function usePortrait(): boolean {
  const get = () => typeof window !== 'undefined' && window.innerWidth / Math.max(1, window.innerHeight) < 0.8;
  const [portrait, setPortrait] = useState(get);
  useEffect(() => {
    const on = () => setPortrait(get());
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  return portrait;
}

interface SideView {
  playerId: string;
  name: string;
  color: string;
  ai: boolean;
  score: number;
  hits: number;
}

function sideEq(a: SideView, b: SideView): boolean {
  return a.playerId === b.playerId && a.name === b.name && a.color === b.color && a.ai === b.ai && a.score === b.score;
}

export function PaddleGame() {
  const me = useSessionStore((s) => s.playerId);
  const phase = useRoomSelector<PaddlePublicState, string>((s) => s.phase);
  const left = useRoomSelector<PaddlePublicState, SideView>((s) => s.left, sideEq);
  const right = useRoomSelector<PaddlePublicState, SideView>((s) => s.right, sideEq);
  const match = useRoomSelector<PaddlePublicState, PaddlePublicState['match']>((s) => s.match);
  const solo = useRoomSelector<PaddlePublicState, boolean>((s) => Boolean(s.classics?.solo)) ?? false;
  const spectator = useRoomSelector<PaddlePublicState, boolean>((s) => Boolean(me && s.players[me]?.spectator)) ?? false;
  const settings = useSettings<PaddleSettings>();
  const standing = useMyStanding();
  const verdict = useLatestMessage<RunVerdict>(CLASSICS_MSG.verdict);

  const mySide: Side | -1 = left?.playerId === me ? 0 : right?.playerId === me ? 1 : -1;
  const matchId = match?.matchId ?? 0;
  const status = match?.status ?? 'idle';
  const board = settings ? `${settings.ai}-${settings.speed}-to${settings.target}` : '';
  const [best, submitBest] = usePersonalBest('paddle', board);

  const portrait = usePortrait();
  const bottom: Side = mySide === 1 ? 1 : 0;
  const orientRef = useRef({ portrait, bottom });
  orientRef.current = { portrait, bottom };
  const screenRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surface = useCanvasSurface(screenRef, canvasRef, portrait ? PADDLE.height : PADDLE.width, portrait ? PADDLE.width : PADDLE.height);
  const net = useMemo(() => new PaddleNet(), []);
  const renderer = useMemo(() => new PaddleRenderer(), []);
  const input = useMemo(() => new IntentInput<Intent>(INTENTS), []);
  const colorsRef = useRef<[string, string]>([PADDLE_ART.ballGlow, PADDLE_ART.house]);
  const viewRef = useRef({ scores: [0, 0] as [number, number], mySide: -1 as Side | -1, winner: -1 as Side | -1, canPlay: false });
  const [paused, setPaused] = useState(false);

  // Networking lifetime.
  useEffect(() => {
    net.attach();
    input.attach();
    return () => {
      net.detach();
      input.detach();
    };
  }, [net, input]);

  useEffect(() => {
    if (settings) net.setRules(settings);
  }, [net, settings]);

  useEffect(() => {
    net.reset(mySide);
    renderer.reset();
  }, [net, renderer, mySide, matchId]);

  useEffect(() => {
    colorsRef.current = [left?.color ?? PADDLE_ART.ballGlow, right?.color ?? PADDLE_ART.house];
  }, [left?.color, right?.color]);

  const livePaused = Boolean(match?.paused);
  useEffect(() => setPaused(livePaused), [livePaused]);

  const playing = phase === 'PLAYING' && standing?.status === 'playing' && !livePaused;
  viewRef.current = {
    scores: [left?.score ?? 0, right?.score ?? 0],
    mySide,
    winner: status === 'over' ? ((match?.winner ?? -1) as Side | -1) : -1,
    canPlay: playing && mySide >= 0,
  };

  // Server events → effects and sound.
  useRoomMessage<PaddleEventPayload>(PADDLE_MSG.event, (ev) => {
    const colors = colorsRef.current;
    switch (ev.kind) {
      case 'hit':
        renderer.hit(ev.side, ev.x, ev.y, ev.speed, colors[ev.side], ev.rally);
        classicSfx('bounce', { pitch: Math.min(14, ev.rally) });
        break;
      case 'wall':
        renderer.wall(ev.x, ev.y);
        classicSfx('wall');
        break;
      case 'serve':
        renderer.serve();
        classicSfx('launch');
        break;
      case 'point': {
        renderer.point(ev.scorer, colors[ev.scorer], net.frame().ball.y);
        if (mySide === -1) classicSfx('brick');
        else if (ev.scorer === mySide) classicSfx('correct');
        else classicSfx('lifelost');
        break;
      }
      case 'over':
        if (mySide === ev.winner) sfx('win');
        else classicSfx('gameover');
        break;
    }
  });

  // Pointer: mouse hover steers directly; touch drags steer relative to where they began.
  useEffect(() => {
    const el = screenRef.current;
    if (!el) return;
    let drag: { id: number; x0: number; y0: number; t0: number; start: number; moved: boolean } | null = null;
    const onMove = (e: PointerEvent) => {
      const s = surface.current;
      if (!s) return;
      if (e.pointerType === 'mouse') {
        input.lastDevice = 'mouse';
        const p = toLogical(s, e.clientX, e.clientY);
        net.steerTo(renderer.toCourt(p.x, p.y).y);
        return;
      }
      if (!drag || drag.id !== e.pointerId) return;
      const rect = s.canvas.getBoundingClientRect();
      const o = orientRef.current;
      // Portrait: the court is on its side, so a sideways drag moves the paddle.
      const travel = o.portrait ? (e.clientX - drag.x0) * (o.bottom === 0 ? 1 : -1) : e.clientY - drag.y0;
      const span = o.portrait ? rect.width : rect.height;
      if (Math.abs(travel) > 6) drag.moved = true;
      input.lastDevice = 'touch';
      net.steerTo(drag.start + (travel / Math.max(1, span)) * PADDLE.height * 1.35);
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        net.serve();
        return;
      }
      drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), start: net.myTarget, moved: false };
      el.setPointerCapture?.(e.pointerId);
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (!drag.moved && performance.now() - drag.t0 < 280) net.serve();
      drag = null;
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [net, input, surface, renderer]);

  // Deck drag pad (phones): relative drag.
  const padRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = padRef.current;
    if (!el) return;
    let drag: { id: number; x0: number; y0: number; start: number } | null = null;
    const down = (e: PointerEvent) => {
      drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, start: net.myTarget };
      el.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const rect = el.getBoundingClientRect();
      const o = orientRef.current;
      const travel = o.portrait ? (e.clientX - drag.x0) * (o.bottom === 0 ? 1 : -1) : e.clientY - drag.y0;
      net.steerTo(drag.start + (travel / Math.max(1, o.portrait ? rect.width : rect.height)) * PADDLE.height * 1.1);
    };
    const up = (e: PointerEvent) => {
      if (drag?.id === e.pointerId) drag = null;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [net, mySide]);

  const togglePause = () => {
    if (!solo || standing?.status !== 'playing') return;
    classicSfx('pause');
    session.send(PADDLE_MSG.pause, { paused: !livePaused });
  };

  const keyDir = useRef<-1 | 0 | 1>(0);
  useFixedLoop(
    () => {
      input.poll();
      if (input.pressed('pause')) togglePause();
      const o = orientRef.current;
      // Sideways keys follow the on-screen court (portrait: the court lies on its side).
      const sideNeg = o.portrait && input.isDown(o.bottom === 0 ? 'left' : 'right');
      const sidePos = o.portrait && input.isDown(o.bottom === 0 ? 'right' : 'left');
      const up = input.isDown('up') || sideNeg;
      const down = input.isDown('down') || sidePos;
      const dir: -1 | 0 | 1 = up && !down ? -1 : down && !up ? 1 : 0;
      if (dir !== 0) net.steerDir(dir);
      else if (keyDir.current !== 0) net.steerDir(0);
      keyDir.current = dir;
      if (input.pressed('serve')) net.serve();
      const v = viewRef.current;
      const startAt = match?.startAt ?? 0;
      net.step(v.canPlay && serverNow() >= startAt - 50);
    },
    (_alpha, frameMs) => {
      const s = surface.current;
      if (!s) return;
      const v = viewRef.current;
      const f = net.frame();
      renderer.setOrientation(orientRef.current.portrait, orientRef.current.bottom);
      renderer.draw(
        s,
        f,
        {
          colors: colorsRef.current,
          scores: v.scores,
          mySide: v.mySide,
          serveHint: v.mySide >= 0 && f.server === v.mySide && v.canPlay,
          winner: v.winner,
        },
        frameMs,
      );
      net.decay(frameMs);
      // Server-confirmed readouts for tests and assistive tech (written only when they change).
      const snap = net.snapshot;
      const c = canvasRef.current;
      if (c && snap) {
        const y = v.mySide >= 0 ? String(Math.round(snap.paddles[v.mySide as Side].y)) : '';
        if (c.dataset.serverY !== y) c.dataset.serverY = y;
        if (c.dataset.status !== snap.status) c.dataset.status = snap.status;
      }
    },
  );

  // Personal best from verified solo results only.
  const runId = `paddle-${matchId}`;
  const myVerdict = verdict && verdict.runId === runId ? verdict : null;
  const [bestFlag, setBestFlag] = useState(false);
  useEffect(() => {
    if (solo && myVerdict && myVerdict.reason === 'over') setBestFlag(submitBest(myVerdict.score));
  }, [solo, myVerdict, submitBest]);

  const target = match?.target ?? settings?.target ?? 7;
  const scoreFor = (side: Side) => (side === 0 ? (left?.score ?? 0) : (right?.score ?? 0));
  const nameFor = (side: Side) => (side === 0 ? left?.name : right?.name) ?? '';

  // ---------------------------------------------------------------------------
  // Overlay card
  // ---------------------------------------------------------------------------
  let overlay: ReactNode = null;
  const startAt = match?.startAt ?? 0;
  // The countdown card plays its "GO!" for ~0.7 s after the start, then the overlay clears.
  const waitingStart = !usePast(startAt, 750);
  if (phase === 'COUNTDOWN') {
    overlay = <CountdownCard startAt={startAt || serverNow() + 3000} label={mySide >= 0 ? 'Get ready' : 'Match starting'} />;
  } else if (solo) {
    if (standing?.status === 'ready' || standing?.status === 'idle') {
      overlay = (
        <InstructionsCard
          info={PADDLE_INFO}
          best={best || undefined}
          startLabel="Play the house"
          onStart={() => session.send(CLASSICS_MSG.start, {})}
          extra={settings ? <SoloOptions settings={settings} /> : null}
        />
      );
    } else if (standing?.status === 'over') {
      const won = myVerdict ? (match?.winner ?? -1) === 0 : false;
      const result: FinalResult | null = myVerdict
        ? {
            score: myVerdict.score,
            reason: myVerdict.reason,
            best: bestFlag || myVerdict.best,
            rank: myVerdict.rank,
            entryId: myVerdict.entryId,
            board: myVerdict.board,
            rows: [
              ['Result', won ? `You win ${scoreFor(0)}–${scoreFor(1)}` : `House wins ${scoreFor(1)}–${scoreFor(0)}`],
              ['House', PADDLE_AI_LABELS[settings?.ai ?? 'pro']],
              ['Longest rally', String(myVerdict.stat)],
            ],
          }
        : null;
      overlay = <GameOverCard info={PADDLE_INFO} result={result} verifying={!myVerdict} onRetry={() => session.send(CLASSICS_MSG.start, {})} retryLabel="Rematch the house" personalBest={best} />;
    } else if (paused) {
      overlay = (
        <PauseCard
          info={PADDLE_INFO}
          onResume={() => session.send(PADDLE_MSG.pause, { paused: false })}
          onRestart={() => {
            session.send(CLASSICS_MSG.quit, {});
            window.setTimeout(() => session.send(CLASSICS_MSG.start, {}), 120);
          }}
        />
      );
    } else if (waitingStart) {
      overlay = <CountdownCard startAt={startAt} label="Get ready" ready />;
    }
  } else if (phase === 'PLAYING') {
    if (status === 'over') {
      const w = (match?.winner ?? -1) as Side | -1;
      const title = w === -1 ? 'Game over' : w === mySide ? 'You win!' : `${nameFor(w as Side)} wins`;
      overlay = (
        <InfoCard title={title}>
          <span className="pd-final">
            {nameFor(0)} <strong>{scoreFor(0)}</strong> – <strong>{scoreFor(1)}</strong> {nameFor(1)}
            {match?.reason === 'forfeit' ? <em> · by forfeit</em> : null}
          </span>
        </InfoCard>
      );
    } else if (waitingStart) {
      overlay = <CountdownCard startAt={startAt} label="Get ready" />;
    }
  }

  // Game keys stay off while a card with its own buttons is up (Enter/Space belong to the card).
  const cardUp = overlay !== null && phase !== 'COUNTDOWN' && !(waitingStart && !paused);
  useEffect(() => {
    input.enabled = !cardUp;
    if (cardUp) input.clear();
  }, [input, cardUp]);

  const leftLabel = solo || mySide === 0 ? 'You' : left?.ai && !left.playerId ? 'House' : (left?.name ?? 'Left');
  const rightLabel = mySide === 1 ? 'You' : right?.ai && !right.playerId ? 'House' : (right?.name ?? 'Right');
  const hud = (
    <>
      <HudStat label={leftLabel} value={<span style={{ color: left?.color }}>{left?.score ?? 0}</span>} emphasis title={left?.name} />
      <HudStat label={`First to ${target}${match?.winBy2 ? ' · by 2' : ''}`} value={match && match.rally > 1 ? `Rally ${match.rally}` : '—'} className="pd-hud-mid" />
      <HudStat label={rightLabel} value={<span style={{ color: right?.color }}>{right?.score ?? 0}</span>} emphasis title={right?.name} />
      {spectator ? <Badge icon="eye">Spectating</Badge> : null}
      {(left?.ai && left.playerId) || (right?.ai && right.playerId) ? <Badge icon="wifi-off">House covering</Badge> : null}
    </>
  );

  const touch = mySide >= 0 ? (
    <TouchDeck
      className={portrait ? 'pd-deck pd-deck--portrait' : 'pd-deck'}
      left={
        <div ref={padRef} className={portrait ? 'pd-pad pd-pad--wide' : 'pd-pad'} aria-hidden>
          <span className="pd-pad__grip" />
          <span className="pd-pad__text">Drag</span>
        </div>
      }
      right={
        portrait ? (
          <div className="pd-deck-buttons pd-deck-buttons--row">
            <TouchButton input={input} intent="left" label="Paddle left" icon="arrow-left" />
            <TouchButton input={input} intent="serve" label="Serve" text="Serve" mode="tap" size="lg" tone="accent" />
            <TouchButton input={input} intent="right" label="Paddle right" icon="arrow-right" />
          </div>
        ) : (
          <div className="pd-deck-buttons">
            <TouchButton input={input} intent="up" label="Paddle up" icon="chevron-up" />
            <TouchButton input={input} intent="serve" label="Serve" text="Serve" mode="tap" size="lg" tone="accent" />
            <TouchButton input={input} intent="down" label="Paddle down" icon="chevron-down" />
          </div>
        )
      }
    />
  ) : null;

  return (
    <ClassicsShell
      ref={screenRef}
      info={PADDLE_INFO}
      hud={hud}
      overlay={overlay}
      touch={touch}
      aspect={portrait ? PADDLE.height / PADDLE.width : PADDLE.width / PADDLE.height}
      onPause={solo && standing?.status === 'playing' ? togglePause : undefined}
      paused={paused}
      leaveConfirm={!solo && mySide >= 0 && phase === 'PLAYING' && status !== 'over' ? 'Leaving forfeits this game.' : undefined}
      className="pd-stage"
    >
      <canvas ref={canvasRef} className="pd-canvas" role="img" aria-label={`Paddle court: ${nameFor(0)} ${scoreFor(0)}, ${nameFor(1)} ${scoreFor(1)}`} />
    </ClassicsShell>
  );
}

/** Solo: pick the house level, target and pace before a game. */
function SoloOptions({ settings }: { settings: PaddleSettings }) {
  const update = (patch: Partial<PaddleSettings>) => session.lobby.settings(patch);
  return (
    <div className="pd-options">
      <div className="pd-options__row">
        <span className="pd-options__label">House</span>
        <Segmented
          label="House paddle level"
          value={settings.ai}
          options={PADDLE_AI_LEVELS.map((v) => ({ value: v, label: PADDLE_AI_LABELS[v] }))}
          onChange={(ai) => update({ ai })}
        />
      </div>
      <div className="pd-options__row">
        <span className="pd-options__label">Points</span>
        <Segmented
          label="Points to win"
          value={String(settings.target)}
          options={PADDLE_TARGETS.filter((t) => t <= 15).map((t) => ({ value: String(t), label: String(t) }))}
          onChange={(v) => update({ target: Number(v) })}
        />
      </div>
      <div className="pd-options__row">
        <span className="pd-options__label">Pace</span>
        <Segmented label="Ball pace" value={settings.speed} options={PADDLE_SPEEDS.map((v) => ({ value: v, label: PADDLE_SPEED_LABELS[v] }))} onChange={(speed) => update({ speed })} />
      </div>
    </div>
  );
}
