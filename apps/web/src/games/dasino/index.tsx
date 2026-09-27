/**
 * DASino — the casino-floor cabinet (roulette, slots, dice). Virtual chips only.
 */
import { useEffect, useRef } from 'react';
import {
  DASINO_MSG,
  DEFAULT_DASINO_SETTINGS,
  type DasinoPublicState,
  type DasinoSettings,
  type SlotResultPayload,
} from '@dascade/shared/games/dasino';
import type { GameClientModule } from '../types.ts';
import { GameStage } from '../../shell/common.tsx';
import { useGame, useRoomMessage } from '../../net/hooks.ts';
import { useSessionStore } from '../../net/session.ts';
import { takeVariantRequest } from '../../arcade/variantRequest.ts';
import { BalanceHud, TableNav, Ticker, goToTable } from './parts.tsx';
import { Floor } from './Floor.tsx';
import { RouletteTable } from './Roulette.tsx';
import { SlotsTable } from './Slots.tsx';
import { DiceTable } from './Dice.tsx';
import { Results } from './Results.tsx';
import { DasinoSettingsPanel } from './SettingsPanel.tsx';
import { useDasinoUi } from './ui.ts';
import './dasino.css';

function DasinoView() {
  const game = useGame<DasinoPublicState, DasinoSettings>();
  const table = useDasinoUi((s) => s.table);
  const setTable = useDasinoUi((s) => s.setTable);
  const restored = useRef<string | null>(null);
  const logSlot = useDasinoUi((s) => s.logSlot);
  // Log my spins even if I walk away from the machine mid-spin.
  useRoomMessage<SlotResultPayload>(DASINO_MSG.slotResult, logSlot);
  const playerId = game?.playerId ?? null;
  const seat = playerId ? game?.state.seats?.[playerId] : undefined;
  const roomCode = useSessionStore((s) => s.code);
  // "Your spins" belong to one room: a different room starts with an empty log.
  useEffect(() => {
    if (roomCode) useDasinoUi.getState().enterRoom(roomCode);
  }, [roomCode]);

  // Entering from a table's title screen (/play/dasino?table=…) walks to that table once;
  // after a refresh/reconnect, return to the table the server remembers.
  useEffect(() => {
    if (!seat || restored.current === seat.id) return;
    restored.current = seat.id;
    const requested = takeVariantRequest(roomCode, 'dasino', ['roulette', 'slots', 'dice'] as const);
    if (requested && seat.table === 'floor') {
      if (useDasinoUi.getState().table === requested) setTable('floor'); // stale UI from an earlier visit
      goToTable(requested, true);
      return;
    }
    if (seat.table !== useDasinoUi.getState().table) setTable(seat.table);
  }, [seat, setTable, roomCode]);

  if (!game) return null;
  const { state, phase, isHost } = game;
  const settings: DasinoSettings = { ...DEFAULT_DASINO_SETTINGS, ...game.settings };
  const spectator = !seat;
  const view = phase === 'RESULTS' ? 'results' : table;
  const seatedCount = Object.values(state.players ?? {}).filter((p) => !p.spectator).length;
  const canSit = spectator && phase === 'PLAYING' && Boolean(playerId && state.players?.[playerId]) && seatedCount < state.maxPlayers;

  return (
    <GameStage gameId="dasino" className="dn" style={{ '--dn-gold': '#ffd23f' } as React.CSSProperties}>
      <div className="dn-shell" data-view={view}>
        {phase === 'RESULTS' ? null : (
          <>
            <header className="dn-hud" data-part="hud">
              <TableNav state={state} seated={!spectator} />
              <BalanceHud seat={seat} settings={settings} isHost={isHost} spectator={spectator && phase === 'PLAYING'} canSit={canSit} />
            </header>
            <Ticker ticker={state.ticker ?? []} />
          </>
        )}
        <div className="dn-main" key={view}>
          {phase === 'RESULTS' ? (
            <Results state={state} playerId={playerId} />
          ) : table === 'roulette' ? (
            <RouletteTable state={state} settings={settings} seat={seat} playerId={playerId} />
          ) : table === 'slots' ? (
            <SlotsTable state={state} settings={settings} seat={seat} />
          ) : table === 'dice' ? (
            <DiceTable state={state} settings={settings} seat={seat} playerId={playerId} />
          ) : (
            <Floor state={state} playerId={playerId} seated={!spectator} />
          )}
        </div>
      </div>
    </GameStage>
  );
}

const module: GameClientModule = {
  GameView: DasinoView,
  SettingsPanel: DasinoSettingsPanel as unknown as GameClientModule['SettingsPanel'],
  musicMood: 'casino',
};
export default module;
