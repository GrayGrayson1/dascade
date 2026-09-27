/**
 * The expanded jukebox — the machine up close: a dome with the record turning on its turntable,
 * bubble-tube pillars, chrome push buttons and the title-strip rack, on a lit plinth. It opens as a
 * non-modal panel (desktop popover rising from the jukebox that opened it, phone bottom sheet,
 * phone-landscape side sheet). Escape / close button / outside tap close it; focus moves in on open
 * and back to the jukebox on close. Gameplay keeps running underneath.
 */
import { lazy, Suspense, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useThemeId } from '@dascade/ui';
import { jukebox, showsPlaying, useJukebox } from '../audio/jukebox/index.ts';
import { useApp } from '../app/store.ts';
import { useSkin } from '../themes/registry.ts';
import { SkinBoundary } from '../themes/SkinBoundary.tsx';
import { ThemedText } from '../themes/ThemedText.tsx';
import { useSkinContext } from '../themes/ThemeHost.tsx';
import { sortTracks } from './format.ts';
import { Glyph } from './icons.tsx';
import { Library, type LibraryActions } from './Library.tsx';
import { Queue } from './Queue.tsx';
import { Record } from './Record.tsx';
import { Seek } from './Seek.tsx';
import { useJukeboxPrefs } from './prefs.ts';
import { selectionCode } from './strips.ts';
import { Visualizer } from './visualizer/Visualizer.tsx';

const DjPanel = lazy(() => import('./DjPanel.tsx'));

export type PlayerLayout = 'popover' | 'sheet' | 'side';
export type PlayerAnchor = 'top-right' | 'bottom-left' | 'bottom-right' | 'floor';
type Tab = 'library' | 'queue' | 'dj';

const SHEET_MQ = '(max-width: 640px) and (min-height: 501px)';
const SIDE_MQ = '(max-height: 500px)';

export function useLayout(): PlayerLayout {
  const read = (): PlayerLayout => {
    if (typeof matchMedia !== 'function') return 'popover';
    if (matchMedia(SIDE_MQ).matches) return 'side';
    if (matchMedia(SHEET_MQ).matches) return 'sheet';
    return 'popover';
  };
  const [layout, setLayout] = useState<PlayerLayout>(read);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mqs = [matchMedia(SIDE_MQ), matchMedia(SHEET_MQ)];
    const on = () => setLayout(read());
    mqs.forEach((m) => m.addEventListener('change', on));
    return () => mqs.forEach((m) => m.removeEventListener('change', on));
  }, []);
  return layout;
}

function Decor({ playing, expanded, level }: { playing: boolean; expanded: boolean; level: number }) {
  const themeId = useThemeId();
  const skin = useSkin(themeId);
  const ctx = useSkinContext();
  const JukeboxDecor = skin?.JukeboxDecor;
  if (!JukeboxDecor || !skin) return null;
  return (
    <SkinBoundary skinId={skin.id}>
      <JukeboxDecor fx={ctx.fx} reducedMotion={ctx.reducedMotion} place={ctx.place} playing={playing} expanded={expanded} level={level} />
    </SkinBoundary>
  );
}

export interface PlayerProps {
  open: boolean;
  anchor: PlayerAnchor;
  inRoom: boolean;
  /** `restoreFocus` false for an outside tap (focus goes where the user tapped). */
  onClose: (restoreFocus?: boolean) => void;
  announce: (msg: string) => void;
}

