/**
 * The wheel editor: segments (add / remove / reorder / duplicate / enable,
 * weights, colors, icons), bulk paste with CSV-like extras, presets and the
 * wheel's behaviour. Used as the lobby SettingsPanel and in the host's side
 * panel during play.
 *
 * Edits apply to a local draft instantly and are sent to the server debounced
 * (text ~400 ms, discrete actions ~120 ms). The server validates and echoes the
 * cleaned settings back; a focused field is never overwritten mid-typing.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { shuffleInPlace } from '@dascade/shared';
import {
  WHEEL_LIMITS,
  WHEEL_PALETTE,
  type WheelSegment,
  type WheelSettings,
} from '@dascade/shared/games/wheel';
import { assignColors, computeArcs, formatBulkLine, initialRotation, normalizeSegments, parseBulkSegments } from '@dascade/game-core/wheel';
import { Badge, Button, ColorSwatches, IconButton, PixelIcon, Segmented, Select, Slider, TextArea, TextInput, cx } from '@dascade/ui';
import type { Preset } from '../../persistence/index.ts';
import { useApp } from '../../app/store.ts';
import { useRoomSelector } from '../../net/hooks.ts';
import { sfx } from '../../audio/audio.ts';
import type { SettingsPanelProps } from '../types.ts';
import { BehaviourBadges, WheelLegend, useChances } from './Legend.tsx';
import { formatDuration, formatPercent, formatWeight, makeSegment, rebaseServerToggles, uiRng, withFreshIds } from './model.ts';
import { BUILTIN_PRESETS, applyPreset, deleteUserPreset, listSavedPresets, saveUserPreset, type WheelPresetData } from './presets.ts';
import { WheelDisplay } from './WheelDisplay.tsx';

const TEXT_DEBOUNCE = 400;
const ACTION_DEBOUNCE = 120;
const QUICK_ICONS = ['🍕', '🌮', '🍣', '🍔', '☕', '🎉', '⭐', '🔥', '💎', '🎁', '🏆', '🎲', '🚀', '❤️', '✅', '❌'];

// ---------------------------------------------------------------------------
// Draft state with debounced, rejection-safe syncing
// ---------------------------------------------------------------------------

type Patch = Partial<WheelSettings>;

function useDraft(settings: WheelSettings, canEdit: boolean, update: (patch: Patch) => void) {
  const [draft, setDraft] = useState(settings);
  const draftRef = useRef(settings);
  const pending = useRef<Patch | null>(null);
  /** Server settings when the pending batch started (to rebase server-made toggles). */
  const pendingBase = useRef<WheelSettings | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const echoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef({ settings, canEdit, update });
  live.current = { settings, canEdit, update };

  useEffect(() => {
    if (pending.current) return;
    draftRef.current = settings;
    setDraft(settings);
  }, [settings]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    let patch = pending.current;
    if (!patch || !live.current.canEdit) return;
    const base = pendingBase.current;
    const sentAgainst = live.current.settings;
    // Held back during a spin? The server may have switched the winner off meanwhile ("remove
    // winner"); keep that instead of re-enabling it with the stale list.
    if (patch.segments && base && base !== sentAgainst) {
      const segments = rebaseServerToggles(patch.segments, base.segments, sentAgainst.segments);
      if (segments !== patch.segments) {
        patch = { ...patch, segments };
        draftRef.current = { ...draftRef.current, segments };
        setDraft(draftRef.current);
      }
    }
    pending.current = null;
    pendingBase.current = null;
    live.current.update(patch);
    if (echoTimer.current) clearTimeout(echoTimer.current);
    echoTimer.current = setTimeout(() => {
      // No echo means the server refused the change: fall back to its version.
      if (!pending.current && live.current.settings === sentAgainst) {
        draftRef.current = live.current.settings;
        setDraft(live.current.settings);
      }
    }, 1600);
  }, []);

  useEffect(() => {
    if (canEdit && pending.current) flush();
  }, [canEdit, flush]);

  useEffect(
    () => () => {
      flush();
      if (echoTimer.current) clearTimeout(echoTimer.current);
    },
    [flush],
  );

  const commit = useCallback(
    (patch: Patch | ((d: WheelSettings) => Patch), delay = ACTION_DEBOUNCE) => {
      const p = typeof patch === 'function' ? patch(draftRef.current) : patch;
      if (!pending.current) pendingBase.current = live.current.settings;
      draftRef.current = { ...draftRef.current, ...p };
      setDraft(draftRef.current);
      pending.current = { ...(pending.current ?? {}), ...p };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [flush],
  );

  return { draft, draftRef, commit };
}

