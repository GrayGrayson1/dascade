/**
 * Host-only custom pack editor: write questions, import JSON / CSV (validated with clear errors),
 * export JSON, save/load packs locally, and send the pack to the room (the server re-validates).
 * The pack never reaches other players: only the host who uploaded it receives the echo, and only
 * between matches. A host who inherited the role sees that a pack exists and may replace or clear it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  TRIVIA_CATEGORIES,
  TRIVIA_CATEGORY_IDS,
  TRIVIA_LIMITS,
  TRIVIA_MSG,
  TRIVIA_TYPE_LABEL,
  TRIVIA_TYPES,
  formatTriviaNumber,
  type TriviaAnyCategoryId,
  type TriviaDifficulty,
  type TriviaPack,
  type TriviaPackEcho,
  type TriviaQuestion,
  type TriviaQuestionType,
} from '@dascade/shared/games/trivia';
import { PACK_CSV_EXAMPLE, packToJson, parsePackCsv, parsePackJson, validatePack } from '@dascade/game-core/trivia';
import { parseNumberAnswer } from '@dascade/game-core/party';
import { Badge, Button, Field, IconButton, Modal, Segmented, Select, Tabs, TextArea, TextInput, cx } from '@dascade/ui';
import { LockNote } from '../_party/index.ts';
import { session, useLatestMessage } from '../../net/hooks.ts';
import { persistence, type Preset } from '../../persistence/index.ts';
import { useApp } from '../../app/store.ts';

const PRESET_KIND = 'trivia-pack';
type Tab = 'questions' | 'add' | 'import' | 'saved';

function answerSummary(q: TriviaQuestion): string {
  switch (q.type) {
    case 'mc':
      return q.options[q.correct] ?? '';
    case 'tf':
      return q.correct ? 'True' : 'False';
    case 'text':
      return q.accept.join(' / ');
    case 'number':
      return formatTriviaNumber(q.correct, q.unit);
    case 'order':
      return q.items.join(' → ');
  }
}

function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `onUploaded(count)` runs after the pack is sent (count 0 = cleared) so settings can follow. */
export function PackEditorButton({ onUploaded }: { onUploaded?: (count: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon="pencil" variant="secondary" onClick={() => setOpen(true)}>
        Edit custom pack
      </Button>
      {open ? <PackEditor onClose={() => setOpen(false)} onUploaded={onUploaded} /> : null}
    </>
  );
}

function PackEditor({ onClose, onUploaded }: { onClose: () => void; onUploaded?: (count: number) => void }) {
  const echo = useLatestMessage<TriviaPackEcho>(TRIVIA_MSG.packEcho);
  const toast = useApp((s) => s.toast);
  const [title, setTitle] = useState(echo?.pack?.title ?? 'Custom pack');
  const [questions, setQuestions] = useState<TriviaQuestion[]>(() => echo?.pack?.questions ?? []);
  const [tab, setTab] = useState<Tab>(questions.length ? 'questions' : 'add');
  const [errors, setErrors] = useState<string[]>([]);
  const serverErrors = echo?.errors ?? [];
  const dirty = useRef(false);

  // The server's echo is the source of truth after a successful upload.
  const lastEcho = useRef(echo);
  useEffect(() => {
    if (echo === lastEcho.current) return;
    lastEcho.current = echo;
    if (echo?.pack && echo.errors.length === 0) {
      dirty.current = false;
      setTitle(echo.pack.title ?? 'Custom pack');
      setQuestions(echo.pack.questions);
    }
  }, [echo]);

  const change = (next: TriviaQuestion[]) => {
    dirty.current = true;
    setQuestions(next);
  };

  const upload = () => {
    if (questions.length === 0) {
      session.send(TRIVIA_MSG.pack, { pack: null });
      toast('info', 'Custom pack cleared.');
      onUploaded?.(0);
      return;
    }
    const pack: TriviaPack = { format: 'dascade-trivia', version: 1, title: title.trim() || 'Custom pack', questions };
    const res = validatePack(pack);
    if (!res.pack) {
      setErrors(res.errors);
      return;
    }
    setErrors([]);
    session.send(TRIVIA_MSG.pack, { pack: res.pack });
    toast('success', `Pack ready: ${res.pack.questions.length} question${res.pack.questions.length === 1 ? '' : 's'}.`);
    onUploaded?.(res.pack.questions.length);
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Custom question pack"
      className="tv-editor"
      footer={
        <>
          <Button
            variant="ghost"
            icon="share"
            onClick={() =>
              download(
                `${(title || 'trivia-pack').replace(/[^\w-]+/g, '-').toLowerCase()}.json`,
                packToJson({ title, questions }),
                'application/json',
              )
            }
            disabled={questions.length === 0}
          >
            Export JSON
          </Button>
          <Button variant="primary" icon="check" onClick={upload}>
            {questions.length === 0 ? 'Clear pack' : 'Use this pack'}
          </Button>
        </>
      }
    >
      <div className="tv-editor__head">
        <Field label="Pack title">
          {({ id }) => (
            <TextInput id={id} value={title} maxLength={TRIVIA_LIMITS.packTitle} onChange={(e) => setTitle(e.currentTarget.value)} />
          )}
        </Field>
        <Badge color="var(--accent)">
          {questions.length}/{TRIVIA_LIMITS.packQuestions} questions
        </Badge>
      </div>
      <Tabs<Tab>
        label="Pack editor"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'questions', label: `Questions (${questions.length})` },
          { value: 'add', label: 'Add question' },
          { value: 'import', label: 'Import' },
          { value: 'saved', label: 'My packs' },
        ]}
      />
      {echo?.hidden && !echo.pack ? (
        <LockNote>
          The room already has a custom pack (“{echo.hidden.title}”, {echo.hidden.total} question{echo.hidden.total === 1 ? '' : 's'})
          written by another host, so its questions and answers stay hidden from you. Write or import a new pack to replace it
          {questions.length === 0 ? ', or use “Clear pack” to remove it' : ''}.
        </LockNote>
      ) : null}
      {errors.length || serverErrors.length ? (
        <ul className="tv-editor__errors" role="alert">
          {[...errors, ...serverErrors].slice(0, 12).map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
      <div className="tv-editor__body">
        {tab === 'questions' ? <QuestionList questions={questions} onChange={change} onAdd={() => setTab('add')} /> : null}
        {tab === 'add' ? (
          <QuestionForm
            onAdd={(q) => {
              if (questions.length >= TRIVIA_LIMITS.packQuestions)
                return setErrors([`A pack holds at most ${TRIVIA_LIMITS.packQuestions} questions.`]);
              change([...questions, q]);
              setErrors([]);
              toast('success', 'Question added.');
            }}
          />
        ) : null}
        {tab === 'import' ? (
          <ImportPanel
            onImport={(pack, mode) => {
              const next = mode === 'replace' ? pack.questions : [...questions, ...pack.questions].slice(0, TRIVIA_LIMITS.packQuestions);
              change(next);
              if (mode === 'replace' && pack.title) setTitle(pack.title);
              setErrors([]);
              setTab('questions');
              toast('success', `Imported ${pack.questions.length} question${pack.questions.length === 1 ? '' : 's'}.`);
            }}
            onErrors={setErrors}
          />
        ) : null}
        {tab === 'saved' ? (
          <SavedPacks
            current={{ title, questions }}
            onLoad={(pack) => {
              change(pack.questions);
              setTitle(pack.title ?? 'Custom pack');
              setTab('questions');
            }}
          />
        ) : null}
      </div>
    </Modal>
  );
}

function QuestionList({
  questions,
  onChange,
  onAdd,
}: {
  questions: TriviaQuestion[];
  onChange: (q: TriviaQuestion[]) => void;
  onAdd: () => void;
}) {
  if (questions.length === 0) {
    return (
      <div className="tv-editor__empty">
        <p>No questions yet. Write your own, or import a JSON / CSV file.</p>
        <Button icon="plus" variant="primary" onClick={onAdd}>
          Add a question
        </Button>
      </div>
    );
  }
  return (
    <ol className="tv-qlist">
      {questions.map((q, i) => (
        <li key={i} className="tv-qlist__item">
          <span className="tv-qlist__num dc-num">{i + 1}</span>
          <div className="tv-qlist__text">
            <strong>{q.prompt}</strong>
            <span className="tv-qlist__meta">
              {TRIVIA_TYPE_LABEL[q.type]} · {TRIVIA_CATEGORIES[q.category].short} · {q.difficulty} ·{' '}
              <span className="tv-qlist__answer">{answerSummary(q)}</span>
            </span>
          </div>
          <div className="tv-qlist__actions">
            <IconButton
              icon="chevron-up"
              label={`Move question ${i + 1} up`}
              size="sm"
              disabled={i === 0}
              onClick={() => onChange(questions.map((x, j) => (j === i - 1 ? questions[i]! : j === i ? questions[i - 1]! : x)))}
            />
            <IconButton
              icon="trash"
              label={`Delete question ${i + 1}`}
              size="sm"
              onClick={() => onChange(questions.filter((_, j) => j !== i))}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

function QuestionForm({ onAdd }: { onAdd: (q: TriviaQuestion) => void }) {
  const [type, setType] = useState<TriviaQuestionType>('mc');
  const [category, setCategory] = useState<TriviaAnyCategoryId>('custom');
  const [difficulty, setDifficulty] = useState<TriviaDifficulty>('medium');
  const [prompt, setPrompt] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const [correct, setCorrect] = useState(0);
  const [tf, setTf] = useState<'true' | 'false'>('true');
  const [accept, setAccept] = useState('');
  const [num, setNum] = useState('');
  const [unit, setUnit] = useState('');
  const [items, setItems] = useState(['', '', '', '']);
  const [ends, setEnds] = useState<[string, string]>(['First', 'Last']);
  const [explanation, setExplanation] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPrompt('');
    setOptions(['', '', '', '']);
    setCorrect(0);
    setAccept('');
    setNum('');
    setUnit('');
    setItems(['', '', '', '']);
    setExplanation('');
  };

  const build = (): TriviaQuestion | string => {
    const base = { category, difficulty, prompt: prompt.trim(), ...(explanation.trim() ? { explanation: explanation.trim() } : {}) };
    if (!base.prompt) return 'Write the question first.';
    switch (type) {
      case 'mc': {
        const filled = options.map((o) => o.trim());
        if (!filled[correct]) return 'The correct option is empty.';
        const kept = filled.map((o, i) => ({ o, i })).filter((x) => x.o);
        if (kept.length < 2) return 'Add at least two options.';
        return { ...base, type: 'mc', options: kept.map((x) => x.o), correct: kept.findIndex((x) => x.i === correct) };
      }
      case 'tf':
        return { ...base, type: 'tf', correct: tf === 'true' };
      case 'text': {
        const list = accept
          .split(/[\n,;]/)
          .map((a) => a.trim())
          .filter(Boolean);
        if (list.length === 0) return 'Add at least one accepted answer.';
        return { ...base, type: 'text', accept: list.slice(0, TRIVIA_LIMITS.accept) };
      }
      case 'number': {
        const n = parseNumberAnswer(num);
        if (n === null) return 'The answer must be a number.';
        return { ...base, type: 'number', correct: n, ...(unit.trim() ? { unit: unit.trim() } : {}) };
      }
      case 'order': {
        const list = items.map((x) => x.trim()).filter(Boolean);
        if (list.length < 3) return 'Add at least three items (in the correct order).';
        return { ...base, type: 'order', items: list, ends: [ends[0].trim() || 'First', ends[1].trim() || 'Last'] };
      }
    }
  };

  const add = () => {
    const q = build();
    if (typeof q === 'string') return setError(q);
    const res = validatePack({ questions: [q] });
    if (!res.pack) return setError(res.errors[0]?.replace(/^Question 1 — /, '') ?? 'Invalid question.');
    setError(null);
    onAdd(res.pack.questions[0]!);
    reset();
  };

  return (
    <div className="tv-qform">
      <div className="tv-qform__row">
        <div className="dc-field">
          <span className="dc-field__label">Type</span>
          <Segmented<TriviaQuestionType>
            label="Question type"
            value={type}
            onChange={setType}
            options={TRIVIA_TYPES.map((t) => ({ value: t, label: TRIVIA_TYPE_LABEL[t] }))}
          />
        </div>
      </div>
      <div className="tv-qform__row tv-qform__row--2">
        <Field label="Category">
          {({ id }) => (
            <Select id={id} value={category} onChange={(e) => setCategory(e.currentTarget.value as TriviaAnyCategoryId)}>
              {(['custom', ...TRIVIA_CATEGORY_IDS] as TriviaAnyCategoryId[]).map((c) => (
                <option key={c} value={c}>
                  {TRIVIA_CATEGORIES[c].title}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="dc-field">
          <span className="dc-field__label">Difficulty</span>
          <Segmented<TriviaDifficulty>
            label="Difficulty"
            value={difficulty}
            onChange={setDifficulty}
            options={(['easy', 'medium', 'hard'] as const).map((d) => ({ value: d, label: d[0]!.toUpperCase() + d.slice(1) }))}
          />
        </div>
      </div>
      <Field
        label="Question"
        aside={
          <span className="dc-num">
            {prompt.length}/{TRIVIA_LIMITS.prompt}
          </span>
        }
      >
        {({ id }) => (
          <TextArea
            id={id}
            rows={2}
            value={prompt}
            maxLength={TRIVIA_LIMITS.prompt}
            onChange={(e) => setPrompt(e.currentTarget.value)}
            placeholder="What is the name of our office plant?"
          />
        )}
      </Field>

      {type === 'mc' ? (
        <fieldset className="tv-qform__options">
          <legend className="dc-field__label">Options — select the correct one</legend>
          {options.map((o, i) => (
            <div key={i} className="tv-qform__option">
              <input
                type="radio"
                name="tv-correct"
                checked={correct === i}
                onChange={() => setCorrect(i)}
                aria-label={`Option ${i + 1} is correct`}
              />
              <TextInput
                value={o}
                maxLength={TRIVIA_LIMITS.option}
                placeholder={`Option ${i + 1}${i >= 2 ? ' (optional)' : ''}`}
                aria-label={`Option ${i + 1}`}
                onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.currentTarget.value : x)))}
              />
            </div>
          ))}
          {options.length < TRIVIA_LIMITS.maxOptions ? (
            <Button size="sm" variant="ghost" icon="plus" onClick={() => setOptions([...options, ''])}>
              Another option
            </Button>
          ) : null}
        </fieldset>
      ) : null}
      {type === 'tf' ? (
        <div className="dc-field">
          <span className="dc-field__label">The statement is…</span>
          <Segmented<'true' | 'false'>
            label="Correct answer"
            value={tf}
            onChange={setTf}
            options={[
              { value: 'true', label: 'True' },
              { value: 'false', label: 'False' },
            ]}
          />
        </div>
      ) : null}
      {type === 'text' ? (
        <Field
          label="Accepted answers"
          hint="One per line (or comma separated). The first is shown at the reveal. Case, accents and small typos are forgiven automatically."
        >
          {({ id, describedBy }) => (
            <TextArea
              id={id}
              aria-describedby={describedBy}
              rows={3}
              value={accept}
              onChange={(e) => setAccept(e.currentTarget.value)}
              placeholder={'Fernando\nFern'}
            />
          )}
        </Field>
      ) : null}
      {type === 'number' ? (
        <div className="tv-qform__row tv-qform__row--2">
          <Field label="Answer" hint="Closest guess wins.">
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                inputMode="decimal"
                value={num}
                onChange={(e) => setNum(e.currentTarget.value)}
                placeholder="42"
              />
            )}
          </Field>
          <Field label="Unit (optional)">
            {({ id }) => (
              <TextInput
                id={id}
                value={unit}
                maxLength={TRIVIA_LIMITS.unit}
                onChange={(e) => setUnit(e.currentTarget.value)}
                placeholder="steps"
              />
            )}
          </Field>
        </div>
      ) : null}
      {type === 'order' ? (
        <fieldset className="tv-qform__options">
          <legend className="dc-field__label">Items in the CORRECT order (players see them shuffled)</legend>
          <div className="tv-qform__row tv-qform__row--2">
            <TextInput
              value={ends[0]}
              maxLength={TRIVIA_LIMITS.endLabel}
              aria-label="Label for the first end"
              onChange={(e) => setEnds([e.currentTarget.value, ends[1]])}
              placeholder="Earliest"
            />
            <TextInput
              value={ends[1]}
              maxLength={TRIVIA_LIMITS.endLabel}
              aria-label="Label for the last end"
              onChange={(e) => setEnds([ends[0], e.currentTarget.value])}
              placeholder="Latest"
            />
          </div>
          {items.map((it, i) => (
            <TextInput
              key={i}
              value={it}
              maxLength={TRIVIA_LIMITS.item}
              aria-label={`Item ${i + 1}`}
              placeholder={`Item ${i + 1}${i >= 3 ? ' (optional)' : ''}`}
              onChange={(e) => setItems(items.map((x, j) => (j === i ? e.currentTarget.value : x)))}
            />
          ))}
          {items.length < TRIVIA_LIMITS.orderMax ? (
            <Button size="sm" variant="ghost" icon="plus" onClick={() => setItems([...items, ''])}>
              Another item
            </Button>
          ) : null}
        </fieldset>
      ) : null}
      <Field label="Fun fact shown at the reveal (optional)">
        {({ id }) => (
          <TextInput
            id={id}
            value={explanation}
            maxLength={TRIVIA_LIMITS.explanation}
            onChange={(e) => setExplanation(e.currentTarget.value)}
          />
        )}
      </Field>
      {error ? (
        <p className="dc-field__error" role="alert">
          {error}
        </p>
      ) : null}
      <Button variant="primary" icon="plus" onClick={add}>
        Add question
      </Button>
    </div>
  );
}

function ImportPanel({
  onImport,
  onErrors,
}: {
  onImport: (pack: TriviaPack, mode: 'replace' | 'append') => void;
  onErrors: (e: string[]) => void;
}) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'replace' | 'append'>('append');
  const fileRef = useRef<HTMLInputElement>(null);
  const parse = (raw: string, name = '') => {
    const looksJson = /^\s*[[{]/.test(raw) || name.toLowerCase().endsWith('.json');
    const res = looksJson ? parsePackJson(raw) : parsePackCsv(raw, name.replace(/\.[^.]+$/, '') || 'Imported pack');
    if (!res.pack) return onErrors(res.errors.length ? res.errors : ['Nothing could be imported.']);
    onImport(res.pack, mode);
    setText('');
  };
  return (
    <div className="tv-import">
      <div className="dc-field">
        <span className="dc-field__label">Imported questions</span>
        <Segmented<'replace' | 'append'>
          label="Import mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'append', label: 'Add to pack' },
            { value: 'replace', label: 'Replace pack' },
          ]}
        />
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json,.csv,application/json,text/csv"
        className="visually-hidden"
        aria-label="Choose a JSON or CSV file"
        onChange={async (e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!f) return;
          if (f.size > TRIVIA_LIMITS.packBytes)
            return onErrors([`That file is too big (max ${Math.round(TRIVIA_LIMITS.packBytes / 1000)} KB).`]);
          parse(await f.text(), f.name);
        }}
      />
      <div className="tv-import__actions">
        <Button icon="plus" variant="secondary" onClick={() => fileRef.current?.click()}>
          Choose JSON or CSV file…
        </Button>
        <Button icon="share" variant="ghost" onClick={() => download('trivia-template.csv', PACK_CSV_EXAMPLE, 'text/csv')}>
          CSV template
        </Button>
      </div>
      <Field
        label="…or paste JSON / CSV"
        hint="CSV columns: type, category, difficulty, prompt, answer, alt1…alt5, explanation, unit, from, to. For multiple choice, answer = correct option and alt1… = wrong options."
      >
        {({ id, describedBy }) => (
          <TextArea
            id={id}
            aria-describedby={describedBy}
            rows={6}
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            spellCheck={false}
            className="tv-import__paste"
          />
        )}
      </Field>
      <Button variant="primary" icon="check" disabled={!text.trim()} onClick={() => parse(text)}>
        Import pasted text
      </Button>
    </div>
  );
}

function SavedPacks({ current, onLoad }: { current: TriviaPack; onLoad: (p: TriviaPack) => void }) {
  const [presets, setPresets] = useState<Array<Preset<TriviaPack>>>([]);
  const toast = useApp((s) => s.toast);
  const refresh = () =>
    void persistence()
      .listPresets<TriviaPack>(PRESET_KIND)
      .then(setPresets)
      .catch(() => setPresets([]));
  useEffect(refresh, []);
  const canSave = current.questions.length > 0;
  const sorted = useMemo(() => [...presets].sort((a, b) => b.updatedAt - a.updatedAt), [presets]);
  return (
    <div className="tv-saved">
      <Button
        icon="star"
        variant="secondary"
        disabled={!canSave}
        onClick={async () => {
          const res = validatePack(current);
          if (!res.pack) return toast('error', res.errors[0] ?? 'This pack has problems.');
          await persistence().savePreset(PRESET_KIND, res.pack.title ?? 'Custom pack', res.pack);
          toast('success', 'Pack saved on this device.');
          refresh();
        }}
      >
        Save current pack
      </Button>
      {sorted.length === 0 ? (
        <p className="dc-muted">No saved packs yet.</p>
      ) : (
        <ul className="tv-saved__list">
          {sorted.map((p) => (
            <li key={p.id} className={cx('tv-saved__item')}>
              <span className="tv-saved__name">
                <strong>{p.name}</strong>
                <span className="dc-muted dc-num"> · {p.data.questions?.length ?? 0} questions</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const res = validatePack(p.data);
                  if (!res.pack) return toast('error', res.errors[0] ?? 'This saved pack is damaged.');
                  onLoad(res.pack);
                }}
              >
                Load
              </Button>
              <IconButton
                icon="trash"
                size="sm"
                label={`Delete ${p.name}`}
                onClick={async () => {
                  await persistence().deletePreset(PRESET_KIND, p.id);
                  refresh();
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
