/**
 * The battle: target the enemy waters, watch incoming fire on your own fleet. On wide screens both
 * grids sit side by side (or stacked on tablets); on phones one grid at a time with a switch that
 * follows the turn (your turn → enemy waters, their turn → your fleet) unless you pick one yourself.
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { PlayerView } from '@dascade/shared';
import {
  SHIPS_FLEETS,
  SHIPS_MSG,
  VESSELS,
  coordLabel,
  type ShipsEvent,
  type ShipsFleetId,
  type ShipsPrivatePayload,
  type ShipsPublicState,
  type ShipsSideView,
  type VesselId,
} from '@dascade/shared/games/ships';
import { placementCells } from '@dascade/game-core/ships';
import { Avatar, Badge, Button, IconButton, Modal, PixelIcon, Segmented, TimerRing, cx } from '@dascade/ui';
import { session, useCountdown, useRoomMessage } from '../../net/hooks.ts';
import { Board, type CellInfo, type VesselDraw } from './Board.tsx';
import { HitMark, MissMark, Reticle, Vessel, VesselIcon } from './art.tsx';
import { arenaLayout, useCoarsePointer, useElementSize, useGlow, useMedia, useReducedMotion } from './hooks.ts';
import { shipsSound } from './sounds.ts';

type View = 'enemy' | 'own';

interface Flash {
  key: number;
  targetId: string;
  cells: Set<number>;
}

interface Banner {
  key: number;
  tone: 'good' | 'bad' | 'info';
  title: string;
  text?: string;
}

export function Battle({
  state,
  playerId,
  priv,
  isCaptain,
}: {
  state: ShipsPublicState;
  playerId: string | null;
  priv: ShipsPrivatePayload | undefined;
  isCaptain: boolean;
}) {
  const n = state.gridSize;
  const fleet = SHIPS_FLEETS[state.fleet as ShipsFleetId]?.vessels ?? SHIPS_FLEETS.standard.vessels;
  const glow = useGlow();
  const reducedMotion = useReducedMotion();
  const coarse = useCoarsePointer();

  // Sides: for a captain [me, them]; for spectators the two captains in seat order.
  const me = isCaptain ? state.sides.find((s) => s.playerId === playerId) : state.sides[0];
  const them = isCaptain ? state.sides.find((s) => s.playerId !== playerId) : state.sides[1];
  const myFleet = priv && priv.matchNo === state.matchNo && priv.playerId === playerId ? priv.vessels : [];
  const live = state.stage === 'battle';
  const myTurn = isCaptain && live && state.turnId === playerId;
  const shotsNeeded = state.shotsAllowed;

  // --- Aiming ----------------------------------------------------------------------------------------
  const [aims, setAims] = useState<Array<{ x: number; y: number }>>([]);
  const [pendingSeq, setPendingSeq] = useState<number | null>(null);
  const [pendingCells, setPendingCells] = useState<Array<{ x: number; y: number }>>([]);
  useEffect(() => {
    setAims([]);
    setPendingSeq(null);
    setPendingCells([]);
  }, [state.turnSeq]);
  const pending = pendingSeq !== null && pendingSeq === state.turnSeq;
  // A refused volley (or one lost in a network drop, never answered) must not lock the captain out.
  useRoomMessage<{ type?: string }>('sys:error', (e) => {
    if (e?.type !== SHIPS_MSG.fire) return;
    setPendingSeq(null);
    setPendingCells([]);
  });
  useEffect(() => {
    if (pendingSeq === null) return;
    const id = window.setTimeout(() => {
      setPendingSeq((cur) => (cur === pendingSeq ? null : cur));
      setPendingCells([]);
    }, 5000);
    return () => window.clearTimeout(id);
  }, [pendingSeq]);

  const fire = (cells: Array<{ x: number; y: number }>) => {
    if (!myTurn || pending || cells.length !== shotsNeeded) return;
    session.send(SHIPS_MSG.fire, { cells, seq: state.turnSeq });
    setPendingSeq(state.turnSeq);
    setPendingCells(cells);
    setAims([]);
    shipsSound.fire(cells.length);
  };

  const enemyShots = them?.board ?? '';
  const onTarget = (x: number, y: number) => {
    if (!myTurn || pending) return;
    if (enemyShots[y * n + x] !== '.') return;
    const idx = aims.findIndex((a) => a.x === x && a.y === y);
    if (shotsNeeded > 1) {
      if (idx >= 0) setAims(aims.filter((_, i) => i !== idx));
      else if (aims.length < shotsNeeded) setAims([...aims, { x, y }]);
      else setAims([...aims.slice(1), { x, y }]);
      shipsSound.rotate();
      return;
    }
    if (!coarse || idx >= 0) fire([{ x, y }]);
    else {
      setAims([{ x, y }]);
      shipsSound.rotate();
    }
  };

  // --- Events: sounds, fresh marks, banners ------------------------------------------------------------
  const [flash, setFlash] = useState<Flash | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [hurt, setHurt] = useState(0);
  const keyRef = useRef(0);
  const nameOf = (id: string) => state.sides.find((s) => s.playerId === id)?.name ?? state.players[id]?.name ?? 'A captain';
  const showBanner = (b: Omit<Banner, 'key'>, ms = 1900) => {
    const key = ++keyRef.current;
    setBanner({ ...b, key });
    window.setTimeout(() => setBanner((cur) => (cur?.key === key ? null : cur)), ms);
  };
  useRoomMessage<ShipsEvent>(SHIPS_MSG.event, (ev) => {
    if (ev.type === 'shot') {
      const key = ++keyRef.current;
      setFlash({ key, targetId: ev.targetId, cells: new Set(ev.shots.map((s) => s.y * n + s.x)) });
      window.setTimeout(() => setFlash((f) => (f?.key === key ? null : f)), 1300);
      const sunk = ev.shots.filter((s) => s.result === 'sunk');
      const hits = ev.shots.filter((s) => s.result !== 'miss').length;
      window.setTimeout(
        () => (sunk.length ? shipsSound.sink() : hits ? shipsSound.hit() : shipsSound.splash()),
        ev.shooterId === playerId ? 180 : 60,
      );
      if (isCaptain && ev.targetId === playerId && hits > 0) setHurt((h) => h + 1);
      for (const s of sunk) {
        const vessel = s.vessel ? VESSELS[s.vessel as VesselId].name : 'vessel';
        if (!isCaptain)
          showBanner({ tone: 'info', title: `${vessel} sunk!`, text: `${nameOf(ev.shooterId)} sank ${nameOf(ev.targetId)}’s ${vessel}.` });
        else if (ev.shooterId === playerId)
          showBanner({ tone: 'good', title: `${vessel} sunk!`, text: `You sank ${nameOf(ev.targetId)}’s ${vessel}.` });
        else showBanner({ tone: 'bad', title: `${vessel} lost`, text: `${nameOf(ev.shooterId)} sank your ${vessel}.` });
      }
      if (ev.auto && ev.shooterId === playerId)
        showBanner(
          {
            tone: 'info',
            title: 'Auto-fire',
            text: state.clockMs ? 'Your clock ran out — the fleet fired at random.' : 'You were idle too long — the fleet fired at random.',
          },
          1600,
        );
    } else if (ev.type === 'skip') {
      showBanner(
        {
          tone: 'info',
          title: 'Out of time',
          text: ev.playerId === playerId ? 'You lost your turn.' : `${nameOf(ev.playerId)} lost their turn.`,
        },
        1500,
      );
    } else if (ev.type === 'over') {
      if (!isCaptain) shipsSound.win();
      else if (ev.winnerId === playerId) shipsSound.win();
      else shipsSound.lose();
    }
  });

  // A fresh battle: the 'battle' event usually lands before this view mounts, so greet on mount.
  useEffect(() => {
    if (state.stage !== 'battle' || state.sides.some((s) => s.shots > 0)) return;
    shipsSound.battle();
    showBanner(
      {
        tone: 'info',
        title: 'Battle stations!',
        text: state.turnId === playerId ? 'You fire first.' : `${nameOf(state.turnId)} fires first.`,
      },
      2000,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  // Your turn: sonar ping.
  useEffect(() => {
    if (myTurn) shipsSound.turn();
  }, [myTurn, state.turnSeq]);

  // --- Phone view switching ----------------------------------------------------------------------------
  const [view, setView] = useState<View>(() => (isCaptain && state.turnId !== playerId ? 'own' : 'enemy'));
  const manual = useRef(false);
  const firstSideId = state.sides[0]?.playerId ?? '';
  useEffect(() => {
    manual.current = false;
    if (!live) return;
    const target: View = !isCaptain ? (state.turnId === firstSideId ? 'own' : 'enemy') : state.turnId === playerId ? 'enemy' : 'own';
    // Let the last volley land on screen before switching grids.
    const t = window.setTimeout(() => {
      if (!manual.current) setView(target);
    }, 1050);
    return () => window.clearTimeout(t);
  }, [state.turnId, live, isCaptain, playerId, firstSideId]);

  // --- Layout ------------------------------------------------------------------------------------------
  const [arenaRef, arena] = useElementSize<HTMLDivElement>();
  const short = useMedia('(orientation: landscape) and (max-height: 500px)');
  const chrome = short ? { x: 30, y: 52 } : { x: 30, y: 104 };
  const layout = arenaLayout(arena.w, arena.h, chrome, { max: 600, gap: short ? 12 : 20, tabsH: 0 });
  // Phones in portrait: the other grid as a tappable thumbnail in the spare height.
  // Tall screens with both grids (tablets in portrait): the battle log fills the spare height.
  const spareH = arena.h - (layout.sea + chrome.y) * (layout.mode === 'column' ? 2 : 1);
  const logInline = layout.mode !== 'single' && spareH > 220;
  const miniPx = layout.mode === 'single' ? Math.floor(Math.min(140, arena.h - (layout.sea + chrome.y) - 44)) : 0;

  // --- Boards ----------------------------------------------------------------------------------------
  const lastTargetId = state.lastShooterId ? state.sides.find((s) => s.playerId !== state.lastShooterId)?.playerId : undefined;
  const latestFor = (side: ShipsSideView | undefined) =>
    side && side.playerId === lastTargetId ? new Set(state.lastShots.map((s) => s.y * n + s.x)) : undefined;
  const freshFor = (side: ShipsSideView | undefined) => (side && flash && flash.targetId === side.playerId ? flash.cells : undefined);

  const wrecksOf = (side: ShipsSideView | undefined): VesselDraw[] => {
    if (!side) return [];
    const sunkIds = new Set(side.sunkVessels.map((v) => v.id));
    const out: VesselDraw[] = side.sunkVessels.map((v) => ({ ...v, tone: 'sunk' as const }));
    for (const v of side.revealed) if (!sunkIds.has(v.id)) out.push({ ...v, tone: 'revealed' });
    return out;
  };

  const ownSunk = new Set(me?.sunkVessels.map((v) => v.id) ?? []);
  const ownVessels: VesselDraw[] =
    !isCaptain || !me ? wrecksOf(me) : myFleet.map((v) => ({ ...v, tone: ownSunk.has(v.id) ? 'sunk' : 'live' }));

  const aimSet = new Set(aims.map((a) => a.y * n + a.x));
  const targetOverlay = (
    <g className="sh-aims">
      {aims.map((a, i) => (
        <Reticle key={`${a.x}-${a.y}`} x={a.x} y={a.y} n={shotsNeeded > 1 ? i + 1 : undefined} />
      ))}
      {pending ? pendingCells.map((a) => <Reticle key={`p${a.x}-${a.y}`} x={a.x} y={a.y} pending />) : null}
    </g>
  );

  const targetCell = (x: number, y: number): CellInfo => {
    const ch = enemyShots[y * n + x];
    const where = coordLabel(x, y);
    const status = ch === 'o' ? 'miss' : ch === 'x' ? 'hit' : ch === '#' ? 'sunk vessel' : '';
    if (!isCaptain) return { label: status ? `${where}, ${status}` : `${where}, unknown`, disabled: true };
    if (status) return { label: `${where}, ${status}`, disabled: true, kind: 'shot' };
    const aimed = aimSet.has(y * n + x);
    if (!myTurn || pending) return { label: `${where}, unknown`, disabled: true };
    if (shotsNeeded > 1) return { label: aimed ? `Unmark ${where}` : `Mark ${where} for the salvo`, kind: aimed ? 'aimed' : 'target' };
    return { label: coarse && !aimed ? `Aim at ${where}` : `Fire at ${where}`, kind: aimed ? 'aimed' : 'target' };
  };

  const ownCell =
    (side: ShipsSideView | undefined) =>
    (x: number, y: number): CellInfo => {
      const ch = side?.board[y * n + x] ?? '.';
      const where = coordLabel(x, y);
      const at = myFleet.find((v) => placementCells(v).some((c) => c.x === x && c.y === y));
      const status = ch === 'o' ? 'miss' : ch === 'x' ? 'hit' : ch === '#' ? 'sunk' : '';
      const vesselText = isCaptain && at ? `, your ${VESSELS[at.id].name}` : '';
      return { label: `${where}${vesselText}${status ? `, ${status}` : ''}`, disabled: true };
    };

  const onEnemyKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.key === 'f' || e.key === 'F') && aims.length === shotsNeeded && shotsNeeded > 0) {
      e.preventDefault();
      fire(aims);
      return true;
    }
    return false;
  };

  const enemyTitle = isCaptain ? 'Enemy waters' : `${them?.name ?? 'Captain'}’s waters`;
  const ownTitle = isCaptain ? 'Your fleet' : `${me?.name ?? 'Captain'}’s waters`;

  const enemyPanel = (
    <BoardPanel
      key="enemy"
      title={enemyTitle}
      side={them}
      tone={myTurn ? 'active' : 'idle'}
      status={
        !live ? null : isCaptain ? (
          myTurn ? (
            <Badge color="var(--accent)" icon="bolt">
              {shotsNeeded > 1 ? `Salvo · ${aims.length}/${shotsNeeded}` : 'Your shot'}
            </Badge>
          ) : (
            <span className="sh-panel__muted">Waiting…</span>
          )
        ) : state.turnId === them?.playerId ? (
          <Badge color="var(--accent-2)">Firing</Badge>
        ) : null
      }
      fleetStrip={<FleetStrip n={n} fleet={fleet} side={them} own={false} />}
    >
      <Board
        n={n}
        px={layout.sea}
        label={isCaptain ? 'Enemy waters — target grid' : enemyTitle}
        variant="enemy"
        shots={enemyShots}
        vessels={wrecksOf(them)}
        fresh={freshFor(them)}
        latest={latestFor(them)}
        overlay={isCaptain ? targetOverlay : null}
        active={myTurn}
        sweep={myTurn && !reducedMotion}
        glow={glow}
        cell={targetCell}
        onCellClick={isCaptain ? onTarget : undefined}
        onKeyAction={isCaptain ? onEnemyKey : undefined}
        testId="ships-enemy-board"
      />
    </BoardPanel>
  );

  const ownPanel = (
    <BoardPanel
      key="own"
      title={ownTitle}
      side={me}
      tone={isCaptain && live && !myTurn ? 'incoming' : 'idle'}
      status={
        !live ? null : isCaptain ? (
          !myTurn ? (
            <Badge color="var(--accent-2)">Incoming</Badge>
          ) : null
        ) : state.turnId === me?.playerId ? (
          <Badge color="var(--accent-2)">Firing</Badge>
        ) : null
      }
      fleetStrip={<FleetStrip n={n} fleet={fleet} side={me} own={isCaptain} ownFleet={myFleet} />}
    >
      <Board
        n={n}
        px={layout.sea}
        label={ownTitle}
        variant="own"
        shots={me?.board ?? ''}
        vessels={ownVessels}
        fresh={freshFor(me)}
        latest={latestFor(me)}
        glow={glow}
        cell={ownCell(me)}
        testId="ships-own-board"
      />
    </BoardPanel>
  );

  // --- HUD -------------------------------------------------------------------------------------------
  const remaining = useCountdown(live ? state.deadline : 0);
  const secs = Math.ceil(remaining / 1000);
  const turnName = nameOf(state.turnId);
  let turnTitle = '';
  let turnText = '';
  if (state.stage === 'over') {
    const won = state.winnerId === playerId;
    turnTitle = !isCaptain ? `${nameOf(state.winnerId)} wins` : won ? 'Victory' : 'Defeat';
    turnText = 'Fleets revealed';
  } else if (myTurn) {
    turnTitle = pending ? 'Shells away…' : shotsNeeded > 1 ? `Salvo · ${shotsNeeded} shots` : 'Your shot';
    turnText = pending
      ? 'Waiting for the splash'
      : shotsNeeded > 1
        ? `Mark ${shotsNeeded} squares, then fire`
        : coarse
          ? 'Tap to aim, tap again to fire'
          : 'Pick a square on the enemy grid';
  } else if (live) {
    turnTitle = isCaptain ? `${turnName} is aiming…` : `${turnName} to fire`;
    turnText =
      state.shotsAllowed > 1 ? `${state.shotsAllowed}-shot salvo` : state.firing === 'streak' ? 'Hot streak: hits fire again' : 'One shot';
  }

  const lastLog = state.log.at(-1);
  const [logOpen, setLogOpen] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);

  const fireButtons =
    myTurn && shotsNeeded > 1 ? (
      <>
        {short ? null : (
          <Button variant="ghost" size="sm" onClick={() => setAims([])} disabled={!aims.length || pending}>
            Clear marks
          </Button>
        )}
        <Button
          variant="primary"
          size={short ? 'sm' : 'md'}
          icon="bolt"
          onClick={() => fire(aims)}
          disabled={aims.length !== shotsNeeded || pending}
          aria-keyshortcuts="F"
        >
          Fire salvo ({aims.length}/{shotsNeeded})
        </Button>
      </>
    ) : myTurn && coarse && aims.length === 1 ? (
      <Button variant="primary" size={short ? 'sm' : 'md'} icon="bolt" onClick={() => fire(aims)} disabled={pending}>
        Fire at {coordLabel(aims[0]!.x, aims[0]!.y)}
      </Button>
    ) : null;

  return (
    <div className={cx('sh-battle', `sh-battle--${layout.mode}`, short && 'sh-battle--short')}>
      {hurt > 0 && !reducedMotion && glow > 0 ? <div key={hurt} className="sh-hurt" aria-hidden /> : null}
      <div className="sh-hud" data-turn={myTurn ? 'mine' : live ? 'theirs' : state.stage}>
        <CaptainTag
          side={me}
          player={me ? state.players[me.playerId] : undefined}
          you={isCaptain}
          active={live && state.turnId === me?.playerId}
          align="left"
        />
        <div className="sh-turn" role="status" aria-live="polite">
          <div className="sh-turn__text">
            <strong className="sh-turn__title">{turnTitle}</strong>
            {turnText ? <span className="sh-turn__sub">{turnText}</span> : null}
          </div>
          {live && state.deadline > 0 ? (
            <TimerRing seconds={secs} progress={state.clockMs ? remaining / state.clockMs : 0} urgentAt={8} size={42} label="Turn time" />
          ) : null}
        </div>
        <CaptainTag
          side={them}
          player={them ? state.players[them.playerId] : undefined}
          you={false}
          active={live && state.turnId === them?.playerId}
          align="right"
        />
        {short ? (
          <div className="sh-hud__tools">
            {fireButtons}
            <IconButton icon="chat" label="Battle log" size="sm" onClick={() => setLogOpen(true)} />
            {isCaptain && live ? <IconButton icon="flag" label="Resign" size="sm" onClick={() => setConfirmResign(true)} /> : null}
          </div>
        ) : null}
      </div>

      {layout.mode === 'single' ? (
        <div className="sh-switch">
          <Segmented<View>
            label="Grid"
            value={view}
            onChange={(v) => {
              manual.current = true;
              setView(v);
            }}
            options={[
              {
                value: 'enemy',
                label: (
                  <SwitchLabel title={isCaptain ? 'Enemy waters' : (them?.name ?? 'Captain 2')} left={them?.vesselsLeft} alert={myTurn} />
                ),
              },
              {
                value: 'own',
                label: (
                  <SwitchLabel
                    title={isCaptain ? 'Your fleet' : (me?.name ?? 'Captain 1')}
                    left={me?.vesselsLeft}
                    alert={isCaptain && live && !myTurn}
                  />
                ),
              },
            ]}
          />
        </div>
      ) : null}

      <div className={cx('sh-arena', `sh-arena--${layout.mode}`)} ref={arenaRef}>
        {layout.sea > 0 ? (
          layout.mode === 'single' ? (
            <>
              {view === 'enemy' ? enemyPanel : ownPanel}
              {miniPx >= 72 ? (
                <MiniMap
                  n={n}
                  px={miniPx}
                  label={view === 'enemy' ? ownTitle : enemyTitle}
                  side={view === 'enemy' ? me : them}
                  vessels={view === 'enemy' ? ownVessels : wrecksOf(them)}
                  fresh={freshFor(view === 'enemy' ? me : them)}
                  onClick={() => {
                    manual.current = true;
                    setView(view === 'enemy' ? 'own' : 'enemy');
                  }}
                />
              ) : null}
            </>
          ) : (
            <div className={cx('sh-arena__pair', `sh-arena__pair--${layout.mode}`)}>
              {enemyPanel}
              {ownPanel}
            </div>
          )
        ) : null}
        {logInline ? <InlineLog log={state.log} /> : null}
        {banner ? (
          <div key={banner.key} className={cx('sh-banner', `sh-banner--${banner.tone}`)} role="status">
            <strong>{banner.title}</strong>
            {banner.text ? <span>{banner.text}</span> : null}
          </div>
        ) : null}
        {state.stage === 'over' ? (
          <div
            className={cx('sh-over', isCaptain && state.winnerId === playerId ? 'is-win' : isCaptain ? 'is-loss' : 'is-neutral')}
            role="status"
          >
            <strong>{turnTitle}</strong>
            <span>{endReasonText(state, nameOf)}</span>
          </div>
        ) : null}
      </div>

      {short ? null : (
        <div className="sh-actions">
          <div className="sh-actions__ticker" aria-live="polite">
            {lastLog && !logInline ? <span data-kind={lastLog.kind}>{lastLog.text}</span> : null}
          </div>
          <div className="sh-actions__buttons">
            {fireButtons}
            <Button variant="ghost" size="sm" icon="chat" onClick={() => setLogOpen(true)}>
              Log
            </Button>
            {isCaptain && live ? (
              <Button variant="ghost" size="sm" icon="flag" onClick={() => setConfirmResign(true)}>
                Resign
              </Button>
            ) : null}
          </div>
        </div>
      )}

      <Modal open={logOpen} onClose={() => setLogOpen(false)} title="Battle log">
        <ol className="sh-log">
          {[...state.log].reverse().map((l) => (
            <li key={l.seq} data-kind={l.kind}>
              {l.text}
            </li>
          ))}
        </ol>
      </Modal>

      <Modal
        open={confirmResign}
        onClose={() => setConfirmResign(false)}
        title="Strike your colours?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmResign(false)}>
              Keep fighting
            </Button>
            <Button
              variant="danger"
              icon="flag"
              onClick={() => {
                setConfirmResign(false);
                session.send(SHIPS_MSG.resign, {});
              }}
            >
              Resign
            </Button>
          </>
        }
      >
        <p>Resigning ends the game now and gives the win to {them?.name ?? 'your opponent'}. Both fleets are revealed.</p>
      </Modal>
    </div>
  );
}

export function endReasonText(state: ShipsPublicState, nameOf: (id: string) => string): string {
  const winner = nameOf(state.winnerId);
  const loser = nameOf(state.sides.find((s) => s.playerId !== state.winnerId)?.playerId ?? '');
  switch (state.endReason) {
    case 'fleet_destroyed':
      return `${winner} destroyed ${loser}’s entire fleet in ${state.turnNumber} turns.`;
    case 'resign':
      return `${loser} struck their colours.`;
    case 'timeout':
      return `${loser} ran out of time three turns in a row.`;
    case 'abandoned':
      return `${loser} lost connection and didn’t return.`;
    case 'forfeit':
      return `${loser} left the battle.`;
    default:
      return '';
  }
}

function SwitchLabel({ title, left, alert }: { title: string; left?: number; alert?: boolean }) {
  return (
    <span className="sh-switch__label">
      <span>{title}</span>
      {left !== undefined ? <span className="sh-switch__count">{left} afloat</span> : null}
      {alert ? <i className="sh-switch__dot" aria-hidden /> : null}
    </span>
  );
}

function BoardPanel({
  title,
  side,
  tone,
  status,
  fleetStrip,
  children,
}: {
  title: string;
  side: ShipsSideView | undefined;
  tone: 'active' | 'incoming' | 'idle';
  status: ReactNode;
  fleetStrip: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={cx('sh-panel', `sh-panel--${tone}`)} aria-label={title}>
      <header className="sh-panel__head">
        <h2 className="sh-panel__title">{title}</h2>
        <span className="sh-panel__meta">
          {side ? (
            <span className="sh-panel__count">
              <b>{side.vesselsLeft}</b> afloat
            </span>
          ) : null}
          {status}
        </span>
      </header>
      {children}
      {fleetStrip}
    </section>
  );
}

function CaptainTag({
  side,
  player,
  you,
  active,
  align,
}: {
  side: ShipsSideView | undefined;
  player: PlayerView | undefined;
  you: boolean;
  active: boolean;
  align: 'left' | 'right';
}) {
  if (!side) return <div className="sh-captain" />;
  const acc = side.shots ? Math.round((side.hits / side.shots) * 100) : 0;
  const offline = player ? !player.connected : true;
  return (
    <div className={cx('sh-captain', `sh-captain--${align}`, active && 'is-active')}>
      <span className="sh-captain__avatar">
        <Avatar avatar={player?.avatar ?? 'rocket'} color={player?.color ?? 'var(--accent)'} size={30} offline={offline} />
      </span>
      <span className="sh-captain__info">
        <span className="sh-captain__name">
          <span className="sh-captain__nm">{side.name}</span>
          {you ? <span className="sh-captain__you">You</span> : null}
        </span>
        <span className="sh-captain__stats">
          {offline ? (
            <span className="sh-captain__offline">Reconnecting…</span>
          ) : (
            <>
              <span title="Hits / shots">
                <b>{side.hits}</b>/{side.shots}
              </span>
              <span title="Accuracy">{acc}%</span>
              {side.streak > 1 ? <span className="sh-captain__streak">×{side.streak}</span> : null}
            </>
          )}
        </span>
      </span>
    </div>
  );
}

/** The grid you aren't looking at (phones): a live thumbnail that switches to it. */
function MiniMap({
  n,
  px,
  label,
  side,
  vessels,
  fresh,
  onClick,
}: {
  n: number;
  px: number;
  label: string;
  side: ShipsSideView | undefined;
  vessels: VesselDraw[];
  fresh?: ReadonlySet<number>;
  onClick: () => void;
}) {
  const shots = side?.board ?? '';
  const marks: ReactNode[] = [];
  for (let i = 0; i < shots.length; i++) {
    const ch = shots[i];
    if (ch === '.') continue;
    const x = i % n;
    const y = Math.floor(i / n);
    marks.push(ch === 'o' ? <MissMark key={i} x={x} y={y} /> : <HitMark key={i} x={x} y={y} sunk={ch === '#'} fresh={fresh?.has(i)} />);
  }
  return (
    <button
      type="button"
      className={cx('sh-mini', fresh && 'is-hot')}
      onClick={onClick}
      aria-label={`Show ${label}${side ? ` (${side.vesselsLeft} afloat)` : ''}`}
    >
      <svg className="sh-mini__sea" viewBox={`0 0 ${n} ${n}`} width={px} height={px} aria-hidden focusable="false">
        {Array.from({ length: n - 1 }, (_, i) => (
          <g key={i} stroke="rgba(125, 211, 252, 0.14)" strokeWidth={0.04}>
            <line x1={i + 1} y1={0} x2={i + 1} y2={n} />
            <line x1={0} y1={i + 1} x2={n} y2={i + 1} />
          </g>
        ))}
        {vessels.map((v) => (
          <Vessel key={v.id} {...v} />
        ))}
        {marks}
      </svg>
      <span className="sh-mini__label">
        <span>{label}</span>
        <span className="sh-mini__hint">Tap to view</span>
      </span>
    </button>
  );
}

