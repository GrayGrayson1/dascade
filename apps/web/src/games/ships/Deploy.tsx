/**
 * Deployment: privately place your fleet — drag from the dock (or tap a vessel, then a square),
 * drag or tap placed vessels to move them, rotate (button / R / tap the selected vessel again),
 * randomize, clear, and lock in. The layout is validated locally for instant feedback and again by
 * the server (the only authority). Drafts are saved privately so a reconnect restores them.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createCryptoRng } from '@dascade/shared';
import {
  SHIPS_FLEETS,
  SHIPS_MSG,
  VESSELS,
  coordLabel,
  type ShipsDir,
  type ShipsFleetId,
  type ShipsPlacement,
  type ShipsPrivatePayload,
  type ShipsPublicState,
  type VesselId,
} from '@dascade/shared/games/ships';
import {
  canPlace,
  occupancy,
  randomLayout,
  rotatePlacement,
  rulesFromSettings,
  validateLayout,
  type ShipsRules,
} from '@dascade/game-core/ships';
import { Button, PixelIcon, TimerRing, cx } from '@dascade/ui';
import { session, useCountdown } from '../../net/hooks.ts';
import { Board, type CellInfo, type VesselDraw } from './Board.tsx';
import { Vessel, VesselIcon } from './art.tsx';
import { useElementSize, useGlow, useViewportSize } from './hooks.ts';
import { shipsSound } from './sounds.ts';

interface DragState {
  id: VesselId;
  dir: ShipsDir;
  /** Which segment of the vessel is under the pointer. */
  grab: number;
  from: 'dock' | 'board';
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  /** Anchor (bow) square under the pointer, when over the sea. */
  over: { x: number; y: number } | null;
}

const clampAnchor = (x: number, y: number, len: number, dir: ShipsDir, n: number) => ({
  x: Math.max(0, Math.min(x, dir === 'h' ? n - len : n - 1)),
  y: Math.max(0, Math.min(y, dir === 'v' ? n - len : n - 1)),
});

