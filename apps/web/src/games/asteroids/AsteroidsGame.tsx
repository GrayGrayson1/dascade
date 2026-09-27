/**
 * Asteroid Run game view: Classics shell + canvas belt. Solo (instructions → READY → run →
 * verified result → retry) and co-op for up to four pilots (countdown → run → results).
 * Controls: keyboard (turn / thrust / fire), gamepad (left stick aims, A or RT fires), and on
 * touch an analog flight stick + a fire button. Portrait phones see the belt on its side.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CLASSICS_MSG, type RunVerdict } from '@dascade/shared/games/classics';
import {
  ASTEROIDS_DIFFICULTIES,
  ASTEROIDS_DIFFICULTY_LABELS,
  ASTEROIDS_MSG,
  POWER_LABELS,
  packControls,
  type AsteroidsEventPayload,
  type AsteroidsPublicState,
  type AsteroidsSettings,
  type PilotView,
} from '@dascade/shared/games/asteroids';
import { WORLD } from '@dascade/game-core/asteroids';
import { dirIndexOf } from '@dascade/game-core/classics/shared';
import { Badge, Segmented, cx } from '@dascade/ui';
import { sfx } from '../../audio/audio.ts';
import { useLatestMessage, useRoomMessage, useRoomSelector, useSettings } from '../../net/hooks.ts';
import { serverNow, session, useSessionStore } from '../../net/session.ts';
import {
  ClassicsShell,
  CountdownCard,
  GameOverCard,
  HudLives,
  HudStat,
  InfoCard,
  InstructionsCard,
  IntentInput,
  PauseCard,
  RailPanel,
  TouchButton,
  TouchDeck,
  classicSfx,
  formatScore,
  useCanvasSurface,
  useLiveMaterials,
  useFixedLoop,
  useMyStanding,
  usePersonalBest,
  type ClassicsGameInfo,
  type FinalResult,
} from '../_classics/index.ts';
import { AsteroidsNet } from './net.ts';
import { BeltRenderer, type PilotLook } from './render.ts';
import { Stick, type StickState } from './Stick.tsx';
import { usePast } from './usePast.ts';

export const ASTEROIDS_INFO: ClassicsGameInfo = {
  gameId: 'asteroids',
  howTo: [
    { icon: 'flag', text: 'Blast rocks before they hit you. Big rocks split; iron takes several hits; crystals shatter three ways.' },
    { icon: 'bolt', text: 'Your shield soaks bumps and recharges when you stay clear. Without shield, you lose a ship.' },
    { icon: 'star', text: 'Grab capsules: S spread, R rapid fire, ◆ shield, N nova blast, + extra ship. Clear waves for bonus points.' },
  ],
  keys: [
    { keys: ['←', '→'], action: 'Turn' },
    { keys: ['↑'], action: 'Thrust' },
    { keys: ['Space'], action: 'Fire' },
    { keys: ['P'], action: 'Pause (solo)' },
  ],
  touch: ['Push the stick to steer — push hard to thrust', 'Hold Fire to shoot'],
  statLabel: 'Wave',
};

type Intent = 'left' | 'right' | 'thrust' | 'fire' | 'pause';
const INTENTS = {
  keys: { left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], thrust: ['ArrowUp', 'KeyW'], fire: ['Space', 'KeyJ'], pause: ['KeyP', 'Escape'] },
  buttons: { thrust: [5, 6], fire: [0, 7], pause: [9], left: [14], right: [15] },
} as const;

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

/** Left analog stick of the first connected gamepad (null when centred / none). */
function padAim(): { x: number; y: number; mag: number } | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  for (const pad of navigator.getGamepads()) {
    if (!pad || !pad.connected) continue;
    const x = pad.axes[0] ?? 0;
    const y = pad.axes[1] ?? 0;
    const mag = Math.sqrt(x * x + y * y);
    if (mag > 0.35) return { x, y, mag: Math.min(1, mag) };
  }
  return null;
}

function pilotsEq(a: Record<string, PilotView>, b: Record<string, PilotView>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    const x = a[k]!;
    const y = b[k];
    if (!y || x.score !== y.score || x.lives !== y.lives || x.shield !== y.shield || x.out !== y.out || x.active !== y.active || x.kills !== y.kills || x.name !== y.name) return false;
  }
  return true;
}

