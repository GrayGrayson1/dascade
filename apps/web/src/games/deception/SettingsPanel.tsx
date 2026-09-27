/**
 * Lobby settings for DASception: role set (Beginner / Standard / Custom mix with validation),
 * timers and voting rules, with a live preview of the roles for the current player count.
 */
import { useMemo, type CSSProperties } from 'react';
import { Field, Segmented, Slider, Toggle, cx } from '@dascade/ui';
import { Icon } from './Icon.tsx';
import {
  DECEPTION_LIMITS,
  DECEPTION_ROLE_INFO,
  DECEPTION_SPECIALS,
  autoGlitchCount,
  describeSetup,
  planSetup,
  type DeceptionPublicState,
  type DeceptionRoleSet,
  type DeceptionSettings,
} from '@dascade/shared/games/deception';
import { useRoomSelector } from '../../net/hooks.ts';
import type { SettingsPanelProps } from '../types.ts';
import { ROLE_COLOR } from './art.ts';
import { RoleEmblem } from './RoleCard.tsx';

const SET_HELP: Record<DeceptionRoleSet, string> = {
  beginner: 'Scanner + Firewall only. The easiest way to learn — great for first games.',
  standard: 'Adds the Sudo (6+ players), a Jammer on the Glitch team (7+) and the Tracer (10+).',
  custom: 'Pick exactly which special roles are in play and how many Glitches there are.',
};

export function DeceptionSettingsPanel({ settings, canEdit, update }: SettingsPanelProps<DeceptionSettings>) {
  const seated =
    useRoomSelector<DeceptionPublicState, number>((s) => Object.values(s.players ?? {}).filter((p) => !p.spectator).length) ?? 0;
  const preview = useMemo(() => planSetup(Math.max(seated, DECEPTION_LIMITS.minPlayers), settings), [seated, settings]);
  const custom = settings.roleSet === 'custom';
  return (
    <div className="dx-settings">
      <div className="dc-field">
        <span className="dc-field__label">Role set</span>
        <Segmented
          label="Role set"
          value={settings.roleSet}
          disabled={!canEdit}
          options={[
            { value: 'beginner', label: 'Beginner' },
            { value: 'standard', label: 'Standard' },
            { value: 'custom', label: 'Custom' },
          ]}
          onChange={(roleSet) => update({ roleSet })}
        />
        <span className="dc-field__hint">{SET_HELP[settings.roleSet]}</span>
      </div>

      {custom ? (
        <div className="dx-settings__custom">
          <span className="dc-field__label">Special roles</span>
          <ul className="dx-settings__roles">
            {DECEPTION_SPECIALS.map((r) => (
              <li
                key={r}
                className={cx('dx-settings__role', settings.customRoles[r] && 'is-on')}
                style={{ '--role': ROLE_COLOR[r] } as CSSProperties}
              >
                <RoleEmblem role={r} size={28} />
                <span className="dx-settings__roletext">
                  <Toggle
                    label={`${DECEPTION_ROLE_INFO[r].name}${DECEPTION_ROLE_INFO[r].team === 'glitches' ? ' (Glitch team)' : ''}`}
                    checked={settings.customRoles[r]}
                    disabled={!canEdit}
                    onChange={(on) => update({ customRoles: { ...settings.customRoles, [r]: on } })}
                  />
                  <span className="dc-field__hint">{DECEPTION_ROLE_INFO[r].rule}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="dc-field">
            <span className="dc-field__label">Glitches</span>
            <Segmented
              label="Number of Glitches"
              value={String(settings.glitchCount)}
              disabled={!canEdit}
              options={[
                { value: '0', label: `Auto (${autoGlitchCount(Math.max(seated, DECEPTION_LIMITS.minPlayers))})` },
                ...[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) })),
              ]}
              onChange={(v) => update({ glitchCount: Number(v) })}
            />
          </div>
        </div>
      ) : null}

      <div className={cx('dx-settings__preview', !preview.ok && 'is-error')} role="status">
        <Icon name={preview.ok ? 'users' : 'warning'} size={14} />
        {preview.ok ? (
          <span>
            With <span className="dc-num">{preview.setup.players}</span> players: {describeSetup(preview.setup)}
            {seated < DECEPTION_LIMITS.minPlayers ? (
              <span className="dc-muted"> (needs at least {DECEPTION_LIMITS.minPlayers} to start)</span>
            ) : null}
          </span>
        ) : (
          <span>{preview.error}</span>
        )}
      </div>

      <div className="dx-settings__grid">
        <Field label="Night" aside={<span className="dc-num">{settings.nightSeconds}s</span>} hint="Time for secret actions.">
          {({ id, describedBy }) => (
            <Slider
              id={id}
              aria-describedby={describedBy}
              min={20}
              max={120}
              step={5}
              value={settings.nightSeconds}
              disabled={!canEdit}
              onChange={(nightSeconds) => update({ nightSeconds })}
            />
          )}
        </Field>
        <Field
          label="Discussion"
          aside={<span className="dc-num">{settings.discussionSeconds}s</span>}
          hint="Ends early when everyone is ready to vote."
        >
          {({ id, describedBy }) => (
            <Slider
              id={id}
              aria-describedby={describedBy}
              min={30}
              max={300}
              step={10}
              value={settings.discussionSeconds}
              disabled={!canEdit}
              onChange={(discussionSeconds) => update({ discussionSeconds })}
            />
          )}
        </Field>
        <Field label="Vote" aside={<span className="dc-num">{settings.voteSeconds}s</span>} hint="Ends early when everyone has voted.">
          {({ id, describedBy }) => (
            <Slider
              id={id}
              aria-describedby={describedBy}
              min={15}
              max={120}
              step={5}
              value={settings.voteSeconds}
              disabled={!canEdit}
              onChange={(voteSeconds) => update({ voteSeconds })}
            />
          )}
        </Field>
      </div>

      <div className="dc-field">
        <span className="dc-field__label">On a tied vote</span>
        <Segmented
          label="Tie rule"
          value={settings.tieRule}
          disabled={!canEdit}
          options={[
            { value: 'runoff', label: 'Runoff vote' },
            { value: 'none', label: 'Nobody leaves' },
          ]}
          onChange={(tieRule) => update({ tieRule })}
        />
      </div>
      <div className="dc-field">
        <span className="dc-field__label">Vote reveal</span>
        <Segmented
          label="Vote reveal"
          value={settings.voteReveal}
          disabled={!canEdit}
          options={[
            { value: 'full', label: 'Who voted for whom' },
            { value: 'tally', label: 'Totals only' },
          ]}
          onChange={(voteReveal) => update({ voteReveal })}
        />
      </div>
      <Toggle label="Allow “Skip” votes" checked={settings.allowSkip} disabled={!canEdit} onChange={(allowSkip) => update({ allowSkip })} />
      <Toggle
        label="Reveal a player’s role when they go offline"
        checked={settings.revealRoles}
        disabled={!canEdit}
        onChange={(revealRoles) => update({ revealRoles })}
      />
    </div>
  );
}