function FleetStrip({
  n,
  fleet,
  side,
  own,
  ownFleet = [],
}: {
  n: number;
  fleet: readonly VesselId[];
  side: ShipsSideView | undefined;
  own: boolean;
  ownFleet?: Array<{ id: VesselId; x: number; y: number; dir: 'h' | 'v' }>;
}) {
  const sunk = new Set(side?.sunkVessels.map((v) => v.id) ?? []);
  return (
    <ul className="sh-fleet" aria-label={own ? 'Your vessels' : 'Enemy vessels'}>
      {fleet.map((id) => {
        const isSunk = sunk.has(id);
        let damage = 0;
        if (own && side) {
          const v = ownFleet.find((p) => p.id === id);
          if (v) damage = placementCells(v).filter((c) => side.board[c.y * n + c.x] !== '.').length;
        }
        const len = VESSELS[id].length;
        const label = `${VESSELS[id].name}: ${isSunk ? 'sunk' : own ? (damage ? `${damage} of ${len} squares hit` : 'undamaged') : 'afloat'}`;
        return (
          <li
            key={id}
            className={cx('sh-fleet__item', isSunk && 'is-sunk')}
            title={label}
            aria-label={label}
            style={{ '--len': len } as CSSProperties}
          >
            <span className="sh-fleet__art">
              <VesselIcon id={id} tone={isSunk ? 'sunk' : 'live'} />
            </span>
            {own && !isSunk && damage ? <span className="sh-fleet__dmg">{damage}</span> : null}
            {isSunk ? <PixelIcon name="close" className="sh-fleet__x" /> : null}
          </li>
        );
      })}
    </ul>
  );
}

function InlineLog({ log }: { log: ShipsPublicState['log'] }) {
  const recent = log.slice(-6).reverse();
  return (
    <section className="sh-inline-log" aria-label="Recent battle log">
      <h2 className="sh-panel__title">Battle log</h2>
      <ol className="sh-log">
        {recent.map((l) => (
          <li key={l.seq} data-kind={l.kind}>
            {l.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
