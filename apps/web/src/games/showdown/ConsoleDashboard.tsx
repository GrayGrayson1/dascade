/**
 * The showcase console's Dashboard layout: every console tool open at once, in columns beside the
 * answer sheet and the rail, with the stage preview at the top of the first. It's the default;
 * Classic (the tabbed drawer under the preview, ConsoleDrawer) is one switch away in the console's
 * bar. Both the layout and which tools are folded are remembered in this browser (presentation only).
 *
 * The tools area scrolls up and down, never sideways. Its columns follow its width (never narrower
 * than DASHBOARD_COLUMN_MIN), and each tool keeps its column whatever its content does, so nothing
 * hops about mid-show. On a big, tall screen the room under the answer sheet takes the statuses and
 * logs (UNDER_SHEET) and the room under the rail the small tools (UNDER_RAIL). A tool folds to its
 * title bar; the scene strip's Cards and Cinema (and the awards) unfold theirs and bring it into view.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { PixelIcon } from '@dascade/ui';
import type { DrawerTab } from './ConsoleDrawer.tsx';

export type ConsoleLayout = 'dashboard' | 'classic';

const LAYOUT_KEY = 'dascade:showdown:console-layout';
const FOLDED_KEY = 'dascade:showdown:console-folded';
/** A tools column is never narrower than this (the Cinema and Awards desks need the room). */
export const DASHBOARD_COLUMN_MIN = 360;
const COLUMN_GAP = 12;

function read<T>(key: string, parse: (raw: string | null) => T): T {
  try {
    return parse(localStorage.getItem(key));
  } catch {
    return parse(null);
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the choice lasts until a reload */
  }
}

