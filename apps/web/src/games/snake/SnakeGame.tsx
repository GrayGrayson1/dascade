/**
 * Neon Snake game view: Classics shell + canvas arena. Solo score attack (instructions → READY
 * → run → verified result → retry) and multiplayer arenas (countdown → round → results).
 * Controls: arrows/WASD, swipes anywhere on the arena, the on-screen d-pad, or a gamepad.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CLASSICS_MSG, type RunVerdict } from '@dascade/shared/games/classics';
import {
  SNAKE_MSG,
  SNAKE_SPEEDS,
  SNAKE_SPEED_LABELS,
  type SnakeEventPayload,
  type SnakePublicState,
  type SnakeSettings,
  type SnakeView,
} from '@dascade/shared/games/snake';
import type { Dir, SnakeSnapshot } from '@dascade/game-core/snake';
import { Badge, PixelIcon, Segmented, Toggle, cx } from '@dascade/ui';
import { sfx } from '../../audio/audio.ts';
import { useLatestMessage, useRoomMessage, useRoomSelector, useSettings } from '../../net/hooks.ts';
import { serverNow, session, useSessionStore } from '../../net/session.ts';
import {
  ClassicsShell,
  CountdownCard,
  DPad,
  GameOverCard,
  HudLives,
  HudStat,
  HudTimer,
  InfoCard,
  InstructionsCard,
  IntentInput,
  PauseCard,
  RailPanel,
  TouchDeck,
  classicSfx,
  formatScore,
  useCanvasSurface,
  useFixedLoop,
  useLiveMaterials,
  useMyStanding,
  usePersonalBest,
  type ClassicsGameInfo,
  type FinalResult,
} from '../_classics/index.ts';
import { usePast } from './usePast.ts';

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
import { SnakeNet } from './net.ts';
import { CELL, SnakeRenderer, type SnakeLook } from './render.ts';
import { shownLength } from './length.ts';

export const SNAKE_INFO: ClassicsGameInfo = {
  gameId: 'snake',
  howTo: [
    { icon: 'bolt', text: 'Steer into energy to grow and score. Sparks, prism gems and power cores are worth more.' },
    { icon: 'warning', text: 'Hitting a wall, yourself or another snake ends your run. You can never turn straight back.' },
    { icon: 'sparkle', text: 'Phase lets you slip through other snakes; the magnet pulls in nearby energy.' },
  ],
  keys: [
    { keys: ['Arrows', 'WASD'], action: 'Turn' },
    { keys: ['P'], action: 'Pause (solo)' },
  ],
  touch: ['Swipe anywhere to turn', 'Or use the d-pad'],
  statLabel: 'Length',
};

type Intent = 'up' | 'down' | 'left' | 'right' | 'pause';
const INTENTS = {
  keys: { up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], pause: ['KeyP', 'Escape'] },
  buttons: { up: [12], down: [13], left: [14], right: [15], pause: [9] },
  stick: { x: ['left', 'right'] as const, y: ['up', 'down'] as const },
} as const;
const DIR_OF: Record<Exclude<Intent, 'pause'>, Dir> = { up: 0, right: 1, down: 2, left: 3 };

function snakesEq(a: Record<string, SnakeView>, b: Record<string, SnakeView>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    const x = a[k]!;
    const y = b[k];
    if (!y || x.score !== y.score || x.alive !== y.alive || x.length !== y.length || x.kills !== y.kills || x.deaths !== y.deaths || x.place !== y.place || x.respawnAt !== y.respawnAt || x.active !== y.active || x.name !== y.name) return false;
  }
  return true;
}

export function SnakeGame() {
  const me = useSessionStore((s) => s.playerId);
  const phase = useRoomSelector<SnakePublicState, string>((s) => s.phase);
  const snakesSel = useRoomSelector<SnakePublicState, Record<string, SnakeView>>((s) => s.snakes ?? {}, snakesEq);
  const snakes = useMemo(() => snakesSel ?? {}, [snakesSel]);
  const match = useRoomSelector<SnakePublicState, SnakePublicState['match']>((s) => s.match);
  const solo = useRoomSelector<SnakePublicState, boolean>((s) => Boolean(s.classics?.solo)) ?? false;
  const spectatorFlag = useRoomSelector<SnakePublicState, boolean>((s) => Boolean(me && s.players[me]?.spectator)) ?? false;
  const settings = useSettings<SnakeSettings>();
  const standing = useMyStanding();
  const verdict = useLatestMessage<RunVerdict>(CLASSICS_MSG.verdict);

  const mine = me ? snakes[me] : undefined;
  const matchId = match?.matchId ?? 0;
  const cols = match?.cols ?? 30;
  const rows = match?.rows ?? 22;
  const board = settings ? `solo-${settings.speed}${settings.wrap ? '-wrap' : ''}${settings.powerUps ? '' : '-pure'}` : '';
  const [best, submitBest] = usePersonalBest('snake', board);

  // Portrait screens get the arena on its side (bigger cells); turns stay screen-relative.
  const portrait = usePortrait() && cols > rows;
  const portraitRef = useRef(portrait);
  portraitRef.current = portrait;
  const screenRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surface = useCanvasSurface(screenRef, canvasRef, portrait ? rows * CELL : cols * CELL, portrait ? cols * CELL : rows * CELL);
  /** Screen direction → arena direction (portrait: screen up = arena right). */
  const worldDir = (d: Dir): Dir => (portraitRef.current ? (((d + 1) & 3) as Dir) : d);
  const net = useMemo(() => new SnakeNet(), []);
  const renderer = useMemo(() => new SnakeRenderer(), []);
  useLiveMaterials(screenRef, (m) => renderer.setMaterials(m));
  const input = useMemo(() => new IntentInput<Intent>(INTENTS), []);
  const looksRef = useRef(new Map<number, SnakeLook>());
  const growingRef = useRef(new Set<number>());
  const lastEatRef = useRef(new Map<number, number>());

  useEffect(() => {
    net.attach();
    input.attach();
    return () => {
      net.detach();
      input.detach();
    };
  }, [net, input]);

  useEffect(() => {
    net.reset();
    renderer.reset();
  }, [net, renderer, matchId]);

  // Slot → look (colour, name, me).
  useEffect(() => {
    const map = new Map<number, SnakeLook>();
    for (const [id, v] of Object.entries(snakes)) map.set(v.slot, { color: v.color, name: v.name, me: id === me });
    looksRef.current = map;
    net.mySlot = mine ? mine.slot : -1;
  }, [snakes, me, mine, net]);

  // Snapshot hook: crash effects + growth tracking.
  useEffect(() => {
    net.onSnapshot = (s: SnakeSnapshot, prev: SnakeSnapshot | null) => {
      const growing = new Set<number>();
      const now = performance.now();
      for (const sn of s.snakes) {
        const before = prev?.snakes.find((p) => p.slot === sn.slot);
        if (before && sn.body.length > before.body.length) growing.add(sn.slot);
        if ((lastEatRef.current.get(sn.slot) ?? 0) > now - s.stepMs * 1.5) growing.add(sn.slot);
        // A snake that was alive and now isn't: draw its wreck.
        if (before && before.body.length && !sn.body.length) {
          const look = looksRef.current.get(sn.slot);
          renderer.crash(before.body, look?.color ?? '#2de38f', Boolean(look?.me));
        }
      }
      growingRef.current = growing;
    };
    return () => {
      net.onSnapshot = null;
    };
  }, [net, renderer]);

  const idToSlot = (id: string) => snakes[id]?.slot ?? -1;
  useRoomMessage<SnakeEventPayload>(SNAKE_MSG.event, (ev) => {
    switch (ev.kind) {
      case 'eat': {
        const slot = idToSlot(ev.playerId);
        lastEatRef.current.set(slot, performance.now());
        const look = looksRef.current.get(slot);
        renderer.eat(ev.x, ev.y, ev.item, ev.points, look?.color ?? '#5ef2b5');
        if (look?.me) classicSfx(ev.item === 'energy' || ev.item === 'spark' ? 'brick' : 'powerup', { pitch: ev.item === 'spark' ? 5 : 0 });
        break;
      }
      case 'death': {
        if (ev.playerId === me) classicSfx('lifelost');
        else classicSfx('explode', { gap: 120 });
        if (ev.by === me) renderer.label(ev.x, ev.y, 'TAKEDOWN +50', '#ffd23f');
        break;
      }
      case 'respawn':
        if (ev.playerId === me) classicSfx('launch');
        break;
      case 'level':
        classicSfx('levelup');
        break;
      case 'over': {
        const won = me ? ev.winners.includes(me) : false;
        if (solo) classicSfx('gameover');
        else if (won) sfx('win');
        else classicSfx('gameover');
        break;
      }
    }
  });

  const livePaused = Boolean(match?.paused);
  const togglePause = () => {
    if (!solo || standing?.status !== 'playing') return;
    classicSfx('pause');
    session.send(SNAKE_MSG.pause, { paused: !livePaused });
  };

  const togglePauseRef = useRef(togglePause);
  togglePauseRef.current = togglePause;
  // Turns go out the instant they happen (keys, d-pad, gamepad via poll()).
  useEffect(
    () =>
      input.onPress((intent) => {
        if (intent === 'pause') {
          togglePauseRef.current();
          return;
        }
        if (net.turn(worldDir(DIR_OF[intent]))) classicSfx('move');
      }),
    [input, net],
  );

  // Swipes anywhere on the arena (continuous: each 22 px of travel is a turn).
  useEffect(() => {
    const el = screenRef.current;
    if (!el) return;
    let active: { id: number; x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      active = { id: e.pointerId, x: e.clientX, y: e.clientY };
      el.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!active || active.id !== e.pointerId) return;
      const dx = e.clientX - active.x;
      const dy = e.clientY - active.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
      const dir: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
      if (net.turn(worldDir(dir))) classicSfx('move');
      active.x = e.clientX;
      active.y = e.clientY;
    };
    const up = (e: PointerEvent) => {
      if (active?.id === e.pointerId) active = null;
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
  }, [net]);

  useFixedLoop(
    () => input.poll(),
    (_a, frameMs) => {
      const s = surface.current;
      if (!s) return;
      const running = net.latest && !net.latest.over && serverNow() >= (match?.startAt ?? 0) && !livePaused;
      renderer.setPortrait(portraitRef.current);
      // Server-confirmed readouts for tests (written only when they change).
      const c = canvasRef.current;
      const mineSnap = net.latest?.snakes.find((x) => x.slot === net.mySlot);
      if (c && mineSnap) {
        const dir = String(mineSnap.dir);
        const head = mineSnap.body[0] ? `${mineSnap.body[0][0]},${mineSnap.body[0][1]}` : '';
        if (c.dataset.dir !== dir) c.dataset.dir = dir;
        if (c.dataset.head !== head) c.dataset.head = head;
      }
      renderer.draw(s, net.latest, looksRef.current, running ? net.progress() : 0, net.myNextDir(), frameMs, growingRef.current);
    },
  );

  // Verified solo result → personal best.
  const runId = `snake-${matchId}`;
  const myVerdict = verdict && verdict.runId === runId ? verdict : null;
  const [bestFlag, setBestFlag] = useState(false);
  useEffect(() => {
    if (solo && myVerdict && myVerdict.reason === 'over') setBestFlag(submitBest(myVerdict.score));
  }, [solo, myVerdict, submitBest]);

  const entries = Object.entries(snakes).sort((a, b) => (a[1].place || 99) - (b[1].place || 99) || b[1].score - a[1].score);
  const aliveCount = entries.filter(([, v]) => v.alive && v.active).length;
  const winners: string[] = (() => {
    try {
      return JSON.parse(match?.winnersJson ?? '[]') as string[];
    } catch {
      return [];
    }
  })();

  // ---------------------------------------------------------------------------
  // Overlay card
  // ---------------------------------------------------------------------------
  let overlay: ReactNode = null;
  const startAt = match?.startAt ?? 0;
  const waitingStart = !usePast(startAt, 750);
  if (phase === 'COUNTDOWN') {
    overlay = <CountdownCard startAt={startAt || serverNow() + 3000} label={mine ? 'Get ready' : 'Round starting'} />;
  } else if (solo) {
    if (standing?.status === 'ready' || standing?.status === 'idle') {
      overlay = (
        <InstructionsCard
          info={SNAKE_INFO}
          best={best || undefined}
          startLabel="Start run"
          onStart={() => session.send(CLASSICS_MSG.start, {})}
          extra={settings ? <SoloOptions settings={settings} /> : null}
        />
      );
    } else if (standing?.status === 'over') {
      const result: FinalResult | null = myVerdict
        ? {
            score: myVerdict.score,
            reason: myVerdict.reason,
            best: bestFlag || myVerdict.best,
            rank: myVerdict.rank,
            entryId: myVerdict.entryId,
            board: myVerdict.board,
            rows: [
              ['Length', String(myVerdict.stat)],
              ['Speed level', String(myVerdict.level)],
            ],
          }
        : null;
      overlay = <GameOverCard info={SNAKE_INFO} result={result} verifying={!myVerdict} onRetry={() => session.send(CLASSICS_MSG.start, {})} retryLabel="Run again" personalBest={best} />;
    } else if (livePaused) {
      overlay = (
        <PauseCard
          info={SNAKE_INFO}
          onResume={() => session.send(SNAKE_MSG.pause, { paused: false })}
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
    if (match?.status === 'over') {
      const names = winners.map((id) => snakes[id]?.name ?? 'Player');
      const title = match.draw ? 'Draw!' : me && winners.includes(me) ? 'You win!' : names[0] ? `${names[0]} wins` : 'Round over';
      overlay = (
        <InfoCard title={title}>
          <span className="sn-final">{match.draw ? `Shared by ${names.join(' & ')}` : match.mode === 'survival' ? 'Last snake standing' : 'Top score in the arena'}</span>
        </InfoCard>
      );
    } else if (waitingStart) {
      overlay = <CountdownCard startAt={startAt} label="Get ready" />;
    }
  }

  const cardUp = overlay !== null && phase !== 'COUNTDOWN' && !(waitingStart && !livePaused);
  useEffect(() => {
    input.enabled = !cardUp;
    if (cardUp) input.clear();
  }, [input, cardUp]);

  const frenzy = !solo && match?.mode === 'frenzy';
  const hudLength = shownLength(mine);
  const hud = (
    <>
      <HudStat label="Score" value={formatScore(mine?.score ?? 0)} emphasis />
      <HudStat label="Length" value={hudLength} icon="bolt" />
      {solo ? <HudStat label="Level" value={match?.level ?? 1} /> : <HudStat label="Alive" value={`${aliveCount}/${entries.length}`} icon="users" />}
      {!solo && match?.endsAt ? <HudTimer endsAt={match.endsAt} /> : null}
      {frenzy ? <HudStat label="Takedowns" value={mine?.kills ?? 0} /> : null}
      {solo ? <HudLives lives={standing?.status === 'playing' && mine?.alive !== false ? 1 : 0} max={1} label="Life" /> : null}
      {spectatorFlag ? <Badge icon="eye">Spectating</Badge> : null}
    </>
  );

  const roster = !solo ? (
    <RailPanel title={match?.mode === 'frenzy' ? 'Frenzy' : 'Survival'}>
      <ol className="sn-roster">
        {entries.map(([id, v]) => (
          <li key={id} className={cx('sn-roster__row', !v.alive && 'is-down', id === me && 'is-me')} style={{ ['--sc' as string]: v.color }}>
            <span className="sn-roster__swatch" aria-hidden />
            <span className="sn-roster__name">{v.name}</span>
            <span className="sn-roster__len" title="Length">
              {v.alive ? v.length : v.respawnAt ? '…' : <PixelIcon name="close" size={12} />}
            </span>
            <span className="sn-roster__score">{formatScore(v.score)}</span>
          </li>
        ))}
      </ol>
    </RailPanel>
  ) : null;

  // Non-blocking banner when our snake is down in a multiplayer round.
  const downBanner =
    !solo && mine && !mine.alive && phase === 'PLAYING' && match?.status !== 'over' ? (
      <div className="sn-banner" role="status">
        {mine.respawnAt ? 'Crashed — respawning…' : 'You crashed — watching the rest of the round'}
      </div>
    ) : null;

  const touch = mine ? (
    <TouchDeck
      left={<DPad input={input} up="up" down="down" left="left" right="right" upMode="tap" downMode="tap" labels={{ up: 'Turn up', down: 'Turn down', left: 'Turn left', right: 'Turn right' }} />}
      right={<span className="sn-swipe-hint">Swipe the arena to turn</span>}
    />
  ) : null;

  return (
    <ClassicsShell
      ref={screenRef}
      info={SNAKE_INFO}
      hud={hud}
      right={roster}
      overlay={overlay}
      touch={touch}
      aspect={portrait ? rows / cols : cols / rows}
      onPause={solo && standing?.status === 'playing' ? togglePause : undefined}
      paused={livePaused}
      leaveConfirm={!solo && mine?.alive && phase === 'PLAYING' ? 'Leaving counts as a crash.' : undefined}
      className="sn-stage"
    >
      <canvas ref={canvasRef} className="sn-canvas" role="img" aria-label={`Snake arena, ${cols} by ${rows}. Your length ${hudLength}, score ${mine?.score ?? 0}.`} />
      {downBanner}
    </ClassicsShell>
  );
}

function SoloOptions({ settings }: { settings: SnakeSettings }) {
  const update = (patch: Partial<SnakeSettings>) => session.lobby.settings(patch);
  return (
    <div className="sn-options">
      <div className="sn-options__row">
        <span className="sn-options__label">Speed</span>
        <Segmented label="Speed" value={settings.speed} options={SNAKE_SPEEDS.map((v) => ({ value: v, label: SNAKE_SPEED_LABELS[v] }))} onChange={(speed) => update({ speed })} />
      </div>
      <div className="sn-options__toggles">
        <Toggle label="Wrap-around edges" checked={settings.wrap} onChange={(wrap) => update({ wrap })} />
        <Toggle label="Power-ups" checked={settings.powerUps} onChange={(powerUps) => update({ powerUps })} />
      </div>
    </div>
  );
}