export function Deploy({
  state,
  playerId,
  priv,
  locked,
}: {
  state: ShipsPublicState;
  playerId: string;
  priv: ShipsPrivatePayload | undefined;
  locked: boolean;
}) {
  const n = state.gridSize;
  const fleetId = state.fleet as ShipsFleetId;
  const fleet = SHIPS_FLEETS[fleetId]?.vessels ?? SHIPS_FLEETS.standard.vessels;
  const rules: ShipsRules = useMemo(
    () => rulesFromSettings({ gridSize: n as 8 | 10 | 12, fleet: fleetId, spacing: state.spacing }),
    [n, fleetId, state.spacing],
  );
  const mySide = state.sides.find((s) => s.playerId === playerId);
  const other = state.sides.find((s) => s.playerId !== playerId);
  const ready = Boolean(mySide?.ready);
  const frozen = locked || ready;
  const glow = useGlow();

  const privFor = priv && priv.matchNo === state.matchNo && priv.playerId === playerId ? priv : undefined;
  const [layout, setLayout] = useState<ShipsPlacement[]>(() => privFor?.vessels ?? []);
  const [selected, setSelected] = useState<VesselId | null>(
    () => fleet.find((id) => !(privFor?.vessels ?? []).some((v) => v.id === id)) ?? null,
  );
  const [dockDir, setDockDir] = useState<ShipsDir>('h');
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [notice, setNotice] = useState('');
  const dirty = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  /** Set when a drag ends: eats the synthetic click the browser fires on release (cleared by the next press). */
  const suppressClick = useRef(false);
  const seaRef = useRef<HTMLDivElement>(null);

  // Adopt the server's copy until the captain starts editing (reconnect / auto-deploy).
  useEffect(() => {
    if (privFor && !dirty.current) setLayout(privFor.vessels);
  }, [privFor]);

  // --- Draft sync (debounced; the server validates) ------------------------------------------
  const saveTimer = useRef<number | null>(null);
  const flush = useCallback((vessels: ShipsPlacement[], readyFlag: boolean) => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    session.send(SHIPS_MSG.layout, { vessels, ready: readyFlag });
  }, []);
  useEffect(() => {
    if (!dirty.current || frozen) return;
    if (validateLayout(layout, rules, { complete: false })) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      session.send(SHIPS_MSG.layout, { vessels: layout, ready: false });
    }, 350);
  }, [layout, rules, frozen]);
  useEffect(
    () => () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    },
    [],
  );

  const placed = new Set(layout.map((p) => p.id));
  const complete = fleet.every((id) => placed.has(id));
  const occ = useMemo(() => occupancy(layout, n), [layout, n]);

  const commit = useCallback((next: ShipsPlacement[]) => {
    dirty.current = true;
    setLayout(next);
  }, []);

  const nextUnplaced = (after: ShipsPlacement[]) => fleet.find((id) => !after.some((p) => p.id === id)) ?? null;

  const placeAt = (id: VesselId, x: number, y: number, dir: ShipsDir, opts: { quiet?: boolean } = {}): boolean => {
    const len = VESSELS[id].length;
    const a = clampAnchor(x, y, len, dir, n);
    const p: ShipsPlacement = { id, x: a.x, y: a.y, dir };
    if (!canPlace(layout, p, rules)) {
      if (!opts.quiet) {
        shipsSound.invalid();
        setNotice(
          `The ${VESSELS[id].name} doesn’t fit at ${coordLabel(a.x, a.y)}${rules.apart ? ' — vessels must keep a square apart' : ''}.`,
        );
      }
      return false;
    }
    const next = [...layout.filter((q) => q.id !== id), p];
    commit(next);
    shipsSound.place();
    setNotice(`${VESSELS[id].name} placed at ${coordLabel(a.x, a.y)}.`);
    const wasPlaced = layout.some((q) => q.id === id);
    setSelected(wasPlaced ? id : nextUnplaced(next));
    return true;
  };

  const rotate = () => {
    if (frozen || !selected) return;
    if (!placed.has(selected)) {
      setDockDir((d) => (d === 'h' ? 'v' : 'h'));
      shipsSound.rotate();
      return;
    }
    const r = rotatePlacement(layout, selected, rules);
    if (!r) {
      shipsSound.invalid();
      setNotice(`No room to turn the ${VESSELS[selected].name} here.`);
      return;
    }
    commit([...layout.filter((q) => q.id !== selected), r]);
    shipsSound.rotate();
    setNotice(`${VESSELS[selected].name} turned ${r.dir === 'h' ? 'across' : 'down'}.`);
  };

  // Partly deployed → fill in the rest around your choices; otherwise shuffle the whole fleet.
  const fillsRest = layout.length > 0 && layout.length < fleet.length;
  const randomize = () => {
    if (frozen) return;
    const next = randomLayout(createCryptoRng(), rules, fillsRest ? layout : []);
    commit(next);
    setSelected(null);
    shipsSound.place();
    setNotice(
      fillsRest ? 'The rest of the fleet is deployed. Drag any vessel to adjust.' : 'Fleet deployed at random. Drag any vessel to adjust.',
    );
  };

  const clear = () => {
    if (frozen) return;
    commit([]);
    setSelected(fleet[0] ?? null);
    setNotice('Fleet returned to the dock.');
  };

  const unplace = (id: VesselId) => {
    commit(layout.filter((q) => q.id !== id));
    setSelected(id);
    setNotice(`${VESSELS[id].name} returned to the dock.`);
  };

  const lockIn = () => {
    if (!complete || validateLayout(layout, rules, { complete: true })) return;
    flush(layout, true);
    shipsSound.ready();
    setSelected(null);
  };
  const unlock = () => {
    dirty.current = true;
    flush(layout, false);
  };

  // --- Keyboard: R rotates, Delete returns to dock, Escape deselects ---------------------------
  const rotateRef = useRef(rotate);
  rotateRef.current = rotate;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'r' || e.key === 'R') {
        if (dragRef.current?.active) {
          const d = dragRef.current;
          const nd: DragState = { ...d, dir: d.dir === 'h' ? 'v' : 'h' };
          dragRef.current = nd;
          setDrag(nd);
          shipsSound.rotate();
        } else rotateRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Latest closures for the window-level drag listeners.
  const placeAtRef = useRef(placeAt);
  placeAtRef.current = placeAt;
  const unplaceRef = useRef(unplace);
  unplaceRef.current = unplace;

  // --- Pointer drag ------------------------------------------------------------------------------
  const cellFromPoint = (x: number, y: number): { x: number; y: number } | null => {
    const el = seaRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (x < r.left || y < r.top || x >= r.right || y >= r.bottom) return null;
    return { x: Math.floor(((x - r.left) / r.width) * n), y: Math.floor(((y - r.top) / r.height) * n) };
  };

  const beginDrag = (e: ReactPointerEvent, id: VesselId, from: 'dock' | 'board', grab: number, dir: ShipsDir) => {
    if (frozen || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // One finger at a time: a second touch never replaces (and orphans) a drag in progress.
    if (!e.isPrimary) return;
    const d: DragState = {
      id,
      dir,
      grab,
      from,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      active: false,
      over: null,
    };
    dragRef.current = d;
    const move = (ev: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur || ev.pointerId !== cur.pointerId) return;
      const dist = Math.hypot(ev.clientX - cur.startX, ev.clientY - cur.startY);
      if (!cur.active && dist < 6) return;
      ev.preventDefault();
      const cell = cellFromPoint(ev.clientX, ev.clientY);
      const len = VESSELS[cur.id].length;
      const over = cell
        ? clampAnchor(cur.dir === 'h' ? cell.x - cur.grab : cell.x, cur.dir === 'v' ? cell.y - cur.grab : cell.y, len, cur.dir, n)
        : null;
      const next = { ...cur, active: true, x: ev.clientX, y: ev.clientY, over };
      dragRef.current = next;
      setDrag(next);
    };
    const up = (ev: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur || ev.pointerId !== cur.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      dragRef.current = null;
      setDrag(null);
      if (!cur.active || ev.type === 'pointercancel') return;
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 500);
      if (cur.over) {
        if (!placeAtRef.current(cur.id, cur.over.x, cur.over.y, cur.dir)) return;
        if (cur.from === 'dock') setDockDir(cur.dir);
      } else if (cur.from === 'board') unplaceRef.current(cur.id);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const clicked = () => suppressClick.current;

  const onCellClick = (x: number, y: number) => {
    if (frozen || clicked()) return;
    const at = occ[y * n + x];
    if (at) {
      if (selected === at) rotate();
      else {
        setSelected(at);
        setNotice(`${VESSELS[at].name} selected — tap a square to move it, tap it again to turn it.`);
        shipsSound.rotate();
      }
      return;
    }
    if (!selected) {
      const first = nextUnplaced(layout);
      if (first) placeAt(first, x, y, dockDir);
      return;
    }
    const current = layout.find((p) => p.id === selected);
    placeAt(selected, x, y, current?.dir ?? dockDir);
  };

  const onCellPointerDown = (x: number, y: number, e: ReactPointerEvent<HTMLButtonElement>) => {
    const at = occ[y * n + x];
    if (!at || frozen) return;
    const p = layout.find((q) => q.id === at)!;
    const grab = p.dir === 'h' ? x - p.x : y - p.y;
    beginDrag(e, at, 'board', grab, p.dir);
  };

  // --- Preview (drag or mouse hover with a selection) --------------------------------------------
  let preview: { p: ShipsPlacement; valid: boolean } | null = null;
  if (drag?.active && drag.over) {
    const p = { id: drag.id, x: drag.over.x, y: drag.over.y, dir: drag.dir };
    preview = { p, valid: canPlace(layout, p, rules) };
  } else if (!drag && hover && selected && !frozen && !occ[hover.y * n + hover.x]) {
    const current = layout.find((q) => q.id === selected);
    const dir = current?.dir ?? dockDir;
    const a = clampAnchor(hover.x, hover.y, VESSELS[selected].length, dir, n);
    const p = { id: selected, x: a.x, y: a.y, dir };
    preview = { p, valid: canPlace(layout, p, rules) };
  }

  const vessels: VesselDraw[] = layout.map((p) => ({
    ...p,
    tone: drag?.active && drag.id === p.id ? 'ghost' : 'live',
    selected: !frozen && selected === p.id,
  }));

  const cell = (x: number, y: number): CellInfo => {
    const at = occ[y * n + x];
    const where = coordLabel(x, y);
    if (frozen)
      return { label: at ? `${where}, ${VESSELS[at].name}` : `${where}, open water`, disabled: true, kind: at ? 'vessel' : undefined };
    if (at)
      return {
        label: `${where}, ${VESSELS[at].name}${selected === at ? ' (selected — press to turn)' : ' — select'}`,
        grabbable: true,
        kind: 'vessel',
      };
    const target = selected ?? nextUnplaced(layout);
    return { label: target ? `Place ${VESSELS[target].name} at ${where}` : `${where}, open water`, kind: target ? 'place' : undefined };
  };

  // --- Layout sizing ------------------------------------------------------------------------------
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const viewport = useViewportSize();
  // Size from the viewport, not the wrapper: the page may grow with content (feedback loop otherwise).
  const availH = viewport.h - 56 - 24;
  // Board beside the dock on landscape screens; stacked on portrait phones and tablets.
  const wide = (size.w >= 760 && size.w > availH * 0.9) || (size.w > availH * 1.25 && size.w >= 560);
  const compact = wide && availH < 460;
  const sideW = wide ? Math.min(compact ? 420 : 360, Math.max(260, size.w * (compact ? 0.46 : 0.3))) : 0;
  const gutter = 22;
  const sea = Math.max(
    160,
    Math.floor(
      wide
        ? Math.min(availH - gutter - 8, size.w - sideW - 32 - gutter, 640)
        : Math.min(size.w - gutter - 4, 560, Math.max(240, viewport.h - 470)),
    ),
  );

  const remaining = useCountdown(state.deadline);
  const secs = Math.ceil(remaining / 1000);
  const cellPx = sea / n;

  const floatGhost =
    drag?.active && !drag.over ? (
      <div
        className="sh-drag-ghost"
        aria-hidden
        style={
          {
            left: drag.x,
            top: drag.y,
            width: cellPx * VESSELS[drag.id].length,
            height: cellPx,
            transform: `translate(${-(drag.grab + 0.5) * cellPx}px, ${-0.5 * cellPx}px)${drag.dir === 'v' ? ` rotate(90deg)` : ''}`,
            transformOrigin: `${(drag.grab + 0.5) * cellPx}px ${0.5 * cellPx}px`,
          } as CSSProperties
        }
      >
        <VesselIcon id={drag.id} tone="ghost" />
      </div>
    ) : null;

  return (
    <div
      className={cx('sh-deploy', wide ? 'sh-deploy--wide' : 'sh-deploy--narrow', compact && 'sh-deploy--compact')}
      ref={wrapRef}
      onPointerDownCapture={() => (suppressClick.current = false)}
      style={{ '--sh-side-w': `${sideW}px`, '--sh-avail-h': `${availH}px` } as CSSProperties}
    >
      <div className="sh-deploy__board">
        <Board
          n={n}
          px={sea}
          label="Your waters — fleet deployment"
          variant="deploy"
          vessels={vessels}
          glow={glow}
          cell={cell}
          seaRef={seaRef}
          active={!frozen}
          onCellClick={onCellClick}
          onCellPointerDown={onCellPointerDown}
          onCellHover={frozen ? undefined : setHover}
          onKeyAction={(e) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && selected && placed.has(selected)) {
              e.preventDefault();
              unplace(selected);
              return true;
            }
            if (e.key === 'Escape') {
              setSelected(null);
              return true;
            }
            return false;
          }}
          overlay={preview ? <Vessel {...preview.p} tone={preview.valid ? 'ghost' : 'invalid'} /> : null}
          testId="ships-deploy-board"
        />
      </div>

      <aside className="sh-deploy__side" aria-label="Fleet deployment">
        <div className="sh-deploy__head">
          <div>
            <h2 className="sh-h2">{ready ? 'Fleet locked in' : 'Deploy your fleet'}</h2>
            <p className="sh-sub">
              {SHIPS_FLEETS[fleetId]?.name ?? 'Fleet'} · {n}×{n}
              {rules.apart ? ' · keep apart' : ''}
            </p>
            <OpponentStatus name={other?.name ?? 'Opponent'} ready={Boolean(other?.ready)} />
          </div>
          {state.deadline > 0 && remaining > 0 ? (
            <TimerRing
              seconds={secs}
              progress={state.clockMs ? remaining / state.clockMs : 0}
              urgentAt={10}
              size={46}
              label="Deployment time"
            />
          ) : null}
        </div>

        <div className="sh-dock" role="list" aria-label="Your fleet">
          {fleet.map((id) => {
            const isPlaced = placed.has(id);
            const isSel = selected === id && !frozen;
            const len = VESSELS[id].length;
            return (
              <div role="listitem" key={id} className="sh-dock__slot">
                <button
                  type="button"
                  className={cx('sh-dock__card', isPlaced && 'is-placed', isSel && 'is-selected')}
                  aria-pressed={isSel}
                  aria-label={`${VESSELS[id].name}, ${len} squares${isPlaced ? ', deployed' : ', in the dock'}`}
                  disabled={frozen}
                  data-vessel={id}
                  onPointerDown={(e) => beginDrag(e, id, 'dock', 0, layout.find((p) => p.id === id)?.dir ?? dockDir)}
                  onClick={() => {
                    if (clicked()) return;
                    setSelected(isSel ? null : id);
                    shipsSound.rotate();
                    setNotice(
                      isPlaced
                        ? `${VESSELS[id].name} selected — tap a square to move it.`
                        : `Tap a square to place the ${VESSELS[id].name}.`,
                    );
                  }}
                >
                  <span className="sh-dock__art" style={{ '--len': len } as CSSProperties}>
                    <VesselIcon id={id} tone={isPlaced ? 'ghost' : 'live'} />
                  </span>
                  <span className="sh-dock__meta">
                    <span className="sh-dock__name">{VESSELS[id].name}</span>
                    <span className="sh-dock__len" aria-hidden>
                      {Array.from({ length: len }, (_, i) => (
                        <i key={i} />
                      ))}
                    </span>
                  </span>
                  {isPlaced ? <PixelIcon name="check" className="sh-dock__check" /> : null}
                </button>
              </div>
            );
          })}
        </div>

        {!ready ? (
          <div className="sh-deploy__tools">
            <Button size="sm" icon="refresh" onClick={rotate} disabled={frozen || !selected} aria-keyshortcuts="R">
              Rotate{' '}
              <kbd className="sh-kbd" aria-hidden>
                R
              </kbd>
            </Button>
            <Button size="sm" icon="dice" onClick={randomize} disabled={frozen}>
              {fillsRest ? 'Fill the rest' : 'Randomize'}
            </Button>
            <Button size="sm" variant="ghost" icon="trash" onClick={clear} disabled={frozen || layout.length === 0}>
              Clear
            </Button>
          </div>
        ) : null}

        <div className="sh-deploy__cta">
          <p className="sh-hint" aria-live="polite">
            {ready
              ? other?.ready
                ? 'Both fleets ready — battle stations!'
                : `Waiting for ${other?.name ?? 'your opponent'} to deploy…`
              : notice ||
                (complete
                  ? 'Fleet complete. Lock it in when you are happy.'
                  : `Drag vessels onto your grid, or tap one and then a square. ${dockDir === 'h' ? 'Across' : 'Down'} for new vessels.`)}
          </p>
          {ready ? (
            <Button variant="ghost" icon="pencil" onClick={unlock} disabled={locked}>
              Edit fleet
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              icon="check"
              block
              onClick={lockIn}
              disabled={frozen || !complete}
              className={complete ? 'sh-pulse' : undefined}
            >
              {complete
                ? 'Ready — lock in fleet'
                : `Place ${fleet.length - placed.size} more vessel${fleet.length - placed.size === 1 ? '' : 's'}`}
            </Button>
          )}
        </div>
      </aside>
      {floatGhost}
    </div>
  );
}

function OpponentStatus({ name, ready }: { name: string; ready: boolean }) {
  return (
    <p className="sh-opp-status" data-ready={ready ? 'true' : undefined}>
      <span className="sh-opp-status__dot" aria-hidden />
      <span className="sh-opp-status__name">{name}</span>
      <span className="sh-opp-status__state">{ready ? 'is ready' : 'is deploying…'}</span>
    </p>
  );
}
