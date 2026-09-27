/**
 * Custom Survey editor (host only). Questions are validated live with the same rules the server
 * applies (validateCustomSurvey), saved with a host-only message and never enter public state.
 * Surveys can be saved as presets on this device/account and imported/exported as JSON.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SURVEY_LIMITS,
  SURVEY_MODE_INFO,
  SURVEY_MSG,
  SURVEY_QUESTION_MODES,
  SurveyCustomSchema,
  validateCustomSurvey,
  type SurveyCustomPrivate,
  type SurveyCustomQuestionInput,
  type SurveyQuestionMode,
} from '@dascade/shared/games/survey';
import { Button, IconButton, Modal, PixelIcon, Segmented, Select, TextArea, TextInput, cx } from '@dascade/ui';
import { session } from '../../net/hooks.ts';
import { persistence, type Preset } from '../../persistence/index.ts';
import { useApp } from '../../app/store.ts';
import { SLOT_LETTERS } from '../_party/index.ts';

const PRESET_KIND = 'survey-custom';

interface DraftQuestion extends SurveyCustomQuestionInput {
  key: number;
}

let nextKey = 1;
const withKey = (q: SurveyCustomQuestionInput): DraftQuestion => ({ ...q, options: [...q.options], key: nextKey++ });

function blank(mode: SurveyQuestionMode = 'majority'): DraftQuestion {
  if (mode === 'percent') return withKey({ mode, prompt: '', options: ['Yes', 'No'], target: 0 });
  if (mode === 'rank') return withKey({ mode, prompt: '', options: ['', '', ''] });
  return withKey({ mode, prompt: '', options: ['', ''] });
}

const strip = (list: DraftQuestion[]): SurveyCustomQuestionInput[] =>
  list.map(({ mode, prompt, options, target }) =>
    mode === 'percent' ? { mode, prompt, options: [...options], target: target ?? 0 } : { mode, prompt, options: [...options] },
  );

/** Changing a question's kind keeps what it can and pads/trims options to the new limits. */
function convert(q: DraftQuestion, mode: SurveyQuestionMode): DraftQuestion {
  const range = SURVEY_LIMITS.options[mode];
  let options = q.options.slice(0, range.max);
  while (options.length < range.min) options = [...options, ''];
  if (mode === 'percent' && options.every((o) => !o.trim())) options = ['Yes', 'No'];
  return { ...q, mode, options, target: mode === 'percent' ? Math.min(q.target ?? 0, options.length - 1) : undefined };
}

