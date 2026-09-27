/**
 * /cabinet/:cabinetId — the in-world game-select screen of a multi-game cabinet.
 *
 * Walking up to DASino, DAS Boardroom, DAStravaganza or DAScade Classics zooms
 * into the cabinet's screen, which becomes a game-select menu dressed in that
 * cabinet's world (casino floor, executive lounge, game-show stage, retro
 * select). Desktop: a menu on the left and a big live preview on the right.
 * Phones: a list of rich cards. Every entry is a real link to its title screen
 * (/play/<gameId>, DASino tables carry ?table=), so direct links, refresh and
 * the back button all work. Single-game cabinets skip the picker entirely.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import {
  CABINETS,
  GAME_CATALOG,
  cabinetPath,
  cabinetPlayersLabel,
  isCabinetId,
  isMultiGameCabinet,
  playPath,
  type CabinetDef,
  type CabinetGame,
  type GameAccent,
} from '@dascade/shared';
import { Badge, Button, GameTheme, PixelIcon, cx } from '@dascade/ui';
import { useApp } from '../app/store.ts';
import { music, sfx } from '../audio/audio.ts';
import { AttractCanvas } from '../arcade/AttractCanvas.tsx';
import { scenesForGame } from '../arcade/attract.ts';
import { CATEGORY_LABEL, entryPlayers, gameBadges, tournamentGames } from '../arcade/cabinetInfo.ts';
import { MarqueeLogo } from '../arcade/Marquee.tsx';
import { PixelWord } from '../arcade/PixelWord.tsx';
import { ThemedText } from '../themes/ThemedText.tsx';
import { lastGameKey, rememberCabinet, rememberGame, runViewTransition } from '../arcade/transition.ts';
import { TournamentButton, tournamentPath } from '../tournament/TournamentButton.tsx';
import { PickerBackdrop } from './cabinet/PickerBackdrop.tsx';
import { UnknownPlace } from './cabinet/UnknownPlace.tsx';
import '../arcade/arcade.css';
import '../arcade/entry.css';
import './cabinet/picker.css';

/** DASino floor tables share one room; give each its own light on the menu. */
const TABLE_ACCENT: Record<string, GameAccent> = {
  roulette: { primary: '#ffb020', secondary: '#2de38f', deep: '#241402' },
  slots: { primary: '#c084fc', secondary: '#ffd23f', deep: '#1c0b2e' },
  dice: { primary: '#22d3ee', secondary: '#ffd23f', deep: '#04161f' },
};

const FLAVOUR_NOTE: Partial<Record<CabinetDef['id'], string>> = {
  dasino: 'Virtual chips only — no real money, purchases or cash-out, ever.',
  boardroom: 'Every board runs in the Tournament Center. Ratings are internal to DASCADE.',
  stravaganza: 'Built for game night: three to thirty players, phones as controllers.',
  classics: 'Six original quick-plays. Solo high scores or challenge the office.',
};

const MENU_TITLE: Partial<Record<CabinetDef['id'], string>> = {
  dasino: 'Choose a table',
  boardroom: 'Choose a board',
  stravaganza: 'Choose a show',
  classics: 'Select game',
};

function entryAccent(entry: CabinetGame): GameAccent {
  return (entry.variant && TABLE_ACCENT[entry.variant]) || GAME_CATALOG[entry.gameId].accent;
}

function entryDescription(entry: CabinetGame): string {
  // DASino tables share one catalog entry; their own blurb is the precise description.
  return entry.variant ? entry.blurb : GAME_CATALOG[entry.gameId].description;
}

function useIsDesktop(): boolean {
  const query = '(min-width: 900px) and (min-height: 560px)';
  const [match, setMatch] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return match;
}

