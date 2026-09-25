/**
 * Narrative panel with a skippable typewriter reveal (instant with reduced motion).
 * Screen readers get the full text at once; the animated copy is aria-hidden.
 * Mount it with `key={sceneRev}` so every scene starts a fresh reveal.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconButton } from '@dascade/ui';
import { useApp } from '../../app/store.ts';
import { emphasis } from './util.ts';

const CPS = 115;
const PAUSE: Record<string, number> = { '.': 5, '!': 5, '?': 5, '—': 4, ',': 2, ':': 3, '…': 5 };

interface Token {
  text: string;
  em: boolean;
  para: number;
}

export function Narrative({ paragraphs, onDone }: { paragraphs: string[]; onDone?: () => void }) {
  const reduced = useApp((s) => s.settings.reducedMotion);
  const tokens = useMemo<Token[]>(() => paragraphs.flatMap((p, para) => emphasis(p).map((seg) => ({ ...seg, para }))), [paragraphs]);
  const text = useMemo(() => tokens.map((t) => t.text).join(''), [tokens]);
  const total = text.length;
  const [typed, setShown] = useState(reduced ? total : 0);
  // Turning reduced motion on mid-reveal shows everything at once (and `typed` may exceed a
  // shorter re-rendered text, e.g. after an item changes an interpolated count).
  const shown = reduced ? total : Math.min(typed, total);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (shown >= total) {
      doneRef.current?.();
      return;
    }
    let raf = 0;
    let budget = 0;
    let last = performance.now();
    let idx = shown;
    const step = (now: number) => {
      budget += ((now - last) / 1000) * CPS;
      last = now;
      while (idx < total) {
        const cost = PAUSE[text[idx]!] ?? 1;
        if (budget < cost) break;
        budget -= cost;
        idx++;
      }
      setShown(idx);
      if (idx < total) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // `shown` is intentionally read only when the reveal (re)starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, text, shown >= total]);

  const typing = shown < total;
  const skip = () => setShown(total);

  // Build the visible paragraphs up to `shown` characters.
  const visible: Array<Array<{ text: string; em: boolean }>> = paragraphs.map(() => []);
  let left = shown;
  for (const t of tokens) {
    if (left <= 0) break;
    const part = t.text.slice(0, left);
    left -= part.length;
    visible[t.para]!.push({ text: part, em: t.em });
  }
  const lastPara = visible.reduce((acc, segs, i) => (segs.length ? i : acc), 0);

  return (
    <div className="qs-narrative" data-typing={typing ? 'true' : undefined}>
      <div className="visually-hidden" aria-live="polite">
        {paragraphs.join(' ')}
      </div>
      <div className="qs-narrative__text" aria-hidden onClick={typing ? skip : undefined}>
        {paragraphs.map((p, i) => (
          <p key={i} className="qs-narrative__p" data-pending={visible[i]!.length === 0 ? 'true' : undefined}>
            {visible[i]!.map((seg, j) => (seg.em ? <em key={j}>{seg.text}</em> : <span key={j}>{seg.text}</span>))}
            {typing && i === lastPara ? <span className="qs-caret" /> : null}
            {/* Reserve the final height so the layout doesn't jump while typing. */}
            <span className="qs-narrative__ghost">{emphasis(p).map((seg) => seg.text).join('').slice(visible[i]!.reduce((n, s) => n + s.text.length, 0))}</span>
          </p>
        ))}
      </div>
      {typing ? <IconButton className="qs-narrative__skip" icon="arrow-right" label="Show full text" size="sm" onClick={skip} /> : null}
    </div>
  );
}
