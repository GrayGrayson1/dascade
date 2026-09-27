/**
 * Elimination bracket, responsive: the spatial tree on wide screens (with a "Rounds" toggle), the
 * round-by-round strip on phones. Both render the same view-model.
 */
import { useState } from 'react';
import { Segmented } from '@dascade/ui';
import { WIDE_QUERY, useMediaQuery } from '../hooks.ts';
import { BracketCanvas } from './BracketCanvas.tsx';
import { RoundsView } from './RoundsView.tsx';
import type { BracketVM } from './types.ts';

type Mode = 'tree' | 'rounds';

export function BracketView({
  vm,
  onSelect,
  label = 'Tournament bracket',
}: {
  vm: BracketVM;
  onSelect: (matchId: string) => void;
  label?: string;
}) {
  const wide = useMediaQuery(WIDE_QUERY);
  const [mode, setMode] = useState<Mode>('tree');
  const hasMatches = vm.sections.some((s) => s.rounds.some((r) => r.matches.length > 0));
  if (!hasMatches) return <p className="dc-muted tc-empty">The bracket is drawn when the organizer starts the tournament.</p>;
  const tree = wide && mode === 'tree';
  return (
    <div className="tc-bracket">
      {wide ? (
        <div className="tc-bracket__bar">
          <Segmented<Mode>
            label="Bracket layout"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'tree', label: 'Bracket' },
              { value: 'rounds', label: 'Rounds' },
            ]}
          />
          <span className="tc-bracket__legend" aria-hidden>
            <i data-k="live" /> Live <i data-k="ready" /> Ready <i data-k="done" /> Final <i data-k="me" /> You
          </span>
        </div>
      ) : null}
      {tree ? <BracketCanvas vm={vm} onSelect={onSelect} label={label} /> : <RoundsView vm={vm} onSelect={onSelect} />}
    </div>
  );
}