export function Player({ open, anchor, inRoom, onClose, announce }: PlayerProps) {
  const layout = useLayout();
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>('library');
  const [level, setLevel] = useState(0);

  const currentId = useJukebox((s) => s.currentId);
  const playing = useJukebox((s) => s.playing);
  const wantPlaying = useJukebox((s) => s.wantPlaying);
  const transportOn = useJukebox(showsPlaying);
  const buffering = useJukebox((s) => s.buffering);
  const needsGesture = useJukebox((s) => s.needsGesture);
  const shuffle = useJukebox((s) => s.shuffle);
  const repeat = useJukebox((s) => s.repeat);
  const queueLen = useJukebox((s) => s.queue.length);
  const muted = useJukebox((s) => s.jukeboxMuted);
  const source = useJukebox((s) => s.source);
  const room = useJukebox((s) => s.room);
  const error = useJukebox((s) => s.error);
  const tracks = useJukebox((s) => s.library.tracks);
  const libraryStatus = useJukebox((s) => s.library.status);
  const prefs = useJukeboxPrefs();
  const updateSettings = useApp((s) => s.updateSettings);

  const track = currentId ? (tracks.find((t) => t.id === currentId) ?? null) : null;
  // The playing record's selection code (catalogue order, as on the title strips).
  const code = useMemo(() => {
    if (!currentId) return null;
    const i = sortTracks(tracks, 'order').findIndex((t) => t.id === currentId);
    return i >= 0 ? selectionCode(i) : null;
  }, [tracks, currentId]);
  const followingRoom = source === 'room';
  const perm = jukebox.djPermissions();
  const roomLocked = followingRoom && !perm.control;
  const showDj = inRoom || room !== null;
  const activeTab: Tab = tab === 'dj' && !showDj ? 'library' : tab;

  // Focus into the panel when it opens (heading is focusable so screen readers announce the dialog).
  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
  }, [open]);

  // Popover placement from what opened it: from the jukebox standing on the floor the machine rises
  // from where it stands; from a toolbar control it drops down just below that button.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!open || layout !== 'popover' || !root || !panel) return;
    if (anchor === 'floor') {
      const machine = document.querySelector<HTMLElement>('[data-jukebox][data-dock="floor"] [data-part="machine"]');
      if (!machine) return;
      const m = machine.getBoundingClientRect();
      root.style.setProperty('--jb-floor-left', `${Math.round(m.left)}px`);
      const p = panel.getBoundingClientRect();
      panel.style.transformOrigin = `${Math.round(m.left + m.width / 2 - p.left)}px ${Math.round(m.top + m.height / 2 - p.top)}px`;
    } else if (anchor === 'top-right') {
      const control = document.querySelector<HTMLElement>(
        '[data-jukebox]:is([data-dock="slot"], [data-dock="topbar"]) [data-part="mini-open"]',
      );
      const r = control?.getBoundingClientRect();
      if (!r || r.width === 0) {
        root.style.removeProperty('--jb-anchor-top');
        root.style.removeProperty('--jb-anchor-right');
        return;
      }
      root.style.setProperty('--jb-anchor-top', `${Math.round(r.bottom + 8)}px`);
      root.style.setProperty('--jb-anchor-right', `${Math.max(12, Math.round(window.innerWidth - r.right))}px`);
      panel.style.transformOrigin = 'top right';
    }
  }, [open, anchor, layout]);

  // Outside tap closes (the dock and the player itself don't count).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('[data-jukebox]')) return;
      if (t.closest('dialog[open], .dc-toasts')) return; // modals/toasts opened on top
      onClose(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, onClose]);

  const personalActions: LibraryActions = {
    currentId,
    play: (id) => jukebox.play(id),
    playLabel: (t) => `Play ${t.title}`,
    playNext: (id) => {
      jukebox.enqueue(id, { next: true });
      announce(`${tracks.find((t) => t.id === id)?.title ?? 'Track'} will play next`);
    },
    queue: (id) => {
      jukebox.enqueue(id);
      announce(`${tracks.find((t) => t.id === id)?.title ?? 'Track'} added to the queue`);
    },
  };

  const repeatLabel = repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat all' : 'Repeat off';
  const volumePct = Math.round(prefs.volume * 100);

  return (
    <div
      ref={rootRef}
      className="jb-root jb-player"
      data-jukebox=""
      data-state={open ? 'expanded' : 'collapsed'}
      data-source={source}
      data-layout={layout}
      data-anchor={anchor}
      data-playing={playing ? 'true' : undefined}
      hidden={!open}
    >
      {layout !== 'popover' ? <div className="jb-scrim" aria-hidden onClick={() => onClose(false)} /> : null}
      <section
        ref={panelRef}
        className="jb-panel"
        data-part="panel"
        role="dialog"
        aria-modal={layout === 'popover' ? 'false' : 'true'}
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          } else if (e.key === 'Tab' && layout !== 'popover') {
            // The sheet covers the page behind a scrim: keep Tab inside it (the popover stays non-modal).
            wrapTab(e.nativeEvent, e.currentTarget);
          }
        }}
      >
        <header className="jb-header" data-part="header">
          <div className="jb-titlebar" data-part="title-bar">
            <span className="jb-titlebar__icon" aria-hidden>
              <Glyph name="jukebox" size={16} />
            </span>
            <h2 className="jb-titlebar__title" id={titleId}>
              <ThemedText k="jukebox.title" plain="Jukebox" />
            </h2>
            {followingRoom ? (
              <span className="jb-badge" data-kind="room">
                Room DJ
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="jb-btn jb-btn--icon jb-close"
            data-part="close"
            onClick={() => onClose()}
            aria-label="Close jukebox"
            title="Close (Esc)"
          >
            <Glyph name="close" size={14} />
          </button>
        </header>

        <span className="jb-pillar" data-side="l" aria-hidden />
        <span className="jb-pillar" data-side="r" aria-hidden />
        <div className="jb-body">
          <div className="jb-dome" data-part="dome">
            {/* The arched glass on top of the machine, the record turning behind it. */}
            <div className="jb-dome__glass" data-part="dome-glass" aria-hidden>
              <Record track={track} playing={playing} />
            </div>
            <div className="jb-display" data-part="display" ref={displayRef} style={{ '--jb-level': 0 } as CSSProperties}>
              <div className="jb-decor" data-part="decor" aria-hidden>
                {open ? <Decor playing={playing} expanded={open} level={level} /> : null}
              </div>
              <div className="jb-now">
                <p className="jb-now__label">
                  {followingRoom
                    ? room?.playing
                      ? 'Room is playing'
                      : room?.current
                        ? 'Room paused'
                        : 'Room is quiet'
                    : playing
                      ? 'Now playing'
                      : track
                        ? wantPlaying
                          ? 'Starting…'
                          : 'Paused'
                        : 'Pick a song'}
                  {code ? <span className="jb-now__code">{code}</span> : null}
                </p>
                <p className="jb-now__title" data-part="track-title" title={track?.title}>
                  {track?.title ?? (libraryStatus === 'ready' ? 'Nothing playing' : 'Loading…')}
                </p>
                <p className="jb-now__artist" data-part="track-artist">
                  {track?.artist ?? (track ? 'DASCADE Jukebox' : ' ')}
                </p>
              </div>
              <div className="jb-vis-wrap">
                <Visualizer active={open} levelTarget={displayRef} onLevel={setLevel} />
              </div>
            </div>
          </div>

          {needsGesture && wantPlaying ? (
            <button type="button" className="jb-enable" data-part="enable-audio" onClick={() => jukebox.unlock()}>
              <Glyph name="volume" size={14} /> Click to enable audio
            </button>
          ) : null}
          {error ? (
            <p className="jb-note" data-kind="error" role="status">
              {error}
              <button type="button" className="jb-btn jb-btn--text" onClick={() => jukebox.clearError()}>
                Dismiss
              </button>
            </p>
          ) : null}
          {prefs.masterMuted ? (
            <p className="jb-note">
              All sound is muted.
              <button type="button" className="jb-btn jb-btn--text" onClick={() => updateSettings({ muted: false })}>
                Unmute
              </button>
            </p>
          ) : null}

          <Seek active={open} disabled={roomLocked || !track} onSeek={(s) => jukebox.seek(s)} />

          <div className="jb-transport" data-part="transport" role="group" aria-label="Playback">
            <button
              type="button"
              className="jb-btn jb-btn--icon jb-btn--toggle"
              data-part="shuffle"
              aria-pressed={shuffle}
              disabled={followingRoom}
              onClick={() => jukebox.setShuffle(!shuffle)}
              aria-label="Shuffle"
              title={shuffle ? 'Shuffle on' : 'Shuffle off'}
            >
              <Glyph name="shuffle" />
            </button>
            <button
              type="button"
              className="jb-btn jb-btn--icon"
              data-part="prev"
              disabled={roomLocked || libraryStatus !== 'ready'}
              onClick={() => jukebox.prev()}
              aria-label="Previous track"
              title="Previous"
            >
              <Glyph name="prev" />
            </button>
            <button
              type="button"
              className="jb-btn jb-btn--play"
              data-part="play"
              data-playing={transportOn ? 'true' : undefined}
              data-buffering={buffering ? 'true' : undefined}
              disabled={libraryStatus !== 'ready' || tracks.length === 0}
              onClick={() => jukebox.toggle()}
              aria-label={transportOn ? 'Pause' : 'Play'}
            >
              <Glyph name={transportOn ? 'pause' : 'play'} size={20} />
            </button>
            <button
              type="button"
              className="jb-btn jb-btn--icon"
              data-part="next"
              disabled={roomLocked || libraryStatus !== 'ready'}
              onClick={() => jukebox.next()}
              aria-label="Next track"
              title="Next"
            >
              <Glyph name="next" />
            </button>
            <button
              type="button"
              className="jb-btn jb-btn--icon jb-btn--toggle"
              data-part="repeat"
              data-mode={repeat}
              aria-pressed={repeat !== 'off'}
              disabled={followingRoom}
              onClick={() => {
                jukebox.cycleRepeat();
                const next = repeat === 'off' ? 'Repeat all' : repeat === 'all' ? 'Repeat one' : 'Repeat off';
                announce(next);
              }}
              aria-label={repeatLabel}
              title={repeatLabel}
            >
              <Glyph name="repeat" />
              {repeat === 'one' ? (
                <span className="jb-repeat-one" aria-hidden>
                  1
                </span>
              ) : null}
            </button>
          </div>

          <div className="jb-volume-row">
            <button
              type="button"
              className="jb-btn jb-btn--icon jb-btn--toggle"
              data-part="mute"
              aria-pressed={muted}
              onClick={() => jukebox.toggleMute()}
              aria-label="Mute jukebox"
              title={muted ? 'Unmute jukebox' : 'Mute jukebox'}
            >
              <Glyph name={muted || prefs.volume === 0 ? 'muted' : 'volume'} />
            </button>
            <input
              type="range"
              className="jb-volume"
              data-part="volume"
              min={0}
              max={100}
              step={1}
              value={volumePct}
              onChange={(e) => jukebox.setVolume(e.currentTarget.valueAsNumber / 100)}
              aria-label="Jukebox volume"
              aria-valuetext={muted ? `${volumePct}%, muted` : `${volumePct}%`}
              style={{ '--fill': `${volumePct}%` } as CSSProperties}
              data-muted={muted ? 'true' : undefined}
            />
            <span className="jb-volume__num" aria-hidden>
              {volumePct}
            </span>
          </div>

          <div
            className="jb-tabs"
            data-part="tabs"
            role="tablist"
            aria-label="Jukebox sections"
            onKeyDown={(e) => tabKeys(e.currentTarget, e)}
          >
            {(
              [
                ['library', 'Selections'],
                ['queue', queueLen ? `Up next · ${queueLen}` : 'Up next'],
                ...(showDj ? ([['dj', 'Room DJ']] as const) : []),
              ] as ReadonlyArray<readonly [Tab, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                id={`${titleId}-tab-${value}`}
                aria-controls={`${titleId}-panel`}
                aria-selected={activeTab === value}
                tabIndex={activeTab === value ? 0 : -1}
                className="jb-tab"
                data-tab={value}
                onClick={() => setTab(value)}
              >
                {label}
                {value === 'dj' && room?.enabled ? <span className="jb-tab__dot" aria-label="(on)" /> : null}
              </button>
            ))}
          </div>
          <div className="jb-tabpanel" role="tabpanel" id={`${titleId}-panel`} aria-labelledby={`${titleId}-tab-${activeTab}`}>
            {activeTab === 'library' ? (
              <>
                {roomLocked ? <p className="jb-note">Picking a track here stops listening with the room.</p> : null}
                <Library actions={personalActions} />
              </>
            ) : activeTab === 'queue' ? (
              <Queue announce={announce} />
            ) : (
              <Suspense fallback={<p className="jb-empty">Loading Room DJ…</p>}>
                <DjPanel active={open} announce={announce} />
              </Suspense>
            )}
          </div>
        </div>
        <span className="jb-plinth" data-part="plinth" aria-hidden />
      </section>
    </div>
  );
}

function tabKeys(list: HTMLElement, e: React.KeyboardEvent): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
  const n = tabs.length;
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (Math.max(0, i) + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
  e.preventDefault();
  tabs[next]?.focus();
  tabs[next]?.click();
}

/**
 * Tab / Shift+Tab cycle through the tabbable controls inside `root` (wrapping at the ends). Focus is moved
 * explicitly for every Tab so the cycle is the same in every browser (WebKit's default Tab skips buttons).
 */
function wrapTab(e: KeyboardEvent, root: HTMLElement): void {
  const tabbables = Array.from(
    root.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'),
  ).filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.checkVisibility?.() !== false);
  if (!tabbables.length) return;
  const i = tabbables.indexOf(document.activeElement as HTMLElement);
  const n = tabbables.length;
  const next = i < 0 ? (e.shiftKey ? n - 1 : 0) : (i + (e.shiftKey ? n - 1 : 1)) % n;
  e.preventDefault();
  tabbables[next]!.focus();
}
