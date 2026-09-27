/** Room-hopping actions: play your match (with its ticket), spectate a match, return to the kiosk. */
import type { NavigateFunction } from 'react-router';
import type { TournamentActiveMatch } from '@dascade/shared';
import { session } from '../net/session.ts';
import { useApp } from '../app/store.ts';
import { sfx } from '../audio/audio.ts';

export async function playMatch(active: TournamentActiveMatch, kioskCode: string, navigate: NavigateFunction): Promise<void> {
  sfx('start');
  const res = await session.joinRoom(active.roomCode, { ticket: active.ticket });
  if (res.ok) {
    navigate(`/room/${active.roomCode}`);
    return;
  }
  useApp.getState().toast('error', `${res.error.title}. ${res.error.message}`);
  // Stay on the kiosk rather than stranding the player on an error screen.
  const back = await session.joinRoom(kioskCode);
  if (!back.ok) navigate(`/room/${kioskCode}`);
}

export async function spectateMatch(roomCode: string, kioskCode: string, navigate: NavigateFunction): Promise<void> {
  sfx('click');
  const res = await session.joinRoom(roomCode, { spectator: true });
  if (res.ok) {
    navigate(`/room/${roomCode}`);
    return;
  }
  useApp.getState().toast('error', `${res.error.title}. ${res.error.message}`);
  const back = await session.joinRoom(kioskCode);
  if (!back.ok) navigate(`/room/${kioskCode}`);
}

export async function backToTournament(tournamentCode: string, navigate: NavigateFunction): Promise<void> {
  sfx('back');
  const res = await session.joinRoom(tournamentCode);
  navigate(`/room/${tournamentCode}`);
  if (!res.ok) useApp.getState().toast('error', `${res.error.title}. ${res.error.message}`);
}

export function inviteLink(code: string): string {
  return `${location.origin}/r/${code}`;
}

export async function shareInvite(code: string, name: string): Promise<void> {
  const url = inviteLink(code);
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
  if (typeof nav.share === 'function' && matchMedia('(pointer: coarse)').matches) {
    try {
      await nav.share({ title: name, text: `Join “${name}” on DASCADE — code ${code}`, url });
      return;
    } catch {
      /* cancelled or unsupported: fall through to copy */
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    sfx('pop');
    useApp.getState().toast('success', `Invite link copied — code ${code}`);
  } catch {
    useApp.getState().toast('info', `Tournament code: ${code}`);
  }
}
