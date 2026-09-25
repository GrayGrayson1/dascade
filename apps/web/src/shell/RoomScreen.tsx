/**
 * /room/:code — resolves (or resumes) the room session, then renders the shared
 * Lobby or the game's GameView based on phase. Handles every connection /
 * error / removal state with a friendly screen.
 */
import { Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { GAME_CATALOG, isGameId, isValidRoomCode, normalizeRoomCode, type GameId } from '@dascade/shared';
import { Button, EmptyState, GameTheme, Panel, Spinner } from '@dascade/ui';
import { session, useSessionStore } from '../net/session.ts';
import { useCountdown, useRoomSelector } from '../net/hooks.ts';
import { useApp } from '../app/store.ts';
import { friendly, type FriendlyError } from '../net/errors.ts';
import { loadGameModule } from '../games/registry.ts';
import type { GameClientModule } from '../games/types.ts';
import { music, sfx } from '../audio/audio.ts';
import { Lobby } from './Lobby.tsx';
import { ShellMenu, TopBar } from './TopBar.tsx';
import { ProfileEditor } from './common.tsx';

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
      if (!isValidRoomCode(code)) {
        setResolving(false);
        return;
      }
      const s = useSessionStore.getState();
      if (s.room && s.code === code) {
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

  if (!isValidRoomCode(code)) {
    return <ErrorScreen error={friendly('invalid_code')} onBack={() => navigate('/')} />;
  }
  // Only show notices that belong to this room code (the effect above clears foreign ones).
  const noticeHere = roomCode === code;
  if (removed && noticeHere) {
    return (
      <ErrorScreen
        error={{ kind: 'kicked', title: removed.reason === 'room_closed' ? 'Room closed' : 'Removed from room', message: removed.message, retryable: false }}
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
    return (
      <ErrorScreen
        error={err}
        onBack={() => {
          session.clearNotices();
          navigate('/');
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
    return <LoadingScreen label={`Connecting to room ${code}…`} />;
  }
  if (needsProfile) {
    return <JoinPrompt code={code} onCancel={() => navigate('/')} />;
  }
  return <LoadingScreen label="Loading…" />;
}

function ActiveRoom({ gameId, code }: { gameId: GameId; code: string }) {
  const phase = useRoomSelector((s) => s.phase);
  const status = useSessionStore((s) => s.status);
  const [module, setModule] = useState<GameClientModule | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let alive = true;
    loadGameModule(gameId)
      .then((m) => alive && setModule(m))
      .catch(() => alive && setLoadError(true));
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
  const immersive = Boolean(module?.immersive) && !inLobby;
  const GameView = module?.GameView;

  return (
    <GameTheme accent={GAME_CATALOG[gameId].accent} className="room" data-immersive={immersive ? 'true' : undefined}>
      {immersive ? <ShellMenu gameId={gameId} code={code} /> : <TopBar gameId={gameId} code={code} />}
      {status === 'reconnecting' ? (
        <div className="conn-banner" role="alert">
          <Spinner label="Reconnecting" /> Connection lost — reconnecting you to your seat…
        </div>
      ) : null}
      {loadError ? (
        <ErrorScreen error={friendly('unknown', 'This cabinet failed to load. Check your connection and try again.')} onRetry={() => location.reload()} />
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
  const profileConfirmed = useApp((s) => s.profileConfirmed);
  const [lookup, setLookup] = useState<{ gameId?: string; roomName?: string; exists: boolean } | null>(null);
  useEffect(() => {
    session
      .lookup(code)
      .then(setLookup)
      .catch(() => setLookup(null));
  }, [code]);
  const game = lookup?.gameId && isGameId(lookup.gameId) ? GAME_CATALOG[lookup.gameId] : null;
  const join = async () => {
    setBusy(true);
    await session.joinRoom(code);
    setBusy(false);
  };
  return (
    <GameTheme accent={game?.accent ?? GAME_CATALOG.wheel.accent} as="main" className="center-screen dc-game-backdrop" id="main">
      <Panel brackets glow className="join-prompt" title={game ? `Join ${game.title}` : 'Join room'}>
        <div className="dc-col" style={{ gap: 18 }}>
          <div>
            <span className="dc-label">Room code</span>
            <div className="lobby-code__value lobby-code__value--static">
              {code.split('').map((c, i) => (
                <span key={i}>{c}</span>
              ))}
            </div>
            {lookup?.roomName ? <p className="dc-muted">{lookup.roomName}</p> : null}
            {lookup && !lookup.exists ? <p className="dc-field__error">No room is using this code right now.</p> : null}
          </div>
          <ProfileEditor compact onSubmit={() => profileConfirmed && void join()} />
          <div className="dc-row dc-row--wrap">
            <Button variant="ghost" onClick={onCancel} icon="arrow-left">
              Arcade
            </Button>
            <span className="dc-spacer" />
            <Button variant="primary" size="lg" icon="play" loading={busy} disabled={!profileConfirmed || lookup?.exists === false} onClick={join}>
              Join game
            </Button>
          </div>
        </div>
      </Panel>
    </GameTheme>
  );
}

export function LoadingScreen({ label }: { label: string }) {
  return (
    <main className="center-screen" id="main">
      <div className="loading-card">
        <Spinner label={label} />
        <p className="dc-display">{label}</p>
      </div>
    </main>
  );
}

export function ErrorScreen({ error, onBack, onRetry }: { error: FriendlyError; onBack?: () => void; onRetry?: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  return (
    <main className="center-screen" id="main">
      <Panel brackets className="error-card" role="alert">
        <EmptyState icon={error.kind === 'server_unavailable' ? 'wifi-off' : error.kind === 'kicked' ? 'leave' : 'warning'} title={error.title}>
          {error.message}
        </EmptyState>
        <div className="dc-row dc-row--wrap" style={{ justifyContent: 'center' }}>
          <Button variant="ghost" icon="arrow-left" onClick={onBack ?? (() => navigate('/'))}>
            Back to arcade
          </Button>
          {onRetry ? (
            <Button
              variant="primary"
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
        </div>
      </Panel>
    </main>
  );
}

export function NotFoundScreen() {
  const navigate = useNavigate();
  return (
    <main className="center-screen" id="main">
      <Panel brackets className="error-card">
        <EmptyState icon="help" title="Nothing at this address">
          That page wandered off the arcade floor.
        </EmptyState>
        <Button variant="primary" icon="arrow-left" onClick={() => navigate('/')}>
          Back to arcade
        </Button>
      </Panel>
    </main>
  );
}

function CountdownOverlay() {
  const endsAt = useRoomSelector((s) => s.phaseEndsAt);
  const remaining = useCountdown(endsAt ?? 0);
  const n = Math.max(1, Math.ceil(remaining / 1000));
  useEffect(() => {
    if (remaining > 0) sfx('countdown');
  }, [n, remaining]);
  return (
    <div className="countdown-overlay" role="status" aria-live="assertive" aria-label={`Starting in ${n}`}>
      <span key={n} className="countdown-overlay__num">
        {n}
      </span>
      <span className="dc-label">Get ready</span>
    </div>
  );
}
