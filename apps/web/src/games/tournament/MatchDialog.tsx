/**
 * Match details: both sides (seed, DASCADE rating, series points), the game-by-game record, status
 * and deadlines, plus actions — Play (your match), Spectate (live room), and for the organizer
 * Forfeit / Decide / Relaunch (confirmed, with a typed reason where it changes a result).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  FINISHED_MATCH_STATUSES,
  GAME_CATALOG,
  formatPoints,
  matchGames,
  type TournamentMatchView,
  type TournamentMe,
  type TournamentParticipantView,
  type TournamentView,
} from '@dascade/shared';
import { Avatar, Badge, Button, Modal, Segmented } from '@dascade/ui';
import { useCountdown } from '../../net/hooks.ts';
import { WITHOUT_PLAY, matchNote } from '../../tournament/adapt.ts';
import { playMatch, spectateMatch } from '../../tournament/actions.ts';
import type { ConfirmSpec } from './ConfirmDialog.tsx';
import { mmss } from './text.ts';
import { adminRequest } from './useKiosk.ts';

const STATUS_LABEL: Record<TournamentMatchView['status'], string> = {
  WAITING: 'Waiting',
  READY: 'Ready to play',
  IN_PROGRESS: 'Live',
  COMPLETE: 'Final',
  FORFEIT: 'Forfeit',
  VOID: 'Not played',
};

function Side({
  p,
  label,
  points,
  winner,
  first,
  sides,
  present,
  started,
  showPoints,
}: {
  p: TournamentParticipantView | undefined;
  label: string;
  points: number;
  winner: boolean;
  first: boolean;
  sides: boolean;
  present: boolean;
  started: boolean;
  showPoints: boolean;
}) {
  return (
    <div className="tk-side" data-winner={winner || undefined} data-empty={!p || undefined}>
      {p ? (
        <Avatar avatar={p.avatar} color={winner ? 'var(--accent)' : 'var(--text-1)'} size={40} />
      ) : (
        <span className="tk-side__ghost" aria-hidden />
      )}
      <div className="tk-side__info">
        <span className="tk-side__name">{p?.name ?? label ?? 'TBD'}</span>
        {p ? (
          <span className="tk-side__meta">
            {p.seed > 0 ? <>Seed {p.seed} · </> : null}
            <span title="Internal DASCADE rating (not FIDE)">
              <span className="dc-num">{p.rating}</span> DASCADE{p.provisional ? ' (provisional)' : ''}
            </span>
            {sides ? <> · {first ? 'moves first in game 1' : 'moves second in game 1'}</> : null}
          </span>
        ) : null}
        {p && !started ? (
          <span className="tk-side__presence" data-on={present || undefined}>
            {present ? 'In the match room' : 'Not in the room yet'}
          </span>
        ) : null}
      </div>
      {showPoints ? (
        <span className="tk-side__pts dc-num" aria-label={`${formatPoints(points)} points`}>
          {formatPoints(points)}
        </span>
      ) : winner ? (
        <span className="tk-side__pts tk-side__pts--win">Winner</span>
      ) : (
        <span className="tk-side__pts" aria-hidden />
      )}
    </div>
  );
}

export function MatchDialog({
  view,
  match,
  me,
  onClose,
  onConfirm,
}: {
  view: TournamentView;
  match: TournamentMatchView | null;
  me: TournamentMe | null;
  onClose: () => void;
  onConfirm: (spec: ConfirmSpec) => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const noShowLeft = useCountdown(match?.noShowAt || 0);
  if (!match) return null;
  const people = new Map(view.participants.map((p) => [p.id, p]));
  const a = people.get(match.aId);
  const b = people.get(match.bId);
  const sides = Boolean(GAME_CATALOG[view.config.gameId].tournament?.sides);
  const started = match.status !== 'WAITING' && match.status !== 'READY';
  const showPoints = started && !(WITHOUT_PLAY.has(match.resultKind) && match.aPoints + match.bPoints === 0);
  const games = matchGames(match);
  const note = matchNote(match);
  const mine = Boolean(me?.participantId && (match.aId === me.participantId || match.bId === me.participantId));
  const active = me?.activeMatch && me.activeMatch.matchId === match.id ? me.activeMatch : null;
  const live = (match.status === 'READY' || match.status === 'IN_PROGRESS') && Boolean(match.roomCode);
  const organizer = Boolean(me?.isOrganizer);
  const open = !FINISHED_MATCH_STATUSES.includes(match.status);
  const canAdmin = organizer && view.status === 'IN_PROGRESS' && Boolean(match.aId && match.bId);

  const forfeit = () => {
    let loser = match.aId;
    onConfirm({
      title: 'Forfeit a player',
      body: <p>The player you pick loses this match (they stay in the tournament if the format allows). The other player advances.</p>,
      extra: <ForfeitPicker a={a} b={b} onChange={(id) => (loser = id)} />,
      confirmLabel: 'Record forfeit',
      danger: true,
      reason: { label: 'Reason', placeholder: 'e.g. Did not show up after 5 minutes' },
      run: (reason) => adminRequest({ action: 'forfeit', matchId: match.id, participantId: loser, reason }),
    });
  };

  const decide = () => {
    let outcome: 'win' | 'draw' | 'double_forfeit' = 'win';
    let winnerId = match.aId;
    const drawAllowed = view.config.format === 'round_robin' || view.config.format === 'swiss';
    onConfirm({
      title: 'Decide this match by hand',
      body: (
        <p>
          Use this only when the game can’t produce a result (a crash, a mistake, a player who had to leave). The result advances the
          tournament like a played match and is written to the public log.
        </p>
      ),
      extra: <OverridePicker a={a} b={b} drawAllowed={drawAllowed} onChange={(o, w) => ((outcome = o), (winnerId = w))} />,
      confirmLabel: 'Record result',
      danger: true,
      reason: { label: 'Reason for the manual result', placeholder: 'e.g. Chess room crashed at move 40; players agreed Ada was winning' },
      run: (reason) =>
        adminRequest(
          outcome === 'win'
            ? { action: 'override', matchId: match.id, outcome, winnerId, reason, confirm: true }
            : { action: 'override', matchId: match.id, outcome, reason, confirm: true },
        ),
    });
  };

  const relaunch = () =>
    onConfirm({
      title: 'Open a fresh match room?',
      body: <p>The current match room closes and a new one opens for both players. The series score is kept.</p>,
      confirmLabel: 'Relaunch room',
      run: () => adminRequest({ action: 'relaunchMatch', matchId: match.id }),
    });

  return (
    <Modal open onClose={onClose} title={match.label || match.id} wide>
      <div className="tk-match">
        <div className="tk-match__status">
          <Badge color={match.status === 'IN_PROGRESS' ? 'var(--green)' : match.status === 'READY' ? 'var(--accent)' : 'var(--text-2)'}>
            {STATUS_LABEL[match.status]}
          </Badge>
          <span className="dc-muted">
            {match.roundLabel} · {match.bestOf === 1 ? 'single game' : `best of ${match.bestOf}`}
            {match.status === 'IN_PROGRESS' && match.gameNumber > 0
              ? ` · game ${match.gameNumber}${match.gameNumber > match.bestOf ? ' (decider)' : ''}`
              : ''}
          </span>
          {note ? <Badge color="var(--accent-2)">{note}</Badge> : null}
        </div>
        <div className="tk-match__sides">
          <Side
            p={a}
            label={match.aLabel}
            points={match.aPoints}
            winner={Boolean(match.winnerId) && match.winnerId === match.aId}
            first={match.firstId === match.aId}
            sides={sides}
            present={match.aPresent}
            started={started}
            showPoints={showPoints}
          />
          <span className="tk-match__vs" aria-hidden>
            VS
          </span>
          <Side
            p={b}
            label={match.bLabel}
            points={match.bPoints}
            winner={Boolean(match.winnerId) && match.winnerId === match.bId}
            first={match.firstId === match.bId}
            sides={sides}
            present={match.bPresent}
            started={started}
            showPoints={showPoints}
          />
        </div>
        {match.noShowAt > 0 && open ? (
          <p className="tk-match__warn" role="status">
            No-show clock: an absent player forfeits in <b className="dc-num">{mmss(noShowLeft)}</b>.
          </p>
        ) : null}
        {games.length > 0 ? (
          <ol className="tk-games" aria-label="Games in this match">
            {games.map((g) => {
              const w = g.winnerId ? (people.get(g.winnerId)?.name ?? 'Unknown') : null;
              return (
                <li key={g.n}>
                  <span className="tk-games__n dc-num">G{g.n}</span>
                  <span>
                    {w ? <b>{w}</b> : <b>Draw</b>}
                    {w ? ' won' : ''}
                    {g.reason ? <span className="dc-muted"> · {g.reason.replace(/_/g, ' ')}</span> : null}
                    {g.decider ? (
                      <span className="dc-muted"> · {g.decider === 'armageddon' ? 'Armageddon decider' : 'sudden-death decider'}</span>
                    ) : null}
                  </span>
                  {sides && g.firstId ? (
                    <span className="dc-muted tk-games__side">{people.get(g.firstId)?.name ?? '—'} moved first</span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : null}
        {!match.aId || !match.bId ? (
          <p className="dc-muted">
            {match.status === 'VOID'
              ? 'This match won’t be played.'
              : `Waiting for ${!match.aId ? match.aLabel || 'a player' : match.bLabel || 'a player'}.`}
          </p>
        ) : null}

        <div className="tk-match__actions">
          {active ? (
            <Button
              variant="primary"
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
          ) : null}
          {live && !active ? (
            <Button
              variant={mine ? 'primary' : 'secondary'}
              icon="eye"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                await spectateMatch(match.roomCode, view.code, navigate);
                setBusy(false);
              }}
            >
              Spectate
            </Button>
          ) : null}
          {canAdmin && open ? (
            <>
              <span className="dc-spacer" />
              <Button variant="ghost" size="sm" icon="refresh" onClick={relaunch}>
                Relaunch room
              </Button>
              <Button variant="ghost" size="sm" icon="flag" onClick={forfeit}>
                Forfeit…
              </Button>
              <Button variant="danger" size="sm" icon="pencil" onClick={decide}>
                Decide…
              </Button>
            </>
          ) : null}
          {organizer && !open && match.status !== 'VOID' && view.status === 'IN_PROGRESS' && match.aId && match.bId ? (
            <>
              <span className="dc-spacer" />
              <Button variant="ghost" size="sm" icon="pencil" onClick={decide}>
                Correct result…
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

function ForfeitPicker({
  a,
  b,
  onChange,
}: {
  a?: TournamentParticipantView;
  b?: TournamentParticipantView;
  onChange: (id: string) => void;
}) {
  const [v, setV] = useState(a?.id ?? '');
  if (!a || !b) return null;
  return (
    <div className="dc-field">
      <span className="dc-field__label">Who forfeits?</span>
      <Segmented<string>
        label="Player who forfeits"
        value={v}
        onChange={(id) => {
          setV(id);
          onChange(id);
        }}
        options={[
          { value: a.id, label: a.name },
          { value: b.id, label: b.name },
        ]}
      />
    </div>
  );
}

function OverridePicker({
  a,
  b,
  drawAllowed,
  onChange,
}: {
  a?: TournamentParticipantView;
  b?: TournamentParticipantView;
  drawAllowed: boolean;
  onChange: (outcome: 'win' | 'draw' | 'double_forfeit', winnerId: string) => void;
}) {
  const [v, setV] = useState(a?.id ?? '');
  if (!a || !b) return null;
  const options = [
    { value: a.id, label: `${a.name} wins` },
    { value: b.id, label: `${b.name} wins` },
    ...(drawAllowed ? [{ value: 'draw', label: 'Draw' }] : []),
    { value: 'double_forfeit', label: 'Both forfeit' },
  ];
  return (
    <div className="dc-field">
      <span className="dc-field__label">Result</span>
      <Segmented<string>
        label="Manual result"
        value={v}
        onChange={(val) => {
          setV(val);
          if (val === 'draw' || val === 'double_forfeit') onChange(val, '');
          else onChange('win', val);
        }}
        options={options}
      />
    </div>
  );
}
