/**
 * "Back to your room": after a tab closed mid-game, the floor offers the newest room this browser
 * still holds a seat in, if that room is still open (resumeSeat.ts). Rejoin opens /room/<code>,
 * where the session takes the seat back; the chip can be dismissed for that seat.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { GAME_CATALOG, type RoomLookup } from '@dascade/shared';
import { Button, IconButton, PixelIcon } from '@dascade/ui';
import { sfx } from '../audio/audio.ts';
import { serverUrl } from '../net/serverUrl.ts';
import { dismissSeat, dismissedSeat, findResumable, isDismissedBy, storedSeats, type ResumableRoom } from './resumeSeat.ts';

async function lookupRoom(code: string, signal: AbortSignal): Promise<RoomLookup | null> {
  try {
    const res = await fetch(`${serverUrl()}/api/rooms/${encodeURIComponent(code)}`, { cache: 'no-store', signal });
    return res.ok ? ((await res.json()) as RoomLookup) : null;
  } catch {
    return null;
  }
}

/** This browser's seats and the dismissed one; null when storage is blocked (private mode, sandboxed frame). */
function readStoredSeats(): { seats: ReturnType<typeof storedSeats>; dismissed: ReturnType<typeof dismissedSeat> } | null {
  try {
    return { seats: storedSeats(localStorage), dismissed: dismissedSeat(localStorage) };
  } catch {
    return null;
  }
}

export function ResumeChip() {
  const navigate = useNavigate();
  const [room, setRoom] = useState<ResumableRoom | null>(null);
  useEffect(() => {
    const stored = readStoredSeats();
    if (!stored || stored.seats.length === 0) return;
    const ctrl = new AbortController();
    void findResumable(stored.seats, (code) => lookupRoom(code, ctrl.signal), isDismissedBy(stored.dismissed)).then((found) => {
      if (!ctrl.signal.aborted) setRoom(found);
    });
    return () => ctrl.abort();
  }, []);

  if (!room) return null;
  const title = GAME_CATALOG[room.gameId].title;
  return (
    <aside className="af-resume" aria-label="Back to your room" data-part="floor-resume">
      <PixelIcon name="arrow-left" className="af-resume__glyph" />
      <p className="af-resume__text">
        <span className="af-resume__title">Back to your room?</span>
        <span className="af-resume__room">
          {title} · <span className="dc-num">{room.code}</span>
          {room.roomName ? <span className="af-resume__name"> · {room.roomName}</span> : null}
        </span>
      </p>
      <Button
        variant="primary"
        size="sm"
        icon="play"
        className="af-resume__go"
        aria-label={`Rejoin ${title} room ${room.code}`}
        onClick={() => {
          sfx('click');
          navigate(`/room/${room.code}`);
        }}
      >
        Rejoin
      </Button>
      <IconButton
        icon="close"
        size="sm"
        label="Dismiss"
        onClick={() => {
          try {
            dismissSeat(localStorage, room);
          } catch {
            /* storage blocked */
          }
          setRoom(null);
        }}
      />
    </aside>
  );
}
