/**
 * Host settings for DAS Bingo (rendered inside the shared lobby).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createCryptoRng } from '@dascade/shared';
import {
  BINGO_LIMITS,
  BINGO_MSG,
  DEFAULT_BINGO_SETTINGS,
  type BingoPatternRef,
  type BingoPresetId,
  type BingoPublicState,
  type BingoRound,
  type BingoSeedPayload,
  type BingoSettings,
} from '@dascade/shared/games/bingo';
import {
  boardSpec,
  centerIndex,
  generateCard,
  itemsPerCard,
  maskFromString,
  maskToString,
  patternName,
  patternProblem,
  resizeMask,
  roundTitle,
  setupProblems,
  summarizeItems,
  type ItemParseMode,
} from '@dascade/game-core/bingo';
import { Badge, Button, Field, IconButton, Modal, PixelIcon, Segmented, Slider, TextArea, TextInput, Toggle, cx } from '@dascade/ui';
import type { SettingsPanelProps } from '../types.ts';
import { useLatestMessage, useRoomSelector } from '../../net/hooks.ts';
import { session } from '../../net/session.ts';
import { persistence, type Preset } from '../../persistence/index.ts';
import { useApp } from '../../app/store.ts';
import { sfx } from '../../audio/audio.ts';
import { BingoCardView, PatternGrid } from './Card.tsx';
import { PatternStudio, refMasks } from './PatternStudio.tsx';
import { useDebouncedCommit } from './util.ts';

const preset = (id: BingoPresetId): BingoPatternRef => ({ type: 'preset', id, rotate: false, mirror: false });

const OFFICE_ITEMS = [
  'Can you hear me?',
  'You’re on mute',
  'Let’s take this offline',
  'Circle back',
  'Synergy',
  'Low-hanging fruit',
  'Can everyone see my screen?',
  'Sorry, go ahead',
  'Quick sync',
  'Per my last email',
  'Touch base',
  'Deep dive',
  'Action items',
  'Bandwidth',
  'Move the needle',
  'Dog barks in the background',
  'Someone joins late',
  'I have a hard stop',
  'Parking lot',
  'Let’s be mindful of time',
  'Alignment',
  'Paradigm shift',
  'Stakeholders',
  'Win-win',
  'Deliverables',
  'Leverage',
  'Ping me',
  'Next steps',
  'Game changer',
  'Reply-all accident',
  'Frozen video',
  'Wrong window shared',
  'Awkward silence',
  'Coffee refill',
  'Pivot',
  'Great question!',
];

const PARTY_ITEMS = [
  'Someone sings along',
  'Group photo',
  'Spilled drink',
  'Dance battle',
  'Inside joke',
  'Cake!',
  'Someone arrives late',
  'A toast speech',
  'Karaoke',
  'Lost phone',
  'Birthday song',
  'Surprise guest',
];

interface QuickSetup {
  id: string;
  label: string;
  blurb: string;
  settings: Partial<BingoSettings>;
}

const QUICK_SETUPS: QuickSetup[] = [
  {
    id: 'classic',
    label: 'Classic 75-ball',
    blurb: 'Any line wins',
    settings: { mode: 'numbers', format: 'single', freeCenter: true, rounds: [{ prize: '', patterns: [preset('any-line')] }] },
  },
  {
    id: 'hall',
    label: 'Hall night',
    blurb: 'Line → corners → X → blackout',
    settings: {
      mode: 'numbers',
      format: 'progressive',
      freeCenter: true,
      continueCalls: false,
      rounds: [
        { prize: 'Snack', patterns: [preset('any-line')] },
        { prize: 'Drink', patterns: [preset('four-corners')] },
        { prize: '', patterns: [preset('x')] },
        { prize: 'Grand prize', patterns: [preset('blackout')] },
      ],
    },
  },
  {
    id: 'uk',
    label: 'Line → full house',
    blurb: 'Calls carry over between rounds',
    settings: {
      mode: 'numbers',
      format: 'progressive',
      continueCalls: true,
      newCardsEachRound: false,
      rounds: [
        { prize: 'One line', patterns: [preset('any-row')] },
        { prize: 'Two lines', patterns: [preset('two-lines')] },
        { prize: 'Full house', patterns: [preset('blackout')] },
      ],
    },
  },
  {
    id: 'office',
    label: 'Meeting buzzwords',
    blurb: '5×5 custom squares',
    settings: { mode: 'text', size: 5, freeCenter: true, items: OFFICE_ITEMS, format: 'single', rounds: [{ prize: '', patterns: [preset('any-line')] }] },
  },
  {
    id: 'party',
    label: 'Quick 3×3 party',
    blurb: 'Tiny cards, fast rounds',
    settings: {
      mode: 'text',
      size: 3,
      freeCenter: true,
      items: PARTY_ITEMS,
      format: 'single',
      callSeconds: 4,
      rounds: [{ prize: '', patterns: [preset('any-line')] }],
    },
  },
];

const SETUP_KIND = 'bingo-setup';

function Section({ title, icon, children, aside }: { title: string; icon: Parameters<typeof PixelIcon>[0]['name']; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="bg-set">
      <header className="bg-set__head">
        <h3 className="bg-set__title">
          <PixelIcon name={icon} /> {title}
        </h3>
        {aside}
      </header>
      <div className="bg-set__body">{children}</div>
    </section>
  );
}

function Group({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="dc-field">
      <span className="dc-field__label">{label}</span>
      {children}
      {hint ? <span className="dc-field__hint">{hint}</span> : null}
    </div>
  );
}

export function BingoSettingsPanel({ settings: raw, canEdit, update }: SettingsPanelProps<BingoSettings>) {
  const s: BingoSettings = useMemo(() => ({ ...DEFAULT_BINGO_SETTINGS, ...raw }), [raw]);
  const spec = boardSpec(s);
  const freeIndex = spec.free ? centerIndex(spec.size) : null;
  const problems = useMemo(() => setupProblems(s), [s]);
  const [studio, setStudio] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);
  const set = (patch: Partial<BingoSettings>) => {
    if (canEdit) update(patch);
  };
  const played = s.format === 'single' ? s.rounds.slice(0, 1) : s.rounds;

  const setRound = (index: number, next: BingoRound) => set({ rounds: s.rounds.map((r, i) => (i === index ? next : r)) });

  return (
    <div className="bg-settings">
      {canEdit ? <SetupLibrary settings={s} update={update} /> : null}

      {problems.length > 0 ? (
        <div className="bg-problems" role="status">
          <PixelIcon name="warning" />
          <ul>
            {problems.slice(0, 4).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="bg-ready">
          <PixelIcon name="check" /> Ready to play — {spec.mode === 'numbers' ? 'classic 75-ball' : `${spec.size}×${spec.size} custom squares`},{' '}
          {played.length > 1 ? `${played.length} rounds` : roundTitle(played[0]!).toLowerCase()}.
        </div>
      )}

      <Section title="Cards" icon="grip">
        <Group label="Squares">
          <Segmented
            label="Card content"
            value={s.mode}
            disabled={!canEdit}
            options={[
              { value: 'numbers', label: 'Numbers · 75-ball' },
              { value: 'text', label: 'Custom text' },
            ]}
            onChange={(mode) => set({ mode })}
          />
        </Group>
        {s.mode === 'text' ? (
          <Group label="Board size" hint={`${itemsPerCard(spec)} squares per card${spec.free ? ' + free center' : ''}.`}>
            <Segmented
              label="Board size"
              value={String(s.size)}
              disabled={!canEdit}
              options={[3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: `${n}×${n}` }))}
              onChange={(v) => set({ size: Number(v) })}
            />
          </Group>
        ) : null}
        <Toggle
          label={spec.size % 2 === 0 ? 'Free center square (odd sizes only)' : 'Free center square'}
          checked={s.freeCenter && spec.size % 2 === 1}
          disabled={!canEdit || spec.size % 2 === 0}
          onChange={(freeCenter) => set({ freeCenter })}
        />
        {s.mode === 'text' ? <ItemsEditor settings={s} canEdit={canEdit} update={update} /> : null}
        <div className="bg-set__row">
          <Button size="sm" variant="secondary" icon="eye" onClick={() => setPreview(true)}>
            Preview a random card
          </Button>
        </div>
      </Section>

      <Section title="Winning patterns" icon="star">
        <Segmented
          label="Game format"
          value={s.format}
          disabled={!canEdit}
          options={[
            { value: 'single', label: 'Single round' },
            { value: 'progressive', label: 'Progressive rounds' },
          ]}
          onChange={(format) => set({ format })}
        />
        <p className="dc-field__hint">
          {s.format === 'single'
            ? 'One round: any of the chosen patterns wins.'
            : 'Rounds play in order — each has its own patterns and prize. Winners are shown between rounds.'}
        </p>
        <ol className="bg-rounds">
          {played.map((round, i) => (
            <RoundCard
              key={i}
              index={i}
              total={played.length}
              round={round}
              progressive={s.format === 'progressive'}
              size={spec.size}
              freeIndex={freeIndex}
              canEdit={canEdit}
              onChange={(next) => setRound(i, next)}
              onEdit={() => setStudio(i)}
              onMove={(dir) => {
                const next = [...s.rounds];
                const j = i + dir;
                if (j < 0 || j >= next.length) return;
                [next[i], next[j]] = [next[j]!, next[i]!];
                set({ rounds: next });
              }}
              onRemove={() => set({ rounds: s.rounds.filter((_, j) => j !== i) })}
            />
          ))}
        </ol>
        {s.format === 'progressive' && canEdit ? (
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            disabled={s.rounds.length >= BINGO_LIMITS.maxRounds}
            onClick={() => {
              const suggestions: BingoPresetId[] = ['any-line', 'four-corners', 'x', 'frame', 'blackout'];
              const id = suggestions[s.rounds.length % suggestions.length]!;
              set({ rounds: [...s.rounds, { prize: '', patterns: [preset(id)] }] });
              sfx('select');
            }}
          >
            Add round
          </Button>
        ) : null}
        {s.format === 'progressive' ? (
          <div className="bg-set__grid">
            <Toggle label="Deal new cards every round" checked={s.newCardsEachRound} disabled={!canEdit} onChange={(newCardsEachRound) => set({ newCardsEachRound, ...(newCardsEachRound ? { continueCalls: false } : {}) })} />
            <Toggle
              label="Keep called balls between rounds"
              checked={s.continueCalls}
              disabled={!canEdit || s.newCardsEachRound}
              onChange={(continueCalls) => set({ continueCalls })}
            />
            <SliderField
              label="Break between rounds"
              unit="s"
              value={s.intermissionSec}
              min={BINGO_LIMITS.minIntermissionSeconds}
              max={BINGO_LIMITS.maxIntermissionSeconds}
              disabled={!canEdit}
              commit={(intermissionSec) => set({ intermissionSec })}
            />
          </div>
        ) : null}
      </Section>

      <Section title="Caller" icon="bolt">
        <Segmented
          label="Caller mode"
          value={s.callerMode}
          disabled={!canEdit}
          options={[
            { value: 'auto', label: 'Automatic' },
            { value: 'manual', label: 'Manual (host calls)' },
          ]}
          onChange={(callerMode) => set({ callerMode })}
        />
        {s.callerMode === 'auto' ? (
          <SliderField
            label="Call speed"
            unit="s"
            prefix="Every "
            value={s.callSeconds}
            min={BINGO_LIMITS.minCallSeconds}
            max={BINGO_LIMITS.maxCallSeconds}
            disabled={!canEdit}
            commit={(callSeconds) => set({ callSeconds })}
          />
        ) : (
          <>
            <p className="dc-field__hint">
              You press “Call next” for each ball. With hand-picking on you can undo a mistaken pick, but whoever picks balls can’t win that round. Pause, speed and mode can also change mid-game.
            </p>
            <Toggle
              label="Let me pick specific balls (reading from a real cage)"
              checked={s.manualPick}
              disabled={!canEdit}
              onChange={(manualPick) => set({ manualPick })}
            />
          </>
        )}
      </Section>

      <Section title="Rules" icon="flag">
        <div className="bg-set__grid">
          <Toggle label="Auto-daub called squares" checked={s.autoMark} disabled={!canEdit} onChange={(autoMark) => set({ autoMark })} />
          <Toggle label="Show how close everyone is" checked={s.showProgress} disabled={!canEdit} onChange={(showProgress) => set({ showProgress })} />
          <Toggle label="Announce false alarms" checked={s.announceFalseClaims} disabled={!canEdit} onChange={(announceFalseClaims) => set({ announceFalseClaims })} />
          <Toggle label="One win per player" checked={s.oneWinPerPlayer} disabled={!canEdit} onChange={(oneWinPerPlayer) => set({ oneWinPerPlayer })} />
        </div>
        <SliderField
          label="False-alarm penalty"
          unit="s"
          value={s.falseClaimPenaltySec}
          min={0}
          max={BINGO_LIMITS.maxPenaltySeconds}
          disabled={!canEdit}
          format={(v) => (v === 0 ? 'None' : `${v}s benched`)}
          commit={(falseClaimPenaltySec) => set({ falseClaimPenaltySec })}
        />
        <SliderField
          label="Shared-win window"
          unit="s"
          value={s.tieWindowMs / 1000}
          min={0}
          max={BINGO_LIMITS.maxTieWindowMs / 1000}
          step={0.5}
          disabled={!canEdit}
          format={(v) => (v === 0 ? 'First claim only' : `${v.toFixed(1)}s after the first BINGO`)}
          commit={(v) => set({ tieWindowMs: Math.round(v * 1000) })}
        />
      </Section>

      <Section title="Fair play" icon="lock">
        <SeedField canEdit={canEdit} />
      </Section>

      {studio !== null && s.rounds[studio] ? (
        <PatternStudio
          open
          onClose={() => setStudio(null)}
          round={s.rounds[studio]!}
          roundLabel={s.format === 'single' ? 'Winning pattern' : `Round ${studio + 1}`}
          size={spec.size}
          freeIndex={freeIndex}
          onChange={(next) => setRound(studio, next)}
        />
      ) : null}
      <PreviewModal open={preview} onClose={() => setPreview(false)} settings={s} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

function RoundCard({
  index,
  total,
  round,
  progressive,
  size,
  freeIndex,
  canEdit,
  onChange,
  onEdit,
  onMove,
  onRemove,
}: {
  index: number;
  total: number;
  round: BingoRound;
  progressive: boolean;
  size: number;
  freeIndex: number | null;
  canEdit: boolean;
  onChange: (next: BingoRound) => void;
  onEdit: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [prize, setPrize] = useDebouncedCommit(round.prize, (p) => onChange({ ...round, prize: p }), 450);
  return (
    <li className="bg-round">
      <header className="bg-round__head">
        <span className="bg-round__no">{progressive ? index + 1 : <PixelIcon name="star" />}</span>
        <strong className="bg-round__title">{roundTitle(round)}</strong>
        {progressive && canEdit ? (
          <span className="bg-round__tools">
            <IconButton icon="chevron-up" size="sm" label={`Move round ${index + 1} earlier`} disabled={index === 0} onClick={() => onMove(-1)} />
            <IconButton icon="chevron-down" size="sm" label={`Move round ${index + 1} later`} disabled={index === total - 1} onClick={() => onMove(1)} />
            <IconButton icon="trash" size="sm" label={`Remove round ${index + 1}`} disabled={total <= 1} onClick={onRemove} />
          </span>
        ) : null}
      </header>
      <div className="bg-round__patterns">
        {round.patterns.map((p, i) => {
          const problem = patternProblem(p, size);
          const psize = p.type === 'custom' ? p.size : size;
          return (
            <span key={i} className={cx('bg-chip bg-chip--static bg-chip--pattern', problem && 'is-problem')} title={problem ?? undefined}>
              <PatternGrid size={psize} mask={refMasks(p, size)[0] ?? []} freeIndex={psize === size ? freeIndex : null} className="bg-pgrid--sm" />
              <span className="bg-chip__label">
                {patternName(p)}
                <span className="bg-chip__tags">
                  {p.type === 'preset' && refMasks(p, size).length > 1 ? <em>any</em> : null}
                  {p.rotate ? <em>↻</em> : null}
                  {p.mirror ? <em>⇆</em> : null}
                  {problem ? <em className="bg-chip__warn">won’t fit</em> : null}
                </span>
              </span>
              {canEdit && problem && p.type === 'custom' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    onChange({
                      ...round,
                      patterns: round.patterns.map((q, j) => (j === i && q.type === 'custom' ? { ...q, size, mask: maskToString(resizeMask(maskFromString(q.mask), size)) } : q)),
                    })
                  }
                >
                  Fit to {size}×{size}
                </Button>
              ) : null}
              {canEdit && round.patterns.length > 1 ? (
                <button type="button" className="bg-chip__x" aria-label={`Remove ${patternName(p)}`} onClick={() => onChange({ ...round, patterns: round.patterns.filter((_, j) => j !== i) })}>
                  <PixelIcon name="close" />
                </button>
              ) : null}
            </span>
          );
        })}
      </div>
      <div className="bg-round__foot">
        {canEdit ? (
          <>
            <TextInput
              className="bg-round__prize"
              value={prize}
              maxLength={BINGO_LIMITS.prizeLabel}
              placeholder="Prize (optional)"
              aria-label={`Prize for ${progressive ? `round ${index + 1}` : 'the winner'}`}
              onChange={(e) => setPrize(e.currentTarget.value)}
            />
            <Button size="sm" variant="primary" icon="pencil" onClick={onEdit}>
              Edit patterns
            </Button>
          </>
        ) : round.prize ? (
          <Badge color="var(--yellow)" icon="trophy">
            {round.prize}
          </Badge>
        ) : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Items (text mode)
// ---------------------------------------------------------------------------

function ItemsEditor({ settings, canEdit, update }: { settings: BingoSettings; canEdit: boolean; update: (patch: Partial<BingoSettings>) => void }) {
  const [text, setText] = useState(() => settings.items.join('\n'));
  const [mode, setMode] = useState<ItemParseMode>('auto');
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summary = useMemo(() => summarizeItems(text, mode), [text, mode]);
  const spec = boardSpec(settings);
  const need = itemsPerCard(spec);

  // Pull in outside changes (a loaded setup, another tab) when not typing.
  const serverKey = settings.items.join('\n');
  useEffect(() => {
    if (focused.current) return;
    if (summary.items.join('\n') !== serverKey) setText(serverKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const commit = (nextText: string, nextMode: ItemParseMode) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => update({ items: summarizeItems(nextText, nextMode).items }), 450);
  };

  if (!canEdit) {
    return (
      <div className="bg-items bg-items--readonly">
        <span className="dc-label">
          {settings.items.length} custom squares · {need} per card
        </span>
        <div className="bg-items__chips">
          {settings.items.slice(0, 40).map((it) => (
            <span key={it} className="bg-chip bg-chip--static">
              {it}
            </span>
          ))}
          {settings.items.length > 40 ? <span className="dc-muted">+{settings.items.length - 40} more</span> : null}
        </div>
      </div>
    );
  }

  const enough = summary.items.length >= need;
  return (
    <div className="bg-items">
      <Field
        label="Custom squares"
        aside={
          <Badge color={enough ? 'var(--green)' : 'var(--red)'} icon={enough ? 'check' : 'warning'}>
            {summary.items.length} / {need} needed
          </Badge>
        }
        hint={`One per line, or paste a comma/tab separated list. Up to ${BINGO_LIMITS.maxItems} squares, ${BINGO_LIMITS.itemLength} characters each. Duplicates are removed.`}
      >
        {({ id, describedBy }) => (
          <TextArea
            id={id}
            aria-describedby={describedBy}
            className="bg-items__input"
            value={text}
            rows={8}
            spellCheck
            placeholder={'Coffee spill\nSomeone is on mute\nReply-all accident\n…'}
            onFocus={() => (focused.current = true)}
            onBlur={() => {
              focused.current = false;
            }}
            onChange={(e) => {
              setText(e.currentTarget.value);
              commit(e.currentTarget.value, mode);
            }}
          />
        )}
      </Field>
      <div className="bg-items__bar">
        <Segmented
          label="How to split the pasted text"
          value={mode}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'lines', label: 'Lines' },
            { value: 'csv', label: 'CSV' },
          ]}
          onChange={(m) => {
            setMode(m);
            commit(text, m);
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          icon="sparkle"
          onClick={() => {
            const sample = spec.size <= 3 ? PARTY_ITEMS : OFFICE_ITEMS;
            const next = sample.join('\n');
            setText(next);
            commit(next, 'lines');
            setMode('auto');
          }}
        >
          Sample list
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="trash"
          disabled={!text}
          onClick={() => {
            setText('');
            commit('', mode);
          }}
        >
          Clear
        </Button>
      </div>
      {summary.duplicates || summary.truncated || summary.overflow ? (
        <p className="bg-items__notes">
          {summary.duplicates ? `${summary.duplicates} duplicate${summary.duplicates === 1 ? '' : 's'} removed. ` : ''}
          {summary.truncated ? `${summary.truncated} shortened to ${BINGO_LIMITS.itemLength} characters. ` : ''}
          {summary.overflow ? `${summary.overflow} over the ${BINGO_LIMITS.maxItems}-square limit ignored.` : ''}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small fields
// ---------------------------------------------------------------------------

function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  prefix = '',
  disabled,
  format,
  commit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  prefix?: string;
  disabled?: boolean;
  format?: (v: number) => string;
  commit: (v: number) => void;
}) {
  const [local, setLocal] = useDebouncedCommit(value, commit, 300);
  return (
    <label className="bg-slider">
      <span className="bg-slider__top">
        <span className="dc-field__label">{label}</span>
        <span className="bg-slider__value">{format ? format(local) : `${prefix}${local}${unit}`}</span>
      </span>
      <Slider value={local} min={min} max={max} step={step} disabled={disabled} onChange={setLocal} aria-label={label} />
    </label>
  );
}

/** Send the private fixed card seed ('' = random every game). Only the host may; the server ignores anyone else. */
function sendSeed(seed: string): void {
  session.send(BINGO_MSG.setSeed, { seed });
}

