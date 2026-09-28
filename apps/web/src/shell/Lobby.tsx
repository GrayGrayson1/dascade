/**
 * The shared lobby used by every cabinet. Games plug in their own SettingsPanel
 * and PlayerSetup via their GameClientModule.
 */
import { useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { GAME_CATALOG, LIMITS, cabinetForGame, type GameId, type PlayerView } from '@dascade/shared';
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
import { crumbCabinet } from './crumbs.ts';
import { ThemedText } from '../themes/ThemedText.tsx';
import { TournamentButton } from '../tournament/TournamentButton.tsx';

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
  // Tournament Center match room: seats, settings and the start are run by the tournament — the server
  // refuses lock / spectators / player limit / rename / kick / host / spectate / ready / start here.
  const tournamentMatch = Boolean(state.tournamentJson);
  return { state, settings, playerId, me, players, seated, tournamentMatch, isHost: Boolean(playerId && state.hostId === playerId) };
}

export function Lobby({ gameId, module }: { gameId: GameId; module: GameClientModule | null }) {
  const game = useLobbyGame();
  const catalog = GAME_CATALOG[gameId];
  const [tab, setTab] = useState<LobbyTab>('players');
  // A game can open the phone lobby on its setup (the module loads lazily, so apply it once it's here).
  const startTabApplied = useRef(false);
  useEffect(() => {
    if (startTabApplied.current || !module) return;
    startTabApplied.current = true;
    if (module.lobbyStartTab === 'setup' && module.PlayerSetup) setTab('setup');
  }, [module]);
  const [confirmStart, setConfirmStart] = useState(false);
  const openModal = useApp((s) => s.openModal);

  // Someone joined (not left, not the first state arriving, not returning from a game).
  const playerCount = game?.players.length ?? 0;
  const prevCount = useRef(playerCount);
  useEffect(() => {
    const prev = prevCount.current;
    prevCount.current = playerCount;
    if (prev > 0 && playerCount > prev) sfx('join');
  }, [playerCount]);

  if (!game) return null;
  const { state, me, isHost, seated, players, tournamentMatch } = game;
  /** Host controls the server honours in this room. */
  const canManage = isHost && !tournamentMatch;
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
    ...(PlayerSetup ? [{ value: 'setup' as const, label: 'Your setup' }] : []),
    { value: 'settings', label: 'Settings' },
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
      <div className="lobby__inner" data-part="lobby">
        <LobbyHero
          gameId={gameId}
          roomName={state.roomName}
          code={state.code}
          canEdit={canManage}
          seated={seated.length}
          maxPlayers={state.maxPlayers}
          locked={state.locked}
          allowSpectators={state.allowSpectators}
          spectators={players.length - seated.length}
        />

        <Tabs className="lobby__tabs" label="Lobby sections" value={tab} onChange={setTab} tabs={tabs} />

        <div className="lobby__grid" data-part="lobby-grid" data-tab={tab}>
          <Panel
            className="lobby__players"
            data-part="lobby-players"
            data-section="players"
            title={
              <>
                <ThemedText k="lobby.players" plain="Players" /> · {`${seated.length}/${state.maxPlayers}`}
              </>
            }
            brackets
          >
            <SeatMeter seated={seated.length} max={state.maxPlayers} min={minPlayers} />
            <PlayerList
              players={players}
              meId={game.playerId}
              hostView={canManage}
              showReady={!tournamentMatch}
              maxPlayers={state.maxPlayers}
              locked={state.locked && !tournamentMatch}
            />
            {me?.spectator && !me.queued && !tournamentMatch ? (
              <p className="dc-field__hint" style={{ marginTop: 12 }}>
                You’re spectating. {seated.length < state.maxPlayers ? 'Grab a seat to play.' : 'All seats are taken.'}
              </p>
            ) : null}
          </Panel>

          {/* DOM order follows the layout (players, your setup, then settings) so Tab reaches your own
              setup before the host settings; the grid areas place the panels. */}
          {PlayerSetup ? (
            <Panel className="lobby__setup" data-part="lobby-setup" data-section="setup" title="Your setup">
              <PlayerSetup />
            </Panel>
          ) : null}

          <div className="lobby__settings" data-part="lobby-settings" data-section="settings">
            {SettingsPanel ? (
              <Panel
                title={tournamentMatch ? 'Game settings (set by the organizer)' : isHost ? 'Game settings' : 'Game settings (host controls these)'}
              >
                <SettingsPanel settings={game.settings} canEdit={canManage} update={updateSettings} />
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
              <TournamentButton gameId={gameId} label="Run a tournament" />
            </Panel>
          </div>

          <Panel className="lobby__chat" data-part="lobby-chat" data-section="chat" title="Lobby chat" padded={false}>
            <ChatPanel />
          </Panel>
        </div>
      </div>

      {/* In-flow sticky bar: it reserves its own height (never covers the end of the lobby). On
          phones it is one row — Leave and Spectate collapse to icons, Ready/Start fills the rest
          and the waiting note becomes a caption (see app.css). */}
      <footer className="lobby__actions" data-part="lobby-actions">
        <div className="lobby__actions-inner">
          <LeaveButton size="md" className="lobby__leave" collapseLabel popover="above" />
          <span className="dc-spacer" />
          {me && !me.spectator && !isHost && !tournamentMatch ? (
            <Button
              className="lobby__ready"
              data-part="ready-button"
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
          {state.allowSpectators && me && !tournamentMatch ? (
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
          {tournamentMatch ? (
            <span className="lobby__waiting">
              <PixelIcon name="clock" /> Starts automatically when both players are here
            </span>
          ) : isHost ? (
            <Button
              className="lobby__start"
              data-part="start-button"
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

function LobbyHero({
  gameId,
  roomName,
  code,
  canEdit,
  seated,
  maxPlayers,
  locked,
  allowSpectators,
  spectators,
}: {
  gameId: GameId;
  roomName: string;
  code: string;
  canEdit: boolean;
  seated: number;
  maxPlayers: number;
  locked: boolean;
  allowSpectators: boolean;
  spectators: number;
}) {
  const catalog = GAME_CATALOG[gameId];
  const cabinet = cabinetForGame(gameId);
  const multi = crumbCabinet(gameId) !== null;
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
    <header className="lobby-hero" data-part="lobby-hero">
      <div className="lobby-hero__title">
        <nav
          className="shell-crumb"
          aria-label="You are here"
          style={cabinet ? ({ '--crumb': cabinet.accent.primary } as CSSProperties) : undefined}
        >
          {multi && cabinet ? (
            <>
              <span className="shell-crumb__cabinet">{cabinet.title}</span>
              <span className="shell-crumb__sep" aria-hidden>
                ›
              </span>
            </>
          ) : null}
          <span className="shell-crumb__game">{catalog.title}</span>
          <span className="shell-crumb__sep" aria-hidden>
            ·
          </span>
          <span className="shell-crumb__here">
            <ThemedText k="lobby.title" plain="Lobby" />
          </span>
        </nav>
        {editing ? (
          <form
            className="dc-row"
            onSubmit={(e) => {
              e.preventDefault();
              session.lobby.room({ roomName: name });
              setEditing(false);
            }}
          >
            <TextInput
              value={name}
              maxLength={LIMITS.roomName}
              autoFocus
              aria-label="Room name"
              onChange={(e) => setName(e.currentTarget.value)}
            />
            <IconButton icon="check" label="Save room name" type="submit" variant="primary" />
          </form>
        ) : (
          <h1 className="dc-title lobby-hero__name" data-part="lobby-title">
            {roomName}
            {canEdit ? <IconButton icon="pencil" label="Rename room" size="sm" onClick={() => setEditing(true)} /> : null}
          </h1>
        )}
        <p className="dc-muted">{catalog.tagline}</p>
        <ul className="lobby-status" data-part="lobby-status" aria-label="Room status">
          <li className="lobby-status__item">
            <PixelIcon name="users" />
            <span>
              <span className="dc-num">{seated}</span>/<span className="dc-num">{maxPlayers}</span> seats
            </span>
          </li>
          <li className="lobby-status__item" data-state={locked ? 'locked' : 'open'}>
            <PixelIcon name={locked ? 'lock' : 'unlock'} />
            <span>{locked ? 'Locked' : 'Open to join'}</span>
          </li>
          {allowSpectators ? (
            <li className="lobby-status__item">
              <PixelIcon name="eye" />
              <span>{spectators > 0 ? `${spectators} watching` : 'Spectators welcome'}</span>
            </li>
          ) : null}
        </ul>
      </div>
      <div className="lobby-code" data-part="room-code" aria-label={`Room code ${code}`}>
        <span className="dc-label">Room code</span>
        <button type="button" className="lobby-code__value" data-part="room-code-value" onClick={() => copy('code')} title="Copy code">
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

/** Filled / empty seat pips (compact bar for big rooms). */
function SeatMeter({ seated, max, min }: { seated: number; max: number; min: number }) {
  const label = `${seated} of ${max} seats taken${seated < min ? ` · ${min - seated} more needed to start` : ''}`;
  return (
    <div className="seat-meter" data-part="seat-meter" role="img" aria-label={label} data-mode={max <= 12 ? 'pips' : 'bar'}>
      {max <= 12 ? (
        Array.from({ length: max }, (_, i) => (
          <i key={i} data-filled={i < seated ? 'true' : undefined} data-needed={i >= seated && i < min ? 'true' : undefined} />
        ))
      ) : (
        <i className="seat-meter__fill" style={{ '--fill': `${Math.min(100, (seated / Math.max(1, max)) * 100)}%` } as CSSProperties} />
      )}
    </div>
  );
}

function PlayerList({
  players,
  meId,
  hostView,
  showReady = true,
  maxPlayers,
  locked,
}: {
  players: PlayerView[];
  meId: string | null;
  hostView: boolean;
  /** Ready pills (hidden where there is no ready-up, e.g. tournament matches start on their own). */
  showReady?: boolean;
  maxPlayers: number;
  locked: boolean;
}) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const seated = useMemo(() => players.filter((p) => !p.spectator).sort((a, b) => a.joinOrder - b.joinOrder), [players]);
  const watching = useMemo(() => players.filter((p) => p.spectator).sort((a, b) => a.joinOrder - b.joinOrder), [players]);
  const open = Math.max(0, maxPlayers - seated.length);
  const row = (p: PlayerView) => (
    <li
      key={p.id}
      data-part="player-row"
      className={cx('player-list__item', p.ready && 'is-ready', p.id === meId && 'is-me', !p.connected && 'is-away')}
    >
      <PlayerChip
        name={p.name}
        avatar={p.avatar}
        color={p.color}
        isHost={p.isHost}
        isYou={p.id === meId}
        connected={p.connected}
        spectator={p.spectator}
        meta={p.queued ? <Badge color="var(--warning)">Next round</Badge> : null}
      />
      <span className="dc-spacer" />
      {!showReady || p.spectator ? null : p.isHost ? (
        <span className="ready-pill ready-pill--host">Host</span>
      ) : (
        <span className={cx('ready-pill', p.ready && 'ready-pill--on')}>
          <PixelIcon name={p.ready ? 'check' : 'clock'} /> {p.ready ? 'Ready' : 'Not ready'}
        </span>
      )}
      {hostView && p.id !== meId ? (
        menuFor === p.id ? (
          <span className="player-list__manage">
            <Button
              size="sm"
              variant="ghost"
              icon="crown"
              onClick={() => (session.lobby.transferHost(p.id), setMenuFor(null))}
              disabled={!p.connected}
            >
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
  );
  return (
    <ul className="player-list" data-part="player-list">
      {seated.map(row)}
      {open > 0 ? (
        locked ? (
          <li className="player-list__open player-list__open--locked">
            <PixelIcon name="lock" /> Room locked — no new players
          </li>
        ) : open <= 3 ? (
          Array.from({ length: open }, (_, i) => (
            <li key={`open-${i}`} className="player-list__open">
              <span className="player-list__open-slot" aria-hidden />
              Open seat
            </li>
          ))
        ) : (
          <li className="player-list__open">
            <span className="player-list__open-slot" aria-hidden />
            <span>
              <span className="dc-num">{open}</span> open seats
            </span>
          </li>
        )
      ) : null}
      {watching.length > 0 ? (
        <li className="player-list__divider">
          <PixelIcon name="eye" /> Spectators · <span className="dc-num">{watching.length}</span>
        </li>
      ) : null}
      {watching.map(row)}
    </ul>
  );
}

function RoomSettings({ gameId }: { gameId: GameId }) {
  const game = useLobbyGame();
  if (!game) return null;
  const { state, isHost, tournamentMatch } = game;
  const cap = GAME_CATALOG[gameId].capacity;
  if (tournamentMatch) {
    return (
      <Panel title="Room">
        <p className="dc-field__hint">
          <PixelIcon name="trophy" /> This match room is run by the Tournament Center: seats, spectators and settings are fixed.
        </p>
      </Panel>
    );
  }
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
