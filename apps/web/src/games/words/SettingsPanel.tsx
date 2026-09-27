/**
 * DASwords lobby settings: pick a mode (big cards), rounds and teams, then the mode's options.
 */
import { WORDS_MODE_INFO, WORDS_MODES, type WordsMode, type WordsSettings } from '@dascade/shared/games/words';
import { Field, Segmented, Slider, Toggle, cx, handleRovingKeys, rovingTabIndex } from '@dascade/ui';
import type { SettingsPanelProps } from '../types.ts';
import { ModeGlyph } from './Common.tsx';

export function WordsSettingsPanel({ settings, canEdit, update }: SettingsPanelProps<WordsSettings>) {
  const s = settings;
  return (
    <div className="wd-settings">
      <div className="dc-field">
        <span className="dc-field__label" id="wd-mode-label">
          Game mode
        </span>
        <div className="wd-modes" role="radiogroup" aria-labelledby="wd-mode-label" onKeyDown={(e) => handleRovingKeys(e, 'radio')}>
          {WORDS_MODES.map((m, i) => {
            const on = s.mode === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={rovingTabIndex(on, i, true)}
                disabled={!canEdit}
                className={cx('wd-modecard', on && 'is-on')}
                onClick={() => update({ mode: m as WordsMode })}
              >
                <ModeGlyph mode={m} className="wd-modecard__glyph" />
                <span className="wd-modecard__title">{WORDS_MODE_INFO[m].title}</span>
                <span className="wd-modecard__tag">{WORDS_MODE_INFO[m].tagline}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="wd-settings__row">
        <Field label={s.mode === 'chain' ? 'Chains' : 'Rounds'} aside={<span className="wd-settings__value dc-num">{s.rounds}</span>}>
          {({ id, describedBy }) => <Slider id={id} aria-describedby={describedBy} min={1} max={8} value={s.rounds} disabled={!canEdit} onChange={(rounds) => update({ rounds })} />}
        </Field>
        <div className="dc-field">
          <span className="dc-field__label">Teams</span>
          <Segmented
            label="Teams"
            value={String(s.teams)}
            disabled={!canEdit}
            options={[
              { value: '0', label: 'Solo' },
              { value: '2', label: '2 teams' },
              { value: '3', label: '3' },
              { value: '4', label: '4' },
            ]}
            onChange={(v) => update({ teams: Number(v) })}
          />
          <span className="dc-field__hint">{s.teams ? 'Random, balanced teams. A word counts once per team; team score = members’ points.' : 'Free-for-all: everyone for themselves.'}</span>
        </div>
      </div>

      {s.mode === 'grid' ? (
        <div className="wd-settings__group">
          <div className="wd-settings__row">
            <div className="dc-field">
              <span className="dc-field__label">Board</span>
              <Segmented
                label="Board size"
                value={String(s.gridSize)}
                disabled={!canEdit}
                options={[
                  { value: '4', label: '4 × 4' },
                  { value: '5', label: '5 × 5' },
                ]}
                onChange={(v) => update({ gridSize: Number(v) as 4 | 5, gridMinLength: v === '5' ? 4 : 3 })}
              />
            </div>
            <div className="dc-field">
              <span className="dc-field__label">Shortest word</span>
              <Segmented
                label="Shortest word"
                value={String(s.gridMinLength)}
                disabled={!canEdit}
                options={[
                  { value: '3', label: '3 letters' },
                  { value: '4', label: '4 letters' },
                ]}
                onChange={(v) => update({ gridMinLength: Number(v) })}
              />
            </div>
          </div>
          <Field label="Round time" aside={<span className="wd-settings__value dc-num">{s.gridSeconds}s</span>}>
            {({ id }) => <Slider id={id} min={60} max={300} step={15} value={s.gridSeconds} disabled={!canEdit} onChange={(gridSeconds) => update({ gridSeconds })} />}
          </Field>
          <Toggle label="Unique words only (classic rule: words found by others score 0)" checked={s.uniqueOnly} disabled={!canEdit} onChange={(uniqueOnly) => update({ uniqueOnly })} />
        </div>
      ) : null}

      {s.mode === 'anagram' ? (
        <div className="wd-settings__group wd-settings__row">
          <div className="dc-field">
            <span className="dc-field__label">Rack size</span>
            <Segmented
              label="Rack size"
              value={String(s.rackSize)}
              disabled={!canEdit}
              options={[6, 7, 8].map((n) => ({ value: String(n), label: `${n} letters` }))}
              onChange={(v) => update({ rackSize: Number(v) })}
            />
          </div>
          <Field label="Round time" aside={<span className="wd-settings__value dc-num">{s.anagramSeconds}s</span>}>
            {({ id }) => <Slider id={id} min={45} max={180} step={15} value={s.anagramSeconds} disabled={!canEdit} onChange={(anagramSeconds) => update({ anagramSeconds })} />}
          </Field>
        </div>
      ) : null}

      {s.mode === 'chain' ? (
        <div className="wd-settings__group">
          <div className="dc-field">
            <span className="dc-field__label">Linking rule</span>
            <Segmented
              label="Linking rule"
              value={s.chainRule}
              disabled={!canEdit}
              options={[
                { value: 'last', label: 'Last letter' },
                { value: 'last2', label: 'Last two letters' },
              ]}
              onChange={(chainRule) => update({ chainRule })}
            />
            <span className="dc-field__hint">{s.chainRule === 'last2' ? 'LEMON → ONION → ONSET… (hard mode)' : 'LEMON → NECTAR → RADISH…'}</span>
          </div>
          <div className="wd-settings__row">
            <Field label="Hearts" aside={<span className="wd-settings__value dc-num">{s.chainLives}</span>}>
              {({ id }) => <Slider id={id} min={1} max={5} value={s.chainLives} disabled={!canEdit} onChange={(chainLives) => update({ chainLives })} />}
            </Field>
            <Field label="Seconds per link" aside={<span className="wd-settings__value dc-num">{s.chainSeconds}s</span>}>
              {({ id }) => <Slider id={id} min={8} max={30} value={s.chainSeconds} disabled={!canEdit} onChange={(chainSeconds) => update({ chainSeconds })} />}
            </Field>
          </div>
          <div className="wd-settings__row">
            <Field label="Links per chain" aside={<span className="wd-settings__value dc-num">{s.chainLinks}</span>}>
              {({ id }) => <Slider id={id} min={5} max={30} value={s.chainLinks} disabled={!canEdit} onChange={(chainLinks) => update({ chainLinks })} />}
            </Field>
            <Field label="Shortest word" aside={<span className="wd-settings__value dc-num">{s.chainMinLength}</span>}>
              {({ id }) => <Slider id={id} min={3} max={6} value={s.chainMinLength} disabled={!canEdit} onChange={(chainMinLength) => update({ chainMinLength })} />}
            </Field>
          </div>
        </div>
      ) : null}

      {s.mode === 'forbidden' ? (
        <div className="wd-settings__group">
          <Field label="Answer time" aside={<span className="wd-settings__value dc-num">{s.forbiddenSeconds}s</span>}>
            {({ id }) => <Slider id={id} min={30} max={180} step={15} value={s.forbiddenSeconds} disabled={!canEdit} onChange={(forbiddenSeconds) => update({ forbiddenSeconds })} />}
          </Field>
          <div className="dc-field">
            <span className="dc-field__label">Unknown answers</span>
            <Segmented
              label="Unknown answers"
              value={s.review}
              disabled={!canEdit}
              options={[
                { value: 'host', label: 'Host reviews' },
                { value: 'trust', label: 'Trust the dictionary' },
              ]}
              onChange={(review) => update({ review })}
            />
            <span className="dc-field__hint">
              {s.review === 'host'
                ? 'Valid words DASwords can’t place in the category go to the host for a quick yes/no.'
                : 'Any real word without the forbidden letter counts — fastest, most forgiving.'}
            </span>
          </div>
          {s.review === 'host' ? (
            <Field label="Review time" aside={<span className="wd-settings__value dc-num">{s.reviewSeconds}s</span>}>
              {({ id }) => <Slider id={id} min={15} max={120} step={5} value={s.reviewSeconds} disabled={!canEdit} onChange={(reviewSeconds) => update({ reviewSeconds })} />}
            </Field>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