/**
 * The fixed card seed is private: it never goes into the (public) settings, because anyone who
 * knows it can work out every card. Only the host who typed it sees it until the results screen.
 */
function SeedField({ canEdit }: { canEdit: boolean }) {
  const isSet = useRoomSelector((st: BingoPublicState) => Boolean(st.customSeed)) ?? false;
  const mine = useLatestMessage<BingoSeedPayload>(BINGO_MSG.seed);
  const known = canEdit && mine && !mine.hidden ? mine.seed : '';
  const [local, setLocal] = useDebouncedCommit(known, sendSeed, 450);
  const hiddenSet = isSet && !local;
  if (!canEdit) {
    return (
      <p className="dc-field__hint">
        <PixelIcon name="lock" />{' '}
        {isSet
          ? 'The host set a fixed card seed. It stays secret until the results screen, where anyone can verify their card.'
          : 'Cards come from a fresh secret seed, revealed on the results screen so anyone can verify their card.'}
      </p>
    );
  }
  return (
    <Field
      label="Card seed (private)"
      hint={
        local
          ? 'Fixed seed: the same seat order gets the same cards every game (great for printed cards). Only you see it until the results screen — anyone who knows it can work out every card.'
          : hiddenSet
            ? 'A fixed seed was set by the previous host. It stays hidden; type a new one or clear it.'
            : 'Blank = a fresh secret seed every game. It is revealed on the results screen so anyone can verify their card.'
      }
    >
      {({ id, describedBy }) => (
        <div className="dc-row">
          <TextInput
            id={id}
            aria-describedby={describedBy}
            value={local}
            maxLength={BINGO_LIMITS.seedLength}
            placeholder={hiddenSet ? 'Fixed seed set (hidden)' : 'Random every game'}
            autoComplete="off"
            onChange={(e) => setLocal(e.currentTarget.value)}
          />
          {isSet ? (
            <Button
              size="sm"
              variant="ghost"
              icon="close"
              onClick={() => setLocal('')}
            >
              Clear
            </Button>
          ) : null}
        </div>
      )}
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Card preview
// ---------------------------------------------------------------------------

function PreviewModal({ open, onClose, settings }: { open: boolean; onClose: () => void; settings: BingoSettings }) {
  const spec = boardSpec(settings);
  const [nonce, setNonce] = useState(0);
  const cells = useMemo(() => {
    if (!open) return null;
    try {
      return generateCard(spec, createCryptoRng());
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nonce, spec.mode, spec.size, spec.free, spec.poolSize, settings.items]);
  const empty = useMemo(() => new Set<number>(), []);
  const freeSet = useMemo(() => new Set<number>(), []);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Sample card"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" icon="refresh" disabled={!cells} onClick={() => setNonce((n) => n + 1)}>
            Deal another
          </Button>
        </>
      }
    >
      {cells ? (
        <div className="bg-preview">
          <BingoCardView size={spec.size} cells={cells} mode={spec.mode} items={settings.items} called={empty} marks={freeSet} title="Sample card" label="Sample bingo card" />
          <p className="dc-field__hint">
            Every player gets a different card like this one, dealt from the game’s seed.
            {spec.mode === 'text' ? ` Squares are sampled from your ${spec.poolSize} items.` : ''}
          </p>
        </div>
      ) : (
        <p className="bg-empty-note">Add at least {itemsPerCard(spec)} custom squares to preview a card.</p>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Quick setups + saved setups
// ---------------------------------------------------------------------------

function SetupLibrary({ settings, update }: { settings: BingoSettings; update: (patch: Partial<BingoSettings>) => void }) {
  const [saved, setSaved] = useState<Array<Preset<BingoSettings>>>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const toast = useApp((s) => s.toast);
  const refresh = () =>
    persistence()
      .listPresets<BingoSettings>(SETUP_KIND)
      .then(setSaved)
      .catch(() => setSaved([]));
  useEffect(() => {
    void refresh();
  }, []);
  const apply = (patch: Partial<BingoSettings>, label: string) => {
    update({ ...DEFAULT_BINGO_SETTINGS, items: settings.items, ...patch });
    // Setups saved before seeds went private may still carry one; the fixed seed is set privately.
    const legacySeed = (patch as { seed?: unknown }).seed;
    sendSeed(typeof legacySeed === 'string' ? legacySeed : '');
    sfx('select');
    toast('success', `Loaded “${label}”.`);
  };
  const save = async () => {
    const label = name.trim() || 'My bingo setup';
    try {
      await persistence().savePreset<BingoSettings>(SETUP_KIND, label.slice(0, 40), settings);
      toast('success', `Saved setup “${label}”.`);
      setNaming(false);
      setName('');
      void refresh();
    } catch {
      toast('error', 'Could not save that setup.');
    }
  };
  return (
    <div className="bg-setups">
      <span className="dc-label">Quick start</span>
      <div className="bg-setups__row" role="group" aria-label="Quick start setups">
        {QUICK_SETUPS.map((q) => (
          <button key={q.id} type="button" className="bg-setup" onClick={() => apply(q.settings, q.label)}>
            <strong>{q.label}</strong>
            <span>{q.blurb}</span>
          </button>
        ))}
      </div>
      <div className="bg-setups__mine">
        {saved.map((p) => (
          <span key={p.id} className="bg-chip">
            <button type="button" className="bg-chip__main" onClick={() => apply(p.data, p.name)} aria-label={`Load setup ${p.name}`}>
              <PixelIcon name="heart" /> {p.name}
            </button>
            <button
              type="button"
              className="bg-chip__x"
              aria-label={`Delete setup ${p.name}`}
              onClick={() =>
                void persistence()
                  .deletePreset(SETUP_KIND, p.id)
                  .then(refresh)
                  .catch(() => undefined)
              }
            >
              <PixelIcon name="close" />
            </button>
          </span>
        ))}
        {naming ? (
          <form
            className="bg-setups__save"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <TextInput autoFocus value={name} maxLength={40} placeholder="Name this setup" aria-label="Setup name" onChange={(e) => setName(e.currentTarget.value)} />
            <IconButton icon="check" label="Save setup" type="submit" variant="primary" size="sm" />
            <IconButton icon="close" label="Cancel" size="sm" onClick={() => setNaming(false)} />
          </form>
        ) : (
          <Button size="sm" variant="ghost" icon="heart" onClick={() => setNaming(true)}>
            Save this setup
          </Button>
        )}
      </div>
    </div>
  );
}
