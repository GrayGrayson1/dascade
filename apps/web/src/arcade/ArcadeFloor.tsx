/**
 * The DASCADE arcade floor — the landing experience.
 *
 * A pixel-art room with a row of original home-arcade cabinets (one per game).
 *  - Desktop (≥1200px): all eight machines across the floor.
 *  - Laptop / tablet / landscape phones: the same row with scroll-snap + arrows.
 *  - Portrait phones: a one-cabinet-at-a-time carousel with prev/next + dots.
 * Tap or click selects a cabinet (the plaque explains it); Play (or pressing the
 * selected cabinet again, or Enter) zooms into its screen and opens /play/<id>.
 * No game module or engine is imported here.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { GAME_CATALOG, GAME_IDS, GAME_LIST, type GameId } from '@dascade/shared';
import { Button, IconButton, cx } from '@dascade/ui';
import { useApp } from '../app/store.ts';
import { music, sfx } from '../audio/audio.ts';
import { ArcadeFooter, ArcadeHeader, useServerStatus } from './ArcadeHud.tsx';
import { ArcadeRoom, type RoomSize } from './ArcadeRoom.tsx';
import { Cabinet } from './Cabinet.tsx';
import { Plaque } from './Plaque.tsx';
import { lastCabinet, rememberCabinet, runViewTransition } from './transition.ts';
import './arcade.css';

type Mode = 'row' | 'scroll' | 'carousel';

const ROW_QUERY = '(min-width: 1200px)';
const CAROUSEL_QUERY = '(max-width: 699px)';

function readMode(): Mode {
  if (typeof matchMedia !== 'function') return 'row';
  if (matchMedia(ROW_QUERY).matches) return 'row';
  if (matchMedia(CAROUSEL_QUERY).matches) return 'carousel';
  return 'scroll';
}

function subscribeMode(cb: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => undefined;
  const lists = [matchMedia(ROW_QUERY), matchMedia(CAROUSEL_QUERY)];
  lists.forEach((l) => l.addEventListener('change', cb));
  return () => lists.forEach((l) => l.removeEventListener('change', cb));
}

function useLayoutMode(): Mode {
  return useSyncExternalStore(subscribeMode, readMode, () => 'row');
}

/** Warms the (small, engine-free) cabinet title-screen chunk on first intent so the zoom never waits on the network. */
let entryPrefetch: Promise<unknown> | null = null;
function prefetchEntry(): void {
  entryPrefetch ??= import('../shell/CabinetEntry.tsx').catch(() => {
    entryPrefetch = null;
  });
}

