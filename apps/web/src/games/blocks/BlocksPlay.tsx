/**
 * Block Drop — play screen. The engine runs locally at 60 Hz (instant feel); the kit's
 * VerifiedRunClient streams the input log and the server's replay decides the result.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BLITZ_SECONDS, type BlocksPublicState, type BlocksSettings } from '@dascade/shared/games/blocks';
import { CODE, createBlocksSim, type BlocksSim, type PieceId } from '@dascade/game-core/blocks';
import { Segmented } from '@dascade/ui';
import { useRoomSelector, useSettings } from '../../net/hooks.ts';
import { session } from '../../net/session.ts';
import { useApp } from '../../app/store.ts';
import {
  ClassicsShell,
  DPad,
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
  useCanvasSurface,
  useLiveMaterials,
  useFixedLoop,
  useGestures,
  useHud,
  useVerifiedFlow,
  verifiedOverlay,
  type ClassicSound,
  type ClassicsGameInfo,
  type FinalResult,
  type IntentSpec,
} from '../_classics/index.ts';
import { BlocksRenderer, WELL_H, WELL_W } from './art.ts';
import { MiniBoard, PiecePreview } from './Previews.tsx';
import { idleDrag, steerCodes, type DragSteer } from './dragSteer.ts';

export const BLOCKS_INFO: ClassicsGameInfo = {
  gameId: 'blocks',
  howTo: [
    { icon: 'grip', text: 'Move and rotate the falling blocks to complete full rows — full rows clear.' },
    { icon: 'star', text: 'Clear four rows at once for a QUAD, or spin a T block into a slot for a T-SPIN bonus.' },
    { icon: 'bolt', text: 'Clear on consecutive drops for combos. Every 10 lines the level (and speed) goes up.' },
    { icon: 'warning', text: 'The game ends when the stack reaches the top.' },
  ],
  keys: [
    { keys: ['←', '→'], action: 'Move' },
    { keys: ['↑', 'X'], action: 'Rotate' },
    { keys: ['Z'], action: 'Rotate back' },
    { keys: ['↓'], action: 'Soft drop' },
    { keys: ['Space'], action: 'Hard drop' },
    { keys: ['C'], action: 'Hold' },
    { keys: ['Esc'], action: 'Pause' },
  ],
  touch: ['Drag sideways to move', 'Tap to rotate', 'Swipe down: hard drop', 'Swipe up: hold'],
  statLabel: 'Lines',
};

type Intent = 'left' | 'right' | 'soft' | 'hard' | 'cw' | 'ccw' | 'hold' | 'pause';

const SPEC: IntentSpec<Intent> = {
  keys: {
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    soft: ['ArrowDown', 'KeyS'],
    hard: ['Space'],
    cw: ['ArrowUp', 'KeyX', 'KeyW', 'KeyE'],
    ccw: ['KeyZ', 'KeyQ'],
    hold: ['KeyC', 'ShiftLeft', 'ShiftRight'],
    pause: ['Escape', 'KeyP'],
  },
  buttons: { left: [14], right: [15], soft: [13], hard: [12], cw: [0, 3], ccw: [1, 2], hold: [4, 5], pause: [9] },
  stick: { x: ['left', 'right'] },
};

const PRESS_CODE: Partial<Record<Intent, number>> = { hard: CODE.hardDrop, cw: CODE.rotateCW, ccw: CODE.rotateCCW, hold: CODE.hold };
const HELD: Array<{ intent: 'left' | 'right' | 'soft'; down: number; up: number }> = [
  { intent: 'left', down: CODE.leftDown, up: CODE.leftUp },
  { intent: 'right', down: CODE.rightDown, up: CODE.rightUp },
  { intent: 'soft', down: CODE.softDown, up: CODE.softUp },
];

/** Translate this tick's intents into engine codes (edge-accurate: quick taps become down+up). */
function sampleCodes(input: IntentInput<Intent>, held: Record<'left' | 'right' | 'soft', boolean>): number[] {
  const codes: number[] = [];
  const presses = input.presses();
  for (const h of HELD) {
    const down = input.isDown(h.intent);
    if (presses.includes(h.intent)) {
      // A fresh press of a direction that still counts as held is just a new "down" (the engine
      // restarts the shift either way) — no redundant "up" first, so a stalled frame stays small.
      codes.push(h.down);
      held[h.intent] = true;
      if (!down) {
        codes.push(h.up);
        held[h.intent] = false;
      }
    } else if (down !== held[h.intent]) {
      codes.push(down ? h.down : h.up);
      held[h.intent] = down;
    }
  }
  for (const p of presses) {
    const code = PRESS_CODE[p];
    if (code) codes.push(code);
  }
  return codes;
}

