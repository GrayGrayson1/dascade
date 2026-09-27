/**
 * Host setup for DAStravaganza Trivia. Everything is validated again by the server.
 */
import { useMemo, type CSSProperties } from 'react';
import {
  TRIVIA_CATEGORIES,
  TRIVIA_CATEGORY_IDS,
  TRIVIA_POINTS,
  TRIVIA_TYPE_LABEL,
  TRIVIA_TYPES,
  countMatching,
  type TriviaCategoryId,
  type TriviaPublicState,
  type TriviaQuestionType,
  type TriviaSettings,
} from '@dascade/shared/games/trivia';
import { Badge, Field, PixelIcon, Segmented, Slider, Toggle, cx } from '@dascade/ui';
import { ArtIcon } from '../_party/index.ts';
import { useRoomSelector } from '../../net/hooks.ts';
import type { SettingsPanelProps } from '../types.ts';
import { usePackInfo } from './hooks.ts';
import { PackEditorButton } from './PackEditor.tsx';

export function TriviaSettingsPanel({ settings, canEdit, update }: SettingsPanelProps<TriviaSettings>) {
  const infoJson = useRoomSelector<TriviaPublicState, string>((s) => s.packInfoJson) ?? '';
  const info = usePackInfo(infoJson);

  const matching = useMemo(() => {
    if (!info) return null;
    let n = 0;
    if (settings.pack !== 'custom') n += countMatching(info.starter.matrix, settings);
    if (settings.pack !== 'starter' && info.custom) n += countMatching(info.custom.matrix, settings, true);
    return n;
  }, [info, settings]);

  const toggleCategory = (id: TriviaCategoryId) => {
    const all = settings.categories.length === 0;
    const current = all ? [...TRIVIA_CATEGORY_IDS] : settings.categories;
    const next = current.includes(id)
      ? current.filter((c) => c !== id)
      : TRIVIA_CATEGORY_IDS.filter((c) => c === id || current.includes(c));
    // Every category selected is the same as "all" (keeps future categories included).
    update({ categories: next.length === TRIVIA_CATEGORY_IDS.length ? [] : next.length === 0 ? current : next });
  };
  const toggleType = (t: TriviaQuestionType) => {
    const has = settings.types.includes(t);
    if (has && settings.types.length === 1) return;
    update({ types: has ? settings.types.filter((x) => x !== t) : TRIVIA_TYPES.filter((x) => x === t || settings.types.includes(x)) });
  };

  const short = matching !== null && matching < settings.questionCount;

  return (
    <div className="tv-settings">
      <section className="tv-settings__group" aria-labelledby="tv-set-play">
        <h3 id="tv-set-play" className="tv-settings__title">
          Game
        </h3>
        <div className="dc-field">
          <span className="dc-field__label">Mode</span>
          <Segmented<'ffa' | 'teams'>
            label="Mode"
            value={settings.mode}
            disabled={!canEdit}
            options={[
              { value: 'ffa', label: 'Free-for-all' },
              { value: 'teams', label: 'Teams' },
            ]}
            onChange={(mode) => update({ mode })}
          />
        </div>
        {settings.mode === 'teams' ? (
          <div className="tv-settings__row">
            <div className="dc-field">
              <span className="dc-field__label">Teams</span>
              <Segmented
                label="Number of teams"
                value={String(settings.teamCount)}
                disabled={!canEdit}
                options={[2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }))}
                onChange={(v) => update({ teamCount: Number(v) })}
              />
            </div>
            <div className="dc-field">
              <span className="dc-field__label">Team score</span>
              <Segmented<'sum' | 'average'>
                label="Team score"
                value={settings.teamScoring}
                disabled={!canEdit}
                options={[
                  { value: 'average', label: 'Average' },
                  { value: 'sum', label: 'Total' },
                ]}
                onChange={(teamScoring) => update({ teamScoring })}
              />
              <span className="dc-field__hint">
                {settings.teamScoring === 'average' ? 'Fair for uneven team sizes.' : 'Bigger teams can score more.'}
              </span>
            </div>
          </div>
        ) : null}
        <div className="tv-settings__row">
          <Field label="Questions" aside={<span className="dc-num tv-settings__value">{settings.questionCount}</span>}>
            {({ id }) => (
              <Slider
                id={id}
                min={3}
                max={50}
                value={settings.questionCount}
                disabled={!canEdit}
                onChange={(questionCount) => update({ questionCount })}
              />
            )}
          </Field>
          <Field label="Time to answer" aside={<span className="dc-num tv-settings__value">{settings.answerSeconds}s</span>}>
            {({ id }) => (
              <Slider
                id={id}
                min={10}
                max={60}
                step={5}
                value={Math.max(10, settings.answerSeconds)}
                disabled={!canEdit}
                onChange={(answerSeconds) => update({ answerSeconds })}
              />
            )}
          </Field>
        </div>
      </section>

      <section className="tv-settings__group" aria-labelledby="tv-set-q">
        <h3 id="tv-set-q" className="tv-settings__title">
          Questions
          {matching !== null ? (
            <Badge color={short ? 'var(--warning)' : 'var(--success)'} className="tv-settings__pool">
              <span className="dc-num">{matching}</span>&nbsp;match
            </Badge>
          ) : null}
        </h3>
        <div className="dc-field">
          <span className="dc-field__label">Question pack</span>
          <Segmented<TriviaSettings['pack']>
            label="Question pack"
            value={settings.pack}
            disabled={!canEdit}
            options={[
              { value: 'starter', label: 'Starter' },
              { value: 'mixed', label: 'Starter + custom' },
              { value: 'custom', label: 'Custom only' },
            ]}
            onChange={(pack) => update({ pack })}
          />
          <span className="dc-field__hint">
            {info ? `Starter pack: ${info.starter.total} original questions. ` : ''}
            {info?.custom ? `Custom: “${info.custom.title}” · ${info.custom.total} questions.` : 'No custom pack yet.'}
          </span>
        </div>
        {canEdit ? (
          <div className="tv-settings__pack">
            <PackEditorButton
              onUploaded={(count) => {
                if (count > 0 && settings.pack === 'starter') update({ pack: 'mixed' });
                if (count === 0 && settings.pack === 'custom') update({ pack: 'starter' });
              }}
            />
          </div>
        ) : null}

        <div className="dc-field">
          <span className="dc-field__label" id="tv-cats-label">
            <span>Categories</span>
            <span className="dc-muted">
              {settings.categories.length === 0 ? 'All' : `${settings.categories.length} of ${TRIVIA_CATEGORY_IDS.length}`}
            </span>
          </span>
          <div className={cx('tv-cats', settings.pack === 'custom' && 'is-muted')} role="group" aria-labelledby="tv-cats-label">
            {TRIVIA_CATEGORY_IDS.map((id) => {
              const meta = TRIVIA_CATEGORIES[id];
              const on = settings.categories.length === 0 || settings.categories.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  className="tv-cat"
                  aria-pressed={on}
                  disabled={!canEdit}
                  onClick={() => toggleCategory(id)}
                  style={{ '--chip': meta.color } as CSSProperties}
                >
                  <span className="tv-cat__check" aria-hidden="true">
                    ✓
                  </span>
                  <ArtIcon name={meta.icon} size={14} />
                  <span className="tv-cat__name">{meta.short}</span>
                  {info ? <span className="tv-cat__count dc-num">{info.starter.byCategory[id] ?? 0}</span> : null}
                </button>
              );
            })}
          </div>
          {settings.pack === 'custom' ? (
            <span className="dc-field__hint">Categories apply to the starter pack; custom questions are always included.</span>
          ) : null}
        </div>

        <div className="dc-field">
          <span className="dc-field__label" id="tv-types-label">
            Question types
          </span>
          <div className="tv-cats" role="group" aria-labelledby="tv-types-label">
            {TRIVIA_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className="tv-cat"
                aria-pressed={settings.types.includes(t)}
                disabled={!canEdit}
                onClick={() => toggleType(t)}
              >
                <span className="tv-cat__check" aria-hidden="true">
                  ✓
                </span>
                <span className="tv-cat__name">{TRIVIA_TYPE_LABEL[t]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="dc-field">
          <span className="dc-field__label">Difficulty</span>
          <Segmented<TriviaSettings['difficulty']>
            label="Difficulty"
            value={settings.difficulty}
            disabled={!canEdit}
            options={[
              { value: 'mixed', label: 'Mixed' },
              { value: 'easy', label: 'Easy' },
              { value: 'medium', label: 'Medium' },
              { value: 'hard', label: 'Hard' },
            ]}
            onChange={(difficulty) => update({ difficulty })}
          />
        </div>
        {short ? (
          <p className="tv-settings__warn" role="status">
            <PixelIcon name="warning" /> Only {matching} question{matching === 1 ? '' : 's'} match — the game will use{' '}
            {Math.max(0, matching ?? 0)}.{matching !== null && matching < 3 ? ' Pick more categories or types to start.' : ''}
          </p>
        ) : null}
      </section>

      <section className="tv-settings__group" aria-labelledby="tv-set-score">
        <h3 id="tv-set-score" className="tv-settings__title">
          Scoring
        </h3>
        <div className="dc-field">
          <span className="dc-field__label">Points per question</span>
          <Segmented
            label="Points per question"
            value={String(settings.basePoints)}
            disabled={!canEdit}
            options={TRIVIA_POINTS.map((p) => ({ value: String(p), label: String(p) }))}
            onChange={(v) => update({ basePoints: Number(v) })}
          />
        </div>
        <div className="tv-settings__toggles">
          <Toggle
            label="Speed bonus (faster = more points)"
            checked={settings.speedBonus}
            disabled={!canEdit}
            onChange={(speedBonus) => update({ speedBonus })}
          />
          <Toggle
            label="Streak bonus (correct in a row)"
            checked={settings.streakBonus}
            disabled={!canEdit}
            onChange={(streakBonus) => update({ streakBonus })}
          />
          <Toggle
            label="Harder questions score more"
            checked={settings.difficultyBonus}
            disabled={!canEdit}
            onChange={(difficultyBonus) => update({ difficultyBonus })}
          />
          <Toggle
            label="Final wager round"
            checked={settings.finalWager}
            disabled={!canEdit}
            onChange={(finalWager) => update({ finalWager })}
          />
        </div>
        {settings.finalWager ? (
          <p className="dc-field__hint">Before the last question everyone privately wagers game points on it — win it or lose it.</p>
        ) : null}
      </section>
    </div>
  );
}
