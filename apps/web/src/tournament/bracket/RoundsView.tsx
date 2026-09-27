/**
 * Round-by-round bracket for phones (and the "Rounds" toggle on desktop): one full-width column
 * per round in a horizontal scroll-snap strip, with a round picker that follows the scroll. A
 * double-elimination bracket gets a section switch (Winners / Losers / Finals). Never a shrunk tree.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PixelIcon, Segmented, cx } from '@dascade/ui';
import { useApp } from '../../app/store.ts';
import { MatchCard } from './MatchCard.tsx';
import type { BracketVM, RoundVM, SectionId } from './types.ts';

/** Round to open first: the viewer's live/ready round, else the first unfinished round, else the last. */
export function initialRoundIndex(rounds: RoundVM[]): number {
  const mine = rounds.findIndex((r) => r.matches.some((m) => m.involvesMe && (m.status === 'ready' || m.status === 'live')));
  if (mine >= 0) return mine;
  const open = rounds.findIndex((r) => r.state !== 'done');
  return open >= 0 ? open : Math.max(0, rounds.length - 1);
}

export function initialSection(vm: BracketVM): SectionId {
  for (const s of vm.sections)
    if (s.rounds.some((r) => r.matches.some((m) => m.involvesMe && (m.status === 'ready' || m.status === 'live')))) return s.id;
  const open = vm.sections.find((s) => s.rounds.some((r) => r.state === 'live'));
  return open?.id ?? vm.sections[0]?.id ?? 'main';
}

export function RoundsView({
  vm,
  onSelect,
  notes,
}: {
  vm: BracketVM;
  onSelect: (matchId: string) => void;
  /** Per round key, e.g. Swiss byes. */ notes?: Record<string, string>;
}) {
  const sections = vm.sections.filter((s) => s.rounds.length > 0);
  const [sectionId, setSectionId] = useState<SectionId>(() => initialSection(vm));
  const section = sections.find((s) => s.id === sectionId) ?? sections[0];
  const rounds = useMemo(() => section?.rounds ?? [], [section]);
  const [active, setActive] = useState(() => initialRoundIndex(rounds));
  const strip = useRef<HTMLDivElement>(null);
  const programmatic = useRef(false);
  const reducedMotion = useApp((st) => st.settings.reducedMotion);

  const columnLeft = (idx: number): number => {
    const el = strip.current;
    const col = el?.children[idx] as HTMLElement | undefined;
    return el && col ? col.offsetLeft - el.offsetLeft : 0;
  };

  // Jump to the right round when the section changes (and on first render).
  useEffect(() => {
    const idx = initialRoundIndex(rounds);
    setActive(idx);
    strip.current?.scrollTo({ left: columnLeft(idx), behavior: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the section changes
  }, [sectionId]);

  const goTo = (idx: number) => {
    setActive(idx);
    const el = strip.current;
    if (!el) return;
    programmatic.current = true;
    el.scrollTo({ left: columnLeft(idx), behavior: reducedMotion ? 'auto' : 'smooth' });
    window.setTimeout(() => (programmatic.current = false), 450);
  };

  const onScroll = () => {
    const el = strip.current;
    if (!el || programmatic.current) return;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < el.children.length; i++) {
      const d = Math.abs(columnLeft(i) - el.scrollLeft);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best !== active) setActive(best);
  };

  if (!section) return null;
  return (
    <div className="tc-rounds" data-part="bracket-rounds">
      {sections.length > 1 ? (
        <Segmented<SectionId>
          label="Bracket section"
          className="tc-rounds__sections"
          value={section.id}
          onChange={setSectionId}
          options={sections.map((s) => ({
            value: s.id,
            label: s.id === 'winners' ? 'Winners' : s.id === 'losers' ? 'Losers' : s.id === 'finals' ? 'Finals' : s.label,
          }))}
        />
      ) : null}
      <div className="tc-rounds__picker" role="group" aria-label="Rounds">
        {rounds.map((r, i) => (
          <button
            key={r.key}
            type="button"
            className={cx('tc-chip', i === active && 'tc-chip--on')}
            aria-pressed={i === active}
            data-state={r.state}
            onClick={() => goTo(i)}
          >
            {r.label}
          </button>
        ))}
      </div>
      <div className="tc-rounds__strip" ref={strip} onScroll={onScroll}>
        {rounds.map((r, i) => (
          <section key={r.key} className="tc-rounds__col" data-part="bracket-round" aria-label={r.label} aria-hidden={Math.abs(i - active) > 1 || undefined}>
            <h3 className="tc-rounds__title">
              <span>{r.label}</span>
              <span className="tc-rounds__count">
                {r.matches.length} {r.matches.length === 1 ? 'match' : 'matches'}
              </span>
              {rounds.length > 1 ? (
                <span className="tc-rounds__steps">
                  <button
                    type="button"
                    className="tc-rounds__step"
                    disabled={i === 0}
                    onClick={() => goTo(i - 1)}
                    aria-label="Previous round"
                    tabIndex={i === active ? 0 : -1}
                  >
                    <PixelIcon name="arrow-left" />
                  </button>
                  <button
                    type="button"
                    className="tc-rounds__step"
                    disabled={i === rounds.length - 1}
                    onClick={() => goTo(i + 1)}
                    aria-label="Next round"
                    tabIndex={i === active ? 0 : -1}
                  >
                    <PixelIcon name="arrow-right" />
                  </button>
                </span>
              ) : null}
            </h3>
            {notes?.[r.key] ? <p className="tc-rounds__note">{notes[r.key]}</p> : null}
            <div className="tc-rounds__list">
              {r.matches.map((m) => (
                <MatchCard key={m.id} match={m} onSelect={onSelect} fluid />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
