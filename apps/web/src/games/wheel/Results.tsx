/**
 * RESULTS phase: the session wrap-up (tally, spin log, top spinners).
 */
import { useMemo, type CSSProperties } from 'react';
import type { WheelHistoryView, WheelPublicState, WheelSettings } from '@dascade/shared/games/wheel';
import { EmptyState, Panel, PixelIcon } from '@dascade/ui';
import { useGame } from '../../net/hooks.ts';
import { GameStage, ResultsActions } from '../../shell/common.tsx';
import { HistoryList, ParticipantList } from './Rail.tsx';

interface Tally {
  key: string;
  label: string;
  emoji: string;
  color: string;
  count: number;
}

export function tallyHistory(history: readonly WheelHistoryView[]): Tally[] {
  const map = new Map<string, Tally>();
  for (const h of history) {
    const key = `${h.segmentId}|${h.label}`;
    const t = map.get(key);
    if (t) t.count++;
    else map.set(key, { key, label: h.label || h.emoji, emoji: h.emoji, color: h.color, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function TopLine({ tallies }: { tallies: Tally[] }) {
  const top = tallies[0] as Tally;
  const tied = tallies.filter((t) => t.count === top.count);
  const name = (t: Tally) => `${t.emoji && t.label !== t.emoji ? `${t.emoji} ` : ''}${t.label}`;
  if (tied.length === 1) {
    return (
      <p className="wh-results__top" style={{ '--c': top.color } as CSSProperties}>
        <PixelIcon name="trophy" /> Most picked: <strong>{name(top)}</strong> ×{top.count}
      </p>
    );
  }
  if (top.count === 1) {
    return (
      <p className="wh-results__top">
        <PixelIcon name="sparkle" /> Every spin landed somewhere new
      </p>
    );
  }
  const shown = tied.slice(0, 3).map(name).join(', ');
  return (
    <p className="wh-results__top">
      <PixelIcon name="trophy" /> Tied at ×{top.count}: <strong>{shown}</strong>
      {tied.length > 3 ? ` +${tied.length - 3} more` : ''}
    </p>
  );
}

export function ResultsView() {
  const game = useGame<WheelPublicState, WheelSettings>();
  const history = useMemo(() => game?.state.history ?? [], [game?.state.history]);
  const tallies = useMemo(() => tallyHistory(history), [history]);
  if (!game) return null;
  const { state, settings, players, playerId } = game;
  const top = tallies[0];
  const max = top?.count ?? 1;
  const total = state.totalSpins;

  return (
    <GameStage gameId="wheel" className="wh wh-results">
      <div className="wh-results__inner">
        <header className="wh-results__hero">
          <span className="dc-label">Session complete</span>
          <h1 className="dc-title wh-results__title">
            {total === 0 ? (
              'No spins this time'
            ) : (
              <>
                The wheel spoke <span className="wh-digits">{total}</span> time{total === 1 ? '' : 's'}
              </>
            )}
          </h1>
          {settings.title ? <p className="wh-results__question">“{settings.title}”</p> : null}
          {top ? <TopLine tallies={tallies} /> : null}
        </header>

        <div className="wh-results__grid">
          <Panel title="Tally" brackets className="wh-results__tally">
            {tallies.length === 0 ? (
              <EmptyState icon="sparkle" title="Nothing landed">
                Spin the wheel next time to build a tally.
              </EmptyState>
            ) : (
              <ol className="wh-tally">
                {tallies.map((t) => (
                  <li key={t.key} className="wh-tally__row" style={{ '--c': t.color, '--w': `${(t.count / max) * 100}%` } as CSSProperties}>
                    <span className="wh-chip" aria-hidden>
                      {t.emoji}
                    </span>
                    <span className="wh-tally__label">{t.label}</span>
                    <span className="wh-tally__bar" aria-hidden>
                      <i />
                    </span>
                    <span className="wh-tally__count dc-num">×{t.count}</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
          <Panel title="Spin log" className="wh-results__log">
            <HistoryList history={history} total={total} canReset={false} resetDisabled onReset={() => undefined} />
          </Panel>
          <Panel title="Spinners" className="wh-results__people">
            <ParticipantList players={players} meId={playerId} anyoneCanSpin={settings.spinPermission === 'anyone'} />
          </Panel>
        </div>
        <ResultsActions />
      </div>
    </GameStage>
  );
}
