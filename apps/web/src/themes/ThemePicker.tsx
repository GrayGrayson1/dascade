/**
 * Premium theme picker: an accessible radiogroup of theme cards, each with a LIVE mini preview drawn
 * in that theme's own tokens (`[data-theme-preview]`, see preview.ts). Selecting applies instantly
 * through the transition layer and persists via settings.theme. Used in Settings → Display
 * (`variant="settings"`, compact grid) and in the quick-access sheet (`variant="sheet"`).
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { getTheme, listThemes, useThemeId, type ThemeDefinition } from '@dascade/ui';
import { useApp } from '../app/store.ts';
import { sfx } from '../audio/audio.ts';
import { switchTheme } from './controller.ts';
import { loadThemeSkin } from './registry.ts';
import { acquirePreviewStyles } from './preview.ts';
import './picker.css';

const KEY_APPLY_DELAY_MS = 280;

export function ThemePreview({ theme }: { theme: ThemeDefinition }) {
  return (
    <div className="tp-prev" data-theme-preview={theme.id} data-scheme={theme.colorScheme} aria-hidden>
      <div className="tp-prev__bar">
        <i />
        <b />
        <i />
      </div>
      <div className="tp-prev__stage">
        <div className="tp-prev__cab">
          <span className="tp-prev__marquee">{theme.name.split(' ')[0]}</span>
          <span className="tp-prev__screen">
            <i />
          </span>
          <span className="tp-prev__deck" />
        </div>
        <div className="tp-prev__win">
          <div className="tp-prev__title">
            <span>Lobby</span>
          </div>
          <div className="tp-prev__rows">
            <i />
            <i />
          </div>
          <span className="tp-prev__btn">Play</span>
        </div>
      </div>
      <div className="tp-prev__mats">
        <i style={{ background: 'var(--mat-felt, #0e6b4d)' }} />
        <i style={{ background: 'var(--mat-board-light, #d9d2f5)' }} />
        <i style={{ background: 'var(--mat-board-dark, #5b4a9c)' }} />
        <i style={{ background: 'var(--mat-grass, #2e9e4f)' }} />
        <i style={{ background: 'var(--mat-water, #1d4f8f)' }} />
        <i style={{ background: 'var(--mat-card-back, #b3175a)' }} />
      </div>
    </div>
  );
}

export function ThemePicker({ variant = 'settings', label = 'Theme' }: { variant?: 'settings' | 'sheet'; label?: string }) {
  const stored = useApp((s) => s.settings.theme);
  const activeId = useThemeId();
  const themes = listThemes();
  const effective = getTheme(stored).id;
  const [selected, setSelected] = useState(effective);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const keyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Preview token CSS exists only while a picker is mounted.
  useLayoutEffect(() => acquirePreviewStyles(), []);
  // Follow external changes (another tab, profile sync, the other picker).
  useEffect(() => setSelected(effective), [effective]);
  useEffect(() => () => clearTimeout(keyTimer.current), []);

  const apply = (id: string) => {
    clearTimeout(keyTimer.current);
    setSelected(id);
    if (id !== getTheme(useApp.getState().settings.theme).id) {
      sfx('select');
      void switchTheme(id);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = themes.findIndex((t) => t.id === selected);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % themes.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + themes.length) % themes.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = themes.length - 1;
    else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      apply(selected);
      return;
    }
    if (next < 0) return;
    e.preventDefault();
    const id = themes[next]!.id;
    setSelected(id);
    itemRefs.current.get(id)?.focus();
    void loadThemeSkin(id); // warm the chunk while the player is still browsing
    // Arrow keys move the selection immediately; the theme applies once the player pauses.
    clearTimeout(keyTimer.current);
    keyTimer.current = setTimeout(() => apply(id), KEY_APPLY_DELAY_MS);
  };

  const current = getTheme(selected);
  return (
    <div className="tp" data-variant={variant} data-part="theme-picker">
      <div className="tp__grid" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
        {themes.map((theme) => {
          const checked = theme.id === selected;
          return (
            <div
              key={theme.id}
              ref={(el) => {
                if (el) itemRefs.current.set(theme.id, el);
                else itemRefs.current.delete(theme.id);
              }}
              role="radio"
              aria-checked={checked}
              aria-label={theme.name}
              aria-describedby={`tp-desc-${variant}-${theme.id}`}
              tabIndex={checked ? 0 : -1}
              className="tp__opt"
              data-theme-option={theme.id}
              data-active={theme.id === activeId ? 'true' : undefined}
              onClick={() => apply(theme.id)}
              onPointerEnter={() => void loadThemeSkin(theme.id)}
              style={{ '--tp-sw': theme.meta.swatches[2] } as CSSProperties}
            >
              <ThemePreview theme={theme} />
              <div className="tp__text">
                <span className="tp__name">
                  {theme.name}
                  {checked ? <span className="tp__check">Selected</span> : null}
                </span>
                <span className="tp__era">{theme.meta.era}</span>
                <span className="tp__tagline">{theme.meta.tagline}</span>
                <span className="tp__desc" id={`tp-desc-${variant}-${theme.id}`}>
                  {theme.description}
                </span>
                <span className="tp__swatches" aria-hidden>
                  {theme.meta.swatches.map((c, i) => (
                    <i key={i} style={{ background: c }} />
                  ))}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {variant === 'settings' ? (
        <p className="tp__summary" aria-live="polite">
          <strong>{current.name}</strong> — {current.meta.tagline}
        </p>
      ) : null}
    </div>
  );
}