/** Names of seated players in join order (re-renders only when they change). */
function useSeatedNames(): string[] {
  return (
    useRoomSelector((s) =>
      Object.values(s.players ?? {})
        .filter((p) => !p.spectator)
        .sort((a, b) => a.joinOrder - b.joinOrder)
        .map((p) => p.name),
    ) ?? []
  );
}

/** Text that follows `value` except while the field is focused. */
function useFieldText(value: string) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  return {
    text,
    setText,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      setText(value);
    },
  };
}

// ---------------------------------------------------------------------------
// Panel entry points
// ---------------------------------------------------------------------------

export function WheelSettingsPanel({ settings, canEdit, update }: SettingsPanelProps<WheelSettings>) {
  if (!settings || !Array.isArray(settings.segments)) return null;
  if (!canEdit) return <ReadOnlyWheel settings={settings} showPreview />;
  return <WheelEditor settings={settings} canEdit={canEdit} update={update} showPreview />;
}

export function ReadOnlyWheel({ settings, lastWinnerId, showPreview }: { settings: WheelSettings; lastWinnerId?: string; showPreview?: boolean }) {
  const layout = useMemo(() => ({ segments: normalizeSegments(settings.segments), sliceMode: settings.sliceMode }), [settings.segments, settings.sliceMode]);
  const rest = useMemo(() => initialRotation(computeArcs(layout.segments, layout.sliceMode)), [layout]);
  return (
    <div className="wh-editor wh-editor--readonly">
      {showPreview ? (
        <div className="wh-editor__preview">
          <WheelDisplay variant="preview" layout={layout} rest={rest} spin={null} highlight={null} maxSize={240} label={`Preview of the wheel with ${layout.segments.length} options`} />
        </div>
      ) : null}
      {settings.title ? <p className="wh-editor__question">“{settings.title}”</p> : null}
      <BehaviourBadges settings={settings} />
      <WheelLegend settings={settings} lastWinnerId={lastWinnerId} />
    </div>
  );
}

