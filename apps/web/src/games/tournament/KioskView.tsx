/**
 * Tournament kiosk (the `tournament` room): scoreboard header, "you" card, organizer next step,
 * then tabs — bracket / standings / crosstable / rounds, players, organizer console, log, chat.
 * Everything renders from the public tournament view; secrets (tokens, tickets) only come from the
 * private `tournament:me` message.
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  GAME_CATALOG,
  SEEDING_LABELS,
  TOURNAMENT_FORMAT_LABELS,
  TOURNAMENT_STATUS_LABELS,
  formatPoints,
  type TournamentMe,
  type TournamentView,
} from '@dascade/shared';
import { Avatar, Button, PixelIcon, Spinner, cx } from '@dascade/ui';
import { ChatPanel, GameStage } from '../../shell/common.tsx';
import { bracketVM, crosstableVM, standingsVM, tiebreaksVM } from '../../tournament/adapt.ts';
import { BracketView } from '../../tournament/bracket/BracketView.tsx';
import { RoundsView } from '../../tournament/bracket/RoundsView.tsx';
import { Crosstable, StandingsTable } from '../../tournament/bracket/Standings.tsx';
import { PixelTrophy } from '../../tournament/art.tsx';
import { useApp } from '../../app/store.ts';
import { sfx } from '../../audio/audio.ts';
import { ConfirmDialog, type ConfirmSpec } from './ConfirmDialog.tsx';
import { MatchDialog } from './MatchDialog.tsx';
import { NextStep, OrganizerConsole } from './OrganizerConsole.tsx';
import { ScrollTabs } from './ScrollTabs.tsx';
import { YouPanel } from './YouPanel.tsx';
import { inviteLink, shareInvite } from '../../tournament/actions.ts';
import { PARTICIPANT_STATUS_TEXT, PARTICIPANT_STATUS_TONE, clockTime, ordinal } from './text.ts';
import { useAckRouter, useTokenClaims, useTournamentEvents, useTournamentMe, useTournamentView } from './useKiosk.ts';

type TabId = 'bracket' | 'standings' | 'crosstable' | 'rounds' | 'players' | 'console' | 'log' | 'chat';

const TAB_NAMES: Record<TabId, string> = {
  bracket: 'Bracket',
  standings: 'Standings',
  crosstable: 'Crosstable',
  rounds: 'Rounds and pairings',
  players: 'Players',
  console: 'Organizer console',
  log: 'Tournament log',
  chat: 'Chat',
};

export function KioskView() {
  const view = useTournamentView();
  const me = useTournamentMe();
  useAckRouter();
  useTokenClaims(view?.code ?? null, me);
  useTournamentEvents(me);
  if (!view) {
    return (
      <GameStage gameId="tournament" className="tk">
        <div className="center-screen">
          <Spinner label="Loading tournament" />
        </div>
      </GameStage>
    );
  }
  return <Kiosk view={view} me={me} />;
}

function defaultTab(view: TournamentView, organizer: boolean): TabId {
  const started = view.matches.length > 0;
  if (!started) return organizer ? 'console' : 'players';
  return view.config.format === 'round_robin' || view.config.format === 'swiss' ? 'standings' : 'bracket';
}

export function Kiosk({ view, me }: { view: TournamentView; me: TournamentMe | null }) {
  const organizer = Boolean(me?.isOrganizer);
  const myId = me?.participantId ?? null;
  const [tab, setTab] = useState<TabId>(() => defaultTab(view, organizer));
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const started = view.matches.length > 0;
  const format = view.config.format;
  const elim = format === 'single_elimination' || format === 'double_elimination';

  // When the draw happens, jump from the registration list to the bracket/standings.
  useEffect(() => {
    if (started) setTab((t) => (t === 'players' || t === 'console' ? defaultTab(view, organizer) : t));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on the start transition
  }, [started]);
  useEffect(() => {
    if (!organizer && tab === 'console') setTab(defaultTab(view, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when organizer powers change
  }, [organizer]);
  useEffect(() => {
    document.title = `${view.config.name} · Tournament · DASCADE`;
    return () => {
      document.title = 'DASCADE';
    };
  }, [view.config.name]);

  const vm = useMemo(() => bracketVM(view, myId), [view, myId]);
  const standings = useMemo(() => standingsVM(view, myId), [view, myId]);
  const tiebreaks = useMemo(() => tiebreaksVM(view), [view]);
  const selectedMatch = selected ? (view.matches.find((m) => m.id === selected) ?? null) : null;
  const live = view.matches.filter((m) => m.status === 'IN_PROGRESS').length;

  const tabs: Array<{ value: TabId; label: ReactNode }> = [];
  if (started && elim) tabs.push({ value: 'bracket', label: 'Bracket' });
  if (started && !elim) tabs.push({ value: 'standings', label: 'Standings' });
  if (started && format === 'round_robin') tabs.push({ value: 'crosstable', label: 'Crosstable' });
  if (started && !elim) tabs.push({ value: 'rounds', label: format === 'swiss' ? 'Pairings' : 'Rounds' });
  if (started && elim) tabs.push({ value: 'standings', label: 'Placings' });
  tabs.push({
    value: 'players',
    label: (
      <>
        Players{' '}
        <span className="dc-num">
          {view.participants.filter((p) => p.status !== 'withdrawn' && p.status !== 'disqualified' && p.status !== 'no_show').length}
        </span>
      </>
    ),
  });
  if (organizer) tabs.push({ value: 'console', label: 'Organizer' });
  tabs.push({ value: 'log', label: 'Log' });
  tabs.push({ value: 'chat', label: 'Chat' });
  const activeTab = tabs.some((t) => t.value === tab) ? tab : tabs[0]!.value;

  const select = (id: string) => {
    sfx('click');
    setSelected(id);
  };

  const names = useMemo(() => new Map(view.participants.map((p) => [p.id, p.name])), [view.participants]);
  const cross = useMemo(() => (format === 'round_robin' ? crosstableVM(view) : null), [format, view]);
  const points = useMemo(() => new Map(view.standings.rows.map((r) => [r.participantId, r.points])), [view.standings.rows]);
  const roundNotes = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of view.rounds) {
      // Byes normally arrive as their own match card; only annotate rounds that don't have one.
      const hasByeMatch = view.matches.some((m) => m.bracket === 'main' && m.round === r.round && (!m.aId || !m.bId));
      if (r.byeId && !hasByeMatch)
        out[`main-${r.round}`] = `Bye: ${names.get(r.byeId) ?? 'Unknown'} (${format === 'swiss' ? '1 point' : 'sits out'})`;
    }
    return out;
  }, [view.rounds, view.matches, names, format]);

  return (
    <GameStage gameId="tournament" className="tk">
      <div className="tk__inner" data-part="kiosk">
        <KioskHeader view={view} live={live} />
        {view.status === 'COMPLETE' ? <ChampionBanner view={view} /> : null}
        <div className="tk__top" data-part="kiosk-top">
          {/* An organizer who isn't playing only needs the next-step card once the event is under way. */}
          {organizer && !myId && (view.status === 'IN_PROGRESS' || view.status === 'COMPLETE' || view.status === 'CANCELLED') ? null : (
            <YouPanel view={view} me={me} onConfirm={setConfirm} onSelectMatch={select} />
          )}
          {organizer && activeTab !== 'console' ? (
            <NextStep view={view} onConfirm={setConfirm} onOpenConsole={() => setTab('console')} />
          ) : null}
        </div>

        <ScrollTabs className="tk__tabs" label="Tournament sections" value={activeTab} onChange={setTab} tabs={tabs} />
        <div className="tk__panel" data-part="kiosk-panel" role="tabpanel" aria-label={TAB_NAMES[activeTab]}>
          {activeTab === 'bracket' ? <BracketView vm={vm} onSelect={select} label={`${view.config.name} bracket`} /> : null}
          {activeTab === 'standings' ? (
            elim ? (
              <Placings view={view} me={myId} />
            ) : (
              <StandingsTable
                rows={standings}
                tiebreaks={tiebreaks}
                caption={`${view.config.name} standings`}
                showByes={format === 'swiss'}
              />
            )
          ) : null}
          {activeTab === 'crosstable' && cross ? (
            <Crosstable
              ids={cross.ids}
              names={names}
              cells={cross.cells}
              points={points}
              me={myId}
              onSelect={select}
              showSeries={view.config.bestOf > 1}
            />
          ) : null}
          {activeTab === 'rounds' ? <RoundsView vm={vm} onSelect={select} notes={roundNotes} /> : null}
          {activeTab === 'players' ? <PlayersList view={view} me={myId} /> : null}
          {activeTab === 'console' && organizer ? <OrganizerConsole view={view} onConfirm={setConfirm} onSelectMatch={select} /> : null}
          {activeTab === 'log' ? <AuditLog view={view} /> : null}
          {activeTab === 'chat' ? (
            <div className="tk-chat">
              <ChatPanel placeholder="Chat with everyone at the tournament…" emptyText="No messages yet. Wish everyone luck!" />
            </div>
          ) : null}
        </div>
      </div>
      <MatchDialog view={view} match={selectedMatch} me={me} onClose={() => setSelected(null)} onConfirm={setConfirm} />
      <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />
    </GameStage>
  );
}

