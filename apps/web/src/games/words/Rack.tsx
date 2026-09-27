/**
 * Anagram Sprint rack: tap letters (phones) or just type (keyboards). Shuffle is local only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { lengthPoints } from '@dascade/shared/games/words';
import { Button, IconButton, cx } from '@dascade/ui';
import { sfx } from '../../audio/audio.ts';

export interface RackProps {
  rack: string;
  disabled?: boolean;
  onSubmit: (word: string) => void;
  flash?: 'good' | 'bad' | null;
}

function shuffled(n: number): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  // Visual shuffle only (not game randomness).
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j] as number, out[i] as number];
  }
  return out;
}

export function RackPlay({ rack, disabled, onSubmit, flash }: RackProps) {
  const letters = rack.split('');
  const [order, setOrder] = useState<number[]>(() => letters.map((_, i) => i));
  const [built, setBuilt] = useState<number[]>([]);

  useEffect(() => {
    setOrder(rack.split('').map((_, i) => i));
    setBuilt([]);
  }, [rack]);

  const word = built.map((i) => letters[i] ?? '').join('');
  const usedSet = useMemo(() => new Set(built), [built]);

  const add = useCallback(
    (i: number) => {
      if (disabled) return;
      setBuilt((b) => (b.includes(i) ? b : [...b, i]));
      sfx('click', 25);
    },
    [disabled],
  );

  const send = useCallback(() => {
    if (disabled || word.length < 3) {
      if (word.length > 0 && word.length < 3) sfx('pop');
      return;
    }
    onSubmit(word);
    setBuilt([]);
  }, [disabled, word, onSubmit]);

  // Physical keyboard: letters pick the first free matching tile, Backspace removes, Enter submits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (target?.closest('dialog')) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        send();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setBuilt((b) => b.slice(0, -1));
      } else if (e.key === 'Escape') {
        setBuilt([]);
      } else if (/^[a-z]$/i.test(e.key)) {
        const ch = e.key.toLowerCase();
        setBuilt((b) => {
          const free = order.find((i) => letters[i] === ch && !b.includes(i));
          if (free === undefined) {
            sfx('pop', 60);
            return b;
          }
          sfx('click', 25);
          return [...b, free];
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [disabled, send, order, letters]);

  return (
    <div className="wd-rack" data-part="rack" data-flash={flash ?? undefined}>
      <div className="wd-rack__build" aria-live="polite">
        <div className="wd-rack__slots" role="group" aria-label={word ? `Your word: ${word.toUpperCase()}` : 'Your word is empty'}>
          {letters.map((_, slot) => {
            const idx = built[slot];
            const ch = idx === undefined ? '' : (letters[idx] ?? '');
            return idx === undefined ? (
              <span key={slot} className="wd-slot" aria-hidden="true" />
            ) : (
              <button key={slot} type="button" className="wd-slot is-filled" aria-label={`Remove ${ch.toUpperCase()}`} disabled={disabled} onClick={() => setBuilt((b) => b.filter((x) => x !== idx))}>
                <span className="wd-tile wd-tile--md" data-part="tile">
                  <span className="wd-tile__face">{ch.toUpperCase()}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="wd-rack__tiles" role="group" aria-label="Rack letters">
        {order.map((i) => {
          const ch = letters[i] ?? '';
          const used = usedSet.has(i);
          return (
            <button key={i} type="button" className={cx('wd-racktile', used && 'is-used')} disabled={disabled || used} aria-label={`Letter ${ch.toUpperCase()}`} onClick={() => add(i)}>
              <span className="wd-tile wd-tile--lg" data-part="tile">
                <span className="wd-tile__face">{ch.toUpperCase()}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="wd-rack__actions">
        <IconButton icon="refresh" label="Shuffle letters" disabled={disabled} onClick={() => setOrder(shuffled(letters.length))} />
        <IconButton icon="arrow-left" label="Delete last letter" disabled={disabled || built.length === 0} onClick={() => setBuilt((b) => b.slice(0, -1))} />
        <Button variant="primary" size="lg" icon="check" disabled={disabled || word.length < 3} onClick={send} className="wd-rack__submit" aria-label="Submit word">
          Submit{word.length >= 3 ? <span className="wd-rack__pts dc-num"> +{lengthPoints(word.length)}</span> : null}
        </Button>
        <IconButton icon="close" label="Clear word" disabled={disabled || built.length === 0} onClick={() => setBuilt([])} />
      </div>
    </div>
  );
}
