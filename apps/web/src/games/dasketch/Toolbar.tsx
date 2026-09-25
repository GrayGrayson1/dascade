/**
 * Artist toolbar: tools, brush sizes, palette, undo and clear (with confirmation).
 * Desktop shortcuts: B / E / F / L / R / O tools, [ and ] sizes, Ctrl/Cmd+Z undo.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button, IconButton, Kbd, Modal, PixelArt, cx } from '@dascade/ui';
import { SKETCH_BRUSH_SIZES, SKETCH_PALETTE, type SketchTool } from '@dascade/shared/games/dasketch';
import { sfx } from '../../audio/audio.ts';
import { canvasStore } from './canvas/canvasStore.ts';
import { SKETCH_ICONS, type SketchIconName } from './icons.ts';

export interface ToolState {
  tool: SketchTool;
  color: string;
  size: number;
}

const TOOLS: Array<{ tool: SketchTool; label: string; key: string; icon: SketchIconName }> = [
  { tool: 'brush', label: 'Brush', key: 'B', icon: 'brush' },
  { tool: 'eraser', label: 'Eraser', key: 'E', icon: 'eraser' },
  { tool: 'fill', label: 'Fill bucket', key: 'F', icon: 'fill' },
  { tool: 'line', label: 'Straight line', key: 'L', icon: 'line' },
  { tool: 'rect', label: 'Rectangle', key: 'R', icon: 'rect' },
  { tool: 'ellipse', label: 'Ellipse', key: 'O', icon: 'ellipse' },
];
const SIZE_NAMES = ['Fine', 'Small', 'Medium', 'Large', 'Huge'];

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export function undo(): void {
  if (canvasStore.draw({ k: 'undo' }).ok) {
    canvasStore.flush();
    sfx('back');
  }
}

export function SketchToolbar({ value, onChange, compact }: { value: ToolState; onChange: (next: ToolState) => void; compact: boolean }) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const popRef = useRef<HTMLDivElement>(null);

  // Close the palette sheet on outside taps and Escape.
  useEffect(() => {
    if (!paletteOpen) return;
    const onDown = (e: PointerEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setPaletteOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPaletteOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [paletteOpen]);
  const set = (patch: Partial<ToolState>) => onChange({ ...valueRef.current, ...patch });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey) return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      const tool = TOOLS.find((t) => t.key.toLowerCase() === key);
      if (tool) {
        onChange({ ...valueRef.current, tool: tool.tool });
        return;
      }
      const idx = SKETCH_BRUSH_SIZES.indexOf(valueRef.current.size as (typeof SKETCH_BRUSH_SIZES)[number]);
      if (key === '[' && idx > 0) onChange({ ...valueRef.current, size: SKETCH_BRUSH_SIZES[idx - 1]! });
      if (key === ']' && idx < SKETCH_BRUSH_SIZES.length - 1) onChange({ ...valueRef.current, size: SKETCH_BRUSH_SIZES[idx + 1]! });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onChange]);

  const colorName = SKETCH_PALETTE.find((s) => s.color === value.color)?.name ?? value.color;
  const palette = (
    <div className="sk-palette" role="radiogroup" aria-label="Colour palette">
      {SKETCH_PALETTE.map((s) => (
        <button
          key={s.color}
          type="button"
          role="radio"
          aria-checked={s.color === value.color}
          aria-label={s.name}
          title={s.name}
          className="sk-swatch"
          style={{ '--swatch': s.color } as CSSProperties}
          onClick={() => {
            set({ color: s.color, tool: value.tool === 'eraser' ? 'brush' : value.tool });
            setPaletteOpen(false);
            sfx('click');
          }}
        />
      ))}
    </div>
  );

  return (
    <div className={cx('sk-toolbar', compact && 'sk-toolbar--compact')} role="toolbar" aria-label="Drawing tools">
      <div className="sk-tool-group sk-tool-group--tools" role="radiogroup" aria-label="Tool">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            type="button"
            role="radio"
            aria-checked={value.tool === t.tool}
            aria-label={`${t.label} (${t.key})`}
            title={`${t.label} — ${t.key}`}
            className="sk-tool"
            onClick={() => {
              set({ tool: t.tool });
              sfx('click');
            }}
          >
            <PixelArt rows={SKETCH_ICONS[t.icon]} className="sk-tool__icon" />
          </button>
        ))}
      </div>

      <div className="sk-tool-group sk-tool-group--sizes" role="radiogroup" aria-label="Brush size">
        {SKETCH_BRUSH_SIZES.map((s, i) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={value.size === s}
            aria-label={`${SIZE_NAMES[i]} brush`}
            title={`${SIZE_NAMES[i]} — ${s}px`}
            className="sk-size"
            onClick={() => {
              set({ size: s });
              sfx('click');
            }}
          >
            <span className="sk-size__dot" style={{ '--dot': `${Math.round(4 + (i / (SKETCH_BRUSH_SIZES.length - 1)) * 18)}px`, '--ink': value.tool === 'eraser' ? '#ffffff' : value.color } as CSSProperties} />
          </button>
        ))}
      </div>

      {compact ? (
        <div className="sk-tool-group sk-palette-pop" ref={popRef}>
          <button
            type="button"
            className="sk-color-btn"
            aria-haspopup="true"
            aria-expanded={paletteOpen}
            aria-label={`Colour: ${colorName}`}
            style={{ '--swatch': value.color } as CSSProperties}
            onClick={() => setPaletteOpen((o) => !o)}
          >
            <PixelArt rows={SKETCH_ICONS.palette} className="sk-tool__icon" />
          </button>
          {paletteOpen ? <div className="sk-palette-sheet">{palette}</div> : null}
        </div>
      ) : (
        <div className="sk-tool-group sk-tool-group--palette">
          <span className="sk-current" style={{ '--swatch': value.color } as CSSProperties} aria-hidden="true" />
          {palette}
        </div>
      )}

      <div className="sk-tool-group sk-tool-group--actions">
        <button type="button" className="sk-tool sk-tool--action" aria-label="Undo (Ctrl+Z)" title="Undo — Ctrl+Z" onClick={undo}>
          <PixelArt rows={SKETCH_ICONS.undo} className="sk-tool__icon" />
        </button>
        <IconButton icon="trash" label="Clear canvas" className="sk-tool--danger" onClick={() => setConfirmClear(true)} />
      </div>

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear the canvas?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Keep drawing
            </Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={() => {
                if (canvasStore.draw({ k: 'clear' }).ok) {
                  canvasStore.flush();
                  sfx('whoosh');
                }
                setConfirmClear(false);
              }}
            >
              Clear canvas
            </Button>
          </>
        }
      >
        <p className="dc-muted">
          Everyone’s view is wiped. Changed your mind afterwards? Press <Kbd>Ctrl</Kbd> + <Kbd>Z</Kbd> or the undo button to bring it back.
        </p>
      </Modal>
    </div>
  );
}