export function ArcadeFloor() {
  const navigate = useNavigate();
  const reduced = useApp((s) => s.settings.reducedMotion);
  const mode = useLayoutMode();
  const status = useServerStatus();
  const initialLast = useMemo(() => lastCabinet(), []);
  const [picked, setPicked] = useState<GameId | null>(initialLast);
  const [cursor, setCursor] = useState<GameId>(initialLast ?? GAME_IDS[0]);
  const [launching, setLaunching] = useState<GameId | null>(null);
  const [roomSize, setRoomSize] = useState<RoomSize | null>(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: false });
  const selected: GameId | null = mode === 'carousel' ? (picked ?? GAME_IDS[0]) : picked;

  const mainRef = useRef<HTMLElement>(null);
  const rowRef = useRef<HTMLUListElement>(null);
  const buttons = useRef(new Map<GameId, HTMLButtonElement>());
  const screens = useRef(new Map<GameId, HTMLElement>());
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const launchingRef = useRef(false);
  /** While a programmatic carousel scroll runs, ignore intermediate snap positions. */
  const scrollTarget = useRef<GameId | null>(null);

  useEffect(() => {
    music.setMood('arcade');
    music.start('arcade');
  }, []);

  // ---------------------------------------------------------------------------
  // Scrolling helpers
  const itemOf = (id: GameId) => buttons.current.get(id)?.parentElement ?? null;

  const scrollToCabinet = useCallback(
    (id: GameId, smooth: boolean) => {
      const row = rowRef.current;
      const li = itemOf(id);
      if (!row || !li || row.scrollWidth <= row.clientWidth + 1) return;
      const behavior: ScrollBehavior = smooth && !reduced ? 'smooth' : 'auto';
      if (modeRef.current === 'carousel') {
        scrollTarget.current = smooth ? id : null;
        row.scrollTo({ left: li.offsetLeft + li.offsetWidth / 2 - row.clientWidth / 2, behavior });
      } else {
        const left = li.offsetLeft;
        const right = left + li.offsetWidth;
        const pad = 56;
        if (left - pad < row.scrollLeft) row.scrollTo({ left: left - pad, behavior });
        else if (right + pad > row.scrollLeft + row.clientWidth) row.scrollTo({ left: right + pad - row.clientWidth, behavior });
      }
    },
    [reduced],
  );

  // ---------------------------------------------------------------------------
  // Selection + play
  const select = useCallback(
    (id: GameId, opts: { focus?: boolean; scroll?: boolean; sound?: boolean } = {}) => {
      if (selectedRef.current !== id && opts.sound !== false) sfx('select');
      prefetchEntry();
      selectedRef.current = id;
      setPicked(id);
      setCursor(id);
      if (opts.scroll !== false) scrollToCabinet(id, true);
      if (opts.focus) buttons.current.get(id)?.focus({ preventScroll: true });
    },
    [scrollToCabinet],
  );

  const play = useCallback(
    (id: GameId) => {
      if (launchingRef.current) return;
      launchingRef.current = true;
      prefetchEntry();
      sfx('coin');
      rememberCabinet(id);
      const path = `/play/${id}`;
      const screen = screens.current.get(id);
      if (reduced || !screen) {
        navigate(path);
        return;
      }
      const r = screen.getBoundingClientRect();
      const root = document.documentElement;
      root.style.setProperty('--vt-x', `${Math.round(r.left + r.width / 2)}px`);
      root.style.setProperty('--vt-y', `${Math.round(r.top + r.height / 2)}px`);
      setLaunching(id);
      screen.style.viewTransitionName = 'af-screen';
      const started = runViewTransition('enter', () => navigate(path), '[data-cabinet-entry]');
      if (!started) {
        screen.style.viewTransitionName = '';
        const main = mainRef.current;
        if (main) {
          const mr = main.getBoundingClientRect();
          main.style.setProperty('--zoom-x', `${r.left + r.width / 2 - mr.left}px`);
          main.style.setProperty('--zoom-y', `${r.top + r.height / 2 - mr.top}px`);
        }
        window.setTimeout(() => navigate(path), 440);
      }
    },
    [navigate, reduced],
  );

  const onPress = useCallback(
    (id: GameId, wasSelected: boolean) => {
      if (wasSelected) play(id);
      else select(id, { scroll: true });
    },
    [play, select],
  );

  const onKeyboardFocus = useCallback(
    (id: GameId) => {
      if (selectedRef.current !== id) select(id, { scroll: true });
    },
    [select],
  );

  const onHover = useCallback(() => {
    sfx('hover', 90);
    prefetchEntry();
  }, []);
  const setButton = useCallback((id: GameId, el: HTMLButtonElement | null) => {
    if (el) buttons.current.set(id, el);
    else buttons.current.delete(id);
  }, []);
  const setScreen = useCallback((id: GameId, el: HTMLElement | null) => {
    if (el) screens.current.set(id, el);
    else screens.current.delete(id);
  }, []);

  /** Moves the selection `delta` cabinets from `fromId` (the focused cabinet, else the selection). */
  const step = useCallback(
    (delta: number, fromId: GameId | null, focus: boolean) => {
      const base = fromId ?? selectedRef.current;
      const from = base ? GAME_IDS.indexOf(base) : delta > 0 ? -1 : GAME_IDS.length;
      const id = GAME_IDS[Math.max(0, Math.min(GAME_IDS.length - 1, from + delta))]!;
      if (id !== selectedRef.current) sfx('hover', 60);
      select(id, { focus, sound: false });
    },
    [select],
  );

  /** Enters the row from elsewhere: focuses (and selects) the current cabinet without moving. */
  const enterRow = useCallback(() => {
    const id = selectedRef.current ?? GAME_IDS[0];
    select(id, { focus: true, sound: selectedRef.current !== id });
  }, [select]);

  const focusedCabinet = (target: EventTarget | null): GameId | null => {
    const game = (target as HTMLElement | null)?.closest?.('.af-cab')?.getAttribute('data-game');
    return game && (GAME_IDS as readonly string[]).includes(game) ? (game as GameId) : null;
  };

  // Arrow keys on the row (roving focus) and anywhere on the floor when nothing is focused.
  const onRowKeyDown = (e: ReactKeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      step(e.key === 'ArrowRight' ? 1 : -1, focusedCabinet(e.target), true);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      select(e.key === 'Home' ? GAME_IDS[0] : GAME_IDS[GAME_IDS.length - 1]!, { focus: true });
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (useApp.getState().modal) return;
      const target = e.target as HTMLElement | null;
      if (target && target !== document.body && !target.classList.contains('af-floor')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        enterRow();
      } else if (e.key === 'Enter' && selectedRef.current) {
        e.preventDefault();
        play(selectedRef.current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enterRow, play]);

  // ---------------------------------------------------------------------------
  // Carousel: the centred cabinet is the selection.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const atStart = row.scrollLeft <= 4;
      const atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 4;
      setEdges((prev) => (prev.atStart === atStart && prev.atEnd === atEnd ? prev : { atStart, atEnd }));
      if (modeRef.current !== 'carousel') return;
      const center = row.scrollLeft + row.clientWidth / 2;
      let best: GameId | null = null;
      let bestD = Infinity;
      for (const id of GAME_IDS) {
        const li = itemOf(id);
        if (!li) continue;
        const d = Math.abs(li.offsetLeft + li.offsetWidth / 2 - center);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      if (!best) return;
      if (scrollTarget.current) {
        if (best !== scrollTarget.current) return;
        scrollTarget.current = null;
      }
      if (best !== selectedRef.current) {
        sfx('hover', 60);
        prefetchEntry();
        selectedRef.current = best;
        setPicked(best);
        setCursor(best);
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    row.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      row.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [mode]);

  // Keep the selection in view when the layout mode changes (and on first paint).
  useLayoutEffect(() => {
    const id = selectedRef.current;
    if (id) scrollToCabinet(id, false);
  }, [mode, scrollToCabinet]);

  // ---------------------------------------------------------------------------
  // Measure the floor so the pixel room lines up with the cabinets.
  useLayoutEffect(() => {
    const main = mainRef.current;
    const row = rowRef.current;
    if (!main || !row) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const mr = main.getBoundingClientRect();
      const rr = row.getBoundingClientRect();
      const bodies = row.querySelectorAll<HTMLElement>('.af-cab__body');
      let top = Infinity;
      let bottom = -Infinity;
      let left = Infinity;
      let right = -Infinity;
      bodies.forEach((b) => {
        const r = b.getBoundingClientRect();
        if (r.right < rr.left || r.left > rr.right) return;
        top = Math.min(top, r.top);
        bottom = Math.max(bottom, r.bottom);
        left = Math.min(left, r.left);
        right = Math.max(right, r.right);
      });
      if (!Number.isFinite(top)) return;
      const header = main.querySelector<HTMLElement>('.af-hud');
      const w = Math.round(mr.width);
      const h = Math.round(Math.max(main.scrollHeight, mr.height));
      const next: RoomSize = {
        w,
        h,
        hints: {
          headerBottom: header ? header.getBoundingClientRect().bottom - mr.top : 64,
          rowTop: top - mr.top,
          rowBottom: bottom - mr.top,
          rowLeft: Math.max(0, Math.max(left, rr.left) - mr.left),
          rowRight: Math.min(w, Math.min(right, rr.right) - mr.left),
        },
      };
      setRoomSize((prev) => {
        if (
          prev &&
          prev.w === next.w &&
          prev.h === next.h &&
          Math.abs(prev.hints.rowTop - next.hints.rowTop) < 2 &&
          Math.abs(prev.hints.rowBottom - next.hints.rowBottom) < 2 &&
          Math.abs(prev.hints.rowLeft - next.hints.rowLeft) < 2 &&
          Math.abs(prev.hints.headerBottom - next.hints.headerBottom) < 2
        )
          return prev;
        return next;
      });
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    ro?.observe(main);
    ro?.observe(row);
    window.addEventListener('resize', schedule);
    // fonts can shift the plaque height once they load
    void document.fonts?.ready.then(schedule);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [mode]);

  const selectedGame = selected ? GAME_CATALOG[selected] : null;
  const showArrows = mode !== 'row';
  const arrowPrev = () => {
    if (mode === 'carousel') step(-1, null, false);
    else rowRef.current?.scrollBy({ left: -rowRef.current.clientWidth * 0.75, behavior: reduced ? 'auto' : 'smooth' });
  };
  const arrowNext = () => {
    if (mode === 'carousel') step(1, null, false);
    else rowRef.current?.scrollBy({ left: rowRef.current.clientWidth * 0.75, behavior: reduced ? 'auto' : 'smooth' });
  };
  const selIndex = selected ? GAME_IDS.indexOf(selected) : -1;

  return (
    <main
      id="main"
      ref={mainRef}
      className={cx('af-floor', launching && 'af-floor--launching')}
      data-arcade-floor
      data-mode={mode}
      tabIndex={-1}
      style={selectedGame ? ({ '--sel': selectedGame.accent.primary, '--sel-2': selectedGame.accent.secondary } as CSSProperties) : undefined}
    >
      <ArcadeRoom size={roomSize} />
      <ArcadeHeader status={status} />

      <div className="af-floor__stage">
        <p className="visually-hidden" id="floor-help">
          Use the left and right arrow keys to browse cabinets. Press Enter on the selected cabinet to play.
        </p>
        <ul className="af-floor__row" ref={rowRef} aria-label="Arcade cabinets" aria-describedby="floor-help" onKeyDown={onRowKeyDown}>
          {GAME_LIST.map((game, i) => (
            <Cabinet
              key={game.id}
              game={game}
              index={i}
              count={GAME_LIST.length}
              selected={selected === game.id}
              tabbable={cursor === game.id}
              isLast={initialLast === game.id}
              onPress={onPress}
              onKeyboardFocus={onKeyboardFocus}
              onHover={onHover}
              setButton={setButton}
              setScreen={setScreen}
            />
          ))}
        </ul>
        {showArrows ? (
          <>
            <IconButton
              icon="arrow-left"
              label={mode === 'carousel' ? 'Previous cabinet' : 'Scroll cabinets left'}
              variant="secondary"
              className="af-floor__arrow af-floor__arrow--prev"
              disabled={mode === 'carousel' ? selIndex <= 0 : edges.atStart}
              onClick={arrowPrev}
            />
            <IconButton
              icon="arrow-right"
              label={mode === 'carousel' ? 'Next cabinet' : 'Scroll cabinets right'}
              variant="secondary"
              className="af-floor__arrow af-floor__arrow--next"
              disabled={mode === 'carousel' ? selIndex >= GAME_IDS.length - 1 : edges.atEnd}
              onClick={arrowNext}
            />
          </>
        ) : null}
        {mode === 'carousel' ? (
          <div className="af-floor__dots" role="group" aria-label="Choose a cabinet">
            {GAME_LIST.map((g) => (
              <button
                key={g.id}
                type="button"
                className="af-floor__dot"
                aria-label={`Show ${g.title}`}
                aria-current={selected === g.id ? 'true' : undefined}
                style={{ '--dot': g.accent.primary } as CSSProperties}
                onClick={() => select(g.id)}
              >
                <i />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="af-floor__plaque-wrap">
        <Plaque game={selectedGame} onPlay={() => selected && play(selected)} busy={launching !== null} />
        <Button
          variant="ghost"
          icon="users"
          className="af-floor__join-mobile"
          onClick={() => {
            sfx('click');
            useApp.getState().openModal('join');
          }}
        >
          Have a code? Join with code
        </Button>
        <p className="visually-hidden" role="status">
          {selectedGame ? `${selectedGame.title} selected` : ''}
        </p>
      </div>

      <ArcadeFooter status={status} />
    </main>
  );
}
