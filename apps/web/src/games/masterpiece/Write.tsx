/**
 * Writing stage: the player's private prompt(s), a composer with a live character count and a
 * "Need a spark?" starter, and the hand-in state. Spectators see the studio while artists work.
 *
 * Phones: the composer sits right under the prompt and scrolls itself into view when the
 * keyboard opens; two-line stories use two single-line inputs (no Shift+Enter needed).
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button, PixelArt, PixelIcon, cx } from '@dascade/ui';
import { MASTERPIECE_MSG, MP_PROMPT_TYPE_INFO, answerLength, type MasterpiecePublicState, type MpAssignment, type MpPrivate, type MpPromptType } from '@dascade/shared/games/masterpiece';
import { SAFETY_ANSWERS } from '@dascade/game-core/masterpiece';
import { session } from '../../net/hooks.ts';
import { sfx } from '../../audio/audio.ts';
import { LockNote, usePartyFx } from '../_party/index.ts';
import { MP_ART, THEME_ICON } from './art.tsx';

// Drafts survive re-renders, stage remounts and reconnects (per tab).
const drafts = new Map<string, string[]>();
const DRAFT_KEY = 'dascade:mp-drafts';
function loadDraft(id: string): string[] {
  if (drafts.has(id)) return drafts.get(id)!;
  try {
    const stored = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}') as Record<string, string[]>;
    if (Array.isArray(stored[id])) return stored[id]!.map((s) => String(s));
  } catch {
    /* storage unavailable: drafts stay in memory only */
  }
  return [];
}
function saveDraft(id: string, lines: string[]): void {
  drafts.set(id, lines);
  try {
    const stored = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}') as Record<string, string[]>;
    stored[id] = lines;
    const keys = Object.keys(stored);
    for (const k of keys.slice(0, Math.max(0, keys.length - 8))) delete stored[k];
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(stored));
  } catch {
    /* storage unavailable: drafts stay in memory only */
  }
}

let sparkTurn = 0;

/** Prompt text with the theme's lead-in. Definitions show the made-up word big. */
export function PromptPlacard({ type, prompt, kicker, compact, note }: { type: MpPromptType; prompt: string; kicker?: string; compact?: boolean; note?: string }) {
  const info = MP_PROMPT_TYPE_INFO[type];
  const def = type === 'definition' ? /^(.*) \(([a-z]+)\)$/u.exec(prompt) : null;
  return (
    <article className={cx('mp-placard', compact && 'mp-placard--compact')} data-type={type}>
      <p className="mp-placard__kicker">
        <PixelIcon name={THEME_ICON[type]} size={12} />
        <span>{kicker ?? info.lead}</span>
      </p>
      {def ? (
        <h2 className="mp-placard__word">
          {def[1]} <em className="mp-placard__pos">{def[2]}</em>
        </h2>
      ) : (
        <h2 className="mp-placard__text">{prompt}</h2>
      )}
      {note ? <p className="mp-placard__note">{note}</p> : null}
    </article>
  );
}

export function WriteStage({ state, priv }: { state: MasterpiecePublicState; priv: MpPrivate | null }) {
  const assignments = priv?.assignments ?? [];
  if (!priv) return <p className="mp-muted">Dealing your prompts…</p>;
  if (priv.role !== 'writer' || assignments.length === 0) return <StudioWait state={state} audience={priv.role === 'audience'} />;
  return <WriterDesk assignments={assignments} />;
}

