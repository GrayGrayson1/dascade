/**
 * DEV ONLY — bracket/standings gallery for visual QA (`/tournaments?gallery=<fixture>` in `vite dev`).
 * Lazy-loaded behind `import.meta.env.DEV`, so production builds drop it entirely.
 */
import { useMemo } from 'react';
import { GAME_CATALOG, formatPoints } from '@dascade/shared';
import { GameTheme } from '@dascade/ui';
import { bracketVM, crosstableVM, standingsVM, tiebreaksVM } from '../adapt.ts';
import { BracketView } from '../bracket/BracketView.tsx';
import { RoundsView } from '../bracket/RoundsView.tsx';
import { Crosstable, StandingsTable } from '../bracket/Standings.tsx';
import { completeView, doubleElimView, registrationView, roundRobinView, singleElimView, swissView } from './viewFixtures.ts';
import { Kiosk } from '../../games/tournament/KioskView.tsx';
import { TournamentBannerView } from '../TournamentBanner.tsx';
import type { TournamentMe, TournamentView } from '@dascade/shared';
import '../bracket/bracket.css';
import '../../games/tournament/kiosk.css';

const ME = (participantId: string | null, isOrganizer = false, activeMatch: TournamentMe['activeMatch'] = null): TournamentMe => ({
  isOrganizer,
  organizerToken: null,
  participantId,
  participantToken: null,
  activeMatch,
});

const KIOSKS: Record<string, () => { view: TournamentView; me: TournamentMe }> = {
  'kiosk-reg': () => ({ view: registrationView(6), me: ME(null, true) }),
  'kiosk-checkin': () => ({ view: registrationView(7, 'CHECK_IN'), me: ME('p2') }),
  'kiosk-se8': () => ({
    view: singleElimView(8, 1),
    me: ME('p2', false, {
      matchId: 'W2-3',
      gameId: 'chess',
      roomCode: 'ABCDE',
      ticket: 'x'.repeat(16),
      label: 'Semifinals · Match 3',
      opponentId: 'p3',
      opponentName: 'Chen',
      side: 'first',
    }),
  }),
  'kiosk-de16': () => ({ view: doubleElimView(16, 2), me: ME('p5', true) }),
  'kiosk-swiss': () => ({ view: swissView(9, 2, 4), me: ME('p4') }),
  'kiosk-rr': () => ({ view: roundRobinView(6, 3), me: ME('p2', true) }),
  'kiosk-done': () => ({ view: completeView(), me: ME('p3') }),
};

const FIXTURES = {
  se8: () => singleElimView(8, 1),
  se5: () => singleElimView(5, 1),
  se16: () => singleElimView(16, 2),
  se64: () => singleElimView(64, 3),
  de8: () => doubleElimView(8, 1),
  de16: () => doubleElimView(16, 2),
  rr6: () => roundRobinView(6, 3),
  swiss9: () => swissView(9, 2, 4),
};

export default function Gallery({ fixture }: { fixture: string }) {
  const kiosk = KIOSKS[fixture];
  if (kiosk) return <KioskPreview make={kiosk} />;
  if (fixture === 'banner') return <BannerPreview />;
  return <BracketGallery fixture={fixture} />;
}

function KioskPreview({ make }: { make: () => { view: TournamentView; me: TournamentMe } }) {
  const { view, me } = useMemo(make, [make]);
  return (
    <div className="room">
      <Kiosk view={view} me={me} />
    </div>
  );
}

function BracketGallery({ fixture }: { fixture: string }) {
  const key = (fixture in FIXTURES ? fixture : 'se8') as keyof typeof FIXTURES;
  const view = useMemo(() => FIXTURES[key](), [key]);
  const vm = useMemo(() => bracketVM(view, 'p2'), [view]);
  const elim = view.config.format === 'single_elimination' || view.config.format === 'double_elimination';
  const names = new Map(view.participants.map((p) => [p.id, p.name]));
  const cross = crosstableVM(view);
  const points = new Map(view.standings.rows.map((r) => [r.participantId, r.points]));
  return (
    <GameTheme
      accent={GAME_CATALOG.tournament.accent}
      as="main"
      className="dc-game-backdrop"
      style={{ minHeight: '100dvh', padding: 16 }}
      id="main"
    >
      <h1 className="dc-title" style={{ fontSize: 22, marginBottom: 16 }}>
        Gallery · {key} · {formatPoints(1.5)}
      </h1>
      {elim ? (
        <BracketView vm={vm} onSelect={(id) => console.info('select', id)} />
      ) : (
        <div style={{ display: 'grid', gap: 24 }}>
          <StandingsTable
            rows={standingsVM(view, 'p2')}
            tiebreaks={tiebreaksVM(view)}
            caption="Standings"
            showByes={view.config.format === 'swiss'}
          />
          {view.config.format === 'round_robin' ? (
            <Crosstable
              ids={cross.ids}
              names={names}
              cells={cross.cells}
              points={points}
              me="p2"
              onSelect={(id) => console.info('select', id)}
            />
          ) : null}
          <RoundsView vm={vm} onSelect={(id) => console.info('select', id)} />
        </div>
      )}
    </GameTheme>
  );
}

function BannerPreview() {
  const base = {
    tournamentCode: 'TRNMT',
    tournamentName: 'Friday Night Invitational',
    matchId: 'W2-1',
    roundLabel: 'Semifinal',
    format: 'single_elimination' as const,
    bestOf: 3,
    gameNumber: 2,
    seriesScore: { p1: 1, p2: 0 },
    participants: [
      { participantId: 'p1', name: 'Ada', seed: 1, playerId: 'x1', side: 'second' as const },
      { participantId: 'p2', name: 'Dmitri', seed: 4, playerId: 'x2', side: 'first' as const },
    ],
  };
  return (
    <GameTheme
      accent={GAME_CATALOG.chess.accent}
      as="main"
      className="dc-game-backdrop"
      style={{ minHeight: '100dvh', display: 'grid', gap: 24, alignContent: 'start' }}
      id="main"
    >
      <TournamentBannerView info={{ ...base, seriesStatus: 'playing' }} compact={false} />
      <TournamentBannerView
        info={{ ...base, seriesStatus: 'intermission', nextGameAt: Date.now() + 8000, seriesScore: { p1: 1.5, p2: 0.5 } }}
        compact={false}
      />
      <TournamentBannerView
        info={{ ...base, seriesStatus: 'decided', seriesScore: { p1: 2, p2: 0.5 }, result: { winnerId: 'p1', kind: 'played', note: '' } }}
        compact={false}
      />
      <TournamentBannerView info={{ ...base, bestOf: 1, gameNumber: 1, seriesStatus: 'waiting', seriesScore: {} }} compact={false} />
      <div style={{ position: 'relative', height: 80 }}>
        <TournamentBannerView info={{ ...base, seriesStatus: 'playing', decider: 'armageddon', gameNumber: 5 }} compact />
      </div>
    </GameTheme>
  );
}
