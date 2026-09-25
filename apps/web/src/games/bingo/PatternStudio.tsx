/**
 * Pattern studio: draw a winning pattern on a grid matching the board, pick from the
 * library, and save/load personal patterns (persistence kind 'bingo-pattern').
 * Rotations and mirror images are explicit per-pattern choices, never applied silently.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { BINGO_LIMITS, type BingoCustomRef, type BingoPatternRef, type BingoPresetId, type BingoRound } from '@dascade/shared/games/bingo';
import {
  PATTERN_PRESETS,
  PRESET_ORDER,
  emptyMask,
  fullMask,
  invertMask,
  maskCount,
  maskFromString,
  maskToString,
  mirrorHorizontal,
  mirrorVertical,
  patternName,
  presetMasks,
  resizeMask,
  rotate90,
  transformVariants,
} from '@dascade/game-core/bingo';
import { Badge, Button, EmptyState, IconButton, Modal, PixelIcon, Tabs, TextInput, Toggle, cx } from '@dascade/ui';
import { persistence, type Preset } from '../../persistence/index.ts';
import { useApp } from '../../app/store.ts';
import { sfx } from '../../audio/audio.ts';
import { PatternGrid } from './Card.tsx';

export interface SavedPattern {
  name: string;
  size: number;
  mask: string;
}

/** Saved patterns come from storage (possibly another device / version): skip anything malformed. */
function isSavedPattern(p: Preset<SavedPattern>): boolean {
  const d = p?.data as Partial<SavedPattern> | undefined;
  return (
    typeof d?.size === 'number' &&
    Number.isInteger(d.size) &&
    d.size >= BINGO_LIMITS.minSize &&
    d.size <= BINGO_LIMITS.maxSize &&
    typeof d.mask === 'string' &&
    /^[01]+$/.test(d.mask) &&
    d.mask.length === d.size * d.size
  );
}

const PRESET_KIND = 'bingo-pattern';

export function refMasks(ref: BingoPatternRef, size: number): boolean[][] {
  if (ref.type === 'preset') return presetMasks(ref.id, size);
  if (ref.size !== size) return [maskFromString(ref.mask)];
  return transformVariants(maskFromString(ref.mask), { rotate: ref.rotate, mirror: ref.mirror }, size);
}

export function refSize(ref: BingoPatternRef, size: number): number {
  return ref.type === 'custom' ? ref.size : size;
}

function sameRef(a: BingoPatternRef, b: BingoPatternRef): boolean {
  if (a.type === 'preset' && b.type === 'preset') return a.id === b.id;
  return false;
}

/** Drawable N×N grid with click / drag painting and full keyboard support. */
export function MaskEditor({
  size,
  mask,
  freeIndex,
  onChange,
  disabled,
}: {
  size: number;
  mask: boolean[];
  freeIndex: number | null;
  onChange: (mask: boolean[]) => void;
  disabled?: boolean;
}) {
  const painting = useRef<{ value: boolean; mask: boolean[] } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const paintAt = (clientX: number, clientY: number) => {
    const p = painting.current;
    if (!p) return;
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const cell = el?.closest<HTMLElement>('[data-cell]');
    if (!cell || !gridRef.current?.contains(cell)) return;
    const i = Number(cell.dataset.cell);
    if (!Number.isInteger(i) || p.mask[i] === p.value) return;
    p.mask = [...p.mask];
    p.mask[i] = p.value;
    onChange(p.mask);
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]');
    if (!cell) return;
    e.preventDefault();
    const i = Number(cell.dataset.cell);
    const value = !mask[i];
    const next = [...mask];
    next[i] = value;
    painting.current = { value, mask: next };
    onChange(next);
    sfx('tick');
    (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
  };
  return (
    <div
      ref={gridRef}
      className="bg-editor"
      style={{ '--n': size } as CSSProperties}
      role="group"
      aria-label={`Pattern editor, ${size} by ${size}. ${maskCount(mask)} squares selected.`}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => painting.current && paintAt(e.clientX, e.clientY)}
      onPointerUp={() => (painting.current = null)}
      onPointerCancel={() => (painting.current = null)}
      onLostPointerCapture={() => (painting.current = null)}
    >
      {mask.map((on, i) => (
        <button
          key={i}
          type="button"
          data-cell={i}
          className="bg-editor__cell"
          data-on={on ? 'true' : undefined}
          data-free={i === freeIndex ? 'true' : undefined}
          aria-pressed={on}
          aria-label={`Row ${Math.floor(i / size) + 1}, column ${(i % size) + 1}${i === freeIndex ? ' (free square)' : ''}`}
          disabled={disabled}
          onClick={(e) => {
            // Pointer painting already handled mouse/touch; this handles keyboard activation.
            if (e.detail !== 0) return;
            const next = [...mask];
            next[i] = !next[i];
            onChange(next);
          }}
        >
          {i === freeIndex ? <PixelIcon name="star" /> : null}
        </button>
      ))}
    </div>
  );
}

