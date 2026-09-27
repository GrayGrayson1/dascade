/**
 * Lobby settings for DASterpiece. Custom prompts travel on their own host-only message (they
 * never enter public room state) and can be saved / loaded as prompt packs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Field, PixelIcon, Segmented, Select, Slider, TextArea, TextInput, Toggle, cx } from '@dascade/ui';
import { PROMPT_PACK, builtInPromptCount } from '@dascade/game-core/masterpiece';
import {
  MASTERPIECE_MSG,
  MP_LIMITS,
  MP_PLAYER_TOKEN,
  MP_PROMPT_TYPES,
  MP_PROMPT_TYPE_INFO,
  MP_VOTE_KIND_INFO,
  cleanCustomPrompts,
  splitPromptList,
  type MasterpiecePublicState,
  type MasterpieceSettings,
  type MpBuiltInType,
  type MpPromptsPrivate,
  type MpVotingMode,
} from '@dascade/shared/games/masterpiece';
import { session, useLatestMessage, useRoomSelector } from '../../net/hooks.ts';
import { persistence, type Preset } from '../../persistence/index.ts';
import { useApp } from '../../app/store.ts';
import type { SettingsPanelProps } from '../types.ts';
import { THEME_ICON } from './art.tsx';

const MODE_HELP: Record<MpVotingMode, string> = {
  showtime: 'Mixes it up each exhibition: head-to-head, favourite and top-three rounds, sized to your group.',
  favourite: MP_VOTE_KIND_INFO.favourite.blurb,
  matchups: `${MP_VOTE_KIND_INFO.matchup.blurb} Best for 3–12 players.`,
  ranked: `${MP_VOTE_KIND_INFO.ranked.blurb} Needs 5+ players (smaller groups vote for a favourite).`,
};

const PACK_KIND = 'masterpiece-prompts';

export function MasterpieceSettingsPanel({ settings, canEdit, update }: SettingsPanelProps<MasterpieceSettings>) {
  const customCount = useRoomSelector<MasterpiecePublicState, number>((s) => s.customCount ?? 0) ?? 0;
  const builtIn = settings.customOnly ? 0 : builtInPromptCount(settings.promptTypes);
  const pool = builtIn + customCount;

  const toggleType = (id: MpBuiltInType) => {
    const has = settings.promptTypes.includes(id);
    update({ promptTypes: has ? settings.promptTypes.filter((t) => t !== id) : MP_PROMPT_TYPES.filter((t) => t === id || settings.promptTypes.includes(t)) });
  };

  return (
    <div className="mp-settings">
      <div className="mp-settings__row">
        <Field label="Exhibitions" aside={<span className="mp-settings__value dc-num">{settings.rounds}</span>} hint="Rounds in a match. Each has its own theme.">
          {({ id, describedBy }) => <Slider id={id} aria-describedby={describedBy} min={1} max={5} value={settings.rounds} disabled={!canEdit} onChange={(rounds) => update({ rounds })} />}
        </Field>
        <Field label="Writing time" aside={<span className="mp-settings__value dc-num">{settings.writeSeconds}s</span>} hint="Per prompt (head-to-head players may get two).">
          {({ id, describedBy }) => (
            <Slider id={id} aria-describedby={describedBy} min={30} max={180} step={10} value={settings.writeSeconds} disabled={!canEdit} onChange={(writeSeconds) => update({ writeSeconds })} />
          )}
        </Field>
        <Field label="Voting time" aside={<span className="mp-settings__value dc-num">{settings.voteSeconds}s</span>} hint="Per showdown (top-three ballots get +10s).">
          {({ id, describedBy }) => (
            <Slider id={id} aria-describedby={describedBy} min={10} max={60} step={5} value={settings.voteSeconds} disabled={!canEdit} onChange={(voteSeconds) => update({ voteSeconds })} />
          )}
        </Field>
      </div>

      <div className="dc-field">
        <span className="dc-field__label">Voting style</span>
        <Segmented
          label="Voting style"
          value={settings.votingMode}
          disabled={!canEdit}
          options={[
            { value: 'showtime', label: 'Showtime' },
            { value: 'favourite', label: 'Favourite' },
            { value: 'matchups', label: 'Head-to-Head' },
            { value: 'ranked', label: 'Top Three' },
          ]}
          onChange={(votingMode) => update({ votingMode: votingMode as MpVotingMode })}
        />
        <span className="dc-field__hint">{MODE_HELP[settings.votingMode]}</span>
      </div>

      <div className="dc-field">
        <span className="dc-field__label" id="mp-types-label">
          <span>Round themes</span>
          {canEdit ? (
            <span className="mp-settings__links">
              <button type="button" className="mp-link" onClick={() => update({ promptTypes: [...MP_PROMPT_TYPES] })}>
                All
              </button>
              <button type="button" className="mp-link" onClick={() => update({ promptTypes: [] })}>
                None
              </button>
            </span>
          ) : null}
        </span>
        <div className={cx('mp-types', settings.customOnly && 'is-muted')} role="group" aria-labelledby="mp-types-label">
          {MP_PROMPT_TYPES.map((id) => {
            const on = settings.promptTypes.includes(id);
            return (
              <button key={id} type="button" className="mp-type" aria-pressed={on} disabled={!canEdit} onClick={() => toggleType(id)} title={MP_PROMPT_TYPE_INFO[id].instruction}>
                <PixelIcon name={THEME_ICON[id]} className="mp-type__icon" />
                <span className="mp-type__name">{MP_PROMPT_TYPE_INFO[id].label}</span>
                <span className="mp-type__count dc-num">{PROMPT_PACK[id].length}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mp-settings__toggles">
        <Toggle label="Let players change their vote until they lock in" checked={settings.allowVoteChange} disabled={!canEdit} onChange={(allowVoteChange) => update({ allowVoteChange })} />
        <Toggle label="Audience voting (spectators award a crowd bonus)" checked={settings.audienceVote} disabled={!canEdit} onChange={(audienceVote) => update({ audienceVote })} />
        <Toggle label="Final exhibition scores double" checked={settings.doubleFinal} disabled={!canEdit} onChange={(doubleFinal) => update({ doubleFinal })} />
      </div>

      <CustomPrompts canEdit={canEdit} customCount={customCount} />
      <Toggle
        label="Only use my prompts"
        checked={settings.customOnly}
        disabled={!canEdit || (customCount === 0 && !settings.customOnly)}
        onChange={(customOnly) => update({ customOnly })}
      />

      <div className={cx('mp-pool', pool === 0 && 'is-empty')} role="status">
        <span className="dc-label">Prompt pool</span>
        <strong className="dc-num">{pool.toLocaleString('en-US')}</strong>
        <span>{pool === 0 ? 'No prompts yet — pick a theme or add your own.' : `prompt${pool === 1 ? '' : 's'} ready`}</span>
      </div>
    </div>
  );
}

function CustomPrompts({ canEdit, customCount }: { canEdit: boolean; customCount: number }) {
  const serverList = useLatestMessage<MpPromptsPrivate>(MASTERPIECE_MSG.prompts);
  const [draft, setDraft] = useState(() => serverList?.prompts.join('\n') ?? '');
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Text typed but not sent yet (the debounce is still running). */
  const pending = useRef<string | null>(null);

  useEffect(() => {
    if (!focused.current && serverList) setDraft(serverList.prompts.join('\n'));
  }, [serverList]);

  const sendNow = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    const prompts = splitPromptList(text)
      .slice(0, MP_LIMITS.customPromptsMax * 2)
      .map((p) => p.slice(0, MP_LIMITS.customPromptMax * 2));
    session.send(MASTERPIECE_MSG.prompts, { prompts });
  }, []);
  // Closing the panel (or starting the game) mid-debounce flushes the last edits instead of dropping them.
  useEffect(
    () => () => {
      if (pending.current !== null) sendNow(pending.current);
    },
    [sendNow],
  );
  const onChange = (text: string) => {
    setDraft(text);
    pending.current = text;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => sendNow(text), 500);
  };

  const local = useMemo(() => cleanCustomPrompts(splitPromptList(draft)), [draft]);
  const synced = serverList !== undefined && serverList.prompts.join('\n') === draft;
  const report = synced ? serverList.report : local;
  const notes = [
    report.duplicates ? `${report.duplicates} duplicate${report.duplicates === 1 ? '' : 's'} removed` : '',
    report.invalid ? `${report.invalid} too short` : '',
    report.filtered ? `${report.filtered} blocked by the profanity filter` : '',
    report.overflow ? `only the first ${MP_LIMITS.customPromptsMax} are kept` : '',
  ].filter(Boolean);

  if (!canEdit) {
    return (
      <div className="dc-field">
        <span className="dc-field__label">House prompts</span>
        <div className="mp-custom-readonly">
          <Badge color={customCount ? 'var(--accent-2)' : 'var(--text-3)'}>{customCount} custom</Badge>
          <span className="mp-muted">{customCount ? 'The host’s prompts stay secret until they’re dealt.' : 'The host hasn’t written any prompts.'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="dc-field mp-custom">
      <div className="dc-field__label">
        <label htmlFor="mp-custom-prompts">House prompts</label>
        <span className="dc-num" aria-live="polite">
          {local.prompts.length}/{MP_LIMITS.customPromptsMax}
        </span>
      </div>
      <TextArea
        id="mp-custom-prompts"
        value={draft}
        rows={5}
        placeholder={`One prompt per line, e.g.\nThe real reason the office plant is thriving:\nName ${MP_PLAYER_TOKEN}’s future podcast.`}
        spellCheck
        aria-describedby="mp-custom-hint"
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          sendNow(draft);
        }}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
      <span id="mp-custom-hint" className="dc-field__hint">
        {notes.length ? notes.join(' · ') : `Only you can see this list. Use ${MP_PLAYER_TOKEN} to drop in a random player’s name. Max ${MP_LIMITS.customPromptMax} characters each.`}
      </span>
      <PromptPacks
        prompts={local.prompts}
        onLoad={(prompts) => {
          const text = prompts.join('\n');
          setDraft(text);
          sendNow(text);
        }}
      />
    </div>
  );
}

