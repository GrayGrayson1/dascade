/**
 * The presenter's round editor. One round = one board: a category (shown from the title card), the
 * question, an optional "According to …" attribution, up to ten answers — each with an optional
 * small line (artist, year…) and other spellings the audience might type — and, optionally, a
 * special answer that sets off the big celebration. A round is scored (survey points; the board
 * sorts by them) or a ranked list (no points; the order you set with ▲/▼).
 *
 * Saved privately to the room (only the presenter gets the rounds back) and, if you like, on this
 * device: the whole show (rounds + its settings) to restore in a new room, or as a file to share.
 * Validation is the same pure function the server runs (validateShowContent), shown live.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  SHOWDOWN_LIMITS,
  SHOWDOWN_MSG,
  boardTotal,
  resolveShowdownLook,
  roundToInput,
  validateShowContent,
  type ShowdownRoundDef,
  type ShowdownSettings,
} from '@dascade/shared/games/showdown';
import { Badge, Button, IconButton, Modal, NumberInput, Select, TextArea, TextInput, Toggle } from '@dascade/ui';
import { session } from '../../net/hooks.ts';
import { useApp } from '../../app/store.ts';
import { persistence } from '../../persistence/index.ts';
import type { Preset } from '../../persistence/types.ts';
import { seasonClock } from '../../themes/seasonalController.ts';
import { useCustomContent, useRehearsal } from './state.ts';
import { forgetLoadedPreset } from './consoleParts.tsx';
import {
  blankAnswer,
  blankRound,
  describeShowSettings,
  fromInput,
  move,
  nextKey,
  parseShowFile,
  pickShowSettings,
  toInput,
  type DraftAnswer,
  type DraftRound,
  type ShowFile,
  type ShowFileSettings,
} from './consoleDraft.ts';
import './chrome-showcase.css';

/** Rounds-only presets (older): a bare array of rounds. */
const ROUNDS_KIND = 'showdown-show';
/** Whole shows: { rounds, settings }. */
const SHOW_KIND = 'showdown-showfile';

const EXAMPLE = (): DraftRound => ({
  key: nextKey(),
  title: 'Offsite Essentials',
  prompt: 'Name something people bring to a team offsite.',
  source: '',
  special: 0,
  ranked: false,
  answers: [
    ['Laptop', 34, 'computer'],
    ['Snacks', 22, 'food'],
    ['Notebook', 14, 'notepad, paper'],
    ['Charger', 11, 'cable'],
    ['Water bottle', 9, 'water'],
    ['Sweater', 6, 'jacket, hoodie'],
  ].map(([text, points, aliases]) => ({ key: nextKey(), text: String(text), points: Number(points), aliases: String(aliases), note: '' })),
});

interface SavedShow {
  id: string;
  name: string;
  kind: typeof ROUNDS_KIND | typeof SHOW_KIND;
  file: ShowFile;
}