export function AsteroidsGame() {
  const me = useSessionStore((s) => s.playerId);
  const phase = useRoomSelector<AsteroidsPublicState, string>((s) => s.phase);
  const pilotsSel = useRoomSelector<AsteroidsPublicState, Record<string, PilotView>>((s) => s.pilots ?? {}, pilotsEq);
  const pilots = useMemo(() => pilotsSel ?? {}, [pilotsSel]);
  const run = useRoomSelector<AsteroidsPublicState, AsteroidsPublicState['run']>((s) => s.run);
  const solo = useRoomSelector<AsteroidsPublicState, boolean>((s) => Boolean(s.classics?.solo)) ?? false;
  const spectatorFlag = useRoomSelector<AsteroidsPublicState, boolean>((s) => Boolean(me && s.players[me]?.spectator)) ?? false;
  const settings = useSettings<AsteroidsSettings>();
  const standing = useMyStanding();
  const verdict = useLatestMessage<RunVerdict>(CLASSICS_MSG.verdict);

  const mine = me ? pilots[me] : undefined;
  const matchId = run?.matchId ?? 0;
  const board = settings ? (settings.lives === 3 ? settings.difficulty : `${settings.difficulty}-${settings.lives}l`) : '';
  const [best, submitBest] = usePersonalBest('asteroids', board);

  const portrait = usePortrait();
  const screenRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surface = useCanvasSurface(screenRef, canvasRef, portrait ? WORLD.height : WORLD.width, portrait ? WORLD.width : WORLD.height);
  const net = useMemo(() => new AsteroidsNet(), []);
  const renderer = useMemo(() => new BeltRenderer(), []);
  useLiveMaterials(screenRef, (m) => renderer.setMaterials(m));
  const input = useMemo(() => new IntentInput<Intent>(INTENTS), []);
  const stickRef = useRef<StickState>({ active: false, x: 0, y: 0, mag: 0 });
  const looksRef = useRef(new Map<number, PilotLook>());
  const liveRef = useRef(false);

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

  useEffect(() => {
    const map = new Map<number, PilotLook>();
    for (const [id, v] of Object.entries(pilots)) map.set(v.slot, { color: v.color, name: solo ? '' : v.name, me: id === me });
    looksRef.current = map;
    net.mySlot = mine ? mine.slot : -1;
  }, [pilots, me, mine, net, solo]);

  useEffect(() => {
    net.onFire = () => classicSfx('laser', { gap: 70 });
    return () => {
      net.onFire = null;
    };
  }, [net]);

  // New wave banner.
  const wave = run?.wave ?? 0;
  const status = run?.status ?? 'idle';
  useEffect(() => {
    if (status === 'play' && wave > 1) renderer.incoming(wave);
  }, [renderer, wave, status]);

  const colorOf = (id: string) => pilots[id]?.color ?? '#c4b5fd';
  useRoomMessage<AsteroidsEventPayload>(ASTEROIDS_MSG.event, (ev) => {
    switch (ev.kind) {
      case 'rock':
        renderer.rockHit(ev.x, ev.y, ev.size, ev.rock, ev.destroyed, ev.by === me ? ev.points : 0);
        if (!ev.destroyed) classicSfx('armor', { gap: 50 });
        else classicSfx(ev.size >= 3 ? 'explode' : 'brick', { gap: 40, pitch: ev.size === 1 ? 5 : 0 });
        break;
      case 'ship-hit':
        renderer.shipHit(ev.x, ev.y, colorOf(ev.playerId));
        classicSfx('steel');
        break;
      case 'ship-down':
        renderer.shipDown(ev.x, ev.y, colorOf(ev.playerId), ev.playerId === me);
        classicSfx(ev.playerId === me ? 'lifelost' : 'explode');
        break;
      case 'respawn':
        if (ev.playerId === me) classicSfx('launch');
        break;
      case 'pickup':
        renderer.pickup(ev.x, ev.y, ev.power, POWER_LABELS[ev.power]);
        if (ev.playerId === me) classicSfx('powerup');
        break;
      case 'nova':
        renderer.nova(ev.x, ev.y);
        classicSfx('explode');
        break;
      case 'wave':
        renderer.wave(ev.wave, ev.bonus);
        classicSfx('levelup');
        break;
      case 'revive':
        if (ev.playerId === me) classicSfx('correct');
        break;
      case 'over':
        if (!solo) sfx('win');
        classicSfx('gameover');
        break;
    }
  });

  const livePaused = Boolean(run?.paused);
  const togglePause = () => {
    if (!solo || standing?.status !== 'playing') return;
    classicSfx('pause');
    session.send(ASTEROIDS_MSG.pause, { paused: !livePaused });
  };
  const togglePauseRef = useRef(togglePause);
  togglePauseRef.current = togglePause;
  useEffect(() => input.onPress((i) => i === 'pause' && togglePauseRef.current()), [input]);

  const startAt = run?.startAt ?? 0;
  liveRef.current = phase === 'PLAYING' && standing?.status === 'playing' && !livePaused && Boolean(mine);

  useFixedLoop(
    () => {
      input.poll();
      const stick = stickRef.current;
      const pad = padAim();
      let aim = false;
      let aimDir = 0;
      let thrust = input.isDown('thrust');
      if (stick.active) {
        const w = renderer.toWorldDir(stick.x, stick.y);
        aim = true;
        aimDir = dirIndexOf(w.x, w.y);
        thrust = thrust || stick.mag > 0.72;
      } else if (pad) {
        aim = true;
        aimDir = dirIndexOf(pad.x, pad.y);
        thrust = thrust || pad.mag > 0.85;
      }
      const frame = packControls({ left: input.isDown('left'), right: input.isDown('right'), thrust, fire: input.isDown('fire'), aim, aimDir });
      net.step(frame, liveRef.current && serverNow() >= startAt);
    },
    (_a, frameMs) => {
      const s = surface.current;
      if (!s) return;
      renderer.setPortrait(s.width < s.height);
      const ship = net.myShip();
      renderer.draw(s, net.sample(), looksRef.current, ship, net.bullets, net.mySlot, frameMs);
      net.decay(frameMs);
      // Server-confirmed readouts for tests (written only when they change).
      const c = canvasRef.current;
      const mineSnap = net.latest?.ships.find((x) => x.slot === net.mySlot);
      if (c && mineSnap) {
        const shots = String(mineSnap.shots);
        const pos = `${Math.round(mineSnap.x)},${Math.round(mineSnap.y)}`;
        if (c.dataset.shots !== shots) c.dataset.shots = shots;
        if (c.dataset.pos !== pos) c.dataset.pos = pos;
      }
    },
  );

  // Verified solo result → personal best.
  const runId = `asteroids-${matchId}`;
  const myVerdict = verdict && verdict.runId === runId ? verdict : null;
  const [bestFlag, setBestFlag] = useState(false);
  useEffect(() => {
    if (solo && myVerdict && myVerdict.reason === 'over') setBestFlag(submitBest(myVerdict.score));
  }, [solo, myVerdict, submitBest]);

  // ---------------------------------------------------------------------------
  // Overlay card
  // ---------------------------------------------------------------------------
  let overlay: ReactNode = null;
  const waitingStart = !usePast(startAt, 750);
  if (phase === 'COUNTDOWN') {
    overlay = <CountdownCard startAt={startAt || serverNow() + 3000} label={mine ? 'Launch in' : 'Run starting'} />;
  } else if (solo) {
    if (standing?.status === 'ready' || standing?.status === 'idle') {
      overlay = (
        <InstructionsCard
          info={ASTEROIDS_INFO}
          best={best || undefined}
          startLabel="Launch"
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
              ['Wave reached', String(myVerdict.stat)],
              ['Rocks destroyed', String(mine?.kills ?? 0)],
              ['Difficulty', ASTEROIDS_DIFFICULTY_LABELS[settings?.difficulty ?? 'pilot']],
            ],
          }
        : null;
      overlay = <GameOverCard info={ASTEROIDS_INFO} result={result} verifying={!myVerdict} onRetry={() => session.send(CLASSICS_MSG.start, {})} retryLabel="Fly again" personalBest={best} />;
    } else if (livePaused) {
      overlay = (
        <PauseCard
          info={ASTEROIDS_INFO}
          onResume={() => session.send(ASTEROIDS_MSG.pause, { paused: false })}
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
      overlay = (
        <InfoCard title="The belt wins">
          <span className="as-final">
            Your crew reached wave <strong>{wave}</strong> with <strong>{formatScore(run?.teamScore ?? 0)}</strong> points.
          </span>
        </InfoCard>
      );
    } else if (waitingStart) {
      overlay = <CountdownCard startAt={startAt} label="Launch in" />;
    }
  }

  const cardUp = overlay !== null && phase !== 'COUNTDOWN' && !(waitingStart && !livePaused);
  useEffect(() => {
    input.enabled = !cardUp;
    if (cardUp) input.clear();
  }, [input, cardUp]);

  const shield = mine?.shield ?? 0;
  const hud = (
    <>
      <HudStat label="Score" value={formatScore(mine?.score ?? 0)} emphasis />
      <HudStat label="Wave" value={wave || '—'} />
      <HudLives lives={mine?.lives ?? 0} label="Ships" />
      <div className="cl-stat as-shield" role="meter" aria-label="Shield" aria-valuemin={0} aria-valuemax={100} aria-valuenow={shield}>
        <span className="cl-stat__label">Shield</span>
        <span className="as-shield__bar" aria-hidden>
          <span className={cx('as-shield__fill', shield < 30 && 'is-low')} style={{ width: `${shield}%` }} />
        </span>
      </div>
      {!solo ? <HudStat label="Crew" value={formatScore(run?.teamScore ?? 0)} icon="users" /> : null}
      {spectatorFlag ? <Badge icon="eye">Spectating</Badge> : null}
    </>
  );

  const entries = Object.entries(pilots).sort((a, b) => b[1].score - a[1].score);
  const crew = !solo ? (
    <RailPanel title="Crew">
      <ol className="as-crew">
        {entries.map(([id, v]) => (
          <li key={id} className={cx('as-crew__row', v.out && 'is-out', id === me && 'is-me')} style={{ ['--pc' as string]: v.color }}>
            <span className="as-crew__swatch" aria-hidden />
            <span className="as-crew__name">{v.name}</span>
            <span className="as-crew__lives" aria-label={`${v.lives} ships`}>
              {v.out ? 'OUT' : `×${v.lives}`}
            </span>
            <span className="as-crew__score">{formatScore(v.score)}</span>
          </li>
        ))}
      </ol>
    </RailPanel>
  ) : null;

  const downBanner =
    !solo && mine?.out && phase === 'PLAYING' && status !== 'over' ? (
      <div className="as-banner" role="status">
        {settings?.revive !== false ? 'Out of ships — clear the wave together to rejoin' : 'Out of ships — cheering the crew on'}
      </div>
    ) : null;

  const touch = mine ? (
    <TouchDeck
      left={<Stick state={stickRef} />}
      right={<TouchButton input={input} intent="fire" label="Fire" text="Fire" size="lg" tone="hot" className="as-fire" />}
    />
  ) : null;

  return (
    <ClassicsShell
      ref={screenRef}
      info={ASTEROIDS_INFO}
      hud={hud}
      right={crew}
      overlay={overlay}
      touch={touch}
      aspect={portrait ? WORLD.height / WORLD.width : WORLD.width / WORLD.height}
      onPause={solo && standing?.status === 'playing' ? togglePause : undefined}
      paused={livePaused}
      leaveConfirm={!solo && mine && !mine.out && phase === 'PLAYING' ? 'Leaving retires your ship for this run.' : undefined}
      className="as-stage"
    >
      <canvas ref={canvasRef} className="as-canvas" role="img" aria-label={`Asteroid belt, wave ${wave}. Score ${mine?.score ?? 0}, ${mine?.lives ?? 0} ships, shield ${shield}%.`} />
      {downBanner}
    </ClassicsShell>
  );
}

function SoloOptions({ settings }: { settings: AsteroidsSettings }) {
  const update = (patch: Partial<AsteroidsSettings>) => session.lobby.settings(patch);
  return (
    <div className="as-options">
      <div className="as-options__row">
        <span className="as-options__label">Difficulty</span>
        <Segmented
          label="Difficulty"
          value={settings.difficulty}
          options={ASTEROIDS_DIFFICULTIES.map((v) => ({ value: v, label: ASTEROIDS_DIFFICULTY_LABELS[v] }))}
          onChange={(difficulty) => update({ difficulty })}
        />
      </div>
      <div className="as-options__row">
        <span className="as-options__label">Ships</span>
        <Segmented label="Ships" value={String(settings.lives)} options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))} onChange={(v) => update({ lives: Number(v) })} />
      </div>
    </div>
  );
}
