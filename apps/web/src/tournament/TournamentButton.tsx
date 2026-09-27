/**
 * Entry point into the Tournament Center for a tournament-capable game (links to
 * `/tournaments?game=<id>`). Renders nothing for other games, and nothing inside a room that is
 * already a tournament match. Used from a room's lobby it leaves that room first — after a
 * confirmation when other players are in the room with you.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { GAME_CATALOG, type GameId } from '@dascade/shared';
import { Button, Modal, type ButtonProps } from '@dascade/ui';
import { useRoomSelector } from '../net/hooks.ts';
import { session, useSessionStore } from '../net/session.ts';
import { sfx } from '../audio/audio.ts';

export function tournamentPath(gameId: GameId): string {
  return `/tournaments?game=${encodeURIComponent(gameId)}`;
}

export function TournamentButton({
  gameId,
  variant = 'ghost',
  size = 'sm',
  label = 'Tournaments',
  className,
}: {
  gameId: GameId;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  label?: string;
  className?: string;
}) {
  const navigate = useNavigate();
  const inTournamentMatch = useRoomSelector((s) => Boolean(s.tournamentJson));
  const playerId = useSessionStore((s) => s.playerId);
  const hostId = useRoomSelector((s) => s.hostId);
  // Other people currently in this room (they stay behind if you leave for the Tournament Center).
  const others = useRoomSelector((s) => Object.values(s.players ?? {}).filter((p) => p.id !== playerId && p.connected).length) ?? 0;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!GAME_CATALOG[gameId]?.tournament || inTournamentMatch) return null;
  const go = async () => {
    setBusy(true);
    // The Tournament Center is another place on the floor: leave a casual room on the way out.
    if (session.room) await session.leaveRoom();
    setBusy(false);
    setConfirming(false);
    navigate(tournamentPath(gameId));
  };
  const isHost = Boolean(playerId && hostId === playerId);
  return (
    <>
      <Button
        variant={variant}
        size={size}
        icon="trophy"
        className={className}
        aria-label={`${label}: run or join a ${GAME_CATALOG[gameId].title} tournament`}
        onClick={() => {
          sfx('click');
          if (session.room && others > 0) setConfirming(true);
          else void go();
        }}
      >
        {label}
      </Button>
      {confirming ? (
        <Modal
          open
          onClose={() => setConfirming(false)}
          title="Leave this room?"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Stay here
              </Button>
              <Button variant="primary" icon="trophy" loading={busy} onClick={() => void go()}>
                Go to Tournament Center
              </Button>
            </>
          }
        >
          <p>
            The Tournament Center is a separate place on the floor: going there leaves this room.{' '}
            <span className="dc-num">{others}</span> other {others === 1 ? 'player stays' : 'players stay'} behind
            {isHost ? ' and the host role passes to one of them' : ''}.
          </p>
        </Modal>
      ) : null}
    </>
  );
}