export function ContentEditor({
  onClose,
  settings,
  update,
}: {
  onClose: () => void;
  /** The lobby's settings, to save the whole show (and apply a saved one) — optional. */
  settings?: ShowdownSettings | null;
  update?: (patch: Partial<ShowdownSettings>) => void;
}) {
  const stored = useCustomContent();
  const rehearsal = useRehearsal();
  const showcase = settings?.mode === 'showcase';
  const look = resolveShowdownLook(settings?.look ?? 'auto', seasonClock());
  const [rounds, setRounds] = useState<DraftRound[]>(() =>
    stored?.rounds.length ? fromInput(stored.rounds.map((r: ShowdownRoundDef) => roundToInput(r))) : [blankRound(showcase)],
  );
  /** Settings of a loaded whole show, applied together with the rounds on Save. */
  const [pendingSettings, setPendingSettings] = useState<ShowFileSettings | null>(null);
  const [saved, setSaved] = useState<SavedShow[]>([]);
  const [presetName, setPresetName] = useState('');
  const [json, setJson] = useState('');
  const input = useMemo(() => toInput(rounds), [rounds]);
  const report = useMemo(() => validateShowContent(input), [input]);
  const toast = useApp.getState().toast;

  useEffect(() => {
    let alive = true;
    const p = persistence();
    Promise.all([p.listPresets<unknown>(SHOW_KIND).catch(() => []), p.listPresets<unknown>(ROUNDS_KIND).catch(() => [])])
      .then(([shows, roundsOnly]) => {
        if (!alive) return;
        const read = (list: Array<Preset<unknown>>, kind: SavedShow['kind']) =>
          list.flatMap((pr) => {
            const file = parseShowFile(pr.data);
            return file ? [{ id: pr.id, name: pr.name, kind, file }] : [];
          });
        setSaved([...read(shows, SHOW_KIND), ...read(roundsOnly, ROUNDS_KIND)]);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const edit = (ri: number, fn: (r: DraftRound) => DraftRound) => setRounds((all) => all.map((r, i) => (i === ri ? fn(r) : r)));
  const editAnswer = (ri: number, ai: number, patch: Partial<DraftAnswer>) =>
    edit(ri, (r) => ({ ...r, answers: r.answers.map((a, i) => (i === ai ? { ...a, ...patch } : a)) }));

  const save = () => {
    if (pendingSettings && update) update({ ...pendingSettings, source: 'custom' });
    session.send(SHOWDOWN_MSG.content, { rounds: input });
    forgetLoadedPreset();
    toast('success', `Saved ${report.rounds.length} round${report.rounds.length === 1 ? '' : 's'} to the show${pendingSettings && update ? ', with its settings' : ''}`);
    onClose();
  };

  const loadFile = (file: ShowFile, from: string) => {
    setRounds(fromInput(file.rounds));
    setPendingSettings(file.settings && update ? file.settings : null);
    toast('success', `Loaded “${from}” — check it, then Save to the show.`);
  };

  const saveOnDevice = async () => {
    const name = (presetName.trim() || (settings?.title ?? '') || `Show ${new Date().toLocaleDateString()}`).slice(0, 40);
    const file: ShowFile = { rounds: input, ...(settings ? { settings: pickShowSettings(settings) } : {}) };
    try {
      const existing = saved.find((s) => s.kind === SHOW_KIND && s.name === name);
      const preset = await persistence().savePreset(SHOW_KIND, name, file, existing?.id);
      setSaved((list) => [{ id: preset.id, name: preset.name, kind: SHOW_KIND, file }, ...list.filter((p) => p.id !== preset.id)]);
      toast('success', `Saved “${preset.name}” on this device`);
    } catch {
      toast('error', 'Couldn’t save the show on this device.');
    }
  };

  const importJson = () => {
    try {
      const file = parseShowFile(JSON.parse(json));
      if (!file) throw new Error('shape');
      loadFile(file, 'the show file');
    } catch {
      toast('error', 'That isn’t a show file (expected {"rounds":[{"prompt":…,"answers":[{"text":…,"points":…}]}]}).');
    }
  };

  const issueFor = (ri: number) => report.issues.find((i) => i.index === ri)?.message;
  const mark = look === 'halloween' ? '🎃' : '⭐';

  return (
    <Modal
      open
      wide
      className="sdc-editor-modal"
      // Esc or a stray click outside must not throw away rounds being typed: Cancel and Save close it.
      dismissible={false}
      onClose={onClose}
      title="Your rounds"
      footer={
        <>
          <span className="sd-editor__status">
            <span className="dc-num">{report.rounds.length}</span> ready
            {report.dropped ? (
              <>
                {' · '}
                <span className="dc-field__error">
                  <span className="dc-num">{report.dropped}</span> need fixing
                </span>
              </>
            ) : null}
            {pendingSettings && update ? <span className="sdc-editor__pending"> · also applies: {describeShowSettings(pendingSettings)}</span> : null}
          </span>
          <span className="dc-spacer" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="check" disabled={report.rounds.length === 0} onClick={save}>
            Save to the show
          </Button>
        </>
      }
    >
      <div className="sd-editor sdc-editor">
        <p className="sd-muted">
          One round = one board with {SHOWDOWN_LIMITS.answersMin}–{SHOWDOWN_LIMITS.answersMax} answers. Give each answer its survey points (the board sorts them), or switch on{' '}
          <b>Ranked list</b> to keep your own order with no points. “Also accept” lists other spellings people might type. Answers stay on your device and the server —
          nobody else sees them until they flip.
        </p>
        {rehearsal ? (
          <p className="sdc-editor__note" role="note">
            These are the rehearsal’s <b>demo boards</b>. Saving makes them your own rounds (the Rehearsal badge goes away).
          </p>
        ) : null}
        {pendingSettings && update ? (
          <p className="sdc-editor__note" role="note">
            Saving also applies this show’s settings: {describeShowSettings(pendingSettings)}.{' '}
            <button type="button" className="sdc-linkbtn" onClick={() => setPendingSettings(null)}>
              Keep the current settings instead
            </button>
          </p>
        ) : null}

        {rounds.map((round, ri) => (
          <RoundCard
            key={round.key}
            round={round}
            index={ri}
            count={rounds.length}
            issue={issueFor(ri)}
            mark={mark}
            onEdit={(fn) => edit(ri, fn)}
            onAnswer={(ai, patch) => editAnswer(ri, ai, patch)}
            onRemove={() => setRounds((all) => all.filter((_, i) => i !== ri))}
            onMove={(by) => setRounds((all) => move(all, ri, by))}
          />
        ))}
        <div className="sd-row sd-row--wrap">
          <Button icon="plus" disabled={rounds.length >= SHOWDOWN_LIMITS.customRounds} onClick={() => setRounds((all) => [...all, blankRound(showcase)])}>
            Add round
          </Button>
          <Button
            variant="ghost"
            icon="sparkle"
            onClick={() => setRounds((all) => [...all.filter((r) => r.prompt.trim() || r.answers.some((a) => a.text.trim())), EXAMPLE()])}
          >
            Add an example
          </Button>
        </div>

        <details className="sd-editor__more sdc-editor__more">
          <summary>Save, load and share</summary>
          <p className="sd-muted">
            Save the whole show — rounds{settings ? ' and settings (format, title, look, clock…)' : ''} — on this device, to restore it in a new room.
          </p>
          <div className="sd-row sd-row--wrap">
            <TextInput
              value={presetName}
              placeholder={settings?.title || 'Show name'}
              aria-label="Name for the saved show"
              maxLength={40}
              onChange={(e) => setPresetName(e.currentTarget.value)}
            />
            <Button size="sm" icon="check" disabled={report.rounds.length === 0} onClick={() => void saveOnDevice()}>
              Save on this device
            </Button>
            {saved.length ? (
              <Select
                aria-label="Load a saved show"
                value=""
                onChange={(e) => {
                  const show = saved.find((p) => p.id === e.currentTarget.value);
                  if (show) loadFile(show.file, show.name);
                }}
              >
                <option value="">Load a saved show…</option>
                {saved.some((s) => s.kind === SHOW_KIND) ? (
                  <optgroup label="Whole shows (rounds + settings)">
                    {saved
                      .filter((s) => s.kind === SHOW_KIND)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.file.rounds.length} round{p.file.rounds.length === 1 ? '' : 's'})
                        </option>
                      ))}
                  </optgroup>
                ) : null}
                {saved.some((s) => s.kind === ROUNDS_KIND) ? (
                  <optgroup label="Rounds only">
                    {saved
                      .filter((s) => s.kind === ROUNDS_KIND)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.file.rounds.length} round{p.file.rounds.length === 1 ? '' : 's'})
                        </option>
                      ))}
                  </optgroup>
                ) : null}
              </Select>
            ) : null}
          </div>
          <TextArea
            rows={4}
            value={json}
            placeholder='Paste a show file here ({"rounds":[…]}), or press “Copy as file” to share yours.'
            aria-label="Show file (JSON)"
            onChange={(e) => setJson(e.currentTarget.value)}
          />
          <div className="sd-row sd-row--wrap">
            <Button size="sm" variant="ghost" disabled={!json.trim()} onClick={importJson}>
              Import
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon="copy"
              onClick={() => {
                const text = JSON.stringify({ rounds: input, ...(settings ? { settings: pickShowSettings(settings) } : {}) }, null, 2);
                setJson(text);
                void navigator.clipboard?.writeText(text).then(
                  () => toast('success', 'Show file copied'),
                  () => undefined,
                );
              }}
            >
              Copy as file
            </Button>
          </div>
        </details>
      </div>
    </Modal>
  );
}

