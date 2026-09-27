/**
 * "You" card: what this viewer can do right now — register, check in, play their match, or follow
 * along — with plain-language status (next opponent, byes, eliminated, champion).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { TOURNAMENT_MSG, formatPoints, type TournamentMe, type TournamentView } from '@dascade/shared';
import { Button, PixelIcon, type IconName } from '@dascade/ui';
import { useCountdown } from '../../net/hooks.ts';
import { useApp } from '../../app/store.ts';
import { sfx } from '../../audio/audio.ts';
import { indexParticipants, nextMatchFor, opponentLabel } from '../../tournament/adapt.ts';
import { playMatch } from '../../tournament/actions.ts';
import type { ConfirmSpec } from './ConfirmDialog.tsx';
import { mmss, ordinal } from './text.ts';
import { request } from './useKiosk.ts';

type Tone = 'go' | 'wait' | 'info' | 'done' | 'win' | 'off';

export function YouPanel({
  view,
  me,
  onConfirm,
  onSelectMatch,
}: {
  view: TournamentView;
  me: TournamentMe | null;
  onConfirm: (s: ConfirmSpec) => void;
  onSelectMatch: (id: string) => void;
}) {
  const navigate = useNavigate();
  const profileName = useApp((s) => s.profile.name);
  const [busy, setBusy] = useState(false);
  const checkInLeft = useCountdown(view.status === 'CHECK_IN' ? view.checkInEndsAt : 0);
  const people = indexParticipants(view);
  const mine = me?.participantId ? people.get(me.participantId) : undefined;
  const active = me?.activeMatch ?? null;
  const activeView = active ? view.matches.find((m) => m.id === active.matchId) : undefined;
  const noShowLeft = useCountdown(activeView?.noShowAt || 0);
  const entries = view.participants.filter((p) => p.status !== 'withdrawn' && p.status !== 'disqualified' && p.status !== 'no_show').length;
  const full = entries >= view.config.maxField;

  const register = async () => {
    setBusy(true);
    sfx('coin');
    const ack = await request(TOURNAMENT_MSG.register, { name: profileName });
    setBusy(false);
    if (ack.ok) useApp.getState().toast('success', 'You’re registered!');
    else useApp.getState().toast('error', ack.message);
  };
  const checkIn = async () => {
    setBusy(true);
    sfx('ready');
    const ack = await request(TOURNAMENT_MSG.checkIn, {});
    setBusy(false);
    if (!ack.ok) useApp.getState().toast('error', ack.message);
  };
  const withdraw = () =>
    onConfirm({
      title: 'Withdraw from the tournament?',
      body:
        view.status === 'IN_PROGRESS' ? (
          <p>Your remaining matches are forfeited and your opponents advance. You can keep watching.</p>
        ) : (
          <p>You leave the field. You can register again while registration is open.</p>
        ),
      confirmLabel: 'Withdraw',
      danger: true,
      run: () => request(TOURNAMENT_MSG.withdraw, { confirm: true }),
    });

  let tone: Tone = 'info';
  let icon: IconName = 'user';
  let title: string;
  let body: React.ReactNode = null;
  let actions: React.ReactNode = null;

  const registrationOpen = view.status === 'REGISTRATION' || view.status === 'CHECK_IN';

  if (!mine) {
    if (registrationOpen && !full) {
      tone = 'go';
      icon = 'plus';
      title = 'Join the field';
      body = (
        <>
          Register as <b>{profileName || 'Player'}</b>. <span className="dc-num">{entries}</span>/
          <span className="dc-num">{view.config.maxField}</span> places taken
          {view.status === 'CHECK_IN' ? ' — late entries are checked in automatically.' : '.'}
        </>
      );
      actions = (
        <Button variant="gold" size="lg" icon="plus" loading={busy} onClick={register}>
          Register
        </Button>
      );
    } else if (registrationOpen && full) {
      tone = 'off';
      icon = 'lock';
      title = 'The field is full';
      body = 'You can still watch every match from the bracket.';
    } else if (view.status === 'DRAFT' || view.status === 'READY') {
      tone = 'wait';
      icon = 'clock';
      title = view.status === 'DRAFT' ? 'Registration opens soon' : 'Registration is closed';
      body =
        view.status === 'DRAFT'
          ? 'The organizer is setting things up. Stay here — the Register button appears when entries open.'
          : 'The field is set. The tournament starts shortly.';
    } else if (view.status === 'IN_PROGRESS' && me?.isOrganizer) {
      tone = 'info';
      icon = 'crown';
      title = 'You’re running the show';
      body = 'Results advance on their own. Open any match to watch it, or step in from the Organizer tab if one needs you.';
    } else if (view.status === 'IN_PROGRESS') {
      tone = 'info';
      icon = 'eye';
      title = 'You’re spectating';
      body = 'Open any live match from the bracket to watch it.';
    } else {
      tone = 'done';
      icon = 'flag';
      title = view.status === 'CANCELLED' ? 'This tournament was cancelled' : 'Tournament complete';
      body = view.status === 'CANCELLED' ? null : 'Final bracket and standings below.';
    }
  } else {
    const next = nextMatchFor(view, mine.id);
    const byeNow =
      view.config.format === 'swiss' || view.config.format === 'round_robin'
        ? view.matches.find((m) => m.round === view.currentRound && (m.aId === mine.id || m.bId === mine.id) && (!m.aId || !m.bId))
        : undefined;
    switch (mine.status) {
      case 'registered':
        if (view.status === 'CHECK_IN') {
          tone = 'go';
          icon = 'check';
          title = 'Check in now';
          body = (
            <>
              Confirm you’re here
              {view.checkInEndsAt ? (
                <>
                  {' '}
                  — check-in closes in <b className="dc-num">{mmss(checkInLeft)}</b>
                </>
              ) : null}
              . Players who don’t check in are left out of the draw.
            </>
          );
          actions = (
            <Button variant="gold" size="lg" icon="check" loading={busy} onClick={checkIn}>
              Check in
            </Button>
          );
        } else {
          tone = 'wait';
          icon = 'check';
          title = 'You’re registered';
          body = view.config.checkIn ? 'Come back when check-in opens — it’s needed to be drawn.' : 'Waiting for the organizer to start.';
        }
        break;
      case 'checked_in':
        tone = 'wait';
        icon = 'check';
        title = 'Checked in — you’re in the draw';
        body = 'Waiting for the organizer to start.';
        break;
      case 'active':
        if (active) {
          tone = 'go';
          icon = 'play';
          title = `Your match is ready: vs ${active.opponentName}`;
          body = (
            <>
              {active.label}
              {active.side ? <> · you move {active.side === 'first' ? 'first' : 'second'}</> : null}
              {activeView && activeView.bestOf > 1 && activeView.gameNumber > 0 ? (
                <>
                  {' '}
                  · series <b className="dc-num">{formatPoints(activeView.aId === mine.id ? activeView.aPoints : activeView.bPoints)}</b>–
                  <b className="dc-num">{formatPoints(activeView.aId === mine.id ? activeView.bPoints : activeView.aPoints)}</b>
                </>
              ) : null}
              {activeView && activeView.noShowAt > 0 ? (
                <span className="tk-you__warn">
                  {' '}
                  · join within <b className="dc-num">{mmss(noShowLeft)}</b> or it’s a forfeit
                </span>
              ) : null}
            </>
          );
          actions = (
            <Button
              variant="gold"
              size="lg"
              icon="play"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                await playMatch(active, view.code, navigate);
                setBusy(false);
              }}
            >
              Play match
            </Button>
          );
        } else if (next) {
          tone = 'wait';
          icon = 'clock';
          title = `Next: ${next.roundLabel}`;
          body = (
            <>
              vs <b>{opponentLabel(next, mine.id, people)}</b>
              {next.status === 'WAITING' ? ' — waiting for that match to finish.' : '.'}{' '}
              <button type="button" className="tk-link" onClick={() => onSelectMatch(next.id)}>
                Match details
              </button>
            </>
          );
        } else if (byeNow) {
          tone = 'wait';
          icon = 'star';
          title = `Bye in ${byeNow.roundLabel || 'this round'}`;
          body =
            view.config.format === 'swiss'
              ? `You sit this round out and score a point (${formatPoints(mine.points)} so far). Next pairings appear when the round finishes.`
              : 'You sit this round out. Your next match appears here when it is ready.';
        } else {
          tone = 'wait';
          icon = 'clock';
          title = view.paused ? 'The organizer paused new matches' : 'Waiting for the next round';
          body =
            view.config.format === 'swiss' || view.config.format === 'round_robin'
              ? `You have ${formatPoints(mine.points)} ${mine.points === 1 ? 'point' : 'points'}. Next pairings appear when the round finishes.`
              : 'Your next match appears here as soon as it is ready.';
        }
        break;
      case 'eliminated':
        tone = 'done';
        icon = 'flag';
        title = mine.place > 0 ? `You finished ${ordinal(mine.place)}` : 'You’re out — thanks for playing!';
        body = `${mine.wins} ${mine.wins === 1 ? 'win' : 'wins'}${mine.draws ? `, ${mine.draws} ${mine.draws === 1 ? 'draw' : 'draws'}` : ''}, ${mine.losses} ${mine.losses === 1 ? 'loss' : 'losses'}. Stick around and watch the rest.`;
        break;
      case 'champion':
        tone = 'win';
        icon = 'trophy';
        title = 'You are the champion!';
        body = `${mine.wins} ${mine.wins === 1 ? 'win' : 'wins'}${mine.draws ? `, ${mine.draws} ${mine.draws === 1 ? 'draw' : 'draws'}` : ''}. Take a bow.`;
        break;
      case 'withdrawn':
        tone = 'off';
        icon = 'flag';
        title = 'You withdrew';
        body = registrationOpen ? 'Changed your mind? Register again below.' : 'You can keep watching.';
        if (registrationOpen && !full) {
          actions = (
            <Button variant="secondary" icon="plus" loading={busy} onClick={register}>
              Register again
            </Button>
          );
        }
        break;
      case 'disqualified':
        tone = 'off';
        icon = 'flag';
        title = 'You were removed by the organizer';
        body = 'The reason is in the tournament log.';
        break;
      case 'no_show':
        tone = 'off';
        icon = 'clock';
        title = 'You missed check-in';
        body = 'The draw went ahead without you. You can still watch.';
        break;
    }
    const canWithdraw =
      (mine.status === 'registered' || mine.status === 'checked_in' || mine.status === 'active') &&
      view.status !== 'COMPLETE' &&
      view.status !== 'CANCELLED';
    if (canWithdraw) {
      actions = (
        <>
          {actions}
          <Button variant="ghost" size="sm" onClick={withdraw}>
            Withdraw
          </Button>
        </>
      );
    }
  }

  return (
    <section className="tk-you" data-tone={tone} aria-label="Your status">
      <PixelIcon name={icon} className="tk-you__icon" />
      <div className="tk-you__text">
        {mine ? (
          <span className="tk-you__who">
            {mine.name}
            {mine.seed > 0 ? <> · seed {mine.seed}</> : null}
            {mine.rating ? (
              <span title="Internal DASCADE rating — not FIDE">
                {' '}
                · <span className="dc-num">{mine.rating}</span>
                {mine.provisional ? '?' : ''} DASCADE
              </span>
            ) : null}
          </span>
        ) : null}
        <h2 className="tk-you__title">{title}</h2>
        {body ? <p className="tk-you__body">{body}</p> : null}
      </div>
      {actions ? <div className="tk-you__actions">{actions}</div> : null}
    </section>
  );
}
