/**
 * The public adventure log: scenes, votes, tie-breaks, rolls and consequences.
 */
import { useEffect, useRef } from 'react';
import { PixelIcon, cx, type IconName } from '@dascade/ui';
import type { QuestLogEntryView } from '@dascade/shared/games/quest';

const ICON: Record<QuestLogEntryView['kind'], IconName> = {
  scene: 'flag',
  vote: 'users',
  roll: 'dice',
  effect: 'sparkle',
  tie: 'warning',
  item: 'heart',
  system: 'info',
  ending: 'trophy',
};

export function AdventureLog({ entries, className }: { entries: QuestLogEntryView[]; className?: string }) {
  const ref = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const last = entries.at(-1)?.id ?? 0;
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [last]);
  return (
    <ol
      ref={ref}
      className={cx('qs-log', className)}
      aria-label="Adventure log"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
      }}
    >
      {entries.length === 0 ? <li className="qs-empty">Nothing has happened yet. Give it a minute.</li> : null}
      {entries.map((e) => (
        <li key={e.id} className="qs-log__item" data-kind={e.kind} data-tone={e.tone || undefined}>
          <PixelIcon name={ICON[e.kind] ?? 'info'} className="qs-log__icon" />
          <span className="qs-log__text">{e.text}</span>
          {e.kind === 'scene' ? <span className="qs-log__turn">T{e.turn}</span> : null}
        </li>
      ))}
    </ol>
  );
}