function RoundCard({
  round,
  index,
  count,
  issue,
  mark,
  onEdit,
  onAnswer,
  onRemove,
  onMove,
}: {
  round: DraftRound;
  index: number;
  count: number;
  issue: string | undefined;
  mark: string;
  onEdit: (fn: (r: DraftRound) => DraftRound) => void;
  onAnswer: (ai: number, patch: Partial<DraftAnswer>) => void;
  onRemove: () => void;
  onMove: (by: -1 | 1) => void;
}) {
  const n = index + 1;
  const filled = round.answers.filter((a) => a.text.trim());
  const total = round.ranked ? 0 : boardTotal({ answers: filled.map((a) => ({ text: a.text, points: a.points || 0, aliases: [] })) });
  // The board as it will show: validated on its own, so a problem elsewhere doesn't hide this preview.
  const single = useMemo(() => validateShowContent(toInput([round])), [round]);
  const preview = single.rounds[0] ?? null;
  const allZero = !round.ranked && filled.length > 0 && filled.every((a) => !a.points);
  const places = Math.max(filled.length, round.special, SHOWDOWN_LIMITS.answersMin);
  return (
    <section className="sd-editor__round sdc-round" data-invalid={issue ? 'true' : undefined} aria-label={`Round ${n}`}>
      <header className="sd-editor__head">
        <span className="sd-editor__no">Round {n}</span>
        {round.ranked ? (
          <Badge>Ranked</Badge>
        ) : (
          <Badge color={total > 100 ? 'var(--warning)' : undefined}>
            <span className="dc-num">{total}</span> pts
          </Badge>
        )}
        {round.special > 0 ? (
          <Badge color="var(--orange)">
            Special #{round.special} {mark}
          </Badge>
        ) : null}
        <span className="dc-spacer" />
        <IconButton icon="chevron-up" label={`Move round ${n} up`} size="sm" disabled={index === 0} onClick={() => onMove(-1)} />
        <IconButton icon="chevron-down" label={`Move round ${n} down`} size="sm" disabled={index >= count - 1} onClick={() => onMove(1)} />
        <IconButton icon="trash" label={`Remove round ${n}`} size="sm" disabled={count === 1} onClick={onRemove} />
      </header>

      <div className="sdc-round__fields">
        <label className="sdc-f sdc-f--title">
          <span className="sdc-f__label">Category</span>
          <TextInput
            value={round.title}
            maxLength={SHOWDOWN_LIMITS.roundTitleMax}
            placeholder="Halloween Songs"
            aria-label={`Round ${n} category`}
            onChange={(e) => onEdit((r) => ({ ...r, title: e.currentTarget.value }))}
          />
          <span className="sdc-f__hint">On the round’s title card.</span>
        </label>
        <label className="sdc-f sdc-f--source">
          <span className="sdc-f__label">Attribution</span>
          <TextInput
            value={round.source}
            maxLength={SHOWDOWN_LIMITS.sourceMax}
            placeholder="DAS-O-Ween Host Picks"
            aria-label={`Round ${n} attribution`}
            onChange={(e) => onEdit((r) => ({ ...r, source: e.currentTarget.value }))}
          />
          <span className="sdc-f__hint">“According to …” — leave blank for none. Don’t name a poll you didn’t run.</span>
        </label>
        <label className="sdc-f sdc-f--prompt">
          <span className="sdc-f__label">Question</span>
          <TextInput
            className="sd-editor__prompt"
            value={round.prompt}
            maxLength={SHOWDOWN_LIMITS.promptMax}
            placeholder="Name the Top 10 Halloween Songs."
            aria-label={`Round ${n} question`}
            onChange={(e) => onEdit((r) => ({ ...r, prompt: e.currentTarget.value }))}
          />
        </label>
      </div>

      <div className="sdc-round__opts">
        <Toggle
          label="Ranked list (no points)"
          checked={round.ranked}
          onChange={(ranked) => onEdit((r) => ({ ...r, ranked }))}
          aria-describedby={`sdc-ranked-${round.key}`}
        />
        <label className="sdc-f sdc-f--inline">
          <span className="sdc-f__label">Special answer</span>
          <Select
            aria-label={`Round ${n} special answer`}
            value={String(round.special)}
            onChange={(e) => onEdit((r) => ({ ...r, special: Number(e.currentTarget.value) }))}
          >
            <option value="0">None</option>
            {Array.from({ length: Math.min(SHOWDOWN_LIMITS.answersMax, Math.max(places, 1)) }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                #{i + 1}
                {preview?.answers[i] ? ` — ${preview.answers[i]!.text}` : ''}
              </option>
            ))}
          </Select>
        </label>
        <span className="sdc-f__hint" id={`sdc-ranked-${round.key}`}>
          {round.ranked ? 'The board keeps the order below (#1 first). Use ▲/▼ to reorder.' : 'The board sorts answers by points, highest first.'}
          {round.special > 0 ? ` Finding #${round.special} sets off the big celebration.` : ''}
        </span>
      </div>

      <div className="sdc-arow sdc-arow--head" data-ranked={round.ranked ? 'true' : undefined} aria-hidden>
        <span>#</span>
        <span>Answer</span>
        {round.ranked ? null : <span>Points</span>}
        <span>Small line (artist, year…)</span>
        <span>Also accept</span>
        <span />
      </div>
      <ol className="sdc-answerlist" data-ranked={round.ranked ? 'true' : undefined}>
        {round.answers.map((a, ai) => (
          <li key={a.key} className="sdc-arow" data-special={round.ranked && round.special === ai + 1 ? 'true' : undefined}>
            <span className="sdc-arow__n" aria-hidden title={round.ranked && round.special === ai + 1 ? 'The special answer' : undefined}>
              {round.ranked ? ai + 1 : '•'}
            </span>
            <TextInput
              className="sdc-arow__text"
              value={a.text}
              maxLength={SHOWDOWN_LIMITS.answerMax}
              placeholder={`Answer ${ai + 1}`}
              aria-label={`Round ${n} answer ${ai + 1}`}
              onChange={(e) => onAnswer(ai, { text: e.currentTarget.value })}
            />
            {round.ranked ? null : (
              <NumberInput
                className="sdc-arow__pts"
                value={a.points}
                min={0}
                max={SHOWDOWN_LIMITS.pointsMax}
                aria-label={`Round ${n} answer ${ai + 1} points`}
                onChange={(points) => onAnswer(ai, { points })}
              />
            )}
            <TextInput
              className="sdc-arow__note"
              value={a.note}
              maxLength={SHOWDOWN_LIMITS.noteMax}
              placeholder="Small line (artist, year…)"
              aria-label={`Round ${n} answer ${ai + 1} note`}
              onChange={(e) => onAnswer(ai, { note: e.currentTarget.value })}
            />
            <TextInput
              className="sdc-arow__alias"
              value={a.aliases}
              placeholder="Also accept (comma separated)"
              aria-label={`Round ${n} answer ${ai + 1} other spellings`}
              onChange={(e) => onAnswer(ai, { aliases: e.currentTarget.value })}
            />
            <span className="sdc-arow__tools">
              {round.ranked ? (
                <>
                  <IconButton
                    icon="chevron-up"
                    size="sm"
                    label={`Move answer ${ai + 1} up`}
                    disabled={ai === 0}
                    onClick={() => onEdit((r) => ({ ...r, answers: move(r.answers, ai, -1) }))}
                  />
                  <IconButton
                    icon="chevron-down"
                    size="sm"
                    label={`Move answer ${ai + 1} down`}
                    disabled={ai >= round.answers.length - 1}
                    onClick={() => onEdit((r) => ({ ...r, answers: move(r.answers, ai, 1) }))}
                  />
                </>
              ) : null}
              <IconButton
                icon="close"
                size="sm"
                label={`Remove answer ${ai + 1}`}
                disabled={round.answers.length <= 1}
                onClick={() => onEdit((r) => ({ ...r, answers: r.answers.filter((_, i) => i !== ai) }))}
              />
            </span>
          </li>
        ))}
      </ol>
      <div className="sd-row sd-row--wrap">
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          disabled={round.answers.length >= SHOWDOWN_LIMITS.answersMax}
          onClick={() => onEdit((r) => ({ ...r, answers: [...r.answers, blankAnswer()] }))}
        >
          Add answer
        </Button>
        {issue ? (
          <span className="dc-field__error" role="alert">
            {issue}
          </span>
        ) : allZero ? (
          <span className="dc-field__hint">Every answer has 0 points, so this board will be ranked in the order listed. Fill in the points, or switch on Ranked list.</span>
        ) : null}
      </div>

      {preview ? (
        <div className="sdc-preview" aria-label={`Round ${n} board preview`}>
          <span className="sdc-preview__label">
            Board preview{preview.title ? ` · ${preview.title}` : ''}
            {preview.source ? ` · According to ${preview.source}` : ''}
          </span>
          <ol className="sdc-preview__board" style={{ '--rows': Math.ceil(preview.answers.length / 2) } as CSSProperties}>
            {preview.answers.map((a, i) => (
              <li key={i} data-special={preview.special === i ? 'true' : undefined}>
                <span className="sdc-preview__n">{i + 1}</span>
                <span className="sdc-preview__t">{a.text}</span>
                {preview.special === i ? (
                  <span className="sdc-preview__mark" aria-label="special answer">
                    {mark}
                  </span>
                ) : null}
                {preview.ranked ? null : <span className="sdc-preview__p dc-num">{a.points}</span>}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
