/**
 * Lobby settings for DASketch. Custom words are sent with their own host-only message
 * (they never enter public room state) and can be saved/loaded as word packs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AVATAR_ART, Badge, Button, Field, PixelArt, Segmented, Select, Slider, TextArea, TextInput, Toggle, cx } from '@dascade/ui';
import { WORD_BANK, wordPoolSize } from '@dascade/game-core/dasketch';
import {
  DASKETCH_MSG,
  SKETCH_CATEGORY_IDS,
  SKETCH_CATEGORY_LABELS,
  SKETCH_CUSTOM_MAX,
  cleanCustomWords,
  splitWordList,
  type DasketchPublicState,
  type DasketchSettings,
  type SketchCategoryId,
  type SketchHintMode,
  type SketchWordsPrivate,
} from '@dascade/shared/games/dasketch';
import { containsProfanity } from '@dascade/shared';
import { session, useLatestMessage, useRoomSelector } from '../../net/hooks.ts';
import { persistence, type Preset } from '../../persistence/index.ts';
import { useApp } from '../../app/store.ts';
import type { SettingsPanelProps } from '../types.ts';

const CATEGORY_ART: Record<SketchCategoryId, string> = {
  animals: 'cat',
  food: 'pizza',
  objects: 'coffee',
  office: 'disk',
  places: 'rocket',
  actions: 'bolt',
  arcade: 'joystick',
  nature: 'cactus',
};

const HINT_HELP: Record<SketchHintMode, string> = {
  off: 'No letters are revealed — pure drawing skill.',
  slow: 'A couple of letters appear late in the turn.',
  normal: 'Letters trickle in from about a third of the way through.',
  fast: 'Generous hints that start early. Great for big groups.',
};

const PACK_KIND = 'sketch-words';

export function SketchSettingsPanel({ settings, canEdit, update }: SettingsPanelProps<DasketchSettings>) {
  const customCount = useRoomSelector<DasketchPublicState, number>((s) => s.customCount ?? 0) ?? 0;
  const customFiltered = useRoomSelector<DasketchPublicState, number>((s) => s.customFiltered ?? 0) ?? 0;
  const hostList = useLatestMessage<SketchWordsPrivate>(DASKETCH_MSG.words);
  const pool = useMemo(() => {
    // The host holds the private list, so they get the exact de-duplicated count.
    if (canEdit && hostList) return wordPoolSize({ ...settings, customWords: hostList.words });
    const builtIn = settings.customOnly ? 0 : settings.categories.reduce((n, id) => n + (WORD_BANK[id]?.length ?? 0), 0);
    return builtIn + customCount;
  }, [canEdit, hostList, settings, customCount]);

  const toggleCategory = (id: SketchCategoryId) => {
    const has = settings.categories.includes(id);
    update({ categories: has ? settings.categories.filter((c) => c !== id) : SKETCH_CATEGORY_IDS.filter((c) => c === id || settings.categories.includes(c)) });
  };

  return (
    <div className="sk-settings">
      <div className="sk-settings__row">
        <Field label="Rounds" aside={<span className="sk-settings__value dc-num">{settings.rounds}</span>} hint="Everyone draws once per round.">
          {({ id, describedBy }) => (
            <Slider id={id} aria-describedby={describedBy} min={1} max={10} value={settings.rounds} disabled={!canEdit} onChange={(rounds) => update({ rounds })} />
          )}
        </Field>
        <Field label="Drawing time" aside={<span className="sk-settings__value dc-num">{settings.drawSeconds}s</span>} hint="Seconds the artist has per turn.">
          {({ id, describedBy }) => (
            <Slider id={id} aria-describedby={describedBy} min={30} max={240} step={10} value={settings.drawSeconds} disabled={!canEdit} onChange={(drawSeconds) => update({ drawSeconds })} />
          )}
        </Field>
      </div>

      <div className="dc-field">
        <span className="dc-field__label">Word choices for the artist</span>
        <Segmented
          label="Word choices"
          value={String(settings.choiceCount)}
          disabled={!canEdit}
          options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
          onChange={(v) => update({ choiceCount: Number(v) })}
        />
      </div>

      <div className="dc-field">
        <span className="dc-field__label">Letter hints</span>
        <Segmented
          label="Letter hints"
          value={settings.hints}
          disabled={!canEdit}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'slow', label: 'Slow' },
            { value: 'normal', label: 'Normal' },
            { value: 'fast', label: 'Fast' },
          ]}
          onChange={(hints) => update({ hints })}
        />
        <span className="dc-field__hint">{HINT_HELP[settings.hints]}</span>
      </div>

      <Toggle
        label="Tell guessers when they’re close"
        checked={settings.closeGuesses}
        disabled={!canEdit}
        onChange={(closeGuesses) => update({ closeGuesses })}
      />

      <div className="dc-field">
        <span className="dc-field__label" id="sk-cats-label">
          <span>Word categories</span>
          {canEdit ? (
            <span className="sk-settings__links">
              <button type="button" className="sk-link" onClick={() => update({ categories: [...SKETCH_CATEGORY_IDS] })}>
                All
              </button>
              <button type="button" className="sk-link" onClick={() => update({ categories: [] })}>
                None
              </button>
            </span>
          ) : null}
        </span>
        <div className={cx('sk-cats', settings.customOnly && 'is-muted')} role="group" aria-labelledby="sk-cats-label">
          {SKETCH_CATEGORY_IDS.map((id) => {
            const on = settings.categories.includes(id);
            return (
              <button
                key={id}
                type="button"
                className="sk-cat"
                aria-pressed={on}
                disabled={!canEdit}
                onClick={() => toggleCategory(id)}
              >
                <PixelArt rows={AVATAR_ART[CATEGORY_ART[id]] ?? AVATAR_ART.star!} mainColor={on ? 'var(--accent)' : 'var(--text-3)'} className="sk-cat__art" />
                <span className="sk-cat__name">{SKETCH_CATEGORY_LABELS[id]}</span>
                <span className="sk-cat__count dc-num">{WORD_BANK[id].length}</span>
              </button>
            );
          })}
        </div>
      </div>

      <CustomWords canEdit={canEdit} customCount={customCount} customFiltered={customFiltered} filterProfanity={settings.filterProfanity} />

      <div className="sk-settings__toggles">
        <Toggle
          label="Only use custom words"
          checked={settings.customOnly}
          disabled={!canEdit || (customCount === 0 && !settings.customOnly)}
          onChange={(customOnly) => update({ customOnly })}
        />
        <Toggle
          label="Filter profanity from custom words"
          checked={settings.filterProfanity}
          disabled={!canEdit}
          onChange={(filterProfanity) => update({ filterProfanity })}
        />
      </div>

      <div className={cx('sk-pool', pool === 0 && 'is-empty')} role="status">
        <span className="dc-label">Word pool</span>
        <strong className="dc-num">{pool.toLocaleString('en-US')}</strong>
        <span>{pool === 0 ? 'No words yet — pick a category or add custom words.' : `word${pool === 1 ? '' : 's'} ready to draw`}</span>
      </div>
    </div>
  );
}

function CustomWords({ canEdit, customCount, customFiltered, filterProfanity }: { canEdit: boolean; customCount: number; customFiltered: number; filterProfanity: boolean }) {
  const serverList = useLatestMessage<SketchWordsPrivate>(DASKETCH_MSG.words);
  const [draft, setDraft] = useState(() => serverList?.words.join('\n') ?? '');
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the textarea in sync with the server copy unless the host is typing.
  useEffect(() => {
    if (!focused.current && serverList) setDraft(serverList.words.join('\n'));
  }, [serverList]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const sendNow = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    // Raw (bounded) entries: the server sanitizes, de-duplicates and reports what it cleaned.
    const words = splitWordList(text)
      .slice(0, SKETCH_CUSTOM_MAX * 2)
      .map((w) => w.slice(0, 64));
    session.send(DASKETCH_MSG.words, { words });
  }, []);
  const onChange = (text: string) => {
    setDraft(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => sendNow(text), 450);
  };

  const local = useMemo(() => cleanCustomWords(splitWordList(draft), false), [draft]);
  const localFiltered = filterProfanity ? local.words.filter((w) => containsProfanity(w)).length : 0;
  // Once the draft is the stored list, report how the server cleaned the last submission.
  const synced = serverList !== undefined && serverList.words.join('\n') === draft;
  const duplicates = synced ? serverList.report.duplicates : local.duplicates;
  const invalid = synced ? serverList.report.invalid : local.invalid;
  const overflow = synced ? serverList.report.overflow : local.overflow;
  const notes = [
    duplicates ? `${duplicates} duplicate${duplicates === 1 ? '' : 's'} removed` : '',
    invalid ? `${invalid} unusable entr${invalid === 1 ? 'y' : 'ies'} skipped` : '',
    localFiltered ? `${localFiltered} hidden by the profanity filter` : '',
    overflow ? `only the first ${SKETCH_CUSTOM_MAX} are kept` : '',
  ].filter(Boolean);

  if (!canEdit) {
    return (
      <div className="dc-field">
        <span className="dc-field__label">Custom words</span>
        <div className="sk-custom-readonly">
          <Badge color={customCount ? 'var(--accent-2)' : 'var(--text-3)'}>{customCount} custom</Badge>
          <span className="dc-muted">
            {customCount ? 'The host’s custom words are secret until they’re drawn.' : 'The host hasn’t added custom words.'}
            {customFiltered ? ` ${customFiltered} filtered.` : ''}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="dc-field sk-custom">
      <div className="dc-field__label">
        <label htmlFor="sk-custom-words">Custom words</label>
        <span className="dc-num" aria-live="polite">
          {local.words.length - localFiltered}/{SKETCH_CUSTOM_MAX}
        </span>
      </div>
      <TextArea
        id="sk-custom-words"
        value={draft}
        rows={5}
        placeholder={'One per line or comma-separated, e.g.\nquarterly review, coffee machine, team offsite'}
        spellCheck={false}
        aria-describedby="sk-custom-hint"
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          sendNow(draft);
        }}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
      <span id="sk-custom-hint" className="dc-field__hint">
        {notes.length ? notes.join(' · ') : 'Only you can see this list — players never receive it.'}
      </span>
      <WordPacks
        words={local.words}
        onLoad={(words) => {
          const text = words.join('\n');
          setDraft(text);
          sendNow(text);
        }}
      />
    </div>
  );
}

function WordPacks({ words, onLoad }: { words: string[]; onLoad: (words: string[]) => void }) {
  const [packs, setPacks] = useState<Array<Preset<string[]>>>([]);
  const [selected, setSelected] = useState('');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const toast = useApp((s) => s.toast);

  const refresh = useCallback(async () => {
    try {
      const list = await persistence().listPresets<string[]>(PACK_KIND);
      setPacks(list.sort((a, b) => b.updatedAt - a.updatedAt));
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
    if (!clean || words.length === 0) return;
    try {
      const saved = await persistence().savePreset<string[]>(PACK_KIND, clean, words, packs.find((p) => p.name === clean)?.id);
      toast('success', `Saved word pack “${saved.name}”`);
      setNaming(false);
      setName('');
      await refresh();
      setSelected(saved.id);
    } catch {
      toast('error', 'Could not save that word pack.');
    }
  };

  return (
    <div className="sk-packs">
      <span className="dc-label">Word packs</span>
      {naming ? (
        <form
          className="sk-packs__row"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <TextInput value={name} maxLength={40} autoFocus placeholder="Pack name" aria-label="Word pack name" onChange={(e) => setName(e.currentTarget.value)} />
          <Button size="sm" variant="primary" type="submit" disabled={!name.trim()}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="sk-packs__row">
          <Select value={selected} aria-label="Saved word packs" onChange={(e) => setSelected(e.currentTarget.value)} disabled={packs.length === 0}>
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
              onLoad(current.data);
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
            aria-label="Delete word pack"
            onClick={async () => {
              if (!current) return;
              await persistence().deletePreset(PACK_KIND, current.id);
              setSelected('');
              await refresh();
            }}
          />
          <Button size="sm" variant="secondary" icon="plus" disabled={words.length === 0} onClick={() => setNaming(true)}>
            Save list
          </Button>
        </div>
      )}
    </div>
  );
}
