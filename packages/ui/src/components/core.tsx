import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AVATAR_ART, ICONS, PALETTE, artToRects, type IconName } from '../icons.ts';
import { clampNumber, resolveNumberDraft } from './numberDraft.ts';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Keyboard support for roving-tabindex groups (role=radiogroup / role=tablist): arrow keys move
 * focus to the next enabled item and select it (via click), Home/End jump to the ends.
 * Attach to the group container's onKeyDown. Tabs only use Left/Right so Up/Down still scroll.
 */
export function handleRovingKeys(e: KeyboardEvent<HTMLElement>, role: 'radio' | 'tab' = 'radio'): void {
  const forward = role === 'tab' ? ['ArrowRight'] : ['ArrowRight', 'ArrowDown'];
  const back = role === 'tab' ? ['ArrowLeft'] : ['ArrowLeft', 'ArrowUp'];
  if (![...forward, ...back, 'Home', 'End'].includes(e.key)) return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(`[role="${role}"]:not([disabled])`));
  if (items.length === 0) return;
  const current = items.indexOf(document.activeElement as HTMLElement);
  let next: number;
  if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = items.length - 1;
  else next = (Math.max(current, 0) + (forward.includes(e.key) ? 1 : -1) + items.length) % items.length;
  e.preventDefault();
  const target = items[next];
  if (!target) return;
  target.focus();
  if (target.getAttribute('aria-checked') !== 'true' && target.getAttribute('aria-selected') !== 'true') target.click();
}

/** tabIndex for item `i` of a roving group: the selected item, else the first item, is the tab stop. */
export function rovingTabIndex(selected: boolean, index: number, anySelected: boolean): 0 | -1 {
  return selected || (!anySelected && index === 0) ? 0 : -1;
}

// ---------------------------------------------------------------------------
// PixelIcon / PixelArt
// ---------------------------------------------------------------------------

export interface PixelIconProps extends Omit<HTMLAttributes<SVGSVGElement>, 'children'> {
  name: IconName;
  /** Accessible label. Omit for decorative icons (aria-hidden). */
  title?: string;
  size?: number | string;
}

export function PixelIcon({ name, title, size, className, style, ...rest }: PixelIconProps) {
  const rows = ICONS[name];
  return (
    <PixelArt
      rows={rows}
      title={title}
      className={cx('dc-icon', className)}
      style={size !== undefined ? { width: size, height: size, ...style } : style}
      {...rest}
    />
  );
}

export interface PixelArtProps extends Omit<HTMLAttributes<SVGSVGElement>, 'children'> {
  rows: readonly string[];
  /** Color for '#'/'a' cells (default currentColor). */
  mainColor?: string;
  title?: string;
}

export function PixelArt({ rows, mainColor = 'currentColor', title, ...rest }: PixelArtProps) {
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const rects = artToRects(rows);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {rects.map((r, i) => (
        <rect
          key={i}
          x={r.x}
          y={r.y}
          width={r.w}
          height={1}
          fill={r.color === '#' || r.color === 'a' ? mainColor : (PALETTE[r.color] ?? mainColor)}
        />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'gold';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
  icon?: IconName;
  iconRight?: IconName;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', block, loading, icon, iconRight, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('dc-btn', `dc-btn--${variant}`, size !== 'md' && `dc-btn--${size}`, block && 'dc-btn--block', className)}
      disabled={disabled || loading}
      data-loading={loading ? 'true' : undefined}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="dc-btn__spinner" aria-hidden /> : icon ? <PixelIcon name={icon} /> : null}
      {children}
      {iconRight && !loading ? <PixelIcon name={iconRight} /> : null}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'children'> {
  icon: IconName;
  /** Required accessible label (also used as tooltip). */
  label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, className, size = 'md', variant = 'ghost', ...rest },
  ref,
) {
  return (
    <Button ref={ref} variant={variant} size={size} className={cx('dc-btn--icon', className)} aria-label={label} title={label} {...rest}>
      <PixelIcon name={icon} size={size === 'sm' ? 16 : 20} />
    </Button>
  );
});

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  actions?: ReactNode;
  brackets?: boolean;
  glow?: boolean;
  solid?: boolean;
  padded?: boolean;
  as?: 'section' | 'div' | 'aside';
}

