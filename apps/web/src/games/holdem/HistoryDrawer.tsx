/** Slide-over drawer with the hand history (grouped by hand), table chat and the hand rankings. */
import { useEffect, useMemo, type ReactNode } from 'react';
import type { HoldemLogEntry } from '@dascade/shared/games/holdem';
import { IconButton, Tabs, cx } from '@dascade/ui';
import { ChatPanel } from '../../shell/common.tsx';
import { HandRankings } from './HandRankings.tsx';

export type DrawerTab = 'hands' | 'chat' | 'rankings';

const SUIT: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const CARD_RE = /\b([2-9TJQKA])([shdc])\b/g;

/** Renders card codes in a log line as small inline cards ("A♠"). */
function withCards(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(CARD_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const rank = m[1] === 'T' ? '10' : m[1]!;
    const suit = m[2]!;
    out.push(
      <span key={idx} className="hd-log__card" data-red={suit === 'h' || suit === 'd' ? 'true' : undefined}>
        {rank}
        {SUIT[suit]}
      </span>,
    );
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function HistoryDrawer({
  open,
  onClose,
  tab,
  onTab,
  log,
  currentHand,
  heroRanking,
}: {
  open: boolean;
  onClose: () => void;
  tab: DrawerTab;
  onTab: (tab: DrawerTab) => void;
  log: HoldemLogEntry[];
  currentHand: number;
  /** The hero's current row in the hand rankings (null = not holding cards). */
  heroRanking: string | null;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const groups = useMemo(() => {
    const map = new Map<number, HoldemLogEntry[]>();
    for (const e of log) {
      const list = map.get(e.hand) ?? [];
      list.push(e);
      map.set(e.hand, list);
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [log]);

  return (
    <aside className={cx('hd-drawer', open && 'hd-drawer--open')} aria-label="Hand history, chat and hand rankings" aria-hidden={!open} inert={!open}>
      <header className="hd-drawer__head">
        <Tabs
          label="Drawer sections"
          value={tab}
          onChange={onTab}
          tabs={[
            { value: 'hands', label: 'Hand history' },
            { value: 'chat', label: 'Chat' },
            { value: 'rankings', label: 'Rankings' },
          ]}
        />
        <IconButton icon="close" label="Close drawer" size="sm" onClick={onClose} />
      </header>
      {tab === 'hands' ? (
        <div className="hd-log" data-part="history" role="log" aria-label="Hand history">
          {groups.length === 0 ? <p className="hd-log__empty">Hands will be logged here as they’re played.</p> : null}
          {groups.map(([hand, entries]) => (
            <section key={hand} className="hd-log__hand" data-current={hand === currentHand ? 'true' : undefined}>
              <h3 className="hd-log__title">{hand === 0 ? 'Table' : `Hand #${hand}`}</h3>
              <ul>
                {entries.map((e, i) => (
                  <li key={i} className="hd-log__line" data-kind={e.kind}>
                    {e.kind === 'street' || e.kind === 'show' ? withCards(e.text) : e.text}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : tab === 'rankings' ? (
        <HandRankings current={heroRanking} />
      ) : (
        <ChatPanel className="hd-chat" placeholder="Chat with the table…" />
      )}
    </aside>
  );
}