export function CabinetPicker() {
  const { cabinetId } = useParams();
  if (!isCabinetId(cabinetId)) return <UnknownPlace title="No cabinet here" text="That machine isn’t on the arcade floor." />;
  const cabinet = CABINETS[cabinetId];
  // Single-game cabinets have nothing to pick: go straight to the title screen.
  if (!isMultiGameCabinet(cabinet)) return <Navigate to={cabinetPath(cabinet)} replace />;
  return <Picker key={cabinet.id} cabinet={cabinet} />;
}

function Picker({ cabinet }: { cabinet: CabinetDef }) {
  const navigate = useNavigate();
  const openModal = useApp((s) => s.openModal);
  const reduced = useApp((s) => s.settings.reducedMotion);
  const desktop = useIsDesktop();
  const games = cabinet.games;
  const initial = useMemo(() => {
    const key = lastGameKey(cabinet.id);
    return Math.max(
      0,
      games.findIndex((g) => g.key === key),
    );
  }, [cabinet.id, games]);
  const [selected, setSelected] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const items = useRef<Array<HTMLAnchorElement | null>>([]);
  const previewScreen = useRef<HTMLDivElement>(null);
  const itemScreens = useRef<Array<HTMLSpanElement | null>>([]);
  const entry = games[selected] ?? games[0]!;
  const game = GAME_CATALOG[entry.gameId];

  useEffect(() => {
    music.setMood('arcade');
    music.start('arcade');
    rememberCabinet(cabinet.id);
    // Land keyboard users on the remembered game.
    const el = items.current[initial];
    if (el && document.activeElement === document.body) el.focus({ preventScroll: true });
  }, [cabinet.id, initial]);

  // Warm the title-screen chunk so the zoom never waits.
  useEffect(() => {
    void import('./CabinetEntry.tsx').catch(() => undefined);
  }, []);

  const select = useCallback((i: number, sound = true) => {
    setSelected((prev) => {
      if (prev !== i && sound) sfx('hover', 60);
      return i;
    });
  }, []);

  const launch = useCallback(
    (i: number, e?: ReactMouseEvent) => {
      const g = games[i];
      if (!g || busy) {
        e?.preventDefault();
        return;
      }
      if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) return; // let the browser open a new tab
      e?.preventDefault();
      setBusy(g.key);
      setSelected(i);
      sfx('coin');
      rememberGame(g.gameId, g.variant ?? null);
      const path = playPath(g);
      const screen = desktop ? previewScreen.current : itemScreens.current[i];
      if (reduced || !screen) {
        navigate(path);
        return;
      }
      const r = screen.getBoundingClientRect();
      const root = document.documentElement;
      root.style.setProperty('--vt-x', `${Math.round(r.left + r.width / 2)}px`);
      root.style.setProperty('--vt-y', `${Math.round(r.top + r.height / 2)}px`);
      // Exactly one element may carry the shared "af-screen" name: the screen that zooms into the title screen.
      for (const el of itemScreens.current) if (el && el !== screen) el.style.viewTransitionName = 'none';
      screen.style.viewTransitionName = 'af-screen';
      if (!runViewTransition('enter', () => navigate(path), '[data-cabinet-entry]')) {
        screen.style.viewTransitionName = '';
        navigate(path);
      }
    },
    [busy, desktop, games, navigate, reduced],
  );

  const back = useCallback(() => {
    sfx('back');
    rememberCabinet(cabinet.id);
    if (reduced || !runViewTransition('exit', () => navigate('/'), '[data-arcade-floor]')) navigate('/');
  }, [cabinet.id, navigate, reduced]);

  const onMenuKeyDown = (e: ReactKeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const n = games.length;
    const cols = !desktop && typeof window !== 'undefined' && window.innerWidth >= 600 ? 2 : 1;
    const current = Math.max(
      0,
      items.current.findIndex((el) => el === document.activeElement),
    );
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = Math.min(n - 1, current + cols);
    else if (e.key === 'ArrowUp') next = Math.max(0, current - cols);
    else if (e.key === 'ArrowRight') next = Math.min(n - 1, current + 1);
    else if (e.key === 'ArrowLeft') next = Math.max(0, current - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next === null) return;
    e.preventDefault();
    select(next);
    items.current[next]?.focus();
  };

  // Escape / Backspace (outside inputs) walk back to the floor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || useApp.getState().modal) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back]);

  const menuTitle = MENU_TITLE[cabinet.id] ?? 'Select a game';
  // The Tournament Center opens on the selected game when it runs tournaments, else the cabinet's first one that does.
  const tourneyGame = GAME_CATALOG[entry.gameId].tournament ? entry.gameId : (tournamentGames(cabinet)[0]?.gameId ?? null);
  const badges = gameBadges(game).slice(0, 5);

  return (
    <GameTheme
      accent={cabinet.accent}
      as="main"
      className="cp"
      id="main"
      data-cabinet-picker={cabinet.id}
      data-part="cabinet-picker"
      data-flavour={cabinet.id}
      style={{ '--p': cabinet.accent.primary, '--s': cabinet.accent.secondary, '--d': cabinet.accent.deep } as CSSProperties}
    >
      <PickerBackdrop cabinet={cabinet.id} />

      <div className="cp__frame" data-part="picker-frame">
        <header className="cp__top" data-part="picker-header">
          <Button variant="ghost" icon="arrow-left" onClick={back} className="cp__back">
            Arcade floor
          </Button>
          <div className="cp__marquee" data-part="picker-marquee" aria-hidden>
            <MarqueeLogo subject={cabinet} />
          </div>
          <div className="cp__top-end">
            {tourneyGame ? (
              <Link to={tournamentPath(tourneyGame)} className="cp__tourney" aria-label="Tournament Center" onClick={() => sfx('click')}>
                <PixelIcon name="trophy" size={16} />
                <span>Tournament Center</span>
              </Link>
            ) : null}
          </div>
        </header>

        <div className="cp__body">
          <div className="cp__col">
            <div className="cp__head" data-part="picker-heading">
              <nav className="cp__crumbs" aria-label="Breadcrumb">
                <ol>
                  <li>
                    <Link to="/" onClick={() => rememberCabinet(cabinet.id)}>
                      Arcade
                    </Link>
                  </li>
                  <li aria-current="page">{cabinet.title}</li>
                </ol>
              </nav>
              <h1 className="cp__title" data-part="picker-title">
                <span className="visually-hidden">{cabinet.title}</span>
                <PixelWord text={cabinet.title} variant="title" />
              </h1>
              <p className="cp__lede">
                <span className="cp__family">{cabinet.family}</span>
                <span aria-hidden> · </span>
                <span>{games.length} games</span>
                <span aria-hidden> · </span>
                <span>{cabinetPlayersLabel(cabinet)}</span>
              </p>
            </div>
            <section className="cp__menu" data-part="picker-menu" aria-labelledby="cp-menu-title">
              <h2 id="cp-menu-title" className="cp__label">
                <span className="cp__label-caret" aria-hidden>
                  ▶
                </span>
                <ThemedText k="cabinet.heading" plain={menuTitle} />
              </h2>
              <ul className="cp__list" data-part="picker-list" onKeyDown={onMenuKeyDown}>
                {games.map((g, i) => {
                  const catalog = GAME_CATALOG[g.gameId];
                  const accent = entryAccent(g);
                  const isSel = i === selected;
                  const itemBadges = gameBadges(catalog)
                    .filter((b) => b.key !== 'spectators')
                    .slice(0, 3);
                  return (
                    <li key={g.key} className="cp__li" data-part="picker-card">
                      <Link
                        ref={(el) => {
                          items.current[i] = el;
                        }}
                        to={playPath(g)}
                        className={cx('cp-item', isSel && 'is-selected', busy === g.key && 'is-busy')}
                        data-game={g.key}
                        data-part="picker-card-link"
                        aria-label={`${g.title} — ${entryPlayers(g)}. ${g.blurb}`}
                        aria-current={isSel && desktop ? 'true' : undefined}
                        style={{ '--ip': accent.primary, '--is': accent.secondary, '--id': accent.deep } as CSSProperties}
                        onMouseEnter={() => desktop && select(i)}
                        onFocus={() => select(i, false)}
                        onClick={(e) => launch(i, e)}
                      >
                        <span
                          className="cp-item__screen"
                          ref={(el) => {
                            itemScreens.current[i] = el;
                          }}
                        >
                          <AttractCanvas
                            scenes={scenesForGame(g.gameId, g.variant)}
                            title={g.title.toUpperCase()}
                            accent={accent}
                            running={false}
                            hud={false}
                            resolution={72}
                          />
                          <span className="cp-item__glass" />
                        </span>
                        <span className="cp-item__text">
                          <span className="cp-item__title">{g.title}</span>
                          <span className="cp-item__meta">
                            <span className="cp-item__players">
                              <PixelIcon name="users" size={11} /> {entryPlayers(g)}
                            </span>
                            {itemBadges.map((b) => (
                              <span key={b.key} className="cp-item__tag" style={{ '--tag': b.color } as CSSProperties}>
                                {b.label}
                              </span>
                            ))}
                          </span>
                          <span className="cp-item__blurb">{g.blurb}</span>
                        </span>
                        <span className="cp-item__go" aria-hidden>
                          <PixelIcon name="arrow-right" size={16} />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>

          {desktop ? (
            <aside
              className="cp__preview"
              data-part="picker-preview"
              aria-label={`Selected: ${entry.title}`}
              style={{ '--ip': entryAccent(entry).primary, '--is': entryAccent(entry).secondary } as CSSProperties}
            >
              <div className="cp-screen" data-part="picker-screen" ref={previewScreen}>
                <AttractCanvas
                  key={entry.key}
                  scenes={scenesForGame(entry.gameId, entry.variant)}
                  title="" /* the title sits right below the screen: only PRESS START */
                  accent={entryAccent(entry)}
                  active
                  hud
                  resolution={128}
                  fps={24}
                />
                <span className="cp-screen__glass" aria-hidden />
              </div>
              <div className="cp-detail" data-part="picker-detail" key={`d-${entry.key}`}>
                <p className="cp-detail__kicker">
                  {CATEGORY_LABEL[game.category]} · {entryPlayers(entry)}
                </p>
                <h2 className="cp-detail__title">
                  <span className="visually-hidden">{entry.title}</span>
                  <PixelWord text={entry.title} variant="title" />
                </h2>
                <p className="cp-detail__desc">{entryDescription(entry)}</p>
                <div className="cp-detail__badges">
                  {badges.map((b) => (
                    <Badge key={b.key} icon={b.icon} color={b.color}>
                      {b.label}
                    </Badge>
                  ))}
                </div>
                <div className="cp-detail__actions" data-part="picker-actions">
                  <Button
                    variant="primary"
                    size="xl"
                    icon="play"
                    aria-label={`Play ${entry.title}`}
                    loading={busy === entry.key}
                    disabled={busy !== null && busy !== entry.key}
                    onClick={() => launch(selected)}
                  >
                    Play
                  </Button>
                  <Button variant="ghost" icon="help" onClick={() => openModal('help', entry.gameId)}>
                    How to play
                  </Button>
                  <TournamentButton gameId={entry.gameId} variant="secondary" size="md" label="Tournament" />
                </div>
              </div>
            </aside>
          ) : null}
        </div>

        <footer className="cp__foot" data-part="picker-footer">
          {FLAVOUR_NOTE[cabinet.id] ? <span className="cp__note">{FLAVOUR_NOTE[cabinet.id]}</span> : null}
          <span className="cp__keys" aria-hidden>
            <kbd className="dc-kbd">↑</kbd>
            <kbd className="dc-kbd">↓</kbd> choose <kbd className="dc-kbd">Enter</kbd> play <kbd className="dc-kbd">Esc</kbd> back
          </span>
        </footer>
      </div>
    </GameTheme>
  );
}