export function WheelEditor({
  settings,
  canEdit,
  update,
  showPreview,
  lockedReason,
}: SettingsPanelProps<WheelSettings> & { showPreview?: boolean; lockedReason?: string | null }) {
  const { draft, draftRef, commit } = useDraft(settings, canEdit, update);
  const [undo, setUndo] = useState<{ text: string; segments: WheelSegment[] } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const offerUndo = useCallback((text: string, segments: WheelSegment[]) => {
    setUndo({ text, segments });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 7000);
  }, []);
  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  const setSegments = useCallback(
    (fn: (segs: WheelSegment[]) => WheelSegment[], delay = ACTION_DEBOUNCE) => commit((d) => ({ segments: fn(d.segments) }), delay),
    [commit],
  );

  const locked = !canEdit;
  const previewLayout = useMemo(() => ({ segments: normalizeSegments(draft.segments), sliceMode: draft.sliceMode }), [draft.segments, draft.sliceMode]);
  const previewRest = useMemo(() => initialRotation(computeArcs(previewLayout.segments, previewLayout.sliceMode)), [previewLayout]);

  return (
    <div className={cx('wh-editor', locked && 'is-locked')}>
      {lockedReason ? (
        <p className="wh-editor__locked" role="status">
          <PixelIcon name="lock" /> {lockedReason}
        </p>
      ) : null}
      {showPreview ? (
        <div className="wh-editor__preview">
          <WheelDisplay
            variant="preview"
            layout={previewLayout}
            rest={previewRest}
            spin={null}
            highlight={null}
            maxSize={260}
            label={`Preview of the wheel with ${previewLayout.segments.length} options`}
          />
        </div>
      ) : null}

      <TitleField value={draft.title} disabled={locked} onChange={(title) => commit({ title }, TEXT_DEBOUNCE)} />
      <PresetBar draft={draft} disabled={locked} onApply={(next, name) => {
        offerUndo(`Loaded “${name}”.`, draftRef.current.segments);
        commit(next, 60);
        sfx('select');
      }} />

      <fieldset className="wh-editor__fieldset" disabled={locked}>
        <legend className="visually-hidden">Wheel options</legend>
        <SegmentList segments={draft.segments} setSegments={setSegments} offerUndo={offerUndo} disabled={locked} />
      </fieldset>

      {undo ? (
        <div className="wh-undo" role="status">
          <span>{undo.text}</span>
          <Button
            size="sm"
            variant="ghost"
            icon="refresh"
            disabled={locked}
            onClick={() => {
              const segments = undo.segments;
              setUndo(null);
              commit({ segments }, 60);
            }}
          >
            Undo
          </Button>
        </div>
      ) : null}

      <BehaviourFields draft={draft} disabled={locked} commit={commit} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------

function TitleField({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (v: string) => void }) {
  const field = useFieldText(value);
  return (
    <label className="dc-field">
      <span className="dc-field__label">Question / title</span>
      <TextInput
        value={field.text}
        maxLength={WHEEL_LIMITS.title}
        placeholder="Ask the wheel something…"
        disabled={disabled}
        onFocus={field.onFocus}
        onBlur={field.onBlur}
        onChange={(e) => {
          field.setText(e.currentTarget.value);
          onChange(e.currentTarget.value);
        }}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

function PresetBar({ draft, disabled, onApply }: { draft: WheelSettings; disabled: boolean; onApply: (next: Partial<WheelSettings>, name: string) => void }) {
  const [saved, setSaved] = useState<Array<Preset<Partial<WheelPresetData>>>>([]);
  const [selected, setSelected] = useState(BUILTIN_PRESETS[0]!.id);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const playerNames = useSeatedNames();
  const toast = useApp((s) => s.toast);

  const refresh = useCallback(() => {
    void listSavedPresets().then(setSaved);
  }, []);
  useEffect(refresh, [refresh]);

  const selectedSaved = saved.find((p) => p.id === selected);
  const load = () => {
    const builtin = BUILTIN_PRESETS.find((p) => p.id === selected);
    const data = builtin ? builtin.build({ playerNames }) : selectedSaved?.data;
    const presetName = builtin?.name ?? selectedSaved?.name ?? 'preset';
    if (!data) return;
    const next = applyPreset(draft, data);
    if (!next) {
      toast('error', 'That preset could not be loaded.');
      return;
    }
    onApply(next, presetName);
  };
  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = saved.find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
    try {
      const preset = await saveUserPreset(trimmed, draft, existing?.id);
      toast('success', `Saved preset “${preset.name}”`);
      setNaming(false);
      setName('');
      setSelected(preset.id);
      refresh();
    } catch {
      toast('error', 'Could not save the preset.');
    }
  };
  const remove = async () => {
    if (!selectedSaved) return;
    try {
      await deleteUserPreset(selectedSaved.id);
      toast('info', `Deleted preset “${selectedSaved.name}”`);
      setSelected(BUILTIN_PRESETS[0]!.id);
      refresh();
    } catch {
      toast('error', 'Could not delete the preset.');
    }
  };

  return (
    <div className="wh-presets">
      <span className="dc-field__label" id="wh-presets-label">
        Presets
      </span>
      <div className="wh-presets__row">
        <Select aria-labelledby="wh-presets-label" value={selected} disabled={disabled} onChange={(e) => setSelected(e.currentTarget.value)}>
          <optgroup label="Examples">
            {BUILTIN_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
          {saved.length ? (
            <optgroup label="Your presets">
              {saved.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          ) : null}
        </Select>
        <Button size="sm" icon="arrow-right" disabled={disabled} onClick={load}>
          Load
        </Button>
      </div>
      {naming ? (
        <form
          className="wh-presets__row"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <TextInput
            autoFocus
            value={name}
            maxLength={WHEEL_LIMITS.presetName}
            placeholder="Preset name"
            aria-label="Preset name"
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <Button size="sm" variant="primary" type="submit" disabled={!name.trim()}>
            Save
          </Button>
          <IconButton size="sm" icon="close" label="Cancel saving" onClick={() => setNaming(false)} />
        </form>
      ) : (
        <div className="wh-presets__row wh-presets__row--actions">
          <Button size="sm" variant="ghost" icon="star" onClick={() => setNaming(true)}>
            Save as preset
          </Button>
          {selectedSaved ? (
            <Button size="sm" variant="ghost" icon="trash" onClick={() => void remove()}>
              Delete “{selectedSaved.name}”
            </Button>
          ) : (
            <span className="dc-field__hint">{BUILTIN_PRESETS.find((p) => p.id === selected)?.description}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Segment list
// ---------------------------------------------------------------------------

interface ListProps {
  segments: WheelSegment[];
  setSegments: (fn: (segs: WheelSegment[]) => WheelSegment[], delay?: number) => void;
  offerUndo: (text: string, segments: WheelSegment[]) => void;
  disabled: boolean;
}

function SegmentList({ segments, setSegments, offerUndo, disabled }: ListProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const chances = useChances({ segments });
  const playerNames = useSeatedNames();
  const full = segments.length >= WHEEL_LIMITS.segments;
  const activeCount = chances.size;
  const anyDisabled = segments.some((s) => !s.enabled);
  const anyWeighted = segments.some((s) => s.weight !== 1);

  const change = useCallback(
    (id: string, patch: Partial<WheelSegment>, delay?: number) => setSegments((segs) => segs.map((s) => (s.id === id ? { ...s, ...patch } : s)), delay),
    [setSegments],
  );
  const move = useCallback(
    (from: number, to: number) => {
      setSegments((segs) => {
        if (to < 0 || to >= segs.length || from === to) return segs;
        const next = [...segs];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item as WheelSegment);
        return next;
      });
    },
    [setSegments],
  );
  const duplicate = useCallback(
    (id: string) => {
      setSegments((segs) => {
        if (segs.length >= WHEEL_LIMITS.segments) return segs;
        const i = segs.findIndex((s) => s.id === id);
        if (i < 0) return segs;
        const copy = { ...withFreshIds([segs[i] as WheelSegment])[0]! };
        const next = [...segs];
        next.splice(i + 1, 0, copy);
        return next;
      });
      sfx('pop');
    },
    [setSegments],
  );
  const remove = useCallback(
    (id: string) => {
      setSegments((segs) => {
        const victim = segs.find((s) => s.id === id);
        if (victim) offerUndo(`Removed “${victim.label || victim.emoji || 'option'}”.`, segs);
        return segs.filter((s) => s.id !== id);
      });
      setExpanded((e) => (e === id ? null : e));
    },
    [setSegments, offerUndo],
  );
  const toggleExpanded = useCallback((id: string) => setExpanded((e) => (e === id ? null : id)), []);

  const add = (raw: string) => {
    const parsed = parseBulkSegments(raw, WHEEL_LIMITS.segments - segments.length);
    if (!parsed.length) return false;
    setSegments((segs) => {
      const next = [...segs];
      for (const p of parsed) {
        if (next.length >= WHEEL_LIMITS.segments) break;
        next.push(makeSegment(p, next[next.length - 1], next[0]));
      }
      return next;
    });
    sfx('pop');
    return true;
  };

  const drag = useReorder(listRef, move);

  return (
    <section className="wh-segs" aria-label="Wheel options">
      <header className="wh-segs__head">
        <div>
          <h3 className="wh-segs__title">Options</h3>
          <p className="wh-segs__count dc-muted">
            {segments.length} total · <strong>{activeCount}</strong> on the wheel
          </p>
        </div>
        <div className="wh-segs__tools">
          <Button size="sm" variant={bulkOpen ? 'primary' : 'secondary'} icon="copy" aria-expanded={bulkOpen} onClick={() => setBulkOpen((o) => !o)}>
            Bulk paste
          </Button>
          <IconButton
            size="sm"
            variant="secondary"
            icon="sparkle"
            label="Randomize colors"
            disabled={segments.length === 0}
            onClick={() => {
              const colors = assignColors(segments.length, uiRng);
              setSegments((segs) => segs.map((s, i) => ({ ...s, color: colors[i] ?? s.color })));
              sfx('select');
            }}
          />
          <IconButton
            size="sm"
            variant="secondary"
            icon="dice"
            label="Shuffle order"
            disabled={segments.length < 2}
            onClick={() => {
              setSegments((segs) => shuffleInPlace([...segs], uiRng));
              sfx('dice');
            }}
          />
          <IconButton size="sm" variant={moreOpen ? 'primary' : 'secondary'} icon="gear" label="More list actions" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)} />
        </div>
      </header>

      {moreOpen ? (
        <div className="wh-segs__more">
          <Button
            size="sm"
            variant="ghost"
            icon="users"
            disabled={full || playerNames.length === 0}
            onClick={() => {
              const names = playerNames;
              setSegments((segs) => {
                const have = new Set(segs.map((s) => s.label.toLowerCase()));
                const next = [...segs];
                for (const n of names) {
                  if (next.length >= WHEEL_LIMITS.segments) break;
                  if (have.has(n.toLowerCase())) continue;
                  next.push(makeSegment({ label: n }, next[next.length - 1], next[0]));
                }
                return next;
              });
              sfx('pop');
            }}
          >
            Add everyone in the room
          </Button>
          <Button size="sm" variant="ghost" icon="check" disabled={!anyDisabled} onClick={() => setSegments((segs) => segs.map((s) => ({ ...s, enabled: true })))}>
            Re-enable all
          </Button>
          <Button size="sm" variant="ghost" icon="minus" disabled={!anyWeighted} onClick={() => setSegments((segs) => segs.map((s) => ({ ...s, weight: 1 })))}>
            Reset weights
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            disabled={segments.length === 0}
            onClick={() => {
              offerUndo(`Cleared ${segments.length} options.`, segments);
              setSegments(() => []);
            }}
          >
            Clear all
          </Button>
        </div>
      ) : null}

      {bulkOpen ? (
        <BulkPanel
          segments={segments}
          onApply={(items, mode) => {
            if (mode === 'replace') offerUndo(`Replaced ${segments.length} options.`, segments);
            setSegments((segs) => {
              const base = mode === 'replace' ? [] : [...segs];
              for (const p of items) {
                if (base.length >= WHEEL_LIMITS.segments) break;
                base.push(makeSegment(p, base[base.length - 1], base[0]));
              }
              return base;
            }, 60);
            setBulkOpen(false);
            sfx('select');
          }}
          onClose={() => setBulkOpen(false)}
        />
      ) : null}

      {segments.length === 0 ? (
        <p className="wh-segs__empty">No options yet. Add one below or paste a list.</p>
      ) : (
        <ol className="wh-segs__list" ref={listRef}>
          {segments.map((s, i) => (
            <SegmentRow
              key={s.id}
              seg={s}
              index={i}
              count={segments.length}
              chance={chances.get(s.id)}
              expanded={expanded === s.id}
              disabled={disabled}
              canDuplicate={!full}
              onChange={change}
              onMove={move}
              onDuplicate={duplicate}
              onRemove={remove}
              onToggle={toggleExpanded}
              onGripDown={drag.onPointerDown}
            />
          ))}
        </ol>
      )}

      <AddOption onAdd={add} disabled={disabled || full} full={full} />
    </section>
  );
}

function useReorder(listRef: RefObject<HTMLOListElement | null>, move: (from: number, to: number) => void) {
  const state = useRef<{ from: number; over: number; startY: number; items: HTMLElement[]; rects: DOMRect[]; gap: number } | null>(null);

  const onPointerDown = useCallback(
    (index: number, e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 || !listRef.current) return;
      const items = Array.from(listRef.current.children) as HTMLElement[];
      if (!items[index]) return;
      e.preventDefault();
      const grip = e.currentTarget;
      grip.setPointerCapture(e.pointerId);
      const rects = items.map((el) => el.getBoundingClientRect());
      const gap = rects.length > 1 ? Math.max(0, (rects[1] as DOMRect).top - (rects[0] as DOMRect).bottom) : 0;
      state.current = { from: index, over: index, startY: e.clientY, items, rects, gap };
      items[index]!.classList.add('is-dragging');

      const onMove = (ev: PointerEvent) => {
        const d = state.current;
        if (!d) return;
        const dy = ev.clientY - d.startY;
        const self = d.rects[d.from] as DOMRect;
        (d.items[d.from] as HTMLElement).style.transform = `translateY(${dy}px)`;
        const center = self.top + self.height / 2 + dy;
        let over = 0;
        d.rects.forEach((r, i) => {
          if (i !== d.from && r.top + r.height / 2 < center) over++;
        });
        d.over = over;
        const shift = self.height + d.gap;
        d.items.forEach((el, i) => {
          if (i === d.from) return;
          let t = 0;
          if (d.from < over && i > d.from && i <= over) t = -shift;
          if (d.from > over && i >= over && i < d.from) t = shift;
          el.style.transform = t ? `translateY(${t}px)` : '';
        });
      };
      const onUp = () => {
        const d = state.current;
        grip.removeEventListener('pointermove', onMove);
        grip.removeEventListener('pointerup', onUp);
        grip.removeEventListener('pointercancel', onUp);
        state.current = null;
        if (!d) return;
        d.items.forEach((el) => {
          el.style.transform = '';
          el.classList.remove('is-dragging');
        });
        if (d.over !== d.from) {
          move(d.from, d.over);
          sfx('click');
        }
      };
      grip.addEventListener('pointermove', onMove);
      grip.addEventListener('pointerup', onUp);
      grip.addEventListener('pointercancel', onUp);
    },
    [listRef, move],
  );

  return { onPointerDown };
}

interface RowProps {
  seg: WheelSegment;
  index: number;
  count: number;
  chance: number | undefined;
  expanded: boolean;
  disabled: boolean;
  canDuplicate: boolean;
  onChange: (id: string, patch: Partial<WheelSegment>, delay?: number) => void;
  onMove: (from: number, to: number) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  onGripDown: (index: number, e: ReactPointerEvent<HTMLButtonElement>) => void;
}

const SegmentRow = memo(function SegmentRow({
  seg,
  index,
  count,
  chance,
  expanded,
  disabled,
  canDuplicate,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
  onToggle,
  onGripDown,
}: RowProps) {
  const label = useFieldText(seg.label);
  const weight = useFieldText(formatWeight(seg.weight));
  const [weightInvalid, setWeightInvalid] = useState(false);
  const name = seg.label || seg.emoji || `Option ${index + 1}`;
  const off = chance === undefined;
  const offReason = !seg.enabled ? 'Switched off' : seg.weight <= 0 ? 'Weight 0' : !seg.label && !seg.emoji ? 'Needs a label' : '';

  const focusGrip = (id: string) =>
    requestAnimationFrame(() => (document.querySelector(`[data-grip="${CSS.escape(id)}"]`) as HTMLElement | null)?.focus());

  const onGripKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowUp' && index > 0) {
      e.preventDefault();
      onMove(index, index - 1);
      focusGrip(seg.id);
    } else if (e.key === 'ArrowDown' && index < count - 1) {
      e.preventDefault();
      onMove(index, index + 1);
      focusGrip(seg.id);
    }
  };

  return (
    <li className={cx('wh-seg', off && 'is-off', expanded && 'is-expanded')} style={{ '--c': seg.color, '--p': `${(chance ?? 0) * 100}%` } as CSSProperties}>
      <div className="wh-seg__main">
        <button
          type="button"
          className="wh-seg__grip"
          data-grip={seg.id}
          aria-label={`Reorder ${name} (drag, or use arrow keys)`}
          title="Drag to reorder"
          disabled={disabled}
          onPointerDown={(e) => onGripDown(index, e)}
          onKeyDown={onGripKey}
        >
          <PixelIcon name="grip" />
        </button>
        <label className="wh-check" title={seg.enabled ? 'On the wheel' : 'Off the wheel'}>
          <input type="checkbox" checked={seg.enabled} onChange={(e) => onChange(seg.id, { enabled: e.currentTarget.checked })} aria-label={`Include ${name} on the wheel`} />
          <span aria-hidden>
            <PixelIcon name="check" />
          </span>
        </label>
        <button
          type="button"
          className="wh-seg__swatch"
          aria-label={`Color and icon for ${name}`}
          aria-expanded={expanded}
          onClick={() => onToggle(seg.id)}
        >
          {seg.emoji ? <span className="wh-seg__emoji">{seg.emoji}</span> : null}
        </button>
        <input
          className="dc-input wh-seg__label"
          value={label.text}
          maxLength={WHEEL_LIMITS.label}
          placeholder="Label"
          aria-label={`Option ${index + 1} label`}
          onFocus={label.onFocus}
          onBlur={label.onBlur}
          onChange={(e) => {
            label.setText(e.currentTarget.value);
            onChange(seg.id, { label: e.currentTarget.value }, TEXT_DEBOUNCE);
          }}
        />
        <input
          className="dc-input dc-num wh-seg__weight"
          inputMode="decimal"
          value={weight.text}
          aria-label={`Option ${index + 1} weight`}
          aria-invalid={weightInvalid || undefined}
          title="Weight: higher = more likely"
          onFocus={weight.onFocus}
          onBlur={() => {
            weight.onBlur();
            setWeightInvalid(false);
          }}
          onChange={(e) => {
            const text = e.currentTarget.value;
            weight.setText(text);
            const n = Number(text.replace(',', '.'));
            const ok = text.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= WHEEL_LIMITS.weightMax;
            setWeightInvalid(!ok);
            if (ok) onChange(seg.id, { weight: n }, TEXT_DEBOUNCE);
          }}
        />
        <IconButton
          size="sm"
          icon={expanded ? 'chevron-up' : 'chevron-down'}
          label={expanded ? `Close options for ${name}` : `More options for ${name}`}
          aria-expanded={expanded}
          className="wh-seg__more"
          onClick={() => onToggle(seg.id)}
        />
      </div>
      <div className="wh-seg__meta">
        <span className="wh-seg__meter" aria-hidden>
          <i />
        </span>
        <span className="wh-seg__pct dc-num">{off ? offReason : `${formatPercent(chance ?? 0)} chance`}</span>
      </div>
      {expanded ? (
        <div className="wh-seg__details">
          <div className="wh-seg__group">
            <span className="dc-field__label">Color</span>
            <div className="wh-seg__colors">
              <ColorSwatches colors={WHEEL_PALETTE} value={seg.color} label={`Color for ${name}`} onChange={(color) => onChange(seg.id, { color })} />
              <label className="wh-color-input" title="Custom color">
                <input type="color" value={seg.color} aria-label={`Custom color for ${name}`} onChange={(e) => onChange(seg.id, { color: e.currentTarget.value }, 200)} />
                <span className="dc-num">{seg.color}</span>
              </label>
            </div>
          </div>
          <IconField seg={seg} name={name} onChange={onChange} />
          <div className="wh-seg__actions">
            <Button size="sm" variant="ghost" icon="chevron-up" disabled={index === 0} onClick={() => onMove(index, index - 1)}>
              Move up
            </Button>
            <Button size="sm" variant="ghost" icon="chevron-down" disabled={index === count - 1} onClick={() => onMove(index, index + 1)}>
              Move down
            </Button>
            <Button size="sm" variant="ghost" icon="copy" disabled={!canDuplicate} onClick={() => onDuplicate(seg.id)}>
              Duplicate
            </Button>
            <Button size="sm" variant="danger" icon="trash" onClick={() => onRemove(seg.id)}>
              Delete
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
});

function IconField({ seg, name, onChange }: { seg: WheelSegment; name: string; onChange: RowProps['onChange'] }) {
  const icon = useFieldText(seg.emoji);
  return (
    <div className="wh-seg__group">
      <span className="dc-field__label">Icon / emoji</span>
      <div className="wh-seg__icons">
        <TextInput
          className="wh-seg__icon-input"
          value={icon.text}
          maxLength={WHEEL_LIMITS.emoji}
          placeholder="🙂"
          aria-label={`Icon for ${name}`}
          onFocus={icon.onFocus}
          onBlur={icon.onBlur}
          onChange={(e) => {
            icon.setText(e.currentTarget.value);
            onChange(seg.id, { emoji: e.currentTarget.value }, TEXT_DEBOUNCE);
          }}
        />
        <div className="wh-seg__quick" role="group" aria-label="Quick icons">
          {QUICK_ICONS.map((q) => (
            <button key={q} type="button" className={cx('wh-quick', seg.emoji === q && 'is-on')} aria-label={`Use ${q}`} aria-pressed={seg.emoji === q} onClick={() => onChange(seg.id, { emoji: q })}>
              {q}
            </button>
          ))}
          <button type="button" className="wh-quick wh-quick--clear" aria-label="Remove icon" disabled={!seg.emoji} onClick={() => onChange(seg.id, { emoji: '' })}>
            <PixelIcon name="close" />
          </button>
        </div>
      </div>
    </div>
  );
}

function AddOption({ onAdd, disabled, full }: { onAdd: (raw: string) => boolean; disabled: boolean; full: boolean }) {
  const [text, setText] = useState('');
  const submit = () => {
    if (!text.trim()) return;
    if (onAdd(text)) setText('');
  };
  return (
    <form
      className="wh-add"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <TextInput
        value={text}
        maxLength={WHEEL_LIMITS.labelRaw}
        placeholder={full ? `The wheel is full (${WHEEL_LIMITS.segments})` : 'Add an option… (🍕 Pizza, 2)'}
        aria-label="New option"
        disabled={disabled}
        onChange={(e) => setText(e.currentTarget.value)}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text');
          if (/\r?\n/.test(pasted.trim())) {
            e.preventDefault();
            onAdd(pasted);
          }
        }}
      />
      <Button type="submit" variant="primary" icon="plus" disabled={disabled || !text.trim()}>
        Add
      </Button>
    </form>
  );
}

function BulkPanel({
  segments,
  onApply,
  onClose,
}: {
  segments: WheelSegment[];
  onApply: (items: ReturnType<typeof parseBulkSegments>, mode: 'append' | 'replace') => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const room = WHEEL_LIMITS.segments - segments.length;
  const parsed = useMemo(() => parseBulkSegments(text), [text]);
  const appendCount = Math.min(parsed.length, room);
  return (
    <div className="wh-bulk">
      <label className="dc-field">
        <span className="dc-field__label">Paste options</span>
        <TextArea
          value={text}
          rows={6}
          maxLength={WHEEL_LIMITS.bulkChars}
          placeholder={'One option per line, e.g.\nPizza, 3, #ff4f81, 🍕\nTacos\n🍣 Sushi, x2'}
          onChange={(e) => setText(e.currentTarget.value)}
          aria-describedby="wh-bulk-hint"
        />
        <span id="wh-bulk-hint" className="dc-field__hint">
          One per line. Optional extras after a comma: weight (3, x3, 25%), color (#ff4f81) and an emoji. A single line of commas becomes several options.
        </span>
      </label>
      <div className="wh-bulk__actions">
        <Badge color={parsed.length ? 'var(--green)' : 'var(--text-3)'}>{parsed.length} found</Badge>
        <span className="dc-spacer" />
        <Button size="sm" variant="ghost" onClick={() => setText(segments.map(formatBulkLine).join('\n'))} disabled={segments.length === 0}>
          Edit current as text
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" disabled={appendCount === 0} onClick={() => onApply(parsed.slice(0, room), 'append')}>
          Append {appendCount || ''}
        </Button>
        <Button size="sm" variant="primary" disabled={parsed.length === 0} onClick={() => onApply(parsed, 'replace')}>
          Replace all
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

function BehaviourFields({ draft, disabled, commit }: { draft: WheelSettings; disabled: boolean; commit: (p: Patch, delay?: number) => void }) {
  return (
    <section className="wh-behaviour" aria-label="Wheel behaviour">
      <h3 className="wh-segs__title">Behaviour</h3>
      <div className="wh-behaviour__grid">
        <div className="dc-field">
          <span className="dc-field__label">Slice size</span>
          <Segmented
            label="Slice size"
            disabled={disabled}
            value={draft.sliceMode}
            onChange={(sliceMode) => commit({ sliceMode })}
            options={[
              { value: 'equal', label: 'Equal slices' },
              { value: 'weighted', label: 'Size by weight' },
            ]}
          />
          <span className="dc-field__hint">Chances always follow the weights.</span>
        </div>
        <div className="dc-field">
          <span className="dc-field__label">After a spin</span>
          <Segmented
            label="After a spin"
            disabled={disabled}
            value={draft.afterSpin}
            onChange={(afterSpin) => commit({ afterSpin })}
            options={[
              { value: 'keep', label: 'Keep winner' },
              { value: 'remove', label: 'Remove winner' },
            ]}
          />
        </div>
        <div className="dc-field">
          <span className="dc-field__label">Repeats</span>
          <Segmented
            label="Repeats"
            disabled={disabled}
            value={draft.repeats}
            onChange={(repeats) => commit({ repeats })}
            options={[
              { value: 'allow', label: 'Allow repeats' },
              { value: 'prevent', label: 'No back-to-back' },
            ]}
          />
        </div>
        <div className="dc-field">
          <span className="dc-field__label">Who can spin</span>
          <Segmented
            label="Who can spin"
            disabled={disabled}
            value={draft.spinPermission}
            onChange={(spinPermission) => commit({ spinPermission })}
            options={[
              { value: 'host', label: 'Host only' },
              { value: 'anyone', label: 'Anyone' },
            ]}
          />
        </div>
        <label className="dc-field wh-behaviour__duration">
          <span className="dc-field__label">
            <span>Spin duration</span>
            <span className="dc-num wh-behaviour__value">{formatDuration(draft.spinDurationMs)}</span>
          </span>
          <Slider
            min={WHEEL_LIMITS.durationMinMs}
            max={WHEEL_LIMITS.durationMaxMs}
            step={500}
            value={draft.spinDurationMs}
            disabled={disabled}
            aria-label="Spin duration"
            aria-valuetext={formatDuration(draft.spinDurationMs)}
            onChange={(spinDurationMs) => commit({ spinDurationMs }, 250)}
          />
        </label>
      </div>
    </section>
  );
}