export function CustomEditor({ open, onClose, stored }: { open: boolean; onClose: () => void; stored: SurveyCustomPrivate | null }) {
  const toast = useApp((s) => s.toast);
  const [draft, setDraft] = useState<DraftQuestion[]>([]);
  const [dirty, setDirty] = useState(false);
  const [tools, setTools] = useState(false);
  const wasOpen = useRef(false);

  // Load the stored survey each time the editor opens.
  useEffect(() => {
    if (open && !wasOpen.current) {
      setDraft(
        stored && stored.questions.length
          ? stored.questions.map((q) => withKey({ mode: q.mode, prompt: q.prompt, options: q.options, target: q.target }))
          : [blank()],
      );
      setDirty(false);
      setTools(false);
    }
    wasOpen.current = open;
  }, [open, stored]);

  const report = useMemo(() => validateCustomSurvey(strip(draft)), [draft]);
  const issuesFor = (i: number) => report.issues.filter((x) => x.index === i && x.field !== 'list');
  const blankCount = draft.filter((q) => !q.prompt.trim() && q.options.every((o) => !o.trim() || o === 'Yes' || o === 'No')).length;

  const change = (list: DraftQuestion[]) => {
    setDraft(list);
    setDirty(true);
  };
  const patch = (i: number, next: Partial<DraftQuestion>) => change(draft.map((q, k) => (k === i ? { ...q, ...next } : q)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.length) return;
    const list = [...draft];
    [list[i], list[j]] = [list[j]!, list[i]!];
    change(list);
  };

  const save = () => {
    // Untouched blank cards are dropped silently; everything else goes to the server as-is
    // (bounded) — it re-validates, sanitizes and reports back.
    const keep = draft.filter((q) => q.prompt.trim() || q.options.some((o) => o.trim() && o !== 'Yes' && o !== 'No'));
    session.send(SURVEY_MSG.custom, { questions: strip(keep).slice(0, SURVEY_LIMITS.customQuestions * 2) });
    setDirty(false);
    const valid = validateCustomSurvey(strip(keep)).questions.length;
    toast(valid ? 'success' : 'info', valid ? `Saved ${valid} question${valid === 1 ? '' : 's'}.` : 'Saved — no complete questions yet.');
  };

  const close = () => {
    if (dirty && !window.confirm('Discard unsaved changes to your survey?')) return;
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Custom Survey"
      wide
      className="sv-editor-modal"
      footer={
        <div className="sv-editor__footer">
          <span className={cx('sv-editor__status', report.dropped - blankCount > 0 && 'is-warn')} role="status">
            {report.questions.length} ready
            {report.dropped - blankCount > 0 ? ` · ${report.dropped - blankCount} need fixing` : ''}
            {dirty ? ' · unsaved changes' : ''}
          </span>
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
          <Button variant="primary" icon="check" onClick={save} disabled={!dirty}>
            Save survey
          </Button>
        </div>
      }
    >
      <div className="sv-editor">
        <p className="sv-editor__intro">
          <PixelIcon name="lock" size={12} /> Only you can see these questions until each one is asked. Answers stay anonymous and results
          need at least {SURVEY_LIMITS.minRespondents} answers.
        </p>
        <ol className="sv-editor__list">
          {draft.map((q, i) => (
            <QuestionCard
              key={q.key}
              index={i}
              total={draft.length}
              q={q}
              issues={issuesFor(i).map((x) => x.message)}
              onPatch={(next) => patch(i, next)}
              onMode={(mode) => change(draft.map((d, k) => (k === i ? convert(d, mode) : d)))}
              onMove={(dir) => move(i, dir)}
              onRemove={() => change(draft.filter((_, k) => k !== i))}
            />
          ))}
        </ol>
        <div className="sv-editor__add">
          {SURVEY_QUESTION_MODES.map((mode) => (
            <Button
              key={mode}
              size="sm"
              variant="secondary"
              icon="plus"
              disabled={draft.length >= SURVEY_LIMITS.customQuestions}
              onClick={() => change([...draft, blank(mode)])}
            >
              {SURVEY_MODE_INFO[mode].short}
            </Button>
          ))}
          <span className="sv-editor__count dc-num">
            {draft.length}/{SURVEY_LIMITS.customQuestions}
          </span>
        </div>

        <button type="button" className="sv-editor__toggle" aria-expanded={tools} onClick={() => setTools((t) => !t)}>
          <PixelIcon name={tools ? 'chevron-up' : 'chevron-down'} size={12} /> Saved surveys, import &amp; export
        </button>
        {tools ? (
          <SurveyTools
            questions={strip(draft)}
            onLoad={(list) => {
              change(list.slice(0, SURVEY_LIMITS.customQuestions).map(withKey));
            }}
          />
        ) : null}
      </div>
    </Modal>
  );
}