const NO_BOARDS: Record<string, string> = {};
function sameBoards(a: Record<string, string>, b: Record<string, string>): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

function fmtTicks(ticks: number): string {
  const s = Math.max(0, Math.floor(ticks / 60));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const sound = (name: string, opts?: { pitch?: number; index?: number }) => classicSfx(name as ClassicSound, opts);

export function BlocksPlay() {
  const screenRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surface = useCanvasSurface(screenRef, canvasRef, WELL_W, WELL_H);
  const [input] = useState(() => new IntentInput<Intent>(SPEC));
  const [hud] = useState(() => createHudStore({ score: 0, level: 1, lines: 0, ticks: 0, hold: '', holdUsed: false, next: '', limit: 0 }));
  const [renderer] = useState(() => new BlocksRenderer());
  useLiveMaterials(screenRef, (m) => renderer.setMaterials(m));
  const held = useRef({ left: false, right: false, soft: false });
  const drag = useRef<DragSteer>(idleDrag());
  const flow = useVerifiedFlow<BlocksSim>('blocks', (seed, opts) => createBlocksSim(seed, opts, true), () => {
    renderer.reset();
    held.current = { left: false, right: false, soft: false };
    drag.current = idleDrag();
    input.clear();
  });
  const { run, runPhase, paused, setPaused, pausedRef, meta, me, mine, rows, phase, isSpectator, solo, best, verdict, improved, status, racing, live } = flow;
  const settings = useSettings<BlocksSettings>();
  const reducedMotion = useApp((s) => s.settings.reducedMotion);

  useEffect(() => {
    input.attach();
    return () => input.detach();
  }, [input]);

  const step = () => {
    input.poll();
    if (input.pressed('pause')) flow.togglePause();
    run.pump();
    if (pausedRef.current) return;
    if (!run.canStep()) return;
    const sampled = sampleCodes(input, held.current);
    const steer = steerCodes(drag.current, run.sim);
    run.step(steer.length ? [...sampled, ...steer] : sampled);
    const sim = run.sim;
    if (!sim) return;
    const events = sim.drainEvents();
    if (events.length) renderer.onEvents(events, sim, sound);
    hud.set({
      score: sim.score,
      level: sim.level,
      lines: sim.lines,
      ticks: sim.tick,
      hold: sim.hold ?? '',
      holdUsed: sim.holdUsed,
      next: sim.queue.join(''),
      limit: run.ticket?.limitTicks ?? 0,
    });
  };

  const render = (_alpha: number, frameMs: number) => {
    const s = surface.current;
    if (!s) return;
    renderer.draw(s, run.sim, frameMs, { paused: pausedRef.current && run.phase === 'running' });
  };
  useFixedLoop(step, render);

  // Seed the HUD when a run is adopted (resume after reload shows the right numbers at once).
  useEffect(() => {
    const sim = run.sim;
    if (sim) hud.set({ score: sim.score, level: sim.level, lines: sim.lines, ticks: sim.tick, hold: sim.hold ?? '', holdUsed: sim.holdUsed, next: sim.queue.join(''), limit: run.ticket?.limitTicks ?? 0 });
  }, [runPhase, run, hud]);

  // Touch gestures on the well: drag to move (steered each tick, see steerCodes), tap to rotate,
  // swipe down/up = drop/hold.
  useGestures(screenRef, {
    onDrag: (dx, dy, ph) => {
      const el = screenRef.current;
      if (!el) return;
      const cell = el.getBoundingClientRect().width / 10;
      if (ph === 'start') {
        drag.current = { ...idleDrag(), active: true };
        input.lastDevice = 'touch';
        return;
      }
      if (ph === 'end') {
        if (drag.current.soft) input.release('soft');
        drag.current = idleDrag();
        return;
      }
      drag.current.want = Math.trunc(dx / (cell * 0.85));
      if (!drag.current.soft && dy > cell * 1.4 && Math.abs(dx) < cell) {
        drag.current.soft = true;
        input.press('soft');
      }
    },
    onTap: () => input.tap('cw'),
    onSwipe: (dir, v) => {
      if (dir === 'down' && v > 0.9) input.tap('hard');
      if (dir === 'up') input.tap('hold');
    },
  });

  const score = useHud(hud, (v) => v.score);
  const level = useHud(hud, (v) => v.level);
  const lines = useHud(hud, (v) => v.lines);
  const ticks = useHud(hud, (v) => Math.floor(v.ticks / 30));
  const limit = useHud(hud, (v) => v.limit);
  const holdId = useHud(hud, (v) => v.hold) as PieceId | '';
  const holdUsed = useHud(hud, (v) => v.holdUsed);
  const next = useHud(hud, (v) => v.next);
  const boards = useRoomSelector<BlocksPublicState, Record<string, string>>((s) => s.boards ?? {}, sameBoards) ?? NO_BOARDS;

  // --- overlay -------------------------------------------------------------------
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
          ['Lines', verdict.stat],
          ['Quads', sim?.quads ?? 0],
          ['T-spins', sim?.tspins ?? 0],
          ['Best combo', sim?.maxCombo ?? 0],
          ['Time', fmtTicks(verdict.ticks)],
        ],
      }
    : null;
  const overlay = verifiedOverlay(flow, BLOCKS_INFO, {
    result,
    instructionsExtra: <ModePicker settings={settings} />,
    countdownSub: settings?.mode === 'blitz' ? 'Most points before the clock runs out' : 'Same pieces for everyone — highest score wins',
  });
  const leader = rows.find((r) => r.status !== 'out');

  const timerTicks = limit > 0 ? Math.max(0, limit - ticks * 30) : ticks * 30;
  const nextPieces = (next.split('') as PieceId[]).slice(0, 5);
  const others = rows.filter((r) => r.id !== me && boards[r.id]);

  const hudNode = (
    <>
      <HudStat label="Score" value={formatScore(score)} emphasis />
      <HudStat label="Level" value={level} />
      <HudStat label="Lines" value={lines} />
      {racing && meta?.endsAt ? <HudTimer endsAt={meta.endsAt} /> : <HudStat label={limit > 0 ? 'Time left' : 'Time'} icon="clock" value={fmtTicks(timerTicks)} />}
      {!solo && mine?.rank ? <HudStat label="Rank" value={`#${mine.rank}/${Math.max(1, meta?.entrants ?? rows.length)}`} /> : <HudStat label="Best" icon="trophy" value={formatScore(Math.max(best, mine?.best ?? 0))} className="cl-hide-sm" />}
    </>
  );

  const left = isSpectator ? undefined : (
    <>
      <RailPanel title="Hold" className="bd-hold">
        <PiecePreview piece={holdId || null} dim={holdUsed} label={holdId ? 'Held piece' : 'Hold is empty'} />
      </RailPanel>
      {solo ? (
        <RailPanel title="Mode" className="bd-mode cl-hide-sm">
          <p className="bd-mode__name">{settings?.mode === 'blitz' ? `Blitz · ${Math.floor((settings.blitzSeconds ?? 180) / 60)} min` : 'Marathon'}</p>
          <p className="bd-mode__hint">{settings?.mode === 'blitz' ? 'Score as much as you can before time runs out.' : 'Survive as long as you can.'}</p>
        </RailPanel>
      ) : (
        <div className="cl-hide-sm">
          <StandingsPanel rows={rows} me={me} statLabel="Lines" />
        </div>
      )}
    </>
  );

  const right = (
    <>
      {!isSpectator ? (
        <RailPanel title="Hold" className="bd-hold cl-show-sm">
          <PiecePreview piece={holdId || null} dim={holdUsed} label={holdId ? 'Held piece' : 'Hold is empty'} />
        </RailPanel>
      ) : null}
      {!isSpectator ? (
        <RailPanel title="Next" className="bd-next">
          {nextPieces.map((p, i) => (
            <PiecePreview key={`${i}-${p}`} piece={p} small={i > 0} label={i === 0 ? `Next piece` : `Upcoming piece ${i + 1}`} className={i >= 3 ? 'cl-hide-sm' : undefined} />
          ))}
        </RailPanel>
      ) : null}
      {!solo ? (
        <>
          {others.length ? (
            <RailPanel title="Rivals" className="bd-rivals cl-hide-sm">
              <div className="bd-rivals__grid">
                {others.slice(0, 6).map((r) => (
                  <MiniBoard key={r.id} board={boards[r.id]!} name={r.name} score={r.score} out={r.status !== 'playing'} color={r.color} />
                ))}
              </div>
            </RailPanel>
          ) : null}
          {isSpectator ? (
            <div className="cl-hide-sm">
              <StandingsPanel rows={rows} me={me} statLabel="Lines" />
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );

  const touch = isSpectator ? undefined : (
    <TouchDeck
      left={<DPad input={input} left="left" right="right" down="soft" up="hard" labels={{ up: 'Hard drop', down: 'Soft drop', left: 'Move left', right: 'Move right' }} />}
      right={
        <div className="bd-actions">
          <TouchButton input={input} intent="hold" label="Hold" text="Hold" mode="tap" />
          <TouchButton input={input} intent="ccw" label="Rotate left" icon="refresh" mode="tap" className="bd-ccw" />
          <TouchButton input={input} intent="cw" label="Rotate right" icon="refresh" mode="tap" size="lg" tone="accent" />
        </div>
      }
    />
  );

  const ticker = !solo && rows.length > 1 ? (
    <div className="cl-show-sm">
      <StandingsPanel rows={rows} me={me} statLabel="Lines" variant="strip" />
    </div>
  ) : undefined;

  // Spectators — and racers who finished and chose to watch — see the live leader's stack.
  const watchTarget = rows.find((r) => r.status === 'playing' && r.id !== me) ?? leader;
  const spectatorBoard = (isSpectator || flow.watching) && watchTarget ? boards[watchTarget.id] : undefined;

  return (
    <ClassicsShell
      ref={screenRef}
      info={BLOCKS_INFO}
      hud={isSpectator ? <SpectatorHud rows={rows} /> : hudNode}
      left={left}
      right={right}
      ticker={ticker}
      overlay={overlay}
      touch={touch}
      aspect={WELL_W / WELL_H}
      onPause={solo && (live || paused) && status === 'playing' ? () => setPaused((p) => !p) : undefined}
      paused={paused}
      leaveConfirm={racing && status === 'playing' ? 'Leave the race? Your run ends here.' : undefined}
      className="bd-stage"
      compactRails
    >
      {spectatorBoard ? (
        <div className="bd-watch" style={{ '--pc': watchTarget?.color } as CSSProperties}>
          <MiniBoard board={spectatorBoard} name={`Watching ${watchTarget?.name ?? ''}`} score={watchTarget?.score ?? 0} large />
        </div>
      ) : null}
      <canvas ref={canvasRef} role="img" aria-label="Block Drop well" hidden={Boolean(spectatorBoard)} data-reduced-motion={reducedMotion ? 'true' : undefined} />
      {isSpectator && !spectatorBoard && phase === 'PLAYING' ? <InfoCard title="Spectating">Boards appear as soon as the race is live.</InfoCard> : null}
    </ClassicsShell>
  );
}

/** Solo mode picker on the start card (host-only settings; the solo player is the host). */
function ModePicker({ settings }: { settings: BlocksSettings | null }) {
  const mode = settings?.mode ?? 'marathon';
  const secs = settings?.blitzSeconds ?? 180;
  const value = mode === 'blitz' ? `blitz-${secs}` : 'marathon';
  const options = useMemo(
    () => [{ value: 'marathon', label: 'Marathon' }, ...BLITZ_SECONDS.map((s) => ({ value: `blitz-${s}`, label: `Blitz ${s / 60}m` }))],
    [],
  );
  return (
    <div className="bd-picker">
      <span className="cl-howto__label">Mode</span>
      <Segmented
        label="Game mode"
        value={value}
        options={options}
        onChange={(v) => {
          classicSfx('move');
          if (v === 'marathon') session.lobby.settings({ mode: 'marathon' });
          else session.lobby.settings({ mode: 'blitz', blitzSeconds: Number(v.split('-')[1]) });
        }}
      />
      <span className="bd-picker__hint">
        {mode === 'blitz' ? `Blitz: most points in ${secs / 60} minutes — its own high-score board.` : 'Marathon: survive as the speed climbs.'}
      </span>
    </div>
  );
}
