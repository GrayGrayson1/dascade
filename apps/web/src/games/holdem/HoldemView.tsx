/** DAS Hold'em game screen: HUD, the table, the action dock and the history drawer. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  HOLDEM_MSG,
  formatBlinds,
  type HoldemPrivatePayload,
  type HoldemPublicState,
  type HoldemSettings,
} from '@dascade/shared/games/holdem';
import { Badge, Button, IconButton, Modal, PixelIcon } from '@dascade/ui';
import { useApp } from '../../app/store.ts';
import { session, useCountdown, useGame, useLatestMessage } from '../../net/hooks.ts';
import { GameStage } from '../../shell/common.tsx';
import { ActionDock } from './ActionDock.tsx';
import { computeGeometry } from './geometry.ts';
import { streetLabel } from './helpers.ts';
import { HistoryDrawer } from './HistoryDrawer.tsx';
import { Results } from './Results.tsx';
import { HoldemSettingsPanel } from './Settings.tsx';
import { Table } from './Table.tsx';
import { useHoldemSounds } from './useHoldemSounds.ts';

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export function HoldemView() {
  const game = useGame<HoldemPublicState, HoldemSettings>();
  const priv = useLatestMessage<HoldemPrivatePayload>(HOLDEM_MSG.private);
  const reducedMotion = useApp((s) => s.settings.reducedMotion);
  const fx = useApp((s) => s.settings.fx);
  const compactDock = useMedia('(max-width: 719px), (max-height: 560px)');
  // Short landscape screens (phones on their side): the dock moves into a side column.
  const sideDock = useMedia('(orientation: landscape) and (max-height: 520px)');
  const shortScreen = useMedia('(max-height: 800px)');
  const arenaRef = useRef<HTMLDivElement>(null);
  const [arena, setArena] = useState({ w: 0, h: 0 });
  const [drawer, setDrawer] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [tableSettings, setTableSettings] = useState(false);

  const inResults = game?.phase === 'RESULTS';
  useLayoutEffect(() => {
    const el = arenaRef.current;
    if (!el) return;
    const measure = () => setArena({ w: Math.floor(el.clientWidth), h: Math.floor(el.clientHeight) });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [inResults]);

  const state = game?.state;
  const playerId = game?.playerId ?? null;
  const mySeat = state ? state.seats.findIndex((s) => s.playerId && s.playerId === playerId) : -1;
  const myTurn = Boolean(state && mySeat >= 0 && state.phase === 'PLAYING' && state.toActSeat === mySeat && state.legal.seat === mySeat);
  const remaining = useCountdown(myTurn ? state?.actionDeadline : 0);
  useHoldemSounds({ mySeat, myTurn, bigBlind: state?.bigBlind ?? 100, secondsLeft: Math.ceil(remaining / 1000) });

  const geo = useMemo(() => computeGeometry(arena.w, arena.h), [arena.w, arena.h]);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  const onSit = useCallback((seat: number) => session.send(HOLDEM_MSG.sit, { seat }), []);

  if (!game || !state) return null;
  const { settings, isHost, isSpectator } = game;

  if (game.phase === 'RESULTS') {
    return (
      <GameStage gameId="holdem" className="hd hd--results">
        <Results state={state} players={state.players} playerId={playerId} />
      </GameStage>
    );
  }

  const heroCards = priv && priv.seat === mySeat && mySeat >= 0 && priv.handNumber === state.handNumber ? priv.cards : [];
  const seatedCount = Object.values(state.players).filter((p) => !p.spectator).length;
  const canSit = mySeat < 0 && seatedCount < state.maxPlayers && state.seats.some((s, i) => i < state.tableSize && !s.playerId);
  const levelText =
    state.handsToNextLevel > 0 && settings.blindIncreaseEvery > 0
      ? `Level ${state.blindLevel + 1} · up in ${state.handsToNextLevel}`
      : null;

  return (
    <GameStage
      gameId="holdem"
      className={sideDock ? 'hd hd--side' : 'hd'}
      style={{ '--hd-fx': fx === 'off' ? 0 : fx === 'low' ? 0.5 : 1 } as CSSProperties}
    >
      <div className="hd-hud" data-part="hud">
        <div className="hd-hud__left">
          <span className="hd-hud__brand">
            <PixelIcon name="spade" /> Hold’em
          </span>
          <span className="hd-hud__stat" aria-label={`Hand ${state.handNumber}`}>
            <span className="dc-label">Hand</span> <b>#{state.handNumber || '—'}</b>
          </span>
          <span className="hd-hud__stat">
            <span className="dc-label">Blinds</span> <b>{formatBlinds(state.smallBlind, state.bigBlind)}</b>
          </span>
          {levelText ? <span className="hd-hud__stat hd-hud__stat--minor">{levelText}</span> : null}
          <Badge className="hd-hud__street" color={state.runout ? 'var(--red)' : 'var(--accent)'}>
            {state.runout && state.street !== 'complete' ? 'All-in' : streetLabel(state.street)}
          </Badge>
        </div>
        <div className="hd-hud__right">
          <span className="hd-hud__virtual" title="DASCADE uses virtual chips only — no real money, purchases or payouts.">
            <PixelIcon name="chip" /> Virtual chips only
          </span>
          <Button size="sm" variant="ghost" icon="chat" onClick={() => setDrawer((d) => !d)} aria-expanded={drawer} className="hd-hud__btn">
            <span className="hd-hud__btn-text">History</span>
          </Button>
          {isHost ? (
            <>
              <IconButton icon="gear" label="Table settings" size="sm" onClick={() => setTableSettings(true)} />
              <Button
                size="sm"
                variant="ghost"
                icon="flag"
                disabled={state.endRequested}
                aria-label={state.endRequested ? 'Ending after this hand' : 'End game'}
                onClick={() => setConfirmEnd(true)}
                className="hd-hud__btn"
              >
                <span className="hd-hud__btn-text">{state.endRequested ? 'Final hand' : 'End game'}</span>
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="hd-arena" ref={arenaRef}>
        {arena.w > 0 && arena.h > 0 ? (
          <Table
            state={state}
            geo={geo}
            mySeat={mySeat}
            heroCards={heroCards}
            players={state.players}
            reducedMotion={reducedMotion}
            fxOff={fx === 'off'}
            canSit={canSit}
            onSit={onSit}
          />
        ) : null}
      </div>

      <ActionDock
        state={state}
        settings={settings}
        mySeat={mySeat}
        heroCards={heroCards}
        myTurn={myTurn}
        compact={compactDock || geo.compact}
        isSpectator={isSpectator}
        canSit={canSit}
        side={sideDock}
        collapseRaise={shortScreen}
      />

      <HistoryDrawer open={drawer} onClose={closeDrawer} log={state.log} currentHand={state.handNumber} />

      <Modal
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        title="End the game?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmEnd(false)}>
              Keep playing
            </Button>
            <Button
              variant="danger"
              icon="flag"
              onClick={() => {
                setConfirmEnd(false);
                session.send(HOLDEM_MSG.end, {});
              }}
            >
              End game
            </Button>
          </>
        }
      >
        <p>
          Everyone goes to the leaderboard. A hand in progress is played to the end first — its pot is won at the table, never cancelled.
        </p>
      </Modal>

      <Modal open={tableSettings} onClose={() => setTableSettings(false)} title="Table settings" wide>
        <p className="dc-field__hint" style={{ marginBottom: 12 }}>
          Changes apply from the next hand. The starting stack is used for rebuys and new players.
        </p>
        <HoldemSettingsPanel settings={settings} canEdit={isHost} update={(patch) => session.lobby.settings(patch)} />
      </Modal>
    </GameStage>
  );
}