function QuestionCard({
  index,
  total,
  q,
  issues,
  onPatch,
  onMode,
  onMove,
  onRemove,
}: {
  index: number;
  total: number;
  q: DraftQuestion;
  issues: string[];
  onPatch: (next: Partial<DraftQuestion>) => void;
  onMode: (mode: SurveyQuestionMode) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const range = SURVEY_LIMITS.options[q.mode];
  const promptId = `sv-q-${q.key}`;
  return (
    <li className="sv-qcard" data-invalid={issues.length ? 'true' : undefined} aria-label={`Question ${index + 1}`}>
      <div className="sv-qcard__head">
        <span className="sv-qcard__num dc-num">Q{index + 1}</span>
        <Segmented
          label={`Question ${index + 1} type`}
          value={q.mode}
          options={SURVEY_QUESTION_MODES.map((m) => ({ value: m, label: SURVEY_MODE_INFO[m].short }))}
          onChange={onMode}
        />
        <span className="sv-qcard__tools">
          <IconButton
            icon="chevron-up"
            label={`Move question ${index + 1} up`}
            size="sm"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          />
          <IconButton
            icon="chevron-down"
            label={`Move question ${index + 1} down`}
            size="sm"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          />
          <IconButton icon="trash" label={`Delete question ${index + 1}`} size="sm" onClick={onRemove} />
        </span>
      </div>
      <label className="visually-hidden" htmlFor={promptId}>
        Question {index + 1} text
      </label>
      <TextArea
        id={promptId}
        className="sv-qcard__prompt"
        rows={2}
        value={q.prompt}
        maxLength={SURVEY_LIMITS.promptMax}
        placeholder={
          q.mode === 'percent'
            ? 'e.g. Have you ever been to a concert?'
            : q.mode === 'rank'
              ? 'e.g. Pick the best team snack.'
              : 'e.g. Which would you rather have: a longer lunch or an earlier finish?'
        }
        onChange={(e) => onPatch({ prompt: e.currentTarget.value.replace(/[\r\n]+/g, ' ') })}
      />
      <ul className="sv-qcard__options">
        {q.options.map((opt, k) => (
          <li key={k} className="sv-qcard__option">
            <span className="sv-letter" aria-hidden="true">
              {SLOT_LETTERS[k]}
            </span>
            <TextInput
              value={opt}
              maxLength={SURVEY_LIMITS.optionMax}
              placeholder={`Option ${SLOT_LETTERS[k]}`}
              aria-label={`Question ${index + 1} option ${SLOT_LETTERS[k]}`}
              onChange={(e) => onPatch({ options: q.options.map((o, j) => (j === k ? e.currentTarget.value : o)) })}
            />
            {q.mode === 'percent' ? (
              <label className="sv-qcard__target" title="Players guess what % picked this option">
                <input type="radio" name={`target-${q.key}`} checked={(q.target ?? 0) === k} onChange={() => onPatch({ target: k })} />
                <span>Guess %</span>
              </label>
            ) : null}
            <IconButton
              icon="close"
              label={`Remove option ${SLOT_LETTERS[k]}`}
              size="sm"
              disabled={q.options.length <= range.min}
              onClick={() => {
                const options = q.options.filter((_, j) => j !== k);
                const target = q.target !== undefined ? Math.min(q.target > k ? q.target - 1 : q.target, options.length - 1) : undefined;
                onPatch({ options, target });
              }}
            />
          </li>
        ))}
      </ul>
      <div className="sv-qcard__foot">
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          disabled={q.options.length >= range.max}
          onClick={() => onPatch({ options: [...q.options, ''] })}
        >
          Add option
        </Button>
        <span className="sv-qcard__hint">
          {q.mode === 'percent'
            ? 'Players answer, then guess the % who picked the marked option.'
            : q.mode === 'rank'
              ? `${range.min}–${range.max} options; players predict the vote order.`
              : `${range.min}–${range.max} options; players predict the most popular.`}
        </span>
      </div>
      {issues.length ? (
        <p className="sv-qcard__issue" role="alert">
          <PixelIcon name="warning" size={12} /> {issues[0]}
        </p>
      ) : null}
    </li>
  );
}

function SurveyTools({
  questions,
  onLoad,
}: {
  questions: SurveyCustomQuestionInput[];
  onLoad: (list: SurveyCustomQuestionInput[]) => void;
}) {
  const toast = useApp((s) => s.toast);
  const [presets, setPresets] = useState<Array<Preset<SurveyCustomQuestionInput[]>>>([]);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [json, setJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await persistence().listPresets<SurveyCustomQuestionInput[]>(PRESET_KIND);
      setPresets(list.sort((a, b) => b.updatedAt - a.updatedAt));
    } catch {
      setPresets([]);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const current = presets.find((p) => p.id === selected);
  const savePreset = async () => {
    const clean = name.trim().slice(0, 40);
    if (!clean) return;
    try {
      const saved = await persistence().savePreset(PRESET_KIND, clean, questions, presets.find((p) => p.name === clean)?.id);
      toast('success', `Saved “${saved.name}”`);
      setName('');
      await refresh();
      setSelected(saved.id);
    } catch {
      toast('error', 'Could not save that survey.');
    }
  };

  const importJson = () => {
    try {
      const raw: unknown = JSON.parse(json);
      const parsed = SurveyCustomSchema.safeParse(Array.isArray(raw) ? { questions: raw } : raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        setJsonError(`That JSON doesn’t look like a survey${issue?.path.length ? ` (${issue.path.join('.')}: ${issue.message})` : ''}.`);
        return;
      }
      setJsonError(null);
      onLoad(parsed.data.questions);
      toast(
        'info',
        `Imported ${parsed.data.questions.length} question${parsed.data.questions.length === 1 ? '' : 's'} — review, then Save survey.`,
      );
    } catch {
      setJsonError('That isn’t valid JSON.');
    }
  };

  const exportJson = async () => {
    const text = JSON.stringify({ questions }, null, 2);
    setJson(text);
    try {
      await navigator.clipboard.writeText(text);
      toast('success', 'Survey JSON copied to the clipboard.');
    } catch {
      toast('info', 'Copy the JSON from the box below.');
    }
  };

  return (
    <div className="sv-tools">
      <div className="sv-tools__row">
        <Select
          value={selected}
          aria-label="Saved surveys"
          onChange={(e) => setSelected(e.currentTarget.value)}
          disabled={presets.length === 0}
        >
          <option value="">{presets.length ? 'Choose a saved survey…' : 'No saved surveys yet'}</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.data.length})
            </option>
          ))}
        </Select>
        <Button size="sm" disabled={!current} onClick={() => current && onLoad(current.data)}>
          Load
        </Button>
        <IconButton
          icon="trash"
          label="Delete saved survey"
          size="sm"
          disabled={!current}
          onClick={async () => {
            if (!current) return;
            await persistence().deletePreset(PRESET_KIND, current.id);
            setSelected('');
            await refresh();
          }}
        />
      </div>
      <form
        className="sv-tools__row"
        onSubmit={(e) => {
          e.preventDefault();
          void savePreset();
        }}
      >
        <TextInput
          value={name}
          maxLength={40}
          placeholder="Name this survey"
          aria-label="Survey name"
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Button size="sm" type="submit" variant="secondary" icon="plus" disabled={!name.trim() || questions.length === 0}>
          Save to my surveys
        </Button>
      </form>
      <TextArea
        className="sv-tools__json"
        rows={4}
        value={json}
        spellCheck={false}
        placeholder='Paste survey JSON here, e.g. {"questions":[{"mode":"majority","prompt":"Tea or coffee?","options":["Tea","Coffee"]}]}'
        aria-label="Survey JSON"
        aria-invalid={jsonError ? true : undefined}
        onChange={(e) => {
          setJson(e.currentTarget.value.slice(0, 48_000));
          setJsonError(null);
        }}
      />
      {jsonError ? (
        <p className="dc-field__error" role="alert">
          {jsonError}
        </p>
      ) : null}
      <div className="sv-tools__row">
        <Button size="sm" variant="secondary" icon="arrow-left" disabled={!json.trim()} onClick={importJson}>
          Import JSON
        </Button>
        <Button size="sm" variant="ghost" icon="copy" disabled={questions.length === 0} onClick={() => void exportJson()}>
          Export JSON
        </Button>
      </div>
    </div>
  );
}
