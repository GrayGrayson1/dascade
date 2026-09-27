/**
 * Kiosk plumbing: the parsed tournament view (memoized per state snapshot), the viewer's private
 * `tournament:me`, token storage + automatic re-claim, request/ack round trips and event toasts.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  TOURNAMENT_MSG,
  tournamentViewFromState,
  type TournamentAck,
  type TournamentAdminAction,
  type TournamentEvent,
  type TournamentMe,
  type TournamentPublicState,
  type TournamentView,
} from '@dascade/shared';
import { useLatestMessage, useRoomMessage, useRoomState } from '../../net/hooks.ts';
import { session, useSessionStore } from '../../net/session.ts';
import { useApp } from '../../app/store.ts';
import { sfx } from '../../audio/audio.ts';
import { loadTournamentTokens, saveTournamentTokens } from '../../tournament/api.ts';

export function useTournamentView(): TournamentView | null {
  const state = useRoomState<TournamentPublicState>();
  return useMemo(() => (state && state.gameId === 'tournament' ? tournamentViewFromState(state) : null), [state]);
}

export function useTournamentMe(): TournamentMe | null {
  return useLatestMessage<TournamentMe>(TOURNAMENT_MSG.me) ?? null;
}

// ---------------------------------------------------------------------------
// Requests with acks
// ---------------------------------------------------------------------------
const pending = new Map<string, (ack: TournamentAck) => void>();
let seq = 0;
const TIMEOUT_MS = 8000;

function resolveAck(ack: TournamentAck): void {
  if (!ack.requestId) return;
  const done = pending.get(ack.requestId);
  if (done) {
    pending.delete(ack.requestId);
    done(ack);
  }
}

/** Send a tournament message and wait for its `tournament:ack` (resolves `ok: false` on timeout). */
export function request(type: string, payload: Record<string, unknown> = {}): Promise<TournamentAck> {
  const requestId = `r${Date.now().toString(36)}${(seq++).toString(36)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ requestId, action: type, ok: false, message: 'No answer from the tournament desk — check your connection and try again.' });
    }, TIMEOUT_MS);
    pending.set(requestId, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
    session.send(type, { ...payload, requestId });
  });
}

export function adminRequest(action: TournamentAdminAction): Promise<TournamentAck> {
  return request(TOURNAMENT_MSG.admin, action as unknown as Record<string, unknown>);
}

/** Resolve acks + surface unsolicited failures as toasts. Mount once in the kiosk root. */
export function useAckRouter(): void {
  useRoomMessage<TournamentAck>(TOURNAMENT_MSG.ack, (ack) => {
    if (ack.requestId && pending.has(ack.requestId)) resolveAck(ack);
    else if (!ack.ok && ack.message) useApp.getState().toast('error', ack.message);
  });
}

// ---------------------------------------------------------------------------
// Tokens: store what the server hands us, re-claim on return
// ---------------------------------------------------------------------------
export function useTokenClaims(code: string | null, me: TournamentMe | null): void {
  const attempted = useRef<{ organizer?: string; participant?: string }>({});
  const status = useSessionStore((s) => s.status);

  // Persist tokens as soon as the server sends them.
  useEffect(() => {
    if (!code || !me) return;
    const patch: { organizerToken?: string; participantToken?: string } = {};
    if (me.organizerToken) patch.organizerToken = me.organizerToken;
    if (me.participantToken) patch.participantToken = me.participantToken;
    if (patch.organizerToken || patch.participantToken) saveTournamentTokens(code, patch);
  }, [code, me]);

  // Re-claim the organizer console / participant seat after a refresh or a match.
  useEffect(() => {
    if (!code || !me || status !== 'connected') return;
    const stored = loadTournamentTokens(code);
    if (!stored) return;
    if (stored.organizerToken && !me.isOrganizer && attempted.current.organizer !== stored.organizerToken) {
      attempted.current.organizer = stored.organizerToken;
      void request(TOURNAMENT_MSG.claimOrganizer, { token: stored.organizerToken }).then((ack) => {
        if (!ack.ok && /token|invalid|not the organizer/i.test(ack.message)) saveTournamentTokens(code, { organizerToken: undefined });
      });
    }
    if (stored.participantToken && !me.participantId && attempted.current.participant !== stored.participantToken) {
      attempted.current.participant = stored.participantToken;
      void request(TOURNAMENT_MSG.claim, { token: stored.participantToken }).then((ack) => {
        if (!ack.ok && /token|invalid|unknown/i.test(ack.message)) saveTournamentTokens(code, { participantToken: undefined });
      });
    }
  }, [code, me, status]);
}

// ---------------------------------------------------------------------------
// Events → toasts & sounds (state stays the source of truth)
// ---------------------------------------------------------------------------
export function useTournamentEvents(me: TournamentMe | null): void {
  const meRef = useRef(me);
  meRef.current = me;
  const onEvent = useCallback((e: TournamentEvent) => {
    const mine = Boolean(e.participantId && e.participantId === meRef.current?.participantId);
    const toast = useApp.getState().toast;
    switch (e.kind) {
      case 'match_ready':
        if (mine) {
          sfx('ding');
          toast('success', e.text || 'Your match is ready — press Play match.');
        }
        break;
      case 'champion':
        sfx('bigwin');
        toast('success', e.text);
        break;
      case 'round_started':
        sfx('start');
        toast('info', e.text);
        break;
      case 'paused':
      case 'resumed':
      case 'override':
      case 'disqualified':
      case 'status':
        toast('info', e.text);
        break;
      case 'match_complete':
        if (mine) sfx('pop');
        break;
      case 'registered':
      case 'withdrawn':
        sfx('pop');
        break;
      default:
        break;
    }
  }, []);
  useRoomMessage<TournamentEvent>(TOURNAMENT_MSG.event, onEvent);
}