function WriterDesk({ assignments }: { assignments: MpAssignment[] }) {
  const firstOpen = assignments.findIndex((a) => a.answer === null);
  const [active, setActive] = useState(firstOpen >= 0 ? firstOpen : 0);
  const done = assignments.filter((a) => a.answer !== null).length;
  const allDone = done === assignments.length;
  const prevDone = useRef(done);
  useEffect(() => {
    // An answer was accepted: move on to the next open prompt.
    if (done > prevDone.current) {
      const next = assignments.findIndex((a) => a.answer === null);
      if (next >= 0) setActive(next);
    }
    prevDone.current = done;
  }, [done, assignments]);

  if (allDone) {
    return (
      <div className="mp-handedin">
        <PixelArt rows={MP_ART.easel} className="mp-handedin__art" />
        <h2 className="mp-handedin__title">All handed in!</h2>
        <p className="mp-muted">Your {assignments.length === 1 ? 'answer is' : `${assignments.length} answers are`} waiting in the vault. Nobody sees who wrote what until the votes are counted.</p>
        <ul className="mp-handedin__list">
          {assignments.map((a) => (
            <li key={a.showdownId} className="mp-mini">
              <span className="mp-mini__prompt">{a.prompt}</span>
              <span className="mp-mini__answer">{a.answer}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const current = assignments[Math.min(active, assignments.length - 1)]!;
  return (
    <div className="mp-write">
      {assignments.length > 1 ? (
        <div className="mp-write__tabs" role="tablist" aria-label="Your prompts">
          {assignments.map((a, i) => (
            <button
              key={a.showdownId}
              type="button"
              role="tab"
              aria-selected={i === active}
              className="mp-write__tab"
              data-done={a.answer !== null ? 'true' : undefined}
              onClick={() => setActive(i)}
            >
              {a.answer !== null ? <PixelIcon name="check" size={12} /> : <span className="dc-num">{i + 1}</span>}
              <span>Prompt {i + 1}</span>
            </button>
          ))}
          <span className="mp-write__progress dc-num" aria-live="polite">
            {done}/{assignments.length} handed in
          </span>
        </div>
      ) : null}
      <PromptPlacard type={current.type} prompt={current.prompt} note={MP_PROMPT_TYPE_INFO[current.type].instruction} />
      {current.answer !== null ? (
        <div className="mp-handed">
          <LockNote tone="success">Handed in</LockNote>
          <p className="mp-handed__text">{current.answer}</p>
        </div>
      ) : (
        <Composer key={current.showdownId} assignment={current} />
      )}
    </div>
  );
}

function Composer({ assignment }: { assignment: MpAssignment }) {
  const info = MP_PROMPT_TYPE_INFO[assignment.type];
  const lineCount = info.multiline ? 2 : 1;
  const perLine = info.multiline ? Math.floor(info.maxLength / 2) : info.maxLength;
  const [lines, setLines] = useState<string[]>(() => {
    const d = loadDraft(assignment.showdownId);
    return Array.from({ length: lineCount }, (_, i) => d[i] ?? '');
  });
  const [sending, setSending] = useState(false);
  const fx = usePartyFx();
  const formRef = useRef<HTMLFormElement>(null);
  const text = lines.map((l) => l.trim()).filter(Boolean).join('\n');
  const length = answerLength(lines.join(info.multiline ? '\n' : ''));
  const over = length > info.maxLength;
  const empty = text.length === 0;
  const fine = useMemo(() => typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches, []);

  useEffect(() => {
    if (!sending) return;
    const t = setTimeout(() => setSending(false), 4000);
    return () => clearTimeout(t);
  }, [sending]);

  const update = (i: number, value: string) => {
    const next = lines.slice();
    next[i] = value.replace(/[\r\n]+/gu, ' ');
    setLines(next);
    saveDraft(assignment.showdownId, next);
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (empty || over || sending) return;
    setSending(true);
    sfx('pop');
    session.send(MASTERPIECE_MSG.submit, { showdownId: assignment.showdownId, text });
  };

  const spark = () => {
    const fits = SAFETY_ANSWERS.filter((s) => s.length <= perLine);
    const seed = Array.from(assignment.showdownId).reduce((n, c) => n + c.charCodeAt(0), 0);
    const pick = fits[(seed + sparkTurn++) % fits.length] ?? '';
    const next = lines.slice();
    next[0] = pick;
    setLines(next);
    saveDraft(assignment.showdownId, next);
    sfx('select');
  };

  const onKey = (i: number) => (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (info.multiline && i === 0) {
      formRef.current?.querySelector<HTMLInputElement>('input[data-line="1"]')?.focus();
      return;
    }
    submit();
  };

  // Phones: when the keyboard opens, line the prompt up under the top bar so the prompt, the
  // answer box and (on most phones) the hand-in button all stay visible above the keyboard.
  const onFocus = () => {
    if (fine) return;
    setTimeout(() => {
      const placard = formRef.current?.closest('.mp-write')?.querySelector('.mp-placard');
      (placard ?? formRef.current)?.scrollIntoView({ block: 'start', behavior: fx.motion ? 'smooth' : 'auto' });
    }, 280);
  };

  return (
    <form ref={formRef} className="mp-compose" onSubmit={submit} data-over={over ? 'true' : undefined}>
      {info.multiline ? (
        <div className="mp-compose__lines">
          {lines.map((line, i) => (
            <label key={i} className="mp-compose__line">
              <span className="mp-compose__label">Line {i + 1}</span>
              <input
                className="dc-input mp-compose__input"
                data-line={i}
                value={line}
                maxLength={perLine}
                placeholder={i === 0 ? 'Line one…' : 'Line two…'}
                autoComplete="off"
                autoCapitalize="sentences"
                enterKeyHint={i === 0 ? 'next' : 'send'}
                aria-label={`Your story, line ${i + 1}`}
                autoFocus={fine && i === 0}
                onFocus={onFocus}
                onKeyDown={onKey(i)}
                onChange={(e) => update(i, e.currentTarget.value)}
              />
            </label>
          ))}
        </div>
      ) : (
        <textarea
          className="dc-input mp-compose__area"
          value={lines[0]}
          rows={assignment.type === 'name' ? 1 : 3}
          maxLength={info.maxLength}
          placeholder={info.placeholder}
          aria-label="Your answer"
          autoComplete="off"
          autoCapitalize="sentences"
          spellCheck
          enterKeyHint="send"
          autoFocus={fine}
          onFocus={onFocus}
          onKeyDown={onKey(0)}
          onChange={(e) => update(0, e.currentTarget.value)}
        />
      )}
      <div className="mp-compose__bar">
        <span className={cx('mp-compose__count dc-num', length > info.maxLength * 0.85 && 'is-near')} aria-live="polite" aria-label={`${length} of ${info.maxLength} characters`}>
          {length}/{info.maxLength}
        </span>
        <Button type="button" variant="ghost" size="md" icon="sparkle" onClick={spark} aria-label="Need a spark?" title="Need a spark?" className="mp-compose__spark">
          <span className="mp-compose__spark-label">Need a spark?</span>
        </Button>
        <Button type="submit" variant="primary" size="lg" icon={sending ? undefined : 'check'} disabled={empty || over || sending} className="mp-compose__submit">
          {sending ? 'Handing in…' : 'Hand it in'}
        </Button>
      </div>
    </form>
  );
}

function StudioWait({ state, audience }: { state: MasterpiecePublicState; audience: boolean }) {
  const writers = Object.keys(state.written ?? {}).length;
  const finished = Object.entries(state.seats ?? {}).filter(([id, s]) => s.answered && id in (state.written ?? {})).length;
  return (
    <div className="mp-studio">
      <PixelArt rows={MP_ART.easel} className="mp-studio__art" />
      <h2 className="mp-studio__title">The artists are at work</h2>
      <p className="mp-muted">
        <span className="dc-num">{finished}</span> of <span className="dc-num">{writers}</span> finished.{' '}
        {audience ? 'You’re in the audience — your vote earns the crowd favourite a bonus when the exhibits go up.' : 'Sit tight — the exhibits go up soon.'}
      </p>
    </div>
  );
}
