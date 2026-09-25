/**
 * Side-rail content for the stage: result history and the participant list.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import type { PlayerView } from '@dascade/shared';
import type { WheelHistoryView } from '@dascade/shared/games/wheel';
import { Badge, Button, EmptyState, PlayerChip, cx } from '@dascade/ui';
import { serverNow } from '../../net/hooks.ts';
import { relativeTime } from './model.ts';

function useNowTicker(ms = 15_000): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function HistoryList({
  history,
  total,
  canReset,
  resetDisabled,
  onReset,
}: {
  history: WheelHistoryView[];
  total: number;
  canReset: boolean;
  resetDisabled: boolean;
  onReset: () => void;
}) {
  const now = useNowTicker();
  const [confirming, setConfirming] = useState(false);
  if (history.length === 0) {
    return (
      <EmptyState icon="clock" title="No spins yet">
        Results land here, newest first.
      </EmptyState>
    );
  }
  const items = [...history].reverse();
  return (
    <div className="wh-history">
      <div className="wh-history__head">
        <span className="dc-muted">
          {total} spin{total === 1 ? '' : 's'} this session{history.length < total ? ` · last ${history.length} shown` : ''}
        </span>
        {canReset ? (
          confirming ? (
            <span className="dc-row" style={{ gap: 4 }}>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  setConfirming(false);
                  onReset();
                }}
              >
                Clear history
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" icon="trash" disabled={resetDisabled} onClick={() => setConfirming(true)}>
              Reset history
            </Button>
          )
        ) : null}
      </div>
      <ol className="wh-history__list" aria-label="Spin results, newest first">
        {items.map((h, i) => (
          <li key={`${h.spinId}-${h.at}`} className={cx('wh-history__item', i === 0 && 'is-latest')} style={{ '--c': h.color } as CSSProperties}>
            <span className="wh-history__num dc-num">#{h.spinId}</span>
            <span className="wh-chip" aria-hidden>
              {h.emoji}
            </span>
            <span className="wh-history__body">
              <span className="wh-history__label">{h.label || h.emoji}</span>
              <span className="wh-history__meta">
                {h.spunByName} · {relativeTime(h.at, now)}
              </span>
            </span>
            {i === 0 ? <Badge color="var(--accent)">Latest</Badge> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ParticipantList({ players, meId, anyoneCanSpin }: { players: PlayerView[]; meId: string | null; anyoneCanSpin: boolean }) {
  const sorted = [...players].sort((a, b) => Number(a.spectator) - Number(b.spectator) || b.score - a.score || a.joinOrder - b.joinOrder);
  return (
    <ul className="wh-people" aria-label="Participants">
      {sorted.map((p) => (
        <li key={p.id} className="wh-people__item">
          <PlayerChip
            name={p.name}
            avatar={p.avatar}
            color={p.color}
            isHost={p.isHost}
            isYou={p.id === meId}
            connected={p.connected}
            spectator={p.spectator}
            size={32}
            meta={!p.spectator && (p.isHost || anyoneCanSpin) ? <Badge color="var(--green)">Can spin</Badge> : null}
          />
          <span className="wh-people__spins dc-num" title="Spins">
            {p.score > 0 ? `${p.score} spin${p.score === 1 ? '' : 's'}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}
