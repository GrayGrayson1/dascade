/**
 * Entry point into the Tournament Center for a tournament-capable game (links to
 * `/tournaments?game=<id>`). Renders nothing for other games, and nothing inside a room that is
 * already a tournament match. Used from a room's lobby it leaves that room first.
 */
import { useNavigate } from 'react-router';
import { GAME_CATALOG, type GameId } from '@dascade/shared';
import { Button, type ButtonProps } from '@dascade/ui';
import { useRoomSelector } from '../net/hooks.ts';
import { session } from '../net/session.ts';
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
  if (!GAME_CATALOG[gameId]?.tournament || inTournamentMatch) return null;
  return (
    <Button
      variant={variant}
      size={size}
      icon="trophy"
      className={className}
      aria-label={`${label}: run or join a ${GAME_CATALOG[gameId].title} tournament`}
      onClick={async () => {
        sfx('click');
        // The Tournament Center is another place on the floor: leave a casual room on the way out.
        if (session.room) await session.leaveRoom();
        navigate(tournamentPath(gameId));
      }}
    >
      {label}
    </Button>
  );
}