// ---------------------------------------------------------------------------
function KioskHeader({ view, live }: { view: TournamentView; live: number }) {
  const game = GAME_CATALOG[view.config.gameId];
  const entries = view.participants.filter((p) => p.status !== 'withdrawn' && p.status !== 'disqualified' && p.status !== 'no_show').length;
  const tone =
    view.status === 'IN_PROGRESS'
      ? view.paused
        ? 'idle'
        : 'live'
      : view.status === 'COMPLETE' || view.status === 'CANCELLED'
        ? 'done'
        : 'open';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink(view.code));
      sfx('pop');
      useApp.getState().toast('success', `Invite link copied — code ${view.code}`);
    } catch {
      useApp.getState().toast('info', `Tournament code: ${view.code}`);
    }
  };
  return (
    <header className="tk-head" data-part="kiosk-header" style={{ '--g': game.accent.primary, '--g2': game.accent.secondary } as CSSProperties}>
      <div className="tk-head__main">
        <span className="tk-head__game">{game.marquee}</span>
        <h1 className="tk-head__name">{view.config.name}</h1>
        <ul className="tk-head__facts" aria-label="Tournament details">
          <li>{TOURNAMENT_FORMAT_LABELS[view.config.format]}</li>
          <li>{view.config.bestOf === 1 ? 'Single game' : `Best of ${view.config.bestOf}`}</li>
          <li>
            <span className="dc-num">{entries}</span>/<span className="dc-num">{view.config.maxField}</span> players
          </li>
          <li>Seeding: {SEEDING_LABELS[view.seedingMethod || view.config.seeding]}</li>
          <li>
            <PixelIcon name="crown" /> {view.organizerName || 'Organizer'}
          </li>
        </ul>
      </div>
      <div className="tk-head__side">
        <div className="tk-board-status" data-part="status" data-tone={tone}>
          <span className="tc-lamp" data-tone={tone} aria-hidden />
          <span className="tk-board-status__label">{view.paused ? 'Paused' : TOURNAMENT_STATUS_LABELS[view.status]}</span>
          {view.status === 'IN_PROGRESS' && view.totalRounds > 0 ? (
            <span className="tk-board-status__round">
              Round <b className="dc-num">{view.currentRound}</b>/<span className="dc-num">{view.totalRounds}</span>
            </span>
          ) : null}
          {live > 0 ? (
            <span className="tk-board-status__live">
              <span className="dc-num">{live}</span> live
            </span>
          ) : null}
        </div>
        <div className="tk-invite">
          <button
            type="button"
            className="tk-invite__code"
            onClick={copy}
            aria-label={`Tournament code ${view.code}. Copy invite link`}
            title="Copy invite link"
          >
            {view.code.split('').map((c, i) => (
              <span key={i}>{c}</span>
            ))}
          </button>
          <Button variant="secondary" size="sm" icon="share" onClick={() => void shareInvite(view.code, view.config.name)}>
            Invite
          </Button>
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
function ChampionBanner({ view }: { view: TournamentView }) {
  const people = new Map(view.participants.map((p) => [p.id, p]));
  const champ = view.championId ? people.get(view.championId) : undefined;
  const reducedMotion = useApp((s) => s.settings.reducedMotion);
  const podium = view.standings.rows.filter((r) => r.rank >= 2 && r.rank <= 3).slice(0, 3);
  if (!champ) {
    return (
      <section className="tk-champ" data-part="podium" aria-label="Result">
        <PixelTrophy className="tk-champ__trophy" />
        <div>
          <span className="tk-champ__kicker">Tournament complete</span>
          <p className="tk-champ__name">Final standings below</p>
        </div>
      </section>
    );
  }
  return (
    <section className="tk-champ" data-anim={reducedMotion ? undefined : 'on'} aria-label="Champion">
      <PixelTrophy className="tk-champ__trophy" />
      <div className="tk-champ__text">
        <span className="tk-champ__kicker">Champion</span>
        <p className="tk-champ__name">
          <Avatar avatar={champ.avatar} color="var(--accent)" size={36} /> {champ.name}
        </p>
        <span className="tk-champ__record">
          {champ.wins} {champ.wins === 1 ? 'win' : 'wins'}
          {champ.draws ? ` · ${champ.draws} ${champ.draws === 1 ? 'draw' : 'draws'}` : ''}
          {champ.losses ? ` · ${champ.losses} ${champ.losses === 1 ? 'loss' : 'losses'}` : ''}
          {view.config.format === 'swiss' || view.config.format === 'round_robin' ? ` · ${formatPoints(champ.points)} pts` : ''}
        </span>
      </div>
      {podium.length > 0 ? (
        <ol className="tk-champ__podium" aria-label="Podium">
          {podium.map((r) => (
            <li key={r.participantId}>
              <span className="tk-champ__place dc-num">
                {r.shared ? '=' : ''}
                {r.rank}
              </span>
              {people.get(r.participantId)?.name ?? 'Unknown'}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
function Placings({ view, me }: { view: TournamentView; me: string | null }) {
  const people = new Map(view.participants.map((p) => [p.id, p]));
  const rows = [...view.standings.rows].sort((a, b) => (a.rank || 999) - (b.rank || 999));
  if (rows.length === 0) return <p className="dc-muted tc-empty">Placings fill in as players are knocked out.</p>;
  return (
    <ol className="tk-placings" data-part="standings">
      {rows.map((r) => {
        const p = people.get(r.participantId);
        return (
          <li key={r.participantId} data-me={r.participantId === me || undefined} data-rank={r.rank || undefined}>
            <span className="tk-placings__rank dc-num">{r.rank > 0 ? `${r.shared ? '=' : ''}${ordinal(r.rank)}` : 'Alive'}</span>
            <span className="tk-placings__name">
              {p?.seed ? <span className="tc-seed">{p.seed}</span> : null}
              {p?.name ?? 'Unknown'}
              {r.participantId === me ? <span className="tc-you">You</span> : null}
            </span>
            <span className="tk-placings__out">
              {r.rank === 1 ? 'Champion' : r.eliminatedIn ? `Out in ${r.eliminatedIn}` : r.rank > 0 ? '' : 'Still in'}
            </span>
            <span className="tk-placings__wl dc-num">
              {r.wins}–{r.losses}
              {r.draws ? `–${r.draws}` : ''}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
function PlayersList({ view, me }: { view: TournamentView; me: string | null }) {
  const started = view.matches.length > 0;
  if (view.participants.length === 0) {
    return (
      <div className="tk-empty">
        <PixelIcon name="users" className="tk-empty__icon" />
        <p className="tk-empty__title">No players yet</p>
        <p className="dc-muted">
          {view.status === 'REGISTRATION' || view.status === 'CHECK_IN'
            ? 'Be the first — press Register above.'
            : 'Players register once the organizer opens registration.'}
        </p>
      </div>
    );
  }
  return (
    <ul className="tk-players" data-part="players">
      {view.participants.map((p) => {
        const gone = p.status === 'withdrawn' || p.status === 'disqualified' || p.status === 'no_show';
        return (
          <li key={p.id} data-me={p.id === me || undefined} data-gone={gone || undefined}>
            <span className="tk-players__seed">
              {p.seed > 0 ? <span className="tc-seed">{p.seed}</span> : <span className="tk-players__entry dc-num">#{p.entry}</span>}
            </span>
            <Avatar avatar={p.avatar} color={p.id === me ? 'var(--cyan)' : 'var(--text-1)'} size={32} />
            <span className="tk-players__who">
              <span className="tk-players__name">
                {p.name}
                {p.id === me ? <span className="tc-you">You</span> : null}
              </span>
              <span className="tk-players__meta">
                <span title="Internal DASCADE rating — not FIDE">
                  <span className="dc-num">{p.rating}</span> DASCADE{p.provisional ? ' · provisional' : ''}
                </span>
                {started && !gone ? (
                  <>
                    {' '}
                    · <span className="dc-num">{p.wins}</span>W <span className="dc-num">{p.draws}</span>D{' '}
                    <span className="dc-num">{p.losses}</span>L
                  </>
                ) : null}
              </span>
            </span>
            <i
              className="tk-online"
              data-on={p.online || undefined}
              title={p.online ? 'At the kiosk' : 'Away'}
              aria-label={p.online ? 'At the kiosk' : 'Away'}
            />
            <span className="tk-status" style={{ '--tone': PARTICIPANT_STATUS_TONE[p.status] } as CSSProperties}>
              {p.status === 'registered' && view.status === 'CHECK_IN' ? 'Not checked in' : PARTICIPANT_STATUS_TEXT[p.status]}
              {p.place > 0 && p.status !== 'champion' ? ` · ${ordinal(p.place)}` : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
const ACTOR_LABEL = { organizer: 'Organizer', system: 'Desk', participant: 'Player' } as const;

function AuditLog({ view }: { view: TournamentView }) {
  const entries = [...view.audit].reverse();
  if (entries.length === 0) return <p className="dc-muted tc-empty">Nothing logged yet.</p>;
  return (
    <ol className="tk-log" data-part="log" aria-label="Tournament log, newest first">
      {entries.map((e) => (
        <li key={e.id} data-actor={e.actor} data-action={e.action}>
          <time className="tk-log__time dc-num" dateTime={new Date(e.at).toISOString()}>
            {clockTime(e.at)}
          </time>
          <span className={cx('tk-log__actor')}>{ACTOR_LABEL[e.actor] ?? e.actor}</span>
          <span className="tk-log__text">
            {e.text}
            {e.reason ? <q className="tk-log__reason">{e.reason}</q> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