export function PatternStudio({
  open,
  onClose,
  round,
  roundLabel,
  size,
  freeIndex,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  round: BingoRound;
  roundLabel: string;
  size: number;
  freeIndex: number | null;
  onChange: (next: BingoRound) => void;
}) {
  const [mask, setMask] = useState<boolean[]>(() => emptyMask(size));
  const [name, setName] = useState('My pattern');
  const [rotate, setRotate] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [tab, setTab] = useState<'library' | 'mine'>('library');
  const [saved, setSaved] = useState<Array<Preset<SavedPattern>>>([]);
  const toast = useApp((s) => s.toast);

  useEffect(() => {
    if (mask.length !== size * size) setMask(emptyMask(size));
  }, [size, mask.length]);

  const refreshSaved = useCallback(() => {
    persistence()
      .listPresets<SavedPattern>(PRESET_KIND)
      .then((list) => setSaved(list.filter(isSavedPattern)))
      .catch(() => setSaved([]));
  }, []);
  useEffect(() => {
    if (open) refreshSaved();
  }, [open, refreshSaved]);

  // Optimistic local copy so quick successive edits never build on a stale round.
  const [local, setLocal] = useState(round);
  useEffect(() => setLocal(round), [round]);
  const patterns = local.patterns;
  const full = patterns.length >= BINGO_LIMITS.maxPatternsPerRound;
  const count = maskCount(mask);
  const onlyFree = count > 0 && mask.every((on, i) => !on || i === freeIndex);
  const variants = useMemo(() => (count ? transformVariants(mask, { rotate, mirror }, size).length : 0), [mask, rotate, mirror, size, count]);

  const setPatterns = (next: BingoPatternRef[]) => {
    const updated = { ...local, patterns: next };
    setLocal(updated);
    onChange(updated);
  };

  const togglePreset = (id: BingoPresetId) => {
    const existing = patterns.findIndex((p) => p.type === 'preset' && p.id === id);
    if (existing >= 0) {
      if (patterns.length === 1) {
        toast('info', 'A round needs at least one pattern.');
        return;
      }
      setPatterns(patterns.filter((_, i) => i !== existing));
      sfx('back');
    } else {
      if (full) return toast('info', `Up to ${BINGO_LIMITS.maxPatternsPerRound} patterns per round.`);
      setPatterns([...patterns, { type: 'preset', id, rotate: false, mirror: false }]);
      sfx('select');
    }
  };

  const loadIntoEditor = (m: boolean[], label: string, opts: { rotate?: boolean; mirror?: boolean } = {}, index: number | null = null) => {
    setMask(m.length === size * size ? m : resizeMask(m, size));
    setName(label.slice(0, BINGO_LIMITS.patternName));
    setRotate(Boolean(opts.rotate));
    setMirror(Boolean(opts.mirror));
    setEditing(index);
  };

  const draftRef = (): BingoCustomRef => ({
    type: 'custom',
    name: name.trim() || 'Custom pattern',
    size,
    mask: maskToString(mask),
    rotate,
    mirror,
  });

  const commitDraft = () => {
    if (count === 0 || onlyFree) return;
    if (editing !== null && patterns[editing]) {
      setPatterns(patterns.map((p, i) => (i === editing ? draftRef() : p)));
      toast('success', `Updated “${draftRef().name}”.`);
    } else {
      if (full) return toast('info', `Up to ${BINGO_LIMITS.maxPatternsPerRound} patterns per round.`);
      setPatterns([...patterns, draftRef()]);
      toast('success', `Added “${draftRef().name}” to ${roundLabel.toLowerCase()}.`);
    }
    sfx('select');
    setEditing(null);
  };

  const saveDraft = async () => {
    if (count === 0) return;
    const data: SavedPattern = { name: name.trim() || 'Custom pattern', size, mask: maskToString(mask) };
    try {
      await persistence().savePreset<SavedPattern>(PRESET_KIND, data.name, data);
      toast('success', `Saved “${data.name}” to your patterns.`);
      refreshSaved();
      setTab('mine');
    } catch {
      toast('error', 'Could not save that pattern.');
    }
  };

  const removeSaved = async (id: string) => {
    await persistence()
      .deletePreset(PRESET_KIND, id)
      .catch(() => undefined);
    refreshSaved();
  };

  const groups = useMemo(() => {
    const map = new Map<string, BingoPresetId[]>();
    for (const id of PRESET_ORDER) {
      const g = PATTERN_PRESETS[id].group;
      map.set(g, [...(map.get(g) ?? []), id]);
    }
    return [...map.entries()];
  }, []);

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={`Pattern studio · ${roundLabel}`}
      className="bg-studio-modal"
      footer={
        <div className="bg-studio__footer">
          <div className="bg-studio__chosen" aria-label="Patterns in this round">
            <span className="dc-label">Wins with</span>
            {patterns.map((p, i) => (
              <span key={i} className="bg-chip bg-chip--static">
                <PatternGrid size={size} mask={refMasks(p, size)[0] ?? []} freeIndex={freeIndex} className="bg-pgrid--xs" />
                {patternName(p)}
                {patterns.length > 1 ? (
                  <button type="button" className="bg-chip__x" aria-label={`Remove ${patternName(p)}`} onClick={() => setPatterns(patterns.filter((_, j) => j !== i))}>
                    <PixelIcon name="close" />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
          <Button variant="primary" icon="check" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="bg-studio">
        <section className="bg-studio__editor" aria-label="Draw a pattern">
          <div className="bg-studio__head">
            <label className="dc-field bg-studio__name">
              <span className="dc-field__label">Pattern name</span>
              <TextInput value={name} maxLength={BINGO_LIMITS.patternName} onChange={(e) => setName(e.currentTarget.value)} aria-label="Pattern name" />
            </label>
            <Badge color={count ? 'var(--accent)' : 'var(--text-3)'}>
              {count} square{count === 1 ? '' : 's'}
            </Badge>
          </div>
          <MaskEditor size={size} mask={mask} freeIndex={freeIndex} onChange={setMask} />
          <div className="bg-studio__tools" role="toolbar" aria-label="Pattern tools">
            <IconButton icon="trash" label="Clear" size="sm" onClick={() => setMask(emptyMask(size))} />
            <IconButton icon="maximize" label="Fill every square" size="sm" onClick={() => setMask(fullMask(size))} />
            <Button size="sm" variant="ghost" onClick={() => setMask(invertMask(mask))}>
              Invert
            </Button>
            <Button size="sm" variant="ghost" icon="refresh" onClick={() => setMask(rotate90(mask, size))}>
              Rotate
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMask(mirrorHorizontal(mask, size))}>
              Mirror ⇆
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMask(mirrorVertical(mask, size))}>
              Flip ⇅
            </Button>
          </div>
          <div className="bg-studio__opts">
            <Toggle label="Also accept rotations (90° / 180° / 270°)" checked={rotate} onChange={setRotate} />
            <Toggle label="Also accept mirror images" checked={mirror} onChange={setMirror} />
            <p className="dc-field__hint">
              {count === 0
                ? 'Click or drag across the grid to paint the squares a player must cover.'
                : onlyFree
                  ? 'This only covers the free square — everyone would win instantly.'
                  : variants > 1
                    ? `Wins in ${variants} orientations.`
                    : 'Wins exactly as drawn.'}
            </p>
          </div>
          <div className="bg-studio__actions">
            <Button variant="primary" icon={editing !== null ? 'check' : 'plus'} disabled={count === 0 || onlyFree || (editing === null && full)} onClick={commitDraft}>
              {editing !== null ? 'Update pattern' : 'Add to round'}
            </Button>
            <Button variant="ghost" icon="heart" disabled={count === 0} onClick={saveDraft}>
              Save to my patterns
            </Button>
            {editing !== null ? (
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Stop editing
              </Button>
            ) : null}
          </div>
          {patterns.some((p) => p.type === 'custom') ? (
            <div className="bg-studio__customs">
              <span className="dc-label">Custom patterns in this round</span>
              {patterns.map((p, i) =>
                p.type === 'custom' ? (
                  <button
                    key={i}
                    type="button"
                    className={cx('bg-chip', editing === i && 'is-active')}
                    onClick={() => loadIntoEditor(maskFromString(p.mask), p.name, p, i)}
                    aria-label={`Edit ${p.name}`}
                  >
                    <PatternGrid size={p.size} mask={maskFromString(p.mask)} className="bg-pgrid--xs" />
                    {p.name}
                    <PixelIcon name="pencil" />
                  </button>
                ) : null,
              )}
            </div>
          ) : null}
        </section>

        <section className="bg-studio__side" aria-label="Pattern library">
          <Tabs
            label="Pattern sources"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'library', label: 'Library' },
              { value: 'mine', label: `My patterns${saved.length ? ` ${saved.length}` : ''}` },
            ]}
          />
          {tab === 'library' ? (
            <div className="bg-library">
              {groups.map(([group, ids]) => (
                <div key={group} className="bg-library__group">
                  <span className="dc-label">{group}</span>
                  <div className="bg-library__grid">
                    {ids.map((id) => {
                      const preset = PATTERN_PRESETS[id];
                      const supported = preset.supports(size);
                      const masks = supported ? presetMasks(id, size) : [];
                      const selected = patterns.some((p) => sameRef(p, { type: 'preset', id, rotate: false, mirror: false }));
                      return (
                        <div key={id} className="bg-tile" data-selected={selected ? 'true' : undefined} data-disabled={!supported ? 'true' : undefined}>
                          <button
                            type="button"
                            className="bg-tile__main"
                            aria-pressed={selected}
                            disabled={!supported}
                            title={supported ? preset.description : `Not available on ${size}×${size} cards`}
                            onClick={() => togglePreset(id)}
                          >
                            <PatternGrid size={size} mask={masks[0] ?? emptyMask(size)} freeIndex={freeIndex} className="bg-pgrid--tile" />
                            <span className="bg-tile__name">{preset.name}</span>
                            {preset.family ? <span className="bg-tile__any">ANY</span> : null}
                            {selected ? <PixelIcon name="check" className="bg-tile__check" /> : null}
                          </button>
                          {supported ? (
                            <IconButton
                              icon="pencil"
                              size="sm"
                              className="bg-tile__edit"
                              label={`Copy ${preset.name} into the editor`}
                              onClick={() => loadIntoEditor(masks[0] ?? emptyMask(size), preset.family ? `${preset.name} (one)` : preset.name)}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : saved.length === 0 ? (
            <EmptyState icon="heart" title="No saved patterns yet">
              Draw a pattern and press “Save to my patterns” to reuse it in future games.
            </EmptyState>
          ) : (
            <ul className="bg-saved">
              {saved.map((p) => {
                const m = maskFromString(p.data.mask);
                const fits = p.data.size === size;
                return (
                  <li key={p.id} className="bg-saved__row">
                    <PatternGrid size={p.data.size} mask={m} className="bg-pgrid--sm" />
                    <span className="bg-saved__name">
                      {p.name}
                      <span className="dc-muted">
                        {' '}
                        {p.data.size}×{p.data.size}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="pencil"
                      onClick={() => loadIntoEditor(fits ? m : resizeMask(m, size), p.name)}
                      title={fits ? 'Open in the editor' : `Rescale to ${size}×${size} and open in the editor`}
                    >
                      {fits ? 'Edit' : 'Fit'}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="plus"
                      disabled={!fits || full}
                      onClick={() => {
                        setPatterns([...patterns, { type: 'custom', name: p.name, size, mask: p.data.mask, rotate: false, mirror: false }]);
                        sfx('select');
                      }}
                    >
                      Add
                    </Button>
                    <IconButton icon="trash" size="sm" label={`Delete ${p.name}`} onClick={() => void removeSaved(p.id)} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}
