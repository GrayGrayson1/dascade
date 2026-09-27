/**
 * /tournaments — the Tournament Center: a scoreboard kiosk on the arcade floor. Live tournaments
 * board (GET /api/tournaments), join by code, and the create wizard. `?game=<id>` filters the board
 * and pre-selects the game; `?create=1` opens the wizard.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  GAME_CATALOG,
  ROOM_CODE_LENGTH,
  TOURNAMENT_FORMAT_BLURBS,
  TOURNAMENT_FORMAT_LABELS,
  TOURNAMENT_FORMATS,
  TOURNAMENT_GAME_LIST,
  TOURNAMENT_STATUS_LABELS,
  normalizeRoomCode,
  type TournamentListing,
} from '@dascade/shared';
import { Button, GameTheme, IconButton, PixelIcon, Spinner, cx } from '@dascade/ui';
import { useApp } from '../app/store.ts';
import { sfx } from '../audio/audio.ts';
import { fetchTournaments } from './api.ts';
import { PixelBracket, PixelTrophy } from './art.tsx';
import { CreateWizard, isTournamentGame } from './CreateWizard.tsx';
import './bracket/bracket.css';
import './center.css';

// Dev-only visual QA gallery (`/tournaments?gallery=se16`). `import.meta.env.DEV` is false in
// production builds, so the import below is dead code there and never bundled.
const Gallery = import.meta.env.DEV ? lazy(() => import('./dev/Gallery.tsx')) : null;

const REFRESH_MS = 10_000;

type BoardState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; list: TournamentListing[] };

export function TournamentCenter() {
  const [params, setParams] = useSearchParams();
  const gallery = params.get('gallery');
  if (Gallery && gallery !== null) {
    return (
      <Suspense fallback={null}>
        <Gallery fixture={gallery} />
      </Suspense>
    );
  }
  return <Center params={params} setParams={setParams} />;
}

function Center({ params, setParams }: { params: URLSearchParams; setParams: ReturnType<typeof useSearchParams>[1] }) {
  const navigate = useNavigate();
  const openModal = useApp((s) => s.openModal);
  const gameParam = params.get('game');
  const game = isTournamentGame(gameParam) ? gameParam : null;
  const creating = params.get('create') === '1';
  const [board, setBoard] = useState<BoardState>({ kind: 'loading' });

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const list = await fetchTournaments(signal);
      setBoard({ kind: 'ok', list });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setBoard((b) => (b.kind === 'ok' ? b : { kind: 'error' }));
    }
  }, []);

  useEffect(() => {
    if (creating) return;
    const ctrl = new AbortController();
    void load(ctrl.signal);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      ctrl.abort();
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [creating, load]);

  useEffect(() => {
    document.title = creating ? 'Create a tournament · DASCADE' : 'Tournament Center · DASCADE';
    return () => {
      document.title = 'DASCADE';
    };
  }, [creating]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: key === 'game' });
  };

  const startCreate = () => {
    sfx('click');
    setParam('create', '1');
    window.scrollTo(0, 0);
  };

  return (
    <GameTheme accent={GAME_CATALOG.tournament.accent} as="main" className="tc-center dc-game-backdrop" id="main">
      <header className="tc-top">
        <Button variant="ghost" icon="arrow-left" onClick={() => (creating ? setParam('create', null) : navigate('/'))}>
          {creating ? 'Tournament Center' : 'Arcade floor'}
        </Button>
        <span className="tc-top__crumb" aria-hidden>
          <PixelIcon name="trophy" /> Tournament Center
        </span>
        <IconButton icon="help" label="How tournaments work" onClick={() => openModal('help', 'tournament')} />
      </header>

      {creating ? (
        <div className="tc-shell">
          <CreateWizard initialGame={game} onCancel={() => setParam('create', null)} />
        </div>
      ) : (
        <div className="tc-shell">
          <Hero onCreate={startCreate} game={game} />
          <Board board={board} game={game} onGame={(id) => setParam('game', id)} onRefresh={() => void load()} onCreate={startCreate} />
          <HowItWorks />
        </div>
      )}
    </GameTheme>
  );
}

// ---------------------------------------------------------------------------
function Hero({ onCreate, game }: { onCreate: () => void; game: string | null }) {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const join = (e: FormEvent) => {
    e.preventDefault();
    const c = normalizeRoomCode(code);
    if (c.length !== ROOM_CODE_LENGTH) {
      setError(`Tournament codes are ${ROOM_CODE_LENGTH} characters.`);
      return;
    }
    sfx('click');
    navigate(`/room/${c}`);
  };
  const gameTitle = game && isTournamentGame(game) ? GAME_CATALOG[game].title : null;
  return (
    <section className="tc-hero" aria-labelledby="tc-hero-title">
      <div className="tc-marquee">
        <PixelTrophy className="tc-marquee__trophy" />
        <div className="tc-marquee__text">
          <span className="tc-marquee__kicker">Delta Alpha Sierra Arcade</span>
          <h1 id="tc-hero-title" className="tc-marquee__title">
            Tournament Center
          </h1>
          <p className="tc-marquee__sub">
            Brackets, Swiss and round robins for head-to-head games. Register, check in, play from the bracket — results advance on their
            own.
          </p>
        </div>
      </div>
      <div className="tc-hero__actions">
        <Button variant="gold" size="xl" icon="trophy" onClick={onCreate} className="tc-hero__create">
          {gameTitle ? `Create a ${gameTitle} tournament` : 'Create tournament'}
        </Button>
        <form className="tc-join" onSubmit={join} noValidate>
          <label className="tc-join__label" htmlFor="tc-join-code">
            Have a tournament code?
          </label>
          <div className="tc-join__row">
            <input
              id="tc-join-code"
              className="tc-join__input"
              value={code}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={7}
              placeholder="ABCDE"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'tc-join-err' : undefined}
              onChange={(e) => {
                setError(null);
                setCode(normalizeRoomCode(e.currentTarget.value).slice(0, ROOM_CODE_LENGTH));
              }}
            />
            <Button type="submit" variant="secondary" icon="arrow-right">
              Join
            </Button>
          </div>
          {error ? (
            <span id="tc-join-err" className="dc-field__error">
              {error}
            </span>
          ) : null}
        </form>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
const STATUS_TONE: Record<TournamentListing['status'], string> = {
  DRAFT: 'idle',
  REGISTRATION: 'open',
  CHECK_IN: 'open',
  READY: 'open',
  IN_PROGRESS: 'live',
  COMPLETE: 'done',
  CANCELLED: 'done',
};

function Board({
  board,
  game,
  onGame,
  onRefresh,
  onCreate,
}: {
  board: BoardState;
  game: string | null;
  onGame: (id: string | null) => void;
  onRefresh: () => void;
  onCreate: () => void;
}) {
  const list = useMemo(() => (board.kind === 'ok' ? board.list : []), [board]);
  const shown = useMemo(() => {
    const filtered = game ? list.filter((t) => t.gameId === game) : list;
    const rank = (t: TournamentListing) => (t.status === 'IN_PROGRESS' ? 0 : t.status === 'COMPLETE' ? 2 : 1);
    return [...filtered].sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt);
  }, [list, game]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of list) m.set(t.gameId, (m.get(t.gameId) ?? 0) + 1);
    return m;
  }, [list]);
  const liveCount = list.filter((t) => t.status === 'IN_PROGRESS').length;
  return (
    <section className="tc-board" aria-labelledby="tc-board-title">
      <header className="tc-board__head">
        <h2 id="tc-board-title" className="tc-board__title">
          <span className="tc-lamp" data-tone={liveCount > 0 ? 'live' : 'idle'} aria-hidden />
          Tournament board
          {board.kind === 'ok' ? (
            <span className="tc-board__count">
              <span className="dc-num">{list.length}</span> running
              {liveCount > 0 ? (
                <>
                  {' '}
                  · <span className="dc-num">{liveCount}</span> live
                </>
              ) : null}
            </span>
          ) : null}
        </h2>
        <IconButton icon="refresh" label="Refresh the board" size="sm" onClick={onRefresh} />
      </header>
      <div className="tc-filters" role="group" aria-label="Filter by game">
        <button type="button" className={cx('tc-chip', !game && 'tc-chip--on')} aria-pressed={!game} onClick={() => onGame(null)}>
          All games
        </button>
        {TOURNAMENT_GAME_LIST.map((g) => (
          <button
            key={g.id}
            type="button"
            className={cx('tc-chip', game === g.id && 'tc-chip--on')}
            aria-pressed={game === g.id}
            style={{ '--g': g.accent.primary } as CSSProperties}
            data-game
            onClick={() => onGame(game === g.id ? null : g.id)}
          >
            {g.title.replace(/^DAS /, '')}
            {counts.get(g.id) ? <span className="tc-chip__n dc-num">{counts.get(g.id)}</span> : null}
          </button>
        ))}
      </div>
      {board.kind === 'loading' ? (
        <div className="tc-board__state">
          <Spinner label="Loading tournaments" />
        </div>
      ) : board.kind === 'error' ? (
        <div className="tc-board__state" role="alert">
          <PixelIcon name="wifi-off" className="tc-board__icon" />
          <p>The tournament board is offline. We’ll keep trying.</p>
          <Button variant="secondary" icon="refresh" onClick={onRefresh}>
            Try again
          </Button>
        </div>
      ) : shown.length === 0 ? (
        <div className="tc-board__state">
          <PixelBracket className="tc-board__icon" />
          <p className="tc-board__empty">
            {game
              ? `No ${GAME_CATALOG[game as keyof typeof GAME_CATALOG]?.title ?? ''} tournaments right now.`
              : 'No tournaments running right now.'}
          </p>
          <p className="dc-muted">Start one — it takes half a minute. Share the code and let the bracket do the rest.</p>
          <Button variant="gold" icon="trophy" onClick={onCreate}>
            Create tournament
          </Button>
        </div>
      ) : (
        <ul className="tc-rows">
          {shown.map((t) => (
            <BoardRow key={t.code} t={t} />
          ))}
        </ul>
      )}
    </section>
  );
}

function BoardRow({ t }: { t: TournamentListing }) {
  const navigate = useNavigate();
  const g = GAME_CATALOG[t.gameId];
  const tone = STATUS_TONE[t.status];
  const cta = t.status === 'REGISTRATION' || t.status === 'CHECK_IN' ? 'Enter' : t.status === 'IN_PROGRESS' ? 'Watch' : 'View';
  const open = () => {
    sfx('click');
    navigate(`/room/${t.code}`);
  };
  return (
    <li className="tc-row" data-tone={tone} style={{ '--g': g.accent.primary, '--g2': g.accent.secondary } as CSSProperties}>
      <span className="tc-row__game" aria-hidden>
        {g.marquee}
      </span>
      <div className="tc-row__main">
        <span className="tc-row__name">{t.name}</span>
        <span className="tc-row__meta">
          {g.title} · {TOURNAMENT_FORMAT_LABELS[t.format]} · {t.bestOf === 1 ? 'single game' : `best of ${t.bestOf}`} · by{' '}
          {t.organizerName || 'organizer'}
        </span>
      </div>
      <div className="tc-row__stage">
        <span className="tc-lamp" data-tone={t.paused ? 'idle' : tone} aria-hidden />
        <span>
          {t.paused ? 'Paused' : t.stageLabel || TOURNAMENT_STATUS_LABELS[t.status]}
          {t.status === 'IN_PROGRESS' && t.totalRounds > 0 && !/round/i.test(t.stageLabel) ? (
            <span className="tc-row__round">
              {' '}
              · round <span className="dc-num">{t.currentRound}</span>/<span className="dc-num">{t.totalRounds}</span>
            </span>
          ) : null}
        </span>
      </div>
      <dl className="tc-row__stats">
        <div>
          <dt>
            <PixelIcon name="users" /> <span className="visually-hidden">Players</span>
          </dt>
          <dd className="dc-num">
            {t.participants}/{t.maxField}
          </dd>
        </div>
        {t.liveMatches > 0 ? (
          <div data-live>
            <dt>
              <PixelIcon name="play" /> <span className="visually-hidden">Live matches</span>
            </dt>
            <dd className="dc-num">{t.liveMatches}</dd>
          </div>
        ) : null}
        <div>
          <dt>
            <PixelIcon name="eye" /> <span className="visually-hidden">Watching</span>
          </dt>
          <dd className="dc-num">{t.viewers}</dd>
        </div>
      </dl>
      <span className="tc-row__code dc-num" aria-hidden>
        {t.code}
      </span>
      <Button
        variant={tone === 'open' ? 'primary' : 'secondary'}
        size="sm"
        className="tc-row__cta"
        onClick={open}
        aria-label={`${cta}: ${t.name} (code ${t.code})`}
      >
        {cta}
      </Button>
    </li>
  );
}

// ---------------------------------------------------------------------------
function HowItWorks() {
  return (
    <section className="tc-how" aria-labelledby="tc-how-title">
      <h2 id="tc-how-title" className="tc-how__title">
        How it works
      </h2>
      <ol className="tc-steps">
        <li>
          <span className="tc-steps__n dc-num">1</span>
          <b>Create &amp; share</b>
          <span>Pick a game and a format, then share the 5-letter code or the invite link.</span>
        </li>
        <li>
          <span className="tc-steps__n dc-num">2</span>
          <b>Register &amp; check in</b>
          <span>Players register from the kiosk. With check-in on, only players who confirm are drawn.</span>
        </li>
        <li>
          <span className="tc-steps__n dc-num">3</span>
          <b>Play from the bracket</b>
          <span>When your match is ready, press Play. Results advance automatically — no scorekeeping.</span>
        </li>
      </ol>
      <div className="tc-formats-info">
        {TOURNAMENT_FORMATS.map((f) => (
          <div key={f} className="tc-formats-info__item">
            <b>{TOURNAMENT_FORMAT_LABELS[f]}</b>
            <span>{TOURNAMENT_FORMAT_BLURBS[f]}</span>
          </div>
        ))}
      </div>
      <p className="dc-field__hint">
        Ratings shown in tournaments are internal DASCADE ratings — not FIDE or any federation’s. Virtual arcade fun only.
      </p>
    </section>
  );
}
