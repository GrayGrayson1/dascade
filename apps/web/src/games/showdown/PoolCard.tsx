/**
 * The pool card (DSP-03 B, PCK-03 C): where a participant learns whether they might be picked, with
 * their private Skip me switch. Phones show the full card above the mini board; the lobby mounts the
 * compact one (`<PoolCard compact />`).
 *
 * Only for participants: it reads this player's private `showdown:me` (`pool`), which the server sends
 * to participants alone — crew, screens, spectators and the presenter get none, so they see nothing.
 * The switch's state comes back in that private payload; nobody else ever learns who skipped.
 */
import { useEffect, useId, useState } from 'react';
import type { ShowdownPublicState } from '@dascade/shared/games/showdown';
import { PixelIcon, Toggle, cx } from '@dascade/ui';
import { useRoomSelector } from '../../net/hooks.ts';
import { useSessionStore } from '../../net/session.ts';
import { showdownApi } from './api.ts';
import { poolStatus } from './poolStatus.ts';
import { useMe, usePicker } from './state.ts';
import './audience-event.css';

/** A switch press waits this long for the server's answer before showing the server's state again (refused). */
const PENDING_MS = 4000;

export function PoolCard({ compact = false }: { compact?: boolean }) {
  const me = useMe();
  const { poolSize } = usePicker();
  const playerId = useSessionStore((s) => s.playerId);
  // Your name as the stage shows it (a moderator's rename lands here at once).
  const name = useRoomSelector<ShowdownPublicState, string>((s) => (playerId ? (s.players?.[playerId]?.name ?? '') : '')) ?? '';
  const pool = me?.pool;
  /** The switch position just pressed, until the server's private payload agrees (or the press is refused). */
  const [pending, setPending] = useState<boolean | null>(null);
  const textId = useId();
  const serverSkip = pool?.skip;
  useEffect(() => {
    if (pending !== null && serverSkip === pending) setPending(null);
  }, [serverSkip, pending]);
  useEffect(() => {
    if (pending === null) return;
    const t = setTimeout(() => setPending(null), PENDING_MS);
    return () => clearTimeout(t);
  }, [pending]);

  if (!pool) return null;
  const skip = pending ?? pool.skip;
  const status = poolStatus({ ...pool, skip }, me?.picked === true, poolSize);
  const flip = (on: boolean) => {
    setPending(on);
    showdownApi.skip(on);
  };
  return (
    <section
      className={cx('sd-panel', 'sdg-pool')}
      data-state={status.key}
      data-compact={compact ? 'true' : undefined}
      aria-label="The picker"
      data-part="showdown-pool-card"
    >
      <span className="sdg-pool__icon" aria-hidden>
        <PixelIcon name={status.icon} size={compact ? 16 : 20} />
      </span>
      {/* A live region: "Your turn's done…", "Skip me is on…" are spoken when they change. */}
      <p id={textId} className="sdg-pool__text" role="status">
        <b>{status.title}</b>
        {!compact && status.detail ? <small>{withNumbers(status.detail)}</small> : null}
      </p>
      <div className="sdg-pool__foot">
        {name && !compact ? (
          <span className="sdg-pool__me">
            On stage as <b>{name}</b>
          </span>
        ) : null}
        <Toggle
          className="sdg-pool__skip"
          label="Skip me"
          checked={skip}
          onChange={flip}
          aria-describedby={textId}
          data-part="showdown-skip-me"
        />
      </div>
    </section>
  );
}

/** Numbers in the house digit face (--font-num), the words around them as text. */
function withNumbers(text: string) {
  return text.split(/(\d+)/).map((part, i) =>
    i % 2 ? (
      <span key={i} className="dc-num">
        {part}
      </span>
    ) : (
      part
    ),
  );
}
