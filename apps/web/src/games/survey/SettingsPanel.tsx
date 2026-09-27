/**
 * Lobby settings for DAS Survey: game mode, question count, packs, timers and the host's custom
 * survey (edited in a dedicated editor; the questions stay private to the host until asked).
 */
import { useMemo, useState, type CSSProperties } from 'react';
import {
  SURVEY_GAME_MODES,
  SURVEY_GAME_MODE_INFO,
  SURVEY_MSG,
  SURVEY_PACK_IDS,
  SURVEY_PACK_INFO,
  type SurveyCustomPrivate,
  type SurveyGameMode,
  type SurveyPackId,
  type SurveyPublicState,
  type SurveySettings,
} from '@dascade/shared/games/survey';
import { plannedCount, poolFor } from '@dascade/game-core/survey';
import { AVATAR_ART, Badge, Button, Field, PixelArt, PixelIcon, Slider, cx, type IconName } from '@dascade/ui';
import { useLatestMessage, useRoomSelector } from '../../net/hooks.ts';
import type { SettingsPanelProps } from '../types.ts';
import { MODE_COLOR, MODE_ICON, PACK_ART } from './hooks.ts';
import { CustomEditor } from './CustomEditor.tsx';

const GAME_MODE_ICON: Record<SurveyGameMode, IconName> = {
  mixed: 'dice',
  majority: MODE_ICON.majority,
  rank: MODE_ICON.rank,
  percent: MODE_ICON.percent,
  custom: 'pencil',
};

const GAME_MODE_COLOR: Record<SurveyGameMode, string> = {
  mixed: 'var(--green)',
  majority: MODE_COLOR.majority,
  rank: MODE_COLOR.rank,
  percent: MODE_COLOR.percent,
  custom: 'var(--orange)',
};