function parseFolded(raw: string | null): ReadonlySet<string> {
  try {
    const ids: unknown = JSON.parse(raw ?? '[]');
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

let layout: ConsoleLayout = read(LAYOUT_KEY, (v) => (v === 'classic' ? 'classic' : 'dashboard'));
let folded = read(FOLDED_KEY, parseFolded);
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const emit = () => {
  for (const fn of listeners) fn();
};

export function useConsoleLayout(): ConsoleLayout {
  return useSyncExternalStore(
    subscribe,
    () => layout,
    () => layout,
  );
}

export function setConsoleLayout(next: ConsoleLayout): void {
  if (next === layout) return;
  layout = next;
  write(LAYOUT_KEY, next);
  emit();
}

function useFolded(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => folded,
    () => folded,
  );
}

function setFolded(id: string, fold: boolean): void {
  if (folded.has(id) === fold) return;
  const next = new Set(folded);
  if (fold) next.add(id);
  else next.delete(id);
  folded = next;
  write(FOLDED_KEY, JSON.stringify([...next]));
  emit();
}

/** The tools that go under the answer sheet and under the rail on a big, tall screen (ROOMY). */
export const UNDER_SHEET: readonly string[] = ['guesses', 'scores', 'crew'];
export const UNDER_RAIL: readonly string[] = ['fix', 'names'];
const ROOMY = '(min-width: 1700px) and (min-height: 1200px)';

/** A big, tall screen: there's room under the answer sheet and the rail. */
export function useRoomyConsole(): boolean {
  return useSyncExternalStore(
    (fn) => {
      const q = typeof matchMedia === 'function' ? matchMedia(ROOMY) : null;
      q?.addEventListener('change', fn);
      return () => q?.removeEventListener('change', fn);
    },
    () => typeof matchMedia === 'function' && matchMedia(ROOMY).matches,
    () => false,
  );
}

/** Roughly how tall each part runs, so a fixed arrangement comes out even ('lead' is the preview). */
const HEIGHT: Readonly<Record<string, number>> = {
  lead: 4,
  picker: 2,
  sound: 3,
  cards: 4,
  cinema: 4,
  awards: 6,
  fix: 2,
  guesses: 3,
  scores: 4,
  names: 3,
  crew: 4,
  preflight: 5,
};

/**
 * The parts in `n` columns, in order, each into the column that's shortest so far. It depends only
 * on the list and `n` (never on what a tool shows or whether it's folded), so nothing moves mid-show.
 */
export function arrangeColumns(ids: readonly string[], n: number): string[][] {
  const cols = Array.from({ length: Math.max(1, Math.floor(n)) }, () => ({ ids: [] as string[], h: 0 }));
  for (const id of ids) {
    const col = cols.reduce((a, b) => (b.h < a.h ? b : a));
    col.ids.push(id);
    col.h += HEIGHT[id] ?? 3;
  }
  return cols.map((c) => c.ids);
}

/** How many columns fit `width` px. */
export function columnsFor(width: number): number {
  return Math.max(1, Math.floor((width + COLUMN_GAP) / (DASHBOARD_COLUMN_MIN + COLUMN_GAP)));
}

/** Unfolds the tool `focus.id` and brings it into view whenever `focus.n` changes. */
export function useToolFocus(focus: { id: string; n: number } | undefined): void {
  const focusN = focus?.n ?? 0;
  const focusId = focus?.id ?? '';
  useEffect(() => {
    if (focusN <= 0 || !focusId) return;
    setFolded(focusId, false);
    document.querySelector(`[data-tool="${focusId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focusN, focusId]);
}

/** One tool: its title bar (it folds) over its panel. */
function ToolCard({ tab, open }: { tab: DrawerTab; open: boolean }) {
  const id = tab.id;
  return (
    <section
      className="sd-panel sdc-tool"
      aria-labelledby={`sdc-tool-${id}`}
      data-tool={id}
      data-open={open ? 'true' : undefined}
      data-part="showdown-tool"
    >
      <h3 className="sdc-tool__head">
        <button
          type="button"
          id={`sdc-tool-${id}`}
          className="sdc-tool__fold"
          aria-expanded={open}
          aria-controls={`sdc-tool-body-${id}`}
          onClick={() => setFolded(id, open)}
        >
          <PixelIcon name={tab.icon} aria-hidden />
          <span className="sdc-tool__name">{tab.label}</span>
          {tab.alert ? <span className="sdc-tool__alert">{tab.alert}</span> : null}
          <PixelIcon name={open ? 'chevron-up' : 'chevron-down'} className="sdc-tool__chev" aria-hidden />
        </button>
      </h3>
      {open ? (
        <div className="sdc-tool__body" id={`sdc-tool-body-${id}`} data-tab={id}>
          {tab.render()}
        </div>
      ) : null}
    </section>
  );
}

/** Tools stacked in the room under the answer sheet or the rail (it scrolls up and down if it must). */
export function ToolStack({ tabs, where }: { tabs: readonly DrawerTab[]; where: 'sheet' | 'rail' }) {
  const shut = useFolded();
  if (!tabs.length) return null;
  return (
    <div className="sdc-under" data-under={where} data-part="showdown-tools-under">
      {tabs.map((t) => (
        <ToolCard key={t.id} tab={t} open={!shut.has(t.id)} />
      ))}
    </div>
  );
}

export function ConsoleDashboard({ lead, tabs }: { lead: ReactNode; tabs: readonly DrawerTab[] }) {
  const region = useRef<HTMLDivElement>(null);
  const [n, setN] = useState(1);
  useLayoutEffect(() => {
    const el = region.current;
    if (!el) return;
    const fit = () => setN(columnsFor(el.clientWidth));
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const shut = useFolded();
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const columns = arrangeColumns(['lead', ...tabs.map((t) => t.id)], n);
  return (
    <div ref={region} className="sdc-tools" data-columns={n} data-part="showdown-tools">
      {columns.map((ids, c) => (
        <div key={c} className="sdc-tools__col">
          {ids.map((id) => {
            if (id === 'lead') return <div key="lead">{lead}</div>;
            const t = byId.get(id);
            return t ? <ToolCard key={id} tab={t} open={!shut.has(id)} /> : null;
          })}
        </div>
      ))}
    </div>
  );
}

/** The console bar's switch between the two layouts. */
export function LayoutSwitch() {
  const now = useConsoleLayout();
  return (
    <span className="sdc-layout" role="group" aria-label="Console layout" data-part="showdown-layout">
      {(['dashboard', 'classic'] as const).map((id) => (
        <button
          key={id}
          type="button"
          className="sdc-layout__opt"
          aria-pressed={now === id}
          onClick={() => setConsoleLayout(id)}
          data-layout={id}
        >
          {id === 'dashboard' ? 'Dashboard' : 'Classic'}
        </button>
      ))}
    </span>
  );
}
