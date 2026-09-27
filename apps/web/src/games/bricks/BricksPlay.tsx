/**
 * Brick Blitz — play screen. Local 60 Hz engine for an instant paddle; the kit streams the
 * input log and the server's replay decides the result.
 *
 * Controls: mouse (paddle follows the pointer anywhere on the page), ←/→ or A/D, gamepad;
 * Space/↑/click to launch or fire lasers. Touch: drag anywhere (relative), tap to launch/fire,
 * or the on-screen ◀ ▶ FIRE deck.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BRICKS_BLITZ_SECONDS, type BricksPublicState, type BricksSettings } from '@dascade/shared/games/bricks';
import { CODE, EFFECT_TICKS, FIELD_H, FIELD_W, POWER_KINDS, createBricksSim, type BricksSim, type PowerKind } from '@dascade/game-core/bricks';
import { Segmented, cx } from '@dascade/ui';
import { useRoomSelector, useSettings } from '../../net/hooks.ts';
import { session } from '../../net/session.ts';
import {
  ClassicsShell,
  HudLives,
  HudStat,
  SpectatorHud,
  HudTimer,
  InfoCard,
  IntentInput,
  RailPanel,
  StandingsPanel,
  TouchButton,
  TouchDeck,
  classicSfx,
  createHudStore,
  formatScore,
  toLogical,
  useCanvasSurface,
  useLiveMaterials,
  useFixedLoop,
  useHud,
  useVerifiedFlow,
  verifiedOverlay,
  type ClassicSound,
  type ClassicsGameInfo,
  type FinalResult,
  type IntentSpec,
} from '../_classics/index.ts';
import { BricksRenderer, POWER_INFO, drawFieldPreview } from './art.ts';
import { fieldArt } from './palette.ts';
import type { Materials } from '../_classics/palette.ts';

export const BRICKS_INFO: ClassicsGameInfo = {
  gameId: 'bricks',
  howTo: [
    { icon: 'play', text: 'Launch the ball and keep it in play with your paddle — where it hits the paddle sets the angle.' },
    { icon: 'bolt', text: 'Armored bricks crack before they break, explosive bricks blast their neighbours, steel never breaks.' },
    { icon: 'star', text: 'Catch falling capsules: W wide · 3 multi-ball · L laser · S slow · C catch · +1 life.' },
    { icon: 'heart', text: 'Clear every breakable brick to advance. Three lives — a bonus life every 25,000 points.' },
  ],
  keys: [
    { keys: ['Mouse', '←', '→'], action: 'Move paddle' },
    { keys: ['Space'], action: 'Launch / fire' },
    { keys: ['Esc'], action: 'Pause' },
  ],
  touch: ['Drag anywhere to move', 'Tap to launch / fire', 'Or use ◀ ▶ and FIRE'],
  statLabel: 'Bricks',
};

type Intent = 'left' | 'right' | 'fire' | 'pause';

const SPEC: IntentSpec<Intent> = {
  keys: {
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    fire: ['Space', 'ArrowUp', 'KeyW', 'KeyJ'],
    pause: ['Escape', 'KeyP'],
  },
  buttons: { left: [14], right: [15], fire: [0, 1, 2, 3, 5], pause: [9] },
  stick: { x: ['left', 'right'] },
};

const sound = (name: string, opts?: { pitch?: number; index?: number; gap?: number }) => classicSfx(name as ClassicSound, opts);

function fmtTicks(ticks: number): string {
  const s = Math.max(0, Math.floor(ticks / 60));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function BricksPlay() {
  const screenRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surface = useCanvasSurface(screenRef, canvasRef, FIELD_W, FIELD_H);
  const [input] = useState(() => new IntentInput<Intent>(SPEC));
  const [hud] = useState(() =>
    createHudStore({ score: 0, level: 1, lives: 3, bricks: 0, ticks: 0, limit: 0, wide: 0, multi: 0, laser: 0, slow: 0, sticky: 0, life: 0, levelName: '', left: 0 }),
  );
  const [renderer] = useState(() => new BricksRenderer());
  useLiveMaterials(screenRef, (m) => renderer.setMaterials(m));
  const sent = useRef({ target: -1, axis: 0, pointerVersion: 0 });
  const flow = useVerifiedFlow<BricksSim>('bricks', (seed, opts) => createBricksSim(seed, opts, true), () => {
    renderer.reset();
    sent.current = { target: -1, axis: 0, pointerVersion: input.pointer.version };
    input.clear();
  });
  const { run, runPhase, paused, pausedRef, meta, me, mine, rows, phase, isSpectator, solo, best, verdict, improved, status, racing, live } = flow;
  const settings = useSettings<BricksSettings>();

  useEffect(() => {
    input.attach();
    return () => input.detach();
  }, [input]);

  // Pointer: the mouse steers the paddle anywhere on the page; touch drags relative to where it started.
  useEffect(() => {
    let touchId: number | null = null;
    let startX = 0;
    let startPaddle = 0;
    let moved = false;
    let downAt = 0;
    const playing = () => run.phase === 'running' && !pausedRef.current;
    const onMove = (e: PointerEvent) => {
      const s = surface.current;
      if (!s || !playing()) return;
      if (e.pointerType === 'mouse') {
        const p = toLogical(s, e.clientX, e.clientY);
        input.setPointer(p.x, p.y, e.buttons > 0, 'mouse');
        return;
      }
      if (e.pointerId !== touchId) return;
      const r = s.canvas.getBoundingClientRect();
      const dx = ((e.clientX - startX) / Math.max(1, r.width)) * FIELD_W * 1.15;
      if (Math.abs(e.clientX - startX) > 8) moved = true;
      input.setPointer(startPaddle + dx, null, true, 'touch');
    };
    const onDown = (e: PointerEvent) => {
      const s = surface.current;
      const el = screenRef.current;
      if (!s || !el || !playing()) return;
      if (!(e.target instanceof Node) || !el.contains(e.target)) return;
      if (e.pointerType === 'mouse') {
        if (e.button === 0) input.tap('fire');
        return;
      }
      touchId = e.pointerId;
      startX = e.clientX;
      startPaddle = run.sim?.paddleX ?? FIELD_W / 2;
      moved = false;
      downAt = performance.now();
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== touchId) return;
      touchId = null;
      if (!moved && performance.now() - downAt < 300 && playing()) input.tap('fire');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [input, run, surface, pausedRef]);

  const pushHud = (sim: BricksSim) =>
    hud.set({
      score: sim.score,
      level: sim.level,
      lives: sim.lives,
      bricks: sim.bricksBroken,
      ticks: Math.floor(sim.tick / 30),
      limit: run.ticket?.limitTicks ?? 0,
      wide: Math.ceil(sim.wide / 30),
      multi: sim.balls.length > 1 ? sim.balls.length : 0,
      laser: Math.ceil(sim.laser / 30),
      slow: Math.ceil(sim.slow / 30),
      sticky: Math.ceil(sim.sticky / 30),
      life: 0,
      levelName: sim.levelName,
      left: sim.breakableLeft(),
    });

  const step = () => {
    input.poll();
    if (input.pressed('pause')) flow.togglePause();
    run.pump();
    if (pausedRef.current || !run.canStep()) return;
    const sim = run.sim!;
    const codes: number[] = [];
    const p = input.pointer;
    if (p.version !== sent.current.pointerVersion && p.x !== null) {
      sent.current.pointerVersion = p.version;
      const x = Math.max(0, Math.min(FIELD_W, Math.round(p.x)));
      if (x !== sent.current.target) {
        codes.push(x);
        sent.current.target = x;
        sent.current.axis = 0;
      }
    }
    const axis = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    if (axis !== sent.current.axis) {
      codes.push(axis === 0 ? CODE.axisNone : axis < 0 ? CODE.axisLeft : CODE.axisRight);
      sent.current.axis = axis;
      if (axis !== 0) sent.current.target = -1;
    }
    for (const pr of input.presses()) if (pr === 'fire') codes.push(CODE.action);
    run.step(codes);
    const events = sim.drainEvents();
    if (events.length) renderer.onEvents(events, sound);
    pushHud(sim);
  };

  const render = (alpha: number, frameMs: number) => {
    const s = surface.current;
    if (!s) return;
    const sim = run.sim;
    const touch = input.lastDevice === 'touch';
    renderer.draw(s, sim, run.phase === 'running' && !pausedRef.current ? alpha : 1, frameMs, {
      paused: pausedRef.current && run.phase === 'running',
      hint: run.phase === 'running' ? (touch ? 'TAP TO LAUNCH' : 'SPACE OR CLICK TO LAUNCH') : null,
    });
  };
  useFixedLoop(step, render);

  useEffect(() => {
    if (run.sim) pushHud(run.sim);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed the HUD when a run is adopted
  }, [runPhase, run]);

  const score = useHud(hud, (v) => v.score);
  const level = useHud(hud, (v) => v.level);
  const lives = useHud(hud, (v) => v.lives);
  const bricks = useHud(hud, (v) => v.bricks);
  const ticks = useHud(hud, (v) => v.ticks * 30);
  const limit = useHud(hud, (v) => v.limit);
  const levelName = useHud(hud, (v) => v.levelName);
  const left = useHud(hud, (v) => v.left);
  const effects = useHud(hud, (v) => `${v.wide}|${v.multi}|${v.laser}|${v.slow}|${v.sticky}`);
  const fields = useRoomSelector<BricksPublicState, Record<string, string>>((s) => s.fields ?? {}, sameMap) ?? NO_FIELDS;

  const sim = run.sim;
  const result: FinalResult | null = verdict
    ? {
        score: verdict.score,
        reason: verdict.reason,
        best: verdict.best && improved === verdict.runId,
        rank: verdict.rank,
        entryId: verdict.entryId,
        board: verdict.board,
        rows: [
          ['Level', verdict.level],
          ['Bricks', verdict.stat],
          ['Lives left', verdict.lives],
          ['Time', fmtTicks(verdict.ticks)],
          ['Sector', sim?.levelName ?? '—'],
          ['Paddle hits', sim?.paddleHits ?? 0],
        ],
      }
    : null;
  const overlay = verifiedOverlay(flow, BRICKS_INFO, {
    result,
    readyLead: false,
    instructionsExtra: <ModePicker settings={settings} />,
    countdownSub: settings?.mode === 'blitz' ? 'Same levels for everyone — most points before time runs out' : 'Same levels for everyone — highest score wins',
  });

  const [wide, multi, laser, slow, sticky] = effects.split('|').map(Number) as [number, number, number, number, number];
  const active: Array<{ kind: PowerKind; secs: number; label: string }> = [];
  if (wide) active.push({ kind: 'wide', secs: wide / 2, label: `${Math.ceil(wide / 2)}s` });
  if (multi) active.push({ kind: 'multi', secs: 0, label: `${multi} balls` });
  if (laser) active.push({ kind: 'laser', secs: laser / 2, label: `${Math.ceil(laser / 2)}s` });
  if (slow) active.push({ kind: 'slow', secs: slow / 2, label: `${Math.ceil(slow / 2)}s` });
  if (sticky) active.push({ kind: 'sticky', secs: sticky / 2, label: `${Math.ceil(sticky / 2)}s` });

  const timerTicks = limit > 0 ? Math.max(0, limit - ticks) : ticks;
  const others = rows.filter((r) => r.id !== me && fields[r.id]);
  const leader = rows.find((r) => r.status !== 'out');
  // Spectators — and racers who finished and chose to watch — see the live leader's field.
  const watchTarget = rows.find((r) => r.status === 'playing' && r.id !== me) ?? leader;
  const spectatorField = (isSpectator || flow.watching) && watchTarget ? fields[watchTarget.id] : undefined;

  const hudNode = (
    <>
      <HudStat label="Score" value={formatScore(score)} emphasis />
      <HudStat label="Level" value={level} />
      <HudLives lives={lives} />
      <HudStat label="Bricks" value={bricks} className="cl-hide-sm" />
      {racing && meta?.endsAt ? <HudTimer endsAt={meta.endsAt} /> : <HudStat label={limit > 0 ? 'Time left' : 'Time'} icon="clock" value={fmtTicks(timerTicks)} />}
      {!solo && mine?.rank ? <HudStat label="Rank" value={`#${mine.rank}/${Math.max(1, meta?.entrants ?? rows.length)}`} /> : <HudStat label="Best" icon="trophy" value={formatScore(Math.max(best, mine?.best ?? 0))} className="cl-hide-sm" />}
    </>
  );

  const leftRail = isSpectator ? undefined : (
    <>
      <RailPanel title="Sector" className="bb-sector">
        <p className="bb-sector__name">{levelName || 'Warm Up'}</p>
        <p className="bb-sector__meta">
          <span>{left}</span> bricks to go
        </p>
      </RailPanel>
      {!solo ? (
        <div className="cl-hide-sm">
          <StandingsPanel rows={rows} me={me} statLabel="Bricks" />
        </div>
      ) : null}
      <RailPanel title="Capsules" className="bb-legend">
        <ul className="bb-legend__list">
          {POWER_KINDS.map((k) => (
            <li key={k}>
              <span className="bb-pill" style={{ '--pill': POWER_INFO[k].color } as CSSProperties} aria-hidden>
                {POWER_INFO[k].glyph}
              </span>
              <span className="bb-legend__text">
                <strong>{POWER_INFO[k].name}</strong> {POWER_INFO[k].hint}
              </span>
            </li>
          ))}
        </ul>
      </RailPanel>
    </>
  );

  const rightRail = (
    <>
      {!isSpectator ? (
        <RailPanel title="Active" className="bb-active">
          {active.length === 0 ? (
            <p className="bb-active__none">No power-ups yet — catch a capsule!</p>
          ) : (
            <ul className="bb-active__list">
              {active.map((a) => (
                <li key={a.kind} className="bb-active__item">
                  <span className="bb-pill" style={{ '--pill': POWER_INFO[a.kind].color } as CSSProperties} aria-hidden>
                    {POWER_INFO[a.kind].glyph}
                  </span>
                  <span className="bb-active__name">{POWER_INFO[a.kind].name}</span>
                  <span className="bb-active__time">{a.label}</span>
                  {a.secs > 0 ? <span className="bb-active__bar" style={{ '--k': String(Math.min(1, a.secs / (EFFECT_TICKS / 60))) } as CSSProperties} aria-hidden /> : null}
                </li>
              ))}
            </ul>
          )}
        </RailPanel>
      ) : null}
      {!solo ? (
        <>
          {others.length ? (
            <RailPanel title="Rivals" className="bb-rivals cl-hide-sm">
              <div className="bb-rivals__grid">
                {others.slice(0, 6).map((r) => (
                  <FieldPreview key={r.id} preview={fields[r.id]!} name={r.name} score={r.score} out={r.status !== 'playing'} color={r.color} />
                ))}
              </div>
            </RailPanel>
          ) : null}
          {isSpectator ? (
            <div className="cl-hide-sm">
              <StandingsPanel rows={rows} me={me} statLabel="Bricks" />
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );

  const touch = isSpectator ? undefined : (
    <TouchDeck
      left={
        <div className="bb-move">
          <TouchButton input={input} intent="left" label="Move left" icon="arrow-left" size="lg" />
          <TouchButton input={input} intent="right" label="Move right" icon="arrow-right" size="lg" />
        </div>
      }
      right={<TouchButton input={input} intent="fire" label="Launch or fire" text="Fire" icon="bolt" mode="tap" size="lg" tone="accent" />}
    />
  );

  const ticker =
    !solo && rows.length > 1 ? (
      <div className="cl-show-sm">
        <StandingsPanel rows={rows} me={me} statLabel="Bricks" variant="strip" />
      </div>
    ) : undefined;

  return (
    <ClassicsShell
      ref={screenRef}
      info={BRICKS_INFO}
      hud={isSpectator ? <SpectatorHud rows={rows} /> : hudNode}
      left={leftRail}
      right={rightRail}
      ticker={ticker}
      overlay={overlay}
      touch={touch}
      aspect={FIELD_W / FIELD_H}
      onPause={solo && (live || paused) && status === 'playing' ? () => flow.togglePause() : undefined}
      paused={paused}
      leaveConfirm={racing && status === 'playing' ? 'Leave the race? Your run ends here.' : undefined}
      className={cx('bb-stage', paused && 'is-paused')}
      compactRails="none"
    >
      {spectatorField ? (
        <div className="bb-watch">
          <FieldPreview preview={spectatorField} name={`Watching ${watchTarget?.name ?? ''}`} score={watchTarget?.score ?? 0} large color={watchTarget?.color} />
        </div>
      ) : null}
      <canvas ref={canvasRef} role="img" aria-label="Brick Blitz playfield" hidden={Boolean(spectatorField)} />
      {isSpectator && !spectatorField && phase === 'PLAYING' ? <InfoCard title="Spectating">Fields appear as soon as the race is live.</InfoCard> : null}
    </ClassicsShell>
  );
}

const NO_FIELDS: Record<string, string> = {};
function sameMap(a: Record<string, string>, b: Record<string, string>): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

function FieldPreview({ preview, name, score, out, color, large }: { preview: string; name: string; score: number; out?: boolean; color?: string; large?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [materials, setMaterials] = useState<Materials>({});
  useLiveMaterials(ref, setMaterials);
  const art = useMemo(() => fieldArt(materials), [materials]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const paint = () => {
      const r = c.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      const ctx = c.getContext('2d');
      if (ctx) drawFieldPreview(ctx, preview, r.width, r.height, dpr, art);
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(c);
    return () => ro.disconnect();
  }, [preview, art]);
  const lvl = preview.split(':')[0];
  return (
    <figure className={cx('bb-field', out && 'is-out', large && 'bb-field--large')} style={color ? ({ '--pc': color } as CSSProperties) : undefined}>
      <canvas ref={ref} className="bb-field__canvas" role="img" aria-label={`${name}'s field, level ${lvl}`} />
      <figcaption className="bb-field__cap">
        <span className="bb-field__name">{name}</span>
        <span className="bb-field__score">
          Lv {lvl} · {formatScore(score)}
        </span>
      </figcaption>
    </figure>
  );
}

/** Solo mode picker on the start card (the solo player is the host). */
function ModePicker({ settings }: { settings: BricksSettings | null }) {
  const mode = settings?.mode ?? 'arcade';
  const secs = settings?.blitzSeconds ?? 180;
  const value = mode === 'blitz' ? `blitz-${secs}` : 'arcade';
  const options = useMemo(() => [{ value: 'arcade', label: 'Arcade' }, ...BRICKS_BLITZ_SECONDS.map((s) => ({ value: `blitz-${s}`, label: `Blitz ${s / 60}m` }))], []);
  return (
    <div className="bb-picker">
      <span className="cl-howto__label">Mode</span>
      <Segmented
        label="Game mode"
        value={value}
        options={options}
        onChange={(v) => {
          classicSfx('move');
          if (v === 'arcade') session.lobby.settings({ mode: 'arcade' });
          else session.lobby.settings({ mode: 'blitz', blitzSeconds: Number(v.split('-')[1]) });
        }}
      />
      <span className="bb-picker__hint">{mode === 'blitz' ? `Blitz: most points in ${secs / 60} minutes — its own high-score board.` : 'Arcade: three lives, endless sectors.'}</span>
    </div>
  );
}
