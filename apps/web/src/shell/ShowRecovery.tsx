/**
 * After a server restart, an event room comes back by itself (OPS-01 C, see net/recovery.ts):
 *
 * - The device holding the room's black box (the presenter's console) waits for the server, then hands
 *   the snapshot back; the room is recreated under the same code and this browser rejoins its seat.
 * - Everyone else in a recoverable room keeps looking for the room and rejoins their own seat (by seat
 *   token) the moment it's back — nobody has to find the link again.
 *
 * The screen stays up through its own join/restore attempts (RoomScreen keeps it while
 * `recoveringCode()` is this room), retries every few seconds, and gives up after a long wait or on an
 * answer that won't change (kicked, a refused snapshot with no room to join).
 */
import { useEffect, useRef, useState } from 'react';
import { GAME_CATALOG, isGameId, type GameId } from '@dascade/shared';
import { Button, GameTheme, Spinner } from '@dascade/ui';
import { session } from '../net/session.ts';
import { serverUrl } from '../net/serverUrl.ts';
import { beginRecovery, endRecovery, giveUpRecovery, isRecoverable, loadBlackBox } from '../net/recovery.ts';
import { NoticeCard } from './common.tsx';

/** Looking for the room this long before giving up (a deploy takes a few minutes on the free plan). */
const GIVE_UP_MS = 15 * 60_000;
const POLL_MS = 3000;
/** Answers a retry won't change. */
const FINAL_KINDS: ReadonlySet<string> = new Set(['kicked', 'room_full', 'room_locked', 'match_ended', 'invalid_code']);

/** Whether this device should try to bring the room back instead of showing an error. */
export function canRecover(code: string): boolean {
  // Guests only wait for a room they still have a seat in (leaving on purpose forgets the seat).
  return Boolean(loadBlackBox(code)) || (isRecoverable(code) && session.hasSeat(code));
}

type Phase = 'waiting' | 'restoring';

export function ShowRecovery({ code, onGiveUp, onFailed }: { code: string; onGiveUp: () => void; onFailed: (message: string) => void }) {
  const holder = Boolean(loadBlackBox(code));
  const [phase, setPhase] = useState<Phase>('waiting');
  const stopped = useRef(false);
  const failedRef = useRef(onFailed);
  failedRef.current = onFailed;

  useEffect(() => {
    stopped.current = false;
    const startedAt = beginRecovery(code);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fail = (message: string) => {
      if (stopped.current) return;
      stopped.current = true;
      giveUpRecovery(code);
      failedRef.current(message);
    };
    const again = () => {
      if (stopped.current) return;
      if (Date.now() - startedAt > GIVE_UP_MS) return fail('The room didn’t come back. Start a new room and load your show file.');
      timer = setTimeout(() => void attempt(), POLL_MS);
    };
    const join = async (): Promise<void> => {
      const res = await session.joinRoom(code);
      if (stopped.current || res.ok) return;
      if (FINAL_KINDS.has(res.error.kind)) return fail(res.error.message);
      again();
    };
    const attempt = async (): Promise<void> => {
      if (stopped.current) return;
      try {
        const health = await fetch(`${serverUrl()}/api/health`, { cache: 'no-store' });
        if (!health.ok) return again();
        const info = await session.lookup(code);
        if (stopped.current) return;
        // Back (restored by the console, or it never went away): take our own seat again.
        if (info.exists) return await join();
        const box = loadBlackBox(code);
        if (!box) return again(); // the presenter's console brings it back
        setPhase('restoring');
        const gameId: GameId = isGameId(box.gameId) ? box.gameId : 'showdown';
        const res = await session.restoreRoom(gameId, code, box.blob);
        if (stopped.current || res.ok) return;
        setPhase('waiting');
        if (res.error.kind === 'restore_failed') {
          // Someone else may have brought it back first: join that room if it's there.
          const again2 = await session.lookup(code).catch(() => null);
          if (stopped.current) return;
          if (again2?.exists) return await join();
          return fail(res.error.message);
        }
        again();
      } catch {
        again();
      }
    };
    void attempt();
    return () => {
      stopped.current = true;
      if (timer) clearTimeout(timer);
      endRecovery(code);
    };
  }, [code]);

  const game = GAME_CATALOG.showdown;
  const leave = () => {
    stopped.current = true;
    giveUpRecovery(code);
    onGiveUp();
  };
  return (
    <GameTheme accent={game.accent} as="main" className="center-screen dc-game-backdrop" id="main">
      <NoticeCard
        icon="refresh"
        tone="info"
        title={holder ? 'Bringing your show back…' : 'Reconnecting to the show…'}
        role="status"
        actions={
          <Button variant="ghost" icon="arrow-left" onClick={leave}>
            Stop waiting
          </Button>
        }
      >
        <p className="notice-card__text" aria-live="polite">
          {holder
            ? phase === 'restoring'
              ? 'The server is back — restoring the board, the clock and everyone’s seats.'
              : 'The game server restarted. This console has the show’s black box: as soon as the server answers, the show comes back under the same code, exactly where it was.'
            : 'The game server restarted. The presenter is bringing the show back — you’ll be put back in your seat automatically.'}
        </p>
        <p className="notice-card__text notice-card__text--muted">
          Room <span className="notice-card__code">{code}</span> <Spinner label="Waiting" />
        </p>
      </NoticeCard>
    </GameTheme>
  );
}
