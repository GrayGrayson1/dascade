/**
 * The shared lobby used by every cabinet. Games plug in their own SettingsPanel
 * and PlayerSetup via their GameClientModule.
 */
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { GAME_CATALOG, LIMITS, type GameId, type PlayerView } from '@dascade/shared';
import {
  Badge,
  Button,
  Field,
  IconButton,
  Modal,
  NumberInput,
  Panel,
  PixelIcon,
  PlayerChip,
  Tabs,
  TextInput,
  Toggle,
  cx,
} from '@dascade/ui';
import { useBaseRoom } from '../net/hooks.ts';
import { session, useSessionStore } from '../net/session.ts';
import { useApp } from '../app/store.ts';
import { sfx } from '../audio/audio.ts';
import type { GameClientModule, SettingsPanelProps } from '../games/types.ts';
import { ChatPanel, GameStage, LeaveButton } from './common.tsx';

type LobbyTab = 'players' | 'settings' | 'setup' | 'chat';

const updateSettings = (patch: Record<string, unknown>) => session.lobby.settings(patch);

/**
 * Lobby view of the room built from the base state only, so game-specific patches that happen in
 * the lobby (car builds, hero picks, seat previews…) don't re-render the whole lobby and the
 * game's SettingsPanel.
 */
function useLobbyGame() {
  const state = useBaseRoom();
  const playerId = useSessionStore((s) => s.playerId);
  const settingsJson = state?.settingsJson;
  const settings = useMemo(() => {
    try {
      return JSON.parse(settingsJson ?? '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  }, [settingsJson]);
  const playersMap = state?.players;
  const players = useMemo(() => Object.values(playersMap ?? {}).sort((a, b) => a.joinOrder - b.joinOrder), [playersMap]);
  const seated = useMemo(() => players.filter((p) => !p.spectator), [players]);
  if (!state) return null;
  const me = playerId ? state.players[playerId] : undefined;
  return { state, settings, playerId, me, players, seated, isHost: Boolean(playerId && state.hostId === playerId) };
}

export function Lobby({ gameId, module }: { gameId: GameId; module: GameClientModule | null }) {
  const game = useLobbyGame();
  const catalog = GAME_CATALOG[gameId];
  const [tab, setTab] = useState<LobbyTab>('players');
  const [confirmStart, setConfirmStart] = useState(false);
  const openModal = useApp((s) => s.openModal);

  const joinSound = game?.players.length ?? 0;
  useEffect(() => {
    if (joinSound > 1) sfx('join');
  }, [joinSound]);

  if (!game) return null;
  const { state, me, isHost, seated, players } = game;
  const activeConnected = seated.filter((p) => p.connected);
  const notReady = seated.filter((p) => !p.ready && !p.isHost && p.connected);
  const minPlayers = catalog.capacity.minPlayers;
  const canStart = activeConnected.length >= minPlayers;
  const SettingsPanel = module?.SettingsPanel as ComponentType<SettingsPanelProps<Record<string, unknown>>> | undefined;
  const PlayerSetup = module?.PlayerSetup;
  const tabs: Array<{ value: LobbyTab; label: ReactNode }> = [
    {
      value: 'players',
      label: (
        <>
          Players <span className="dc-num">{`${seated.length}/${state.maxPlayers}`}</span>
        </>
      ),
    },
    { value: 'settings', label: 'Settings' },
    ...(PlayerSetup ? [{ value: 'setup' as const, label: 'Your setup' }] : []),
    { value: 'chat', label: 'Chat' },
  ];

  const start = () => {
    if (notReady.length > 0 && !confirmStart) {
      setConfirmStart(true);
      return;
    }
    setConfirmStart(false);
    sfx('start');
    session.lobby.start();
  };

  return (
    <GameStage gameId={gameId} className="lobby">
      <div className="lobby__inner">
        <LobbyHero gameId={gameId} roomName={state.roomName} code={state.code} canEdit={isHost} />

        <Tabs className="lobby__tabs" label="Lobby sections" value={tab} onChange={setTab} tabs={tabs} />

        <div className="lobby__grid" data-tab={tab}>
          <Panel className="lobby__players" data-section="players" title={`Players · ${seated.length}/${state.maxPlayers}`} brackets>
            <PlayerList players={players} meId={game.playerId} hostView={isHost} />
            {me?.spectator && !me.queued ? (
              <p className="dc-field__hint" style={{ marginTop: 12 }}>
                You’re spectating. {seated.length < state.maxPlayers ? 'Grab a seat to play.' : 'All seats are taken.'}
              </p>
            ) : null}
          </Panel>

          <div className="lobby__settings" data-section="settings">
            {SettingsPanel ? (
              <Panel title={isHost ? 'Game settings' : 'Game settings (host controls these)'}>
                <SettingsPanel settings={game.settings} canEdit={isHost} update={updateSettings} />
              </Panel>
            ) : null}
            <RoomSettings gameId={gameId} />
            <Panel title="How to play">
              <ol className="help-steps help-steps--compact">
                {catalog.howToPlay.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <Button size="sm" variant="ghost" icon="help" onClick={() => openModal('help', gameId)}>
                Full rules & controls
              </Button>
            </Panel>
          </div>

          {PlayerSetup ? (
            <Panel className="lobby__setup" data-section="setup" title="Your setup">
              <PlayerSetup />
            </Panel>
          ) : null}

          <Panel className="lobby__chat" data-section="chat" title="Lobby chat" padded={false}>
            <ChatPanel />
          </Panel>
        </div>
      </div>

      {/* In-flow sticky bar: it reserves its own height (never covers the end of the lobby). On
          phones it is one row — Leave and Spectate collapse to icons, Ready/Start fills the rest
          and the waiting note becomes a caption (see app.css). */}
      <footer className="lobby__actions">
        <div className="lobby__actions-inner">
          <LeaveButton size="md" className="lobby__leave" collapseLabel />
          <span className="dc-spacer" />
          {me && !me.spectator && !isHost ? (
            <Button
              className="lobby__ready"
              variant={me.ready ? 'success' : 'secondary'}
              icon={me.ready ? 'check' : undefined}
              onClick={() => {
                sfx('ready');
                session.lobby.ready(!me.ready);
              }}
              aria-pressed={me.ready}
            >
              {me.ready ? 'Ready!' : 'Ready up'}
            </Button>
          ) : null}
          {state.allowSpectators && me ? (
            <Button
              className="lobby__spectate"
              variant="ghost"
              icon="eye"
              onClick={() => session.lobby.spectate(!me.spectator)}
              disabled={me.spectator && seated.length >= state.maxPlayers}
            >
              <span className="dc-collapse-label">{me.spectator ? 'Take a seat' : 'Spectate'}</span>
            </Button>
          ) : null}
          {isHost ? (
            <Button
              className="lobby__start"
              variant="primary"
              size="lg"
              icon="play"
              disabled={!canStart}
              onClick={start}
              title={canStart ? undefined : `Need ${minPlayers} players`}
            >
              {canStart ? 'Start game' : `Need ${minPlayers - activeConnected.length} more`}
            </Button>
          ) : (
            <span className="lobby__waiting">
              <PixelIcon name="clock" /> Waiting for host to start
            </span>
          )}
        </div>
      </footer>

      <Modal
        open={confirmStart}
        onClose={() => setConfirmStart(false)}
        title="Start anyway?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmStart(false)}>
              Wait
            </Button>
            <Button variant="primary" icon="play" onClick={start}>
              Start now
            </Button>
          </>
        }
      >
        <p>
          {notReady.length} player{notReady.length === 1 ? ' isn’t' : 's aren’t'} ready yet: {notReady.map((p) => p.name).join(', ')}.
        </p>
      </Modal>
    </GameStage>
  );
}

function LobbyHero({ gameId, roomName, code, canEdit }: { gameId: GameId; roomName: string; code: string; canEdit: boolean }) {
  const catalog = GAME_CATALOG[gameId];
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(roomName);
  useEffect(() => setName(roomName), [roomName]);
  const link = `${location.origin}/room/${code}`;
  const copy = async (what: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(what === 'code' ? code : link);
      sfx('pop');
      useApp.getState().toast('success', what === 'code' ? `Copied code ${code}` : 'Invite link copied');
    } catch {
      useApp.getState().toast('info', what === 'code' ? code : link);
    }
  };
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join my ${catalog.title} game`, text: `Room code ${code}`, url: link });
      } catch {
        /* cancelled */
      }
    } else await copy('link');
  };
  return (
    <header className="lobby-hero">
      <div className="lobby-hero__title">
        <span className="dc-label">{catalog.title} · Lobby</span>
        {editing ? (
          <form
            className="dc-row"
            onSubmit={(e) => {
              e.preventDefault();
              session.lobby.room({ roomName: name });
              setEditing(false);
            }}
          >
            <TextInput value={name} maxLength={LIMITS.roomName} autoFocus aria-label="Room name" onChange={(e) => setName(e.currentTarget.value)} />
            <IconButton icon="check" label="Save room name" type="submit" variant="primary" />
          </form>
        ) : (
          <h1 className="dc-title lobby-hero__name">
            {roomName}
            {canEdit ? <IconButton icon="pencil" label="Rename room" size="sm" onClick={() => setEditing(true)} /> : null}
          </h1>
        )}
        <p className="dc-muted">{catalog.tagline}</p>
      </div>
      <div className="lobby-code" aria-label={`Room code ${code}`}>
        <span className="dc-label">Room code</span>
        <button type="button" className="lobby-code__value" onClick={() => copy('code')} title="Copy code">
          {(code ?? '').split('').map((ch, i) => (
            <span key={i}>{ch}</span>
          ))}
        </button>
        <div className="dc-row">
          <Button size="sm" icon="copy" onClick={() => copy('link')}>
            Copy link
          </Button>
          <Button size="sm" icon="share" variant="ghost" onClick={share}>
            Share
          </Button>
        </div>
      </div>
    </header>
  );
}

function PlayerList({ players, meId, hostView }: { players: PlayerView[]; meId: string | null; hostView: boolean }) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const sorted = useMemo(
    () => [...players].sort((a, b) => Number(a.spectator) - Number(b.spectator) || a.joinOrder - b.joinOrder),
    [players],
  );
  return (
    <ul className="player-list">
      {sorted.map((p) => (
        <li key={p.id} className={cx('player-list__item', p.ready && 'is-ready')}>
          <PlayerChip
            name={p.name}
            avatar={p.avatar}
            color={p.color}
            isHost={p.isHost}
            isYou={p.id === meId}
            connected={p.connected}
            spectator={p.spectator}
            meta={p.queued ? <Badge color="var(--yellow)">Next round</Badge> : null}
          />
          <span className="dc-spacer" />
          {!p.spectator && !p.isHost ? (
            <span className={cx('ready-pill', p.ready && 'ready-pill--on')}>{p.ready ? 'Ready' : 'Not ready'}</span>
          ) : null}
          {hostView && p.id !== meId ? (
            menuFor === p.id ? (
              <span className="dc-row" style={{ gap: 4 }}>
                <Button size="sm" variant="ghost" icon="crown" onClick={() => (session.lobby.transferHost(p.id), setMenuFor(null))} disabled={!p.connected}>
                  Make host
                </Button>
                <Button size="sm" variant="danger" onClick={() => (session.lobby.kick(p.id), setMenuFor(null))}>
                  Remove
                </Button>
                <IconButton icon="close" label="Close player actions" size="sm" onClick={() => setMenuFor(null)} />
              </span>
            ) : (
              <IconButton icon="gear" label={`Manage ${p.name}`} size="sm" onClick={() => setMenuFor(p.id)} />
            )
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function RoomSettings({ gameId }: { gameId: GameId }) {
  const game = useLobbyGame();
  if (!game) return null;
  const { state, isHost } = game;
  const cap = GAME_CATALOG[gameId].capacity;
  return (
    <Panel title="Room">
      <div className="dc-col" style={{ gap: 14 }}>
        <Toggle
          label={state.locked ? 'Room locked — no new players' : 'Room open to new players'}
          checked={state.locked}
          disabled={!isHost}
          onChange={(locked) => session.lobby.room({ locked })}
        />
        {cap.supportsSpectators ? (
          <Toggle
            label="Allow spectators"
            checked={state.allowSpectators}
            disabled={!isHost}
            onChange={(allowSpectators) => session.lobby.room({ allowSpectators })}
          />
        ) : null}
        <Field label="Max players" hint={`Up to ${cap.maxPlayersLimit} for ${GAME_CATALOG[gameId].title}.`}>
          {({ id, describedBy }) => (
            <NumberInput
              id={id}
              aria-describedby={describedBy}
              value={state.maxPlayers}
              min={Math.max(1, cap.minPlayers)}
              max={cap.maxPlayersLimit}
              disabled={!isHost}
              onChange={(maxPlayers) => {
                if (maxPlayers !== state.maxPlayers) session.lobby.room({ maxPlayers });
              }}
            />
          )}
        </Field>
      </div>
    </Panel>
  );
}
