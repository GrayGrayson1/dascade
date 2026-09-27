/**
 * /room/:code — resolves (or resumes) the room session, then renders the shared
 * Lobby or the game's GameView based on phase. Handles every connection /
 * error / removal state with a friendly screen.
 */
import { Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { GAME_CATALOG, isGameId, isValidRoomCode, normalizeRoomCode, type GameId } from '@dascade/shared';
import { Button, GameTheme, Panel, Spinner, type IconName } from '@dascade/ui';
import { session, useSessionStore } from '../net/session.ts';
import { useCountdown, useRoomSelector } from '../net/hooks.ts';
import { selectCanPlay, useApp } from '../app/store.ts';
import { friendly, type FriendlyError } from '../net/errors.ts';
import { loadGameModule } from '../games/registry.ts';
import type { GameClientModule } from '../games/types.ts';
import { music, sfx } from '../audio/audio.ts';
import { Lobby } from './Lobby.tsx';
import { ShellMenu, TopBar } from './TopBar.tsx';
import { NoticeCard, ProfileEditor, commitProfileName } from './common.tsx';
import { ConnectionLostScreen, ReconnectedFlash, ReconnectingOverlay } from './Reconnect.tsx';
import { crumbCabinet } from './crumbs.ts';
import { shouldLeaveBeforeResolving, shouldLeaveOnExit } from './roomPath.ts';
import { TournamentBanner } from '../tournament/TournamentBanner.tsx';
import { leaveRoomTo, useTournamentExit } from '../tournament/exit.ts';
import { reportRoomPlace } from '../themes/place.ts';
import { LoadingFlavour } from '../themes/LoadingFlavour.tsx';
import { isChunkLoadError, reloadForNewDeploy } from '../app/chunkReload.ts';

export function RoomScreen() {
  const params = useParams();
  const code = normalizeRoomCode(params.code ?? '');
  const navigate = useNavigate();
  const status = useSessionStore((s) => s.status);
  const roomCode = useSessionStore((s) => s.code);
  const hasRoom = useSessionStore((s) => Boolean(s.room));
  const gameId = useSessionStore((s) => s.gameId);
  const error = useSessionStore((s) => s.error);
  const removed = useSessionStore((s) => s.removed);
  const [resolving, setResolving] = useState(true);
  const [needsProfile, setNeedsProfile] = useState(false);

  // Resolve: existing session → resume from stored seat → prompt to join.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let s = useSessionStore.getState();
      if (s.room && s.code === code) {
        setResolving(false);
        return;
      }
      // Opened another room's link (or went Back to one) while still in a room: leave that one first,
      // whether or not there's a seat to resume here (or the code is even valid).
      if (shouldLeaveBeforeResolving(code, { code: s.code, hasRoom: Boolean(s.room), status: s.status })) {
        await session.leaveRoom();
        if (cancelled) return;
        s = useSessionStore.getState();
      }
      if (!isValidRoomCode(code)) {
        setResolving(false);
        return;
      }
      // Notices (error / removed) belong to the room they happened in, not to this code.
      if (!s.room && (s.error || s.removed) && s.code !== code) session.clearNotices();
      const resumed = await session.resumeRoom(code);
      if (cancelled) return;
      if (!resumed && !useSessionStore.getState().error) setNeedsProfile(true);
      setResolving(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Leaving the room screens leaves the room — browser / Android Back, a link, an error screen's "Back
  // to arcade" — or the open socket keeps a ghost seat (the host never migrates, the lobby stalls on
  // "Waiting for host") and the Room DJ keeps driving the jukebox on the floor. Deferred a tick so
  // StrictMode's dev remount settles before deciding; the explicit Leave buttons have already left by
  // then, and a switch to another room's screen is handled by the resolve effect above.
  useEffect(
    () => () => {
      setTimeout(() => {
        const s = useSessionStore.getState();
        if (shouldLeaveOnExit(code, window.location.pathname, { code: s.code, hasRoom: Boolean(s.room), status: s.status })) {
          void session.leaveRoom();
        }
      }, 0);
    },
    [code],
  );

  if (!isValidRoomCode(code)) {
    return <ErrorScreen error={friendly('invalid_code')} onBack={() => navigate('/')} />;
  }
  // Only show notices that belong to this room code (the effect above clears foreign ones).
  const noticeHere = roomCode === code;
  if (removed && noticeHere) {
    return (
      <ErrorScreen
        error={{
          kind: 'kicked',
          title: removed.reason === 'room_closed' ? 'Room closed' : 'Removed from room',
          message: removed.message,
          retryable: false,
        }}
        onBack={() => {
          session.clearNotices();
          navigate('/');
        }}
      />
    );
  }
  if (hasRoom && roomCode === code && gameId && isGameId(gameId)) {
    // Keyed by code: switching rooms remounts the game view, so no component keeps the previous
    // room's replayed private messages, Phaser scene or local state.
    return <ActiveRoom key={code} gameId={gameId} code={code} />;
  }
  if ((status === 'lost' || error) && noticeHere) {
    const err: FriendlyError = error ?? friendly('reconnect_failed');
    if (err.kind === 'reconnect_failed') {
      return (
        <ConnectionLostScreen
          code={code}
          error={err}
          onBack={() => {
            session.clearNotices();
            navigate('/');
          }}
        />
      );
    }
    return (
      <ErrorScreen
        error={err}
        onBack={() => {
          session.clearNotices();
          // A restarted (usually redeployed) server: a full load also picks up the new client build.
          if (err.kind === 'server_restarted') location.assign('/');
          else navigate('/');
        }}
        onRetry={
          err.retryable
            ? async () => {
                session.clearNotices();
                await session.joinRoom(code);
              }
            : undefined
        }
      />
    );
  }
  if (resolving || status === 'connecting') {
    return <LoadingScreen label={`Connecting to room ${code}…`} kind="connecting" />;
  }
  if (needsProfile) {
    return <JoinPrompt code={code} onCancel={() => navigate('/')} />;
  }
  return <LoadingScreen label="Loading…" />;
}

function ActiveRoom({ gameId, code }: { gameId: GameId; code: string }) {
  const navigate = useNavigate();
  const tournamentExit = useTournamentExit();
  const phase = useRoomSelector((s) => s.phase);
  const [module, setModule] = useState<GameClientModule | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let alive = true;
    loadGameModule(gameId)
      .then((m) => alive && setModule(m))
      .catch((err: unknown) => {
        // The game's chunk is from an older deploy: reload once (the seat is resumed after the reload).
        if (isChunkLoadError(err) && reloadForNewDeploy()) return;
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, [gameId]);

  useEffect(() => {
    music.setMood(module?.musicMood ?? 'arcade');
  }, [module]);

  useEffect(() => {
    if (phase === 'PLAYING') sfx('go');
  }, [phase]);

  // A new screen (lobby → countdown → game → results → lobby) starts at the top instead of
  // inheriting the previous screen's scroll position (e.g. results opening mid-page on phones).
  // Round loops (PLAYING ↔ INTERMISSION) keep the player's position.
  const prevPhase = useRef(phase);
  useEffect(() => {
    const prev = prevPhase.current;
    prevPhase.current = phase;
    if (!phase || prev === phase || !prev) return;
    const roundLoop = (prev === 'PLAYING' && phase === 'INTERMISSION') || (prev === 'INTERMISSION' && phase === 'PLAYING');
    if (!roundLoop) window.scrollTo(0, 0);
  }, [phase]);

  const lobbyPhases = module?.lobbyPhases ?? ['LOBBY'];
  const inLobby = !phase || lobbyPhases.includes(phase);
  // Theme environments calm down in games (presentation only; see themes/place.ts).
  useEffect(() => reportRoomPlace(inLobby ? 'lobby' : 'game'), [inLobby]);
  useEffect(() => () => reportRoomPlace(null), []);
  const immersive = Boolean(module?.immersive) && !inLobby;
  const GameView = module?.GameView;

  return (
    <GameTheme accent={GAME_CATALOG[gameId].accent} className="room" data-part="room" data-immersive={immersive ? 'true' : undefined}>
      {immersive ? <ShellMenu gameId={gameId} code={code} /> : <TopBar gameId={gameId} code={code} />}
      <TournamentBanner compact={immersive} />
      <ReconnectingOverlay gameId={gameId} immersive={immersive} />
      <ReconnectedFlash />
      {loadError ? (
        <ErrorScreen
          error={friendly('unknown', 'This cabinet failed to load. Check your connection and try again.')}
          onRetry={() => location.reload()}
          onBack={() => void leaveRoomTo(navigate, tournamentExit)}
        />
      ) : inLobby ? (
        <Lobby gameId={gameId} module={module} />
      ) : GameView ? (
        <Suspense fallback={<LoadingScreen label="Loading game…" />}>
          <GameView />
        </Suspense>
      ) : (
        <LoadingScreen label="Loading game…" />
      )}
      {phase === 'COUNTDOWN' && !module?.ownCountdown ? <CountdownOverlay /> : null}
    </GameTheme>
  );
}

function JoinPrompt({ code, onCancel }: { code: string; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  // Enabled from the typed name (not only once it's committed on blur: a tap on iOS doesn't blur).
  const canPlay = useApp(selectCanPlay);
  const [lookup, setLookup] = useState<{ gameId?: string; roomName?: string; exists: boolean } | null>(null);
  useEffect(() => {
    session
      .lookup(code)
      .then(setLookup)
      .catch(() => setLookup(null));
  }, [code]);
  const gameId = lookup?.gameId && isGameId(lookup.gameId) ? lookup.gameId : null;
  const game = gameId ? GAME_CATALOG[gameId] : null;
  const cabinet = gameId ? crumbCabinet(gameId) : null;
  const join = async () => {
    if (busy || lookup?.exists === false || !commitProfileName()) return;
    setBusy(true);
    await session.joinRoom(code);
    setBusy(false);
  };
  return (
    <GameTheme
      accent={game?.accent ?? GAME_CATALOG.wheel.accent}
      as="main"
      className="center-screen dc-game-backdrop"
      id="main"
      data-part="join-screen"
    >
      <Panel data-part="join-prompt" brackets glow className="join-prompt" title={game ? `Join ${game.title}` : 'Join room'}>
        <div className="dc-col join-prompt__body">
          <div className="join-prompt__head">
            {game ? (
              <p className="shell-crumb" aria-label="Cabinet">
                {cabinet ? (
                  <>
                    <span className="shell-crumb__cabinet">{cabinet.title}</span>
                    <span className="shell-crumb__sep" aria-hidden>
                      ›
                    </span>
                  </>
                ) : null}
                <span className="shell-crumb__game">{game.title}</span>
              </p>
            ) : null}
            <span className="dc-label">Room code</span>
            <div className="lobby-code__value lobby-code__value--static">
              {code.split('').map((c, i) => (
                <span key={i}>{c}</span>
              ))}
            </div>
            {lookup?.roomName ? <p className="join-prompt__room">{lookup.roomName}</p> : null}
            {lookup && !lookup.exists ? <p className="dc-field__error">No room is using this code right now.</p> : null}
          </div>
          <ProfileEditor compact onSubmit={() => void join()} />
          <div className="dc-row dc-row--wrap">
            <Button variant="ghost" onClick={onCancel} icon="arrow-left">
              Arcade
            </Button>
            <span className="dc-spacer" />
            <Button
              variant="primary"
              size="lg"
              icon="play"
              loading={busy}
              disabled={!canPlay || lookup?.exists === false}
              onClick={join}
            >
              Join game
            </Button>
          </div>
        </div>
      </Panel>
    </GameTheme>
  );
}

export function LoadingScreen({ label, kind = 'loading' }: { label: string; kind?: 'loading' | 'connecting' }) {
  return (
    <main className="center-screen" id="main" data-part="loading-screen">
      <div className="loading-card" data-part="loading-card">
        <LoadingFlavour kind={kind} />
        <Spinner label={label} />
        <p className="dc-display">{label}</p>
      </div>
    </main>
  );
}

const ERROR_ICON: Partial<Record<FriendlyError['kind'], IconName>> = {
  server_unavailable: 'wifi-off',
  server_restarted: 'refresh',
  reconnect_failed: 'wifi-off',
  kicked: 'leave',
  room_locked: 'lock',
  room_full: 'users',
  not_found: 'help',
  invalid_code: 'help',
  match_ended: 'flag',
  rate_limited: 'clock',
};

export function ErrorScreen({
  error,
  onBack,
  onRetry,
}: {
  error: FriendlyError;
  onBack?: () => void;
  onRetry?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const gameId = useSessionStore((s) => s.gameId);
  const game = gameId && isGameId(gameId) ? GAME_CATALOG[gameId] : null;
  const tone =
    error.kind === 'kicked' || error.kind === 'unknown'
      ? 'danger'
      : error.kind === 'not_found' || error.kind === 'invalid_code'
        ? 'info'
        : 'warning';
  return (
    <GameTheme
      accent={game?.accent ?? GAME_CATALOG.wheel.accent}
      as="main"
      className="center-screen dc-game-backdrop"
      id="main"
      data-part="error-screen"
    >
      <NoticeCard
        icon={ERROR_ICON[error.kind] ?? 'warning'}
        tone={tone}
        crumb={game?.title}
        title={error.title}
        role="alert"
        actions={
          <>
            {onRetry ? (
              <Button
                variant="primary"
                size="lg"
                icon="refresh"
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  await onRetry();
                  setBusy(false);
                }}
              >
                Try again
              </Button>
            ) : null}
            <Button variant={onRetry ? 'ghost' : 'primary'} icon="arrow-left" onClick={onBack ?? (() => navigate('/'))}>
              Back to arcade
            </Button>
          </>
        }
      >
        <p className="notice-card__text">{error.message}</p>
      </NoticeCard>
    </GameTheme>
  );
}

export function NotFoundScreen() {
  const navigate = useNavigate();
  return (
    <main className="center-screen dc-game-backdrop" id="main" data-part="not-found-screen">
      <NoticeCard
        icon="help"
        tone="info"
        title="Nothing at this address"
        actions={
          <Button variant="primary" icon="arrow-left" onClick={() => navigate('/')}>
            Back to arcade
          </Button>
        }
      >
        <p className="notice-card__text">That page wandered off the arcade floor.</p>
      </NoticeCard>
    </main>
  );
}

function CountdownOverlay() {
  const endsAt = useRoomSelector((s) => s.phaseEndsAt);
  const remaining = useCountdown(endsAt ?? 0);
  const n = Math.max(1, Math.ceil(remaining / 1000));
  // One beep per displayed second (`remaining` itself ticks every 250 ms).
  const live = remaining > 0;
  useEffect(() => {
    if (live) sfx('countdown');
  }, [n, live]);
  return (
    <div className="countdown-overlay" role="status" aria-live="assertive" aria-label={`Starting in ${n}`}>
      <span key={n} className="countdown-overlay__num">
        {n}
      </span>
      <span className="dc-label">Get ready</span>
    </div>
  );
}