export function SurveySettingsPanel({ settings, canEdit, update }: SettingsPanelProps<SurveySettings>) {
  const customCount = useRoomSelector<SurveyPublicState, number>((s) => s.customCount ?? 0) ?? 0;
  const hostCopy = useLatestMessage<SurveyCustomPrivate>(SURVEY_MSG.custom);
  const [editing, setEditing] = useState(false);
  const custom = settings.mode === 'custom';
  const planned = useMemo(
    () => (custom ? customCount : plannedCount({ mode: settings.mode, count: settings.questions, packs: settings.packs, custom: [] })),
    [custom, customCount, settings.mode, settings.questions, settings.packs],
  );
  // A generous estimate: most questions end early once everyone is done.
  const minutes = Math.max(
    1,
    Math.round((planned * (settings.answerSeconds * 0.7 + settings.predictSeconds * 0.7 + settings.revealSeconds)) / 60),
  );

  const togglePack = (id: SurveyPackId) => {
    const on = settings.packs.includes(id);
    update({ packs: on ? settings.packs.filter((p) => p !== id) : SURVEY_PACK_IDS.filter((p) => p === id || settings.packs.includes(p)) });
  };

  return (
    <div className="sv-settings">
      <div className="dc-field">
        <span className="dc-field__label" id="sv-mode-label">
          Game mode
        </span>
        <div className="sv-modes" role="radiogroup" aria-labelledby="sv-mode-label">
          {SURVEY_GAME_MODES.map((mode) => {
            const info = SURVEY_GAME_MODE_INFO[mode];
            const on = settings.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={on}
                className="sv-modecard"
                disabled={!canEdit}
                style={{ '--mode': GAME_MODE_COLOR[mode] } as CSSProperties}
                onClick={() => update({ mode })}
              >
                <span className="sv-modecard__icon" aria-hidden="true">
                  <PixelIcon name={GAME_MODE_ICON[mode]} />
                </span>
                <span className="sv-modecard__title">{info.title}</span>
                <span className="sv-modecard__blurb">{info.blurb}</span>
              </button>
            );
          })}
        </div>
      </div>

      {custom ? null : (
        <>
          <Field
            label="Questions"
            aside={<span className="sv-settings__value dc-num">{settings.questions}</span>}
            hint={planned < settings.questions ? `Only ${planned} fit this mode and pack selection.` : 'Questions per game.'}
          >
            {({ id, describedBy }) => (
              <Slider
                id={id}
                aria-describedby={describedBy}
                min={3}
                max={30}
                value={settings.questions}
                disabled={!canEdit}
                onChange={(questions) => update({ questions })}
              />
            )}
          </Field>

          <div className="dc-field">
            <span className="dc-field__label" id="sv-packs-label">
              <span>Question packs</span>
              {canEdit ? (
                <span className="sv-settings__links">
                  <button type="button" className="sv-link" onClick={() => update({ packs: [...SURVEY_PACK_IDS] })}>
                    All
                  </button>
                </span>
              ) : null}
            </span>
            <div className="sv-packs" role="group" aria-labelledby="sv-packs-label">
              {SURVEY_PACK_IDS.map((id) => {
                const on = settings.packs.includes(id);
                const count =
                  settings.mode === 'mixed' || settings.mode === 'custom' ? poolFor([id]).length : poolFor([id], settings.mode).length;
                return (
                  <button
                    key={id}
                    type="button"
                    className="sv-pack"
                    aria-pressed={on}
                    disabled={!canEdit}
                    onClick={() => togglePack(id)}
                    title={SURVEY_PACK_INFO[id].blurb}
                  >
                    <PixelArt
                      rows={AVATAR_ART[PACK_ART[id]] ?? AVATAR_ART.star!}
                      mainColor={on ? 'var(--accent)' : 'var(--text-3)'}
                      className="sv-pack__icon"
                    />
                    <span className="sv-pack__name">{SURVEY_PACK_INFO[id].title}</span>
                    <span className="sv-pack__count dc-num">{count}</span>
                  </button>
                );
              })}
            </div>
            {settings.packs.length === 0 ? (
              <span className="dc-field__error" role="alert">
                Pick at least one pack.
              </span>
            ) : null}
          </div>
        </>
      )}

      <div className={cx('sv-customcard', custom && 'is-active')}>
        <div className="sv-customcard__text">
          <span className="sv-customcard__title">
            <PixelIcon name="pencil" size={14} /> Your custom questions
          </span>
          <span className="sv-customcard__desc">
            {canEdit
              ? customCount
                ? `${customCount} question${customCount === 1 ? '' : 's'} ready.${custom ? ' They play in the order you wrote them.' : ' Choose the Custom Survey mode to play them.'}`
                : 'Write your own questions for this group — up to 30.'
              : customCount
                ? `The host wrote ${customCount} question${customCount === 1 ? '' : 's'} — they stay secret until asked.`
                : 'The host hasn’t written custom questions.'}
          </span>
        </div>
        <Badge color={customCount ? 'var(--orange)' : 'var(--text-3)'}>
          <span className="dc-num">{customCount}</span>/30
        </Badge>
        {canEdit ? (
          <Button size="md" variant={custom && customCount === 0 ? 'primary' : 'secondary'} icon="pencil" onClick={() => setEditing(true)}>
            {customCount ? 'Edit survey' : 'Write survey'}
          </Button>
        ) : null}
      </div>
      {custom && customCount === 0 ? (
        <span className="dc-field__error" role="alert">
          {canEdit ? 'Write at least one question to start a Custom Survey.' : 'Waiting for the host to write the survey.'}
        </span>
      ) : null}

      <div className="sv-settings__row">
        <Field label="Answer time" aside={<span className="sv-settings__value dc-num">{settings.answerSeconds}s</span>}>
          {({ id }) => (
            <Slider
              id={id}
              min={10}
              max={90}
              step={5}
              value={settings.answerSeconds}
              disabled={!canEdit}
              onChange={(answerSeconds) => update({ answerSeconds })}
            />
          )}
        </Field>
        <Field label="Predict time" aside={<span className="sv-settings__value dc-num">{settings.predictSeconds}s</span>}>
          {({ id }) => (
            <Slider
              id={id}
              min={10}
              max={90}
              step={5}
              value={settings.predictSeconds}
              disabled={!canEdit}
              onChange={(predictSeconds) => update({ predictSeconds })}
            />
          )}
        </Field>
        <Field label="Results time" aside={<span className="sv-settings__value dc-num">{settings.revealSeconds}s</span>}>
          {({ id }) => (
            <Slider
              id={id}
              min={6}
              max={30}
              step={1}
              value={settings.revealSeconds}
              disabled={!canEdit}
              onChange={(revealSeconds) => update({ revealSeconds })}
            />
          )}
        </Field>
      </div>

      <div className={cx('sv-summaryline', planned === 0 && 'is-empty')} role="status">
        <PixelIcon name="clock" size={14} />
        {planned === 0 ? (
          <span>No questions yet.</span>
        ) : (
          <span>
            <strong className="dc-num">{planned}</strong> question{planned === 1 ? '' : 's'} · about{' '}
            <strong className="dc-num">{minutes}</strong> min · rounds end early once everyone is done
          </span>
        )}
      </div>

      {canEdit ? <CustomEditor open={editing} onClose={() => setEditing(false)} stored={hostCopy ?? null} /> : null}
    </div>
  );
}
