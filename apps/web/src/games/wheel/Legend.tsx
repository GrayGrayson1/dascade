/**
 * Read-only views of the wheel: the option legend (with chances) and a compact
 * behaviour summary. Used by non-hosts in the lobby and on the stage.
 */
import { useMemo, type CSSProperties } from 'react';
import { Badge, EmptyState, cx } from '@dascade/ui';
import { normalizeSegments, probabilities } from '@dascade/game-core/wheel';
import type { WheelSettings } from '@dascade/shared/games/wheel';
import { formatDuration, formatPercent } from './model.ts';

export function useChances(settings: Pick<WheelSettings, 'segments'>): Map<string, number> {
  return useMemo(() => {
    const active = normalizeSegments(settings.segments);
    const p = probabilities(active);
    return new Map(active.map((s, i) => [s.id, p[i] ?? 0]));
  }, [settings.segments]);
}

export function BehaviourBadges({ settings }: { settings: WheelSettings }) {
  return (
    <div className="wh-badges" aria-label="Wheel rules">
      <Badge color="var(--accent)" icon="clock">
        {formatDuration(settings.spinDurationMs)} spin
      </Badge>
      <Badge color="var(--accent-2)">{settings.sliceMode === 'weighted' ? 'Sized by weight' : 'Equal slices'}</Badge>
      {settings.afterSpin === 'remove' ? <Badge color="var(--cyan)">Winners removed</Badge> : null}
      {settings.repeats === 'prevent' ? <Badge color="var(--purple)">No back-to-back</Badge> : null}
      <Badge color="var(--green)" icon={settings.spinPermission === 'anyone' ? 'users' : 'crown'}>
        {settings.spinPermission === 'anyone' ? 'Anyone can spin' : 'Host spins'}
      </Badge>
    </div>
  );
}

export function WheelLegend({ settings, lastWinnerId, compact }: { settings: WheelSettings; lastWinnerId?: string; compact?: boolean }) {
  const chances = useChances(settings);
  const segments = settings.segments ?? [];
  if (segments.length === 0) {
    return (
      <EmptyState icon="sparkle" title="The wheel is empty">
        The host hasn’t added any options yet.
      </EmptyState>
    );
  }
  const on = segments.filter((s) => chances.has(s.id)).length;
  return (
    <div className={cx('wh-legend', compact && 'wh-legend--compact')}>
      <p className="wh-legend__summary dc-muted">
        {on} of {segments.length} option{segments.length === 1 ? '' : 's'} on the wheel
      </p>
      <ol className="wh-legend__list">
        {segments.map((s) => {
          const p = chances.get(s.id);
          return (
            <li key={s.id} className={cx('wh-legend__item', p === undefined && 'is-off')} style={{ '--c': s.color, '--p': `${(p ?? 0) * 100}%` } as CSSProperties}>
              <span className="wh-chip" aria-hidden>
                {s.emoji}
              </span>
              <span className="wh-legend__label">{s.label || s.emoji || 'Untitled'}</span>
              {s.id === lastWinnerId ? <Badge color="var(--yellow)">Last</Badge> : null}
              <span className="wh-legend__pct dc-num">{p === undefined ? 'off' : formatPercent(p)}</span>
              <i className="wh-legend__bar" aria-hidden />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