function PromptPacks({ prompts, onLoad }: { prompts: string[]; onLoad: (prompts: string[]) => void }) {
  const [packs, setPacks] = useState<Array<Preset<string[]>>>([]);
  const [selected, setSelected] = useState('');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const toast = useApp((s) => s.toast);

  const refresh = useCallback(async () => {
    try {
      const list = await persistence().listPresets<string[]>(PACK_KIND);
      setPacks(list.filter((p) => Array.isArray(p.data)).sort((a, b) => b.updatedAt - a.updatedAt));
    } catch {
      setPacks([]);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const current = packs.find((p) => p.id === selected);
  const save = async () => {
    const clean = name.trim().slice(0, 40);
    if (!clean || prompts.length === 0) return;
    try {
      const saved = await persistence().savePreset<string[]>(PACK_KIND, clean, prompts, packs.find((p) => p.name === clean)?.id);
      toast('success', `Saved prompt pack “${saved.name}”`);
      setNaming(false);
      setName('');
      await refresh();
      setSelected(saved.id);
    } catch {
      toast('error', 'Could not save that prompt pack.');
    }
  };

  return (
    <div className="mp-packs">
      <span className="dc-label">Prompt packs</span>
      {naming ? (
        <form
          className="mp-packs__row"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <TextInput value={name} maxLength={40} autoFocus placeholder="Pack name" aria-label="Prompt pack name" onChange={(e) => setName(e.currentTarget.value)} />
          <Button size="sm" variant="primary" type="submit" disabled={!name.trim()}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="mp-packs__row">
          <Select value={selected} aria-label="Saved prompt packs" onChange={(e) => setSelected(e.currentTarget.value)} disabled={packs.length === 0}>
            <option value="">{packs.length ? 'Choose a saved pack…' : 'No saved packs yet'}</option>
            {packs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.data.length})
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            disabled={!current}
            onClick={() => {
              if (!current) return;
              onLoad(current.data.map((s) => String(s)));
              toast('info', `Loaded “${current.name}”`);
            }}
          >
            Load
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            disabled={!current}
            aria-label="Delete prompt pack"
            onClick={async () => {
              if (!current) return;
              await persistence().deletePreset(PACK_KIND, current.id);
              setSelected('');
              await refresh();
            }}
          />
          <Button size="sm" variant="secondary" icon="plus" disabled={prompts.length === 0} onClick={() => setNaming(true)}>
            Save list
          </Button>
        </div>
      )}
    </div>
  );
}
