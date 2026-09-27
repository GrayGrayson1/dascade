/**
 * Reconnection UX shared by every cabinet:
 *   1. <ReconnectingOverlay> — the socket dropped: a prominent RECONNECTING… card over the (inert,
 *      dimmed) stage with how long the seat is held; the top bar / Leave stays reachable.
 *   2. <ReconnectedFlash>    — a short RECONNECTED confirmation once the seat is back.
 *   3. <ConnectionLostScreen> — auto-reconnect gave up: what happened + "Rejoin my seat"
 *      (seat-token rejoin, also automatic when the device comes back online) or "Back to arcade".
 * Honours reduced motion (no pulsing) and visual-effects settings via tokens.
 */
import { useEffect, useRef, useState } from 'react';
import { GAME_CATALOG, RECONNECT_GRACE_SECONDS, isGameId, type GameId } from '@dascade/shared';
import { Button, GameTheme, PixelIcon, ProgressBar } from '@dascade/ui';
import { session, useSessionStore } from '../net/session.ts';
import type { FriendlyError } from '../net/errors.ts';
import { sfx } from '../audio/audio.ts';
import { LeaveButton, NoticeCard } from './common.tsx';
import { crumbCabinet } from './crumbs.ts';

/** Set by a manual rejoin so the next mounted room shows the RECONNECTED confirmation. */
let pendingRejoinFlash = false;

function graceSeconds(gameId: GameId | null): number {
  return (gameId && GAME_CATALOG[gameId]?.reconnectGraceSeconds) || RECONNECT_GRACE_SECONDS;
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

function formatSeconds(s: number): string {
  const n = Math.max(0, Math.round(s));
  return n >= 60 ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` : `${n}s`;
}

// ---------------------------------------------------------------------------
export function ReconnectingOverlay({ gameId, immersive }: { gameId: GameId; immersive: boolean }) {
  const reconnecting = useSessionStore((s) => s.status === 'reconnecting');
  // The room's own window (e.g. tournament matches hold seats longer than the catalog default).
  const roomGrace = useSessionStore((s) => s.graceSeconds);
  const online = useOnline();
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    if (!reconnecting) return;
    startedAt.current = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 1000);
    return () => clearInterval(timer);
  }, [reconnecting]);

  if (!reconnecting) return null;
  const grace = roomGrace ?? graceSeconds(gameId);
  const left = Math.max(0, grace - elapsed);
  return (
    <div className="reconnect-overlay" data-part="reconnect-overlay" data-immersive={immersive ? 'true' : undefined}>
      <section
        className="reconnect-card dc-panel dc-panel--brackets dc-panel--glow"
        data-part="reconnect-card"
        role="alert"
        aria-live="assertive"
        aria-labelledby="reconnect-title"
      >
        <div className="reconnect-card__signal" aria-hidden>
          <PixelIcon name="wifi-off" />
          <span className="reconnect-card__bars">
            <i />
            <i />
            <i />
          </span>
        </div>
        <h2 id="reconnect-title" className="reconnect-card__title">
          Reconnecting…
        </h2>
        <p className="reconnect-card__text">Connection lost — reconnecting you to your seat…</p>
        <p className="reconnect-card__hint">
          {online ? 'No need to refresh. ' : 'Your device looks offline — we’ll keep trying as soon as the network is back. '}
          {left > 0 ? (
            <>
              Your seat is held for <span className="dc-num">{formatSeconds(left)}</span>.
            </>
          ) : (
            'Still trying to reach the arcade — hang tight.'
          )}
        </p>
        <ProgressBar value={left / grace} label="Seat held" className="reconnect-card__meter" />
        <div className="reconnect-card__actions">
          <LeaveButton size="sm" />
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function ReconnectedFlash() {
  const status = useSessionStore((s) => s.status);
  const prev = useRef(status);
  const [shownAt, setShownAt] = useState<number | null>(null);

  // A manual "Rejoin my seat" remounts the room: confirm it here too.
  useEffect(() => {
    if (!pendingRejoinFlash) return;
    pendingRejoinFlash = false;
    setShownAt(Date.now());
  }, []);

  useEffect(() => {
    const was = prev.current;
    prev.current = status;
    if (was === 'reconnecting' && status === 'connected') {
      setShownAt(Date.now());
      sfx('join');
    }
    if (status === 'reconnecting') setShownAt(null);
  }, [status]);

  useEffect(() => {
    if (shownAt === null) return;
    const t = setTimeout(() => setShownAt(null), 2600);
    return () => clearTimeout(t);
  }, [shownAt]);

  if (shownAt === null) return null;
  return (
    <div className="reconnected-flash" role="status" aria-live="polite" key={shownAt}>
      <PixelIcon name="check" className="reconnected-flash__icon" />
      <strong className="reconnected-flash__title">Reconnected!</strong>
      <span className="reconnected-flash__text">You’re back in your seat.</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function ConnectionLostScreen({ code, error, onBack }: { code: string; error: FriendlyError; onBack: () => void }) {
  const gameId = useSessionStore((s) => s.gameId);
  const game = gameId && isGameId(gameId) ? GAME_CATALOG[gameId] : null;
  const cabinet = gameId && isGameId(gameId) ? crumbCabinet(gameId) : null;
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const rejoin = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    sfx('click');
    session.clearNotices();
    pendingRejoinFlash = true;
    const res = await session.joinRoom(code);
    if (!res.ok) pendingRejoinFlash = false;
    busyRef.current = false;
    setBusy(false);
  };

  // Wi-Fi came back while this screen was up: take the seat back without a click.
  const rejoinRef = useRef(rejoin);
  rejoinRef.current = rejoin;
  useEffect(() => {
    const onOnline = () => void rejoinRef.current();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  const where = game ? (cabinet ? `${cabinet.title} › ${game.title}` : game.title) : null;
  return (
    <GameTheme accent={game?.accent ?? GAME_CATALOG.wheel.accent} as="main" className="center-screen dc-game-backdrop" id="main">
      <NoticeCard
        icon="wifi-off"
        tone="warning"
        crumb={where}
        title={error.title}
        role="alert"
        actions={
          <>
            <Button variant="primary" size="lg" icon="refresh" loading={busy} onClick={rejoin}>
              Rejoin my seat
            </Button>
            <Button variant="ghost" icon="arrow-left" onClick={onBack}>
              Back to arcade
            </Button>
          </>
        }
      >
        <p className="notice-card__text">{error.message}</p>
        <p className="notice-card__text notice-card__text--muted">
          Rejoining reclaims your seat in room <span className="notice-card__code">{code}</span>, so you pick up right where you left off.
        </p>
        <p className="notice-card__net" data-online={online ? 'true' : 'false'}>
          <i aria-hidden />
          {online ? 'Your device is online' : 'You’re offline — we’ll rejoin automatically when your connection returns'}
        </p>
      </NoticeCard>
    </GameTheme>
  );
}
