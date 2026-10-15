/**
 * The presenter's question writer: survey questions with up to ten answers each (points + extra
 * spellings the audience might type). Saved privately to the room (only the presenter gets them
 * back) and, if you like, as a named preset on this device to reuse for the next show.
 *
 * Validation is the same pure function the server runs (validateShowContent), shown live.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  SHOWDOWN_LIMITS,
  SHOWDOWN_MSG,
  ShowdownContentSchema,
  boardTotal,
  validateShowContent,
  type ShowdownRoundInput,
} from '@dascade/shared/games/showdown';
import { Badge, Button, IconButton, Modal, NumberInput, Select, TextArea, TextInput } from '@dascade/ui';
import { session } from '../../net/hooks.ts';
import { useApp } from '../../app/store.ts';
import { persistence } from '../../persistence/index.ts';
import type { Preset } from '../../persistence/types.ts';
import { useCustomContent } from './state.ts';

interface DraftAnswer {
  text: string;
  points: number;
  aliases: string;
}
interface DraftRound {
  prompt: string;
  answers: DraftAnswer[];
}

const PRESET_KIND = 'showdown-show';

const EXAMPLE: DraftRound = {
  prompt: 'Name something people bring to a team offsite.',
  answers: [
    { text: 'Laptop', points: 34, aliases: 'computer' },
    { text: 'Snacks', points: 22, aliases: 'food' },
    { text: 'Notebook', points: 14, aliases: 'notepad, paper' },
    { text: 'Charger', points: 11, aliases: 'cable' },
    { text: 'Water bottle', points: 9, aliases: 'water' },
    { text: 'Sweater', points: 6, aliases: 'jacket, hoodie' },
  ],
};

const blankRound = (): DraftRound => ({ prompt: '', answers: Array.from({ length: 5 }, () => ({ text: '', points: 0, aliases: '' })) });

function toInput(rounds: DraftRound[]): ShowdownRoundInput[] {
  return rounds.map((r) => ({
    prompt: r.prompt,
    answers: r.answers
      .filter((a) => a.text.trim())
      .map((a) => ({
        text: a.text,
        points: Math.max(0, Math.min(1000, Math.round(a.points || 0))),
        aliases: a.aliases
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 8),
      })),
  }));
}

function fromInput(rounds: ShowdownRoundInput[]): DraftRound[] {
  return rounds.map((r) => ({
    prompt: r.prompt,
    answers: r.answers.map((a) => ({ text: a.text, points: a.points, aliases: (a.aliases ?? []).join(', ') })),
  }));
}

export function ContentEditor({ onClose }: { onClose: () => void }) {
  const stored = useCustomContent();
  const [rounds, setRounds] = useState<DraftRound[]>(() =>
    stored?.rounds.length ? fromInput(stored.rounds.map((r) => ({ prompt: r.prompt, answers: r.answers }))) : [blankRound()],
  );
  const [presets, setPresets] = useState<Array<Preset<ShowdownRoundInput[]>>>([]);
  const [presetName, setPresetName] = useState('');
  const [json, setJson] = useState('');
  const report = useMemo(() => validateShowContent(toInput(rounds)), [rounds]);
  const toast = useApp.getState().toast;

  useEffect(() => {
    let alive = true;
    persistence()
      .listPresets<ShowdownRoundInput[]>(PRESET_KIND)
      .then((list) => alive && setPresets(list))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const edit = (ri: number, fn: (r: DraftRound) => DraftRound) => setRounds((all) => all.map((r, i) => (i === ri ? fn(r) : r)));
  const editAnswer = (ri: number, ai: number, patch: Partial<DraftAnswer>) =>
    edit(ri, (r) => ({ ...r, answers: r.answers.map((a, i) => (i === ai ? { ...a, ...patch } : a)) }));

  const save = () => {
    session.send(SHOWDOWN_MSG.content, { rounds: toInput(rounds) });
    toast('success', `Saved ${report.rounds.length} round${report.rounds.length === 1 ? '' : 's'} to the show`);
    onClose();
  };

  const savePreset = async () => {
    const name = presetName.trim() || `Show ${new Date().toLocaleDateString()}`;
    try {
      const preset = await persistence().savePreset(PRESET_KIND, name.slice(0, 40), toInput(rounds));
      setPresets((list) => [preset, ...list.filter((p) => p.id !== preset.id)]);
      toast('success', `Saved “${preset.name}” on this device`);
    } catch {
      toast('error', 'Couldn’t save the preset.');
    }
  };

  const importJson = () => {
    try {
      const parsed = ShowdownContentSchema.safeParse(JSON.parse(json));
      if (!parsed.success) throw new Error('shape');
      setRounds(fromInput(parsed.data.rounds).slice(0, SHOWDOWN_LIMITS.customRounds));
      toast('success', 'Rounds imported — check them, then save.');
    } catch {
      toast('error', 'That isn’t a show file (expected {"rounds":[{"prompt":…,"answers":[{"text":…,"points":…}]}]}).');
    }
  };

  const issueFor = (ri: number) => report.issues.find((i) => i.index === ri)?.message;

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Your survey rounds"
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
      <div className="sd-editor">
        <p className="sd-muted">
          One round = one survey question with {SHOWDOWN_LIMITS.answersMin}–{SHOWDOWN_LIMITS.answersMax} answers. Give each answer its survey points (how many of 100 people said it); the board sorts them for you. “Also accept” lists other spellings the audience might type.
        </p>
        {rounds.map((round, ri) => {
          const filled = round.answers.filter((a) => a.text.trim());
          const total = boardTotal({ answers: filled.map((a) => ({ text: a.text, points: a.points || 0, aliases: [] })) });
          const issue = issueFor(ri);
          return (
            <section key={ri} className="sd-editor__round" data-invalid={issue ? 'true' : undefined}>
              <header className="sd-editor__head">
                <span className="sd-editor__no">Round {ri + 1}</span>
                <Badge color={total > 100 ? 'var(--warning)' : undefined}>
                  <span className="dc-num">{total}</span> pts
                </Badge>
                <span className="dc-spacer" />
                <IconButton icon="trash" label={`Remove round ${ri + 1}`} size="sm" disabled={rounds.length === 1} onClick={() => setRounds((all) => all.filter((_, i) => i !== ri))} />
              </header>
              <TextInput
                className="sd-editor__prompt"
                value={round.prompt}
                maxLength={SHOWDOWN_LIMITS.promptMax}
                placeholder="We asked 100 people: name something…"
                aria-label={`Round ${ri + 1} question`}
                onChange={(e) => edit(ri, (r) => ({ ...r, prompt: e.currentTarget.value }))}
              />
              <ol className="sd-editor__answers">
                {round.answers.map((a, ai) => (
                  <li key={ai}>
                    <TextInput
                      value={a.text}
                      maxLength={SHOWDOWN_LIMITS.answerMax}
                      placeholder={`Answer ${ai + 1}`}
                      aria-label={`Round ${ri + 1} answer ${ai + 1}`}
                      onChange={(e) => editAnswer(ri, ai, { text: e.currentTarget.value })}
                    />
                    <NumberInput
                      value={a.points}
                      min={0}
                      max={SHOWDOWN_LIMITS.pointsMax}
                      aria-label={`Round ${ri + 1} answer ${ai + 1} points`}
                      onChange={(points) => editAnswer(ri, ai, { points })}
                    />
                    <TextInput
                      value={a.aliases}
                      placeholder="Also accept (comma separated)"
                      aria-label={`Round ${ri + 1} answer ${ai + 1} other spellings`}
                      onChange={(e) => editAnswer(ri, ai, { aliases: e.currentTarget.value })}
                    />
                    <IconButton
                      icon="close"
                      size="sm"
                      label={`Remove answer ${ai + 1}`}
                      disabled={round.answers.length <= 1}
                      onClick={() => edit(ri, (r) => ({ ...r, answers: r.answers.filter((_, i) => i !== ai) }))}
                    />
                  </li>
                ))}
              </ol>
              <div className="sd-row">
                <Button
                  size="sm"
                  variant="ghost"
                  icon="plus"
                  disabled={round.answers.length >= SHOWDOWN_LIMITS.answersMax}
                  onClick={() => edit(ri, (r) => ({ ...r, answers: [...r.answers, { text: '', points: 0, aliases: '' }] }))}
                >
                  Add answer
                </Button>
                {issue ? <span className="dc-field__error">{issue}</span> : null}
              </div>
            </section>
          );
        })}
        <div className="sd-row sd-row--wrap">
          <Button icon="plus" disabled={rounds.length >= SHOWDOWN_LIMITS.customRounds} onClick={() => setRounds((all) => [...all, blankRound()])}>
            Add round
          </Button>
          <Button variant="ghost" icon="sparkle" onClick={() => setRounds((all) => [...all.filter((r) => r.prompt.trim() || r.answers.some((a) => a.text.trim())), EXAMPLE])}>
            Add an example
          </Button>
        </div>

        <details className="sd-editor__more">
          <summary>Save, load and share</summary>
          <div className="sd-row sd-row--wrap">
            <TextInput value={presetName} placeholder="Preset name" aria-label="Preset name" maxLength={40} onChange={(e) => setPresetName(e.currentTarget.value)} />
            <Button size="sm" icon="check" onClick={() => void savePreset()}>
              Save on this device
            </Button>
            {presets.length ? (
              <Select
                aria-label="Load a saved show"
                value=""
                onChange={(e) => {
                  const preset = presets.find((p) => p.id === e.currentTarget.value);
                  if (preset) setRounds(fromInput(preset.data));
                }}
              >
                <option value="">Load a saved show…</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
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
                const text = JSON.stringify({ rounds: toInput(rounds) }, null, 2);
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
