/**
 * In-game Tournament Center strip. Renders nothing unless the room is a tournament match
 * (`state.tournamentJson`): "Tournament · <name> · <round> · Game n of N · series score", the series
 * status (waiting / intermission countdown / decided) and "Back to tournament" once the match is
 * over (spectators may go back any time). Placed once in the shared RoomScreen.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { SYS, formatPoints, type RemovedPayload, type TournamentMatchInfo } from '@dascade/shared';
import { gameLabel, parseMatchInfo } from './matchInfo.ts';
import { Button, PixelIcon, cx } from '@dascade/ui';
import { useCountdown, useRoomMessage, useRoomSelector } from '../net/hooks.ts';
import { useSessionStore } from '../net/session.ts';
import { useApp } from '../app/store.ts';
import { backToTournament } from './actions.ts';
import './banner.css';

export function TournamentBanner({ compact = false }: { compact?: boolean }) {
  const json = useRoomSelector((s) => s.tournamentJson);
  const info = useMemo(() => parseMatchInfo(json), [json]);
  if (!info) return null;
  return <TournamentBannerView info={info} compact={compact} />;
}

export function TournamentBannerView({ info, compact }: { info: TournamentMatchInfo; compact: boolean }) {
  const navigate = useNavigate();
  const playerId = useSessionStore((s) => s.playerId);
  const [busy, setBusy] = useState(false);
  const nextIn = useCountdown(info.seriesStatus === 'intermission' ? (info.nextGameAt ?? 0) : 0);
  const [a, b] = info.participants;
  const isParticipant = info.participants.some((p) => p.playerId && p.playerId === playerId);
  const over = info.seriesStatus === 'decided' || info.seriesStatus === 'void';
  const winner = info.result?.winnerId ? info.participants.find((p) => p.participantId === info.result?.winnerId) : null;

  let status: string | null = null;
  if (info.seriesStatus === 'waiting') {
    const missing = info.participants.filter((p) => !p.playerId);
    status = missing.length === 1 ? `Waiting for ${missing[0]!.name} to join` : 'Waiting for both players';
  } else if (info.seriesStatus === 'intermission') {
    // Only games with sides (chess colours, first shot, first serve…) swap them between games.
    const sided = info.participants.some((p) => p.side);
    status = nextIn > 0 ? `Next game in ${Math.ceil(nextIn / 1000)}s${sided ? ' · sides swap' : ''}` : 'Next game starting…';
  } else if (info.seriesStatus === 'decided')
    status = winner
      ? `${winner.name} wins the match${info.result?.note ? ` · ${info.result.note}` : ''}`
      : `Drawn match${info.result?.note ? ` · ${info.result.note}` : ''}`;
  else if (info.seriesStatus === 'void') status = 'Match cancelled by the tournament';

  const back = async () => {
    setBusy(true);
    await backToTournament(info.tournamentCode, navigate);
    setBusy(false);
  };

  // The tournament closed this match room (result decided elsewhere: override, forfeit, no-show,
  // relaunch): take everyone straight back to the kiosk instead of a dead-end "room closed" screen.
  useRoomMessage<RemovedPayload>(SYS.removed, (p) => {
    if (p?.reason !== 'room_closed') return;
    useApp.getState().toast('info', `Back to ${info.tournamentName}…`);
    void backToTournament(info.tournamentCode, navigate);
  });

  const ref = useRef<HTMLElement>(null);
  useReserveTopSpace(ref, compact);

  return (
    <aside
      ref={ref}
      className={cx('tb', compact && 'tb--compact')}
      data-part="tournament-banner"
      data-over={over || undefined}
      aria-label="Tournament match"
    >
      <span className="tb__tag">
        <PixelIcon name="trophy" /> <span className="tb__tag-text">Tournament</span>
      </span>
      <span className="tb__what">
        <b className="tb__name">{info.tournamentName}</b>
        <span className="tb__sep" aria-hidden>
          ·
        </span>
        <span>{info.roundLabel}</span>
        <span className="tb__sep" aria-hidden>
          ·
        </span>
        <span>{gameLabel(info)}</span>
      </span>
      {a && b && info.bestOf > 1 ? (
        <span
          className="tb__score"
          aria-label={`Series score: ${a.name} ${formatPoints(info.seriesScore[a.participantId] ?? 0)}, ${b.name} ${formatPoints(info.seriesScore[b.participantId] ?? 0)}`}
        >
          <span className="tb__player" data-side={a.side}>
            {a.name}
          </span>
          <b className="dc-num">{formatPoints(info.seriesScore[a.participantId] ?? 0)}</b>
          <span aria-hidden>–</span>
          <b className="dc-num">{formatPoints(info.seriesScore[b.participantId] ?? 0)}</b>
          <span className="tb__player" data-side={b.side}>
            {b.name}
          </span>
        </span>
      ) : null}
      {status ? (
        <span className="tb__status" role="status">
          {status}
        </span>
      ) : null}
      {over || !isParticipant ? (
        <Button variant={over ? 'gold' : 'ghost'} size="sm" icon="arrow-left" loading={busy} onClick={back} className="tb__back">
          {compact ? 'Bracket' : 'Back to tournament'}
        </Button>
      ) : null}
    </aside>
  );
}

/**
 * The compact strip floats over immersive games (putt, paddle, snake, memory…), whose headers sit at
 * the top-left under it. Reserve its height: every immersive layout already keeps clear of the top
 * safe area (`--safe-top`), so extend that inset on the room while the strip is shown — headers, HUDs
 * and the shell menu move down just enough and the strip never covers the back button or the score.
 */
function useReserveTopSpace(ref: React.RefObject<HTMLElement | null>, compact: boolean): void {
  useLayoutEffect(() => {
    const el = ref.current;
    const room = el?.closest<HTMLElement>('.room');
    if (!compact || !el || !room) return;
    const apply = () => room.style.setProperty('--safe-top', `calc(env(safe-area-inset-top, 0px) + ${Math.ceil(el.offsetHeight) + 8}px)`);
    apply();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      room.style.removeProperty('--safe-top');
    };
  }, [ref, compact]);
}