export function Panel({ title, actions, brackets, glow, solid, padded = true, as = 'section', className, children, ...rest }: PanelProps) {
  const Tag = as;
  const headingId = useId();
  return (
    <Tag
      className={cx('dc-panel', brackets && 'dc-panel--brackets', glow && 'dc-panel--glow', solid && 'dc-panel--solid', className)}
      aria-labelledby={title ? headingId : undefined}
      data-part="panel"
      {...rest}
    >
      {title || actions ? (
        <header className="dc-panel__header" data-part="panel-header">
          {title ? (
            <h2 id={headingId} className="dc-panel__title" data-part="panel-title">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {actions ? <div className="dc-row">{actions}</div> : null}
        </header>
      ) : null}
      {padded ? (
        <div className="dc-panel__body" data-part="panel-body">
          {children}
        </div>
      ) : (
        children
      )}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  aside?: ReactNode;
  children: (ids: { id: string; describedBy?: string }) => ReactNode;
  className?: string;
}

export function Field({ label, hint, error, aside, children, className }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-err`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('dc-field', className)}>
      <label className="dc-field__label" htmlFor={id}>
        <span>{label}</span>
        {aside ? <span>{aside}</span> : null}
      </label>
      {children({ id, describedBy })}
      {hint ? (
        <div id={hintId} className="dc-field__hint">
          {hint}
        </div>
      ) : null}
      {error ? (
        <div id={errorId} className="dc-field__error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx('dc-input', className)} {...rest} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cx('dc-textarea', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cx('dc-select', className)} {...rest}>
      {children}
    </select>
  );
});

export interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

/**
 * Numeric input that never emits NaN. While the player types it shows their draft — the `value`
 * prop (often server state echoing every change back, clamped) must not rewrite a half-typed number
 * ("1" on the way to "12") — and commits the clamped value on blur, Enter, or a tap anywhere else
 * (iOS doesn't blur the field when a button is tapped). Arrow keys and the spinner commit each step
 * right away; Escape discards the draft.
 */
export function NumberInput({ value, onChange, min, max, step = 1, className, onBlur, onKeyDown, ...rest }: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const stepping = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const setText = (text: string | null) => {
    draftRef.current = text;
    setDraft(text);
  };
  const emit = (n: number) => {
    const next = clampNumber(n, min, max);
    if (next !== value) onChange(next);
  };
  // Latest-render commit for the document listener below.
  const commitRef = useRef<() => void>(() => undefined);
  commitRef.current = () => {
    const text = draftRef.current;
    if (text === null) return;
    setText(null);
    const next = resolveNumberDraft(text, min, max);
    if (next !== null && next !== value) onChange(next);
  };
  const editing = draft !== null;
  useEffect(() => {
    if (!editing) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && inputRef.current?.contains(e.target)) return;
      commitRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [editing]);

  return (
    <input
      type="number"
      inputMode="numeric"
      {...rest}
      ref={inputRef}
      className={cx('dc-input', 'dc-num', className)}
      value={draft ?? (Number.isFinite(value) ? value : '')}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const el = e.currentTarget;
        const inputType = (e.nativeEvent as Partial<InputEvent>).inputType;
        const typed = !stepping.current && typeof inputType === 'string' && inputType !== '';
        stepping.current = false;
        if (typed) {
          setText(el.value);
          return;
        }
        // Arrow key / spinner step: a complete value.
        setText(null);
        const n = el.valueAsNumber;
        if (Number.isFinite(n)) emit(n);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          // The browser steps (and fires `input`) as this key's default action, in this same task.
          stepping.current = true;
          setTimeout(() => (stepping.current = false), 0);
        } else if (e.key === 'Enter') commitRef.current();
        else if (e.key === 'Escape' && draftRef.current !== null) setText(null);
        onKeyDown?.(e);
      }}
      onBlur={(e) => {
        commitRef.current();
        onBlur?.(e);
      }}
    />
  );
}

export interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hideLabel?: boolean;
}

export function Toggle({ checked, onChange, label, hideLabel, className, ...rest }: ToggleProps) {
  return (
    <label className={cx('dc-toggle', className)}>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} {...rest} />
      <span className="dc-toggle__track" aria-hidden>
        <span className="dc-toggle__thumb" />
      </span>
      <span className={hideLabel ? 'visually-hidden' : 'dc-toggle__label'}>{label}</span>
    </label>
  );
}

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type' | 'value'> {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}

export function Slider({ value, min, max, step = 1, onChange, className, style, ...rest }: SliderProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      className={cx('dc-slider', className)}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(e.currentTarget.valueAsNumber)}
      style={{ '--fill': `${pct}%`, ...style } as CSSProperties}
      {...rest}
    />
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  label: string;
  className?: string;
  disabled?: boolean;
}

export function Segmented<T extends string>({ value, options, onChange, label, className, disabled }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('dc-segmented', className)} onKeyDown={(e) => handleRovingKeys(e, 'radio')}>
      {options.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={opt.value === value}
          tabIndex={rovingTabIndex(
            opt.value === value,
            i,
            options.some((o) => o.value === value),
          )}
          disabled={disabled || opt.disabled}
          className="dc-segmented__item"
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export interface TabsProps<T extends string> {
  value: T;
  tabs: ReadonlyArray<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

export function Tabs<T extends string>({ value, tabs, onChange, label, className }: TabsProps<T>) {
  return (
    // Arrow keys move focus along with the selection (previously the selection moved but focus stayed
    // on a tab that had just become tabIndex=-1, stranding keyboard users).
    <div role="tablist" aria-label={label} className={cx('dc-tabs', className)} onKeyDown={(e) => handleRovingKeys(e, 'tab')}>
      {tabs.map((t, i) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          tabIndex={rovingTabIndex(
            t.value === value,
            i,
            tabs.some((x) => x.value === value),
          )}
          className="dc-tab"
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal (native <dialog>: focus trap, Esc, inert background for free)
// ---------------------------------------------------------------------------

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Prevent closing via Esc/backdrop (e.g. required choice). */
  dismissible?: boolean;
  className?: string;
}

export function Modal({ open, onClose, title, children, footer, wide, dismissible = true, className }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    // Remember the opener: the modal is often unmounted while still open (e.g. a global modal
    // store resets), which skips the native dialog's focus restoration and drops focus on <body>.
    const opener =
      document.activeElement instanceof HTMLElement && !dialog.contains(document.activeElement) ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      const active = document.activeElement;
      if (opener?.isConnected && (!active || active === document.body || dialog.contains(active))) opener.focus();
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={cx('dc-modal', wide && 'dc-modal--wide', className)}
      data-part="dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onCloseRef.current();
      }}
      onClick={(e) => {
        if (dismissible && e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      {open ? (
        <Panel
          brackets
          glow
          padded={false}
          className="dc-modal__frame"
          data-part="dialog-frame"
          title={<span id={titleId}>{title}</span>}
          actions={dismissible ? <IconButton icon="close" label="Close" size="sm" onClick={() => onCloseRef.current()} /> : null}
        >
          <div className="dc-modal__body" data-part="dialog-body">
            {children}
          </div>
          {footer ? (
            <footer className="dc-modal__footer" data-part="dialog-footer">
              {footer}
            </footer>
          ) : null}
        </Panel>
      ) : null}
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Small display components
// ---------------------------------------------------------------------------

export function Badge({
  children,
  color,
  solid,
  icon,
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { color?: string; solid?: boolean; icon?: IconName }) {
  return (
    <span
      className={cx('dc-badge', solid && 'dc-badge--solid', className)}
      style={color ? ({ '--badge': color } as CSSProperties) : undefined}
      {...rest}
    >
      {icon ? <PixelIcon name={icon} size={11} /> : null}
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="dc-kbd">{children}</kbd>;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="dc-spinner" role="status" aria-label={label} data-part="spinner">
      <i />
      <i />
      <i />
    </span>
  );
}

export function ProgressBar({ value, label, className }: { value: number; label?: string; className?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className={cx('dc-progress', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
      style={{ '--value': `${pct}%` } as CSSProperties}
    />
  );
}

/** Circular countdown. `progress` 1 → 0. */
export function TimerRing({
  seconds,
  progress,
  urgentAt = 5,
  size,
  label = 'Time remaining',
}: {
  seconds: number;
  progress: number;
  urgentAt?: number;
  size?: number;
  label?: string;
}) {
  return (
    <div
      className="dc-timer"
      data-urgent={seconds <= urgentAt && seconds > 0 ? 'true' : undefined}
      style={{ '--p': Math.max(0, Math.min(1, progress)), ...(size ? { width: size, height: size } : {}) } as CSSProperties}
      role="timer"
      aria-label={`${label}: ${seconds} seconds`}
    >
      <span>{Math.max(0, Math.ceil(seconds))}</span>
    </div>
  );
}

export function EmptyState({ icon = 'sparkle', title, children }: { icon?: IconName; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="dc-empty" data-part="empty-state">
      <PixelIcon name={icon} className="dc-empty__icon" />
      <strong style={{ color: 'var(--text-1)' }}>{title}</strong>
      {children ? <div>{children}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Avatars & players
// ---------------------------------------------------------------------------

export function Avatar({
  avatar,
  color,
  size = 36,
  offline,
  title,
}: {
  avatar: string;
  color: string;
  size?: number;
  offline?: boolean;
  title?: string;
}) {
  const rows = AVATAR_ART[avatar] ?? AVATAR_ART.rocket!;
  return (
    <span
      className="dc-avatar"
      data-offline={offline ? 'true' : undefined}
      style={{ '--size': `${size}px`, '--player': color } as CSSProperties}
      title={title}
    >
      <PixelArt rows={rows} mainColor={color} />
    </span>
  );
}

export interface PlayerChipProps {
  name: string;
  avatar: string;
  color: string;
  isHost?: boolean;
  isYou?: boolean;
  connected?: boolean;
  spectator?: boolean;
  size?: number;
  meta?: ReactNode;
  className?: string;
}

export function PlayerChip({
  name,
  avatar,
  color,
  isHost,
  isYou,
  connected = true,
  spectator,
  size = 36,
  meta,
  className,
}: PlayerChipProps) {
  return (
    <div className={cx('dc-player', className)} data-part="player-chip">
      <Avatar avatar={avatar} color={color} size={size} offline={!connected} />
      <div style={{ minWidth: 0 }}>
        <div className="dc-row" style={{ gap: 6 }}>
          <span className="dc-player__name" style={{ color: connected ? 'var(--text-0)' : 'var(--text-3)' }}>
            {name}
          </span>
          {isHost ? <PixelIcon name="crown" title="Host" style={{ color: 'var(--yellow)' }} /> : null}
        </div>
        <div className="dc-player__meta">
          {isYou ? <Badge color="var(--cyan)">You</Badge> : null}
          {spectator ? (
            <Badge color="var(--purple)" icon="eye">
              Spectator
            </Badge>
          ) : null}
          {!connected ? (
            <Badge color="var(--orange)" icon="wifi-off">
              Reconnecting
            </Badge>
          ) : null}
          {meta}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Color swatches
// ---------------------------------------------------------------------------

export function ColorSwatches({
  colors,
  value,
  onChange,
  label,
}: {
  colors: readonly string[];
  value: string;
  onChange: (color: string) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="dc-swatches" onKeyDown={(e) => handleRovingKeys(e, 'radio')}>
      {colors.map((c, i) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c.toLowerCase() === value.toLowerCase()}
          tabIndex={rovingTabIndex(
            c.toLowerCase() === value.toLowerCase(),
            i,
            colors.some((x) => x.toLowerCase() === value.toLowerCase()),
          )}
          aria-label={c}
          className="dc-swatch"
          style={{ '--swatch': c } as CSSProperties}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Game theme wrapper — sets the per-game accent variables.
// ---------------------------------------------------------------------------

export function GameTheme({
  accent,
  className,
  style,
  children,
  as = 'div',
  ...rest
}: HTMLAttributes<HTMLElement> & { accent: { primary: string; secondary: string; deep: string }; as?: 'div' | 'main' | 'section' }) {
  const Tag = as;
  return (
    <Tag
      className={className}
      style={{ '--accent': accent.primary, '--accent-2': accent.secondary, '--accent-deep': accent.deep, ...style } as CSSProperties}
      {...rest}
    >
      {children}
    </Tag>
  );
}
