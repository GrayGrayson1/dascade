/**
 * /play/:gameId — a game's title screen: Create / Join / Solo + nickname.
 * Reached from a single-game cabinet on the arcade floor, or from a multi-game
 * cabinet's picker. Styled as the zoomed-in cabinet screen: the game's attract
 * art fills a big pixelated "screen" behind glass, with the title card and an
 * "Insert coin" panel on top.
 *
 * Navigation: games inside a multi-game cabinet show "Arcade › DASino ›
 * Roulette" and Back returns to that cabinet's picker; single-game cabinets go
 * back to the arcade floor (centred on the cabinet). DASino tables arrive as
 * ?table=roulette|slots|dice: the title shows the table, and the requested
 * table is carried into the room (consumed once by the DASino client).
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { CABINETS, GAME_CATALOG, cabinetForGame, isGameId, normalizeRoomCode, type CabinetGame, type GameId } from '@dascade/shared';
import { Badge, Button, GameTheme, PixelIcon, TextInput } from '@dascade/ui';
import { session, useSessionStore } from '../net/session.ts';
import { useApp } from '../app/store.ts';
import { loadGameModule } from '../games/registry.ts';
import { sfx } from '../audio/audio.ts';
import { AttractCanvas } from '../arcade/AttractCanvas.tsx';
import { scenesForGame } from '../arcade/attract.ts';
import { CATEGORY_LABEL, gameBadges, playerRange } from '../arcade/cabinetInfo.ts';
import { MarqueeLogo } from '../arcade/Marquee.tsx';
import { PixelWord } from '../arcade/PixelWord.tsx';
import { gameKeyFor, rememberGame, runViewTransition } from '../arcade/transition.ts';
import { requestVariant } from '../arcade/variantRequest.ts';
import { TournamentButton } from '../tournament/TournamentButton.tsx';
import { UnknownPlace } from './cabinet/UnknownPlace.tsx';
import { ProfileEditor } from './common.tsx';
import '../arcade/entry.css';

/** Longer copy for the DASino floor tables (they share one catalog entry). */
const TABLE_COPY: Record<string, string> = {
  roulette:
    'Place chips on numbers and outside bets during the shared betting window, then one European single-zero wheel spins for the whole table.',
  slots: 'Neon 7s, an original DASCADE slot machine: pick your lines and bet, pull the lever and chase the paytable at your own pace.',
  dice: 'Two dice, one call: will the next roll land higher or lower? Quick shared rounds that get streaky fast.',
};

/** The cabinet entry for a game (+ the ?table= variant for DASino tables). */
function resolveEntry(gameId: GameId, variant: string | null): { entry: CabinetGame | null; variant: string | null } {
  const found = gameKeyFor(gameId, variant);
  if (!found) return { entry: null, variant: null };
  const cabinet = CABINETS[found.cabinet];
  const entry = found.key ? (cabinet.games.find((g) => g.key === found.key) ?? null) : null;
  // Unknown ?table= values are ignored (the bare DASino floor opens instead).
  return { entry, variant: entry?.variant ?? null };
}

export function CabinetEntry() {
  const { gameId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const profileConfirmed = useApp((s) => s.profileConfirmed);
  const openModal = useApp((s) => s.openModal);
  const reducedMotion = useApp((s) => s.settings.reducedMotion);
  const error = useSessionStore((s) => s.error);
  const [busy, setBusy] = useState<'create' | 'solo' | 'join' | null>(null);
  const [code, setCode] = useState('');
  const [showJoin, setShowJoin] = useState(false);
  const requestedTable = params.get('table');
  const known = !!gameId && isGameId(gameId);
  const { entry, variant } = known ? resolveEntry(gameId, requestedTable) : { entry: null, variant: null };

  useEffect(() => {
    if (gameId && isGameId(gameId)) {
      void loadGameModule(gameId).catch(() => undefined); // warm the code-split chunk
      rememberGame(gameId, variant);
    }
    session.clearNotices();
  }, [gameId, variant]);

  if (!gameId || !isGameId(gameId)) return <UnknownPlace title="No game here" text="That machine isn’t on the arcade floor." />;
  const game = GAME_CATALOG[gameId];
  const cabinet = cabinetForGame(gameId) ?? null;
  const inPicker = !!cabinet && cabinet.games.length > 1;
  const title = entry?.variant ? entry.title : game.title;
  const tagline = entry?.variant ? entry.blurb : game.tagline;
  const description = entry?.variant
    ? `${TABLE_COPY[entry.variant] ?? entry.blurb} One shared balance across the DASino floor — every chip is virtual.`
    : game.description;
  const badges = gameBadges(game);

  const create = async (solo: boolean) => {
    setBusy(solo ? 'solo' : 'create');
    sfx('coin');
    const roomCode = await session.createRoom(gameId, solo ? { solo: true } : {});
    setBusy(null);
    if (roomCode) {
      requestVariant(roomCode, gameId, variant);
      navigate(`/room/${roomCode}`);
    }
  };
  const join = async () => {
    const c = normalizeRoomCode(code);
    setBusy('join');
    const res = await session.joinRoom(c);
    setBusy(null);
    if (res.ok) {
      requestVariant(c, gameId, variant);
      navigate(`/room/${c}`);
    }
  };
  const backPath = inPicker && cabinet ? `/cabinet/${cabinet.id}` : '/';
  const back = () => {
    sfx('back');
    const ready = inPicker ? '[data-cabinet-picker]' : '[data-arcade-floor]';
    if (reducedMotion || !runViewTransition('exit', () => navigate(backPath), ready)) navigate(backPath);
  };

  return (
    <GameTheme
      accent={game.accent}
      as="main"
      className="af-entry"
      id="main"
      data-cabinet-entry={gameId}
      data-game={gameId}
      data-table={variant ?? undefined}
      style={{ '--p': game.accent.primary, '--s': game.accent.secondary, '--d': game.accent.deep } as CSSProperties}
    >
      <div className="af-entry__bg" aria-hidden>
        <div className="af-entry__screen">
          <AttractCanvas
            scenes={scenesForGame(gameId, variant)}
            title={title.toUpperCase()}
            accent={game.accent}
            fit="cover"
            resolution={132}
            hud={false}
            active
            fps={20}
            className="af-entry__art"
          />
          <span className="af-entry__scan" />
          <span className="af-entry__scrim" />
          <span className="af-entry__glass" />
        </div>
      </div>

      <div className="af-entry__frame">
        <header className="af-entry__top">
          <Button
            variant="ghost"
            icon="arrow-left"
            onClick={back}
            className="af-entry__back"
            aria-label={inPicker && cabinet ? `Back to ${cabinet.title}` : 'Back to the arcade floor'}
          >
            {inPicker && cabinet ? cabinet.title : 'Arcade floor'}
          </Button>
          <div
            className="af-entry__marquee"
            style={cabinet ? ({ '--p': cabinet.accent.primary, '--s': cabinet.accent.secondary } as CSSProperties) : undefined}
          >
            <MarqueeLogo subject={cabinet ?? game} />
          </div>
          <Button variant="ghost" icon="help" onClick={() => openModal('help', gameId)} className="af-entry__help">
            How to play
          </Button>
        </header>

        <div className="af-entry__grid">
          <div className="af-entry__head">
            <nav className="af-entry__crumbs" aria-label="Breadcrumb">
              <ol>
                <li>
                  <Link to="/">Arcade</Link>
                </li>
                {inPicker && cabinet ? (
                  <li>
                    <Link to={`/cabinet/${cabinet.id}`}>{cabinet.title}</Link>
                  </li>
                ) : null}
                <li aria-current="page">{title}</li>
              </ol>
            </nav>
            <p className="af-entry__kicker">
              {CATEGORY_LABEL[game.category]} · {playerRange(game)} players
            </p>
            <h1 id="ce-title" className="af-entry__title">
              <span className="visually-hidden">{title}</span>
              <PixelWord text={title} variant="title" />
            </h1>
            <p className="af-entry__tagline">{tagline}</p>
          </div>

          <section className="af-entry__card" aria-labelledby="ce-coin">
            <header className="af-entry__card-head">
              <span className="af-entry__slot" aria-hidden />
              <h2 id="ce-coin">Insert coin</h2>
              <span className="af-entry__credit" aria-hidden>
                1P
              </span>
            </header>
            <div className="af-entry__card-body">
              <ProfileEditor compact />
              {error ? (
                <div className="af-entry__error" role="alert">
                  <strong>{error.title}.</strong> {error.message}
                </div>
              ) : null}
              <Button
                variant="primary"
                size="xl"
                block
                icon="plus"
                loading={busy === 'create'}
                disabled={!profileConfirmed || busy !== null}
                onClick={() => create(false)}
              >
                Create game
              </Button>
              {game.capacity.supportsSolo ? (
                <Button
                  variant="secondary"
                  size="lg"
                  block
                  icon="user"
                  loading={busy === 'solo'}
                  disabled={!profileConfirmed || busy !== null}
                  onClick={() => create(true)}
                >
                  {gameId === 'circuit' ? 'Solo time trial' : 'Play solo'}
                </Button>
              ) : null}
              {showJoin ? (
                <form
                  className="af-entry__join"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void join();
                  }}
                >
                  <TextInput
                    className="dc-input--code"
                    value={code}
                    autoFocus
                    placeholder="CODE"
                    aria-label="Room code"
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setCode(normalizeRoomCode(e.currentTarget.value).slice(0, 5))}
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    loading={busy === 'join'}
                    disabled={!profileConfirmed || code.length !== 5 || busy !== null}
                  >
                    Join
                  </Button>
                </form>
              ) : (
                <Button variant="secondary" size="lg" block icon="users" disabled={busy !== null} onClick={() => setShowJoin(true)}>
                  Join with code
                </Button>
              )}
              {game.tournament ? (
                <TournamentButton gameId={gameId} variant="ghost" size="md" label="Tournament Center" className="af-entry__tourney" />
              ) : null}
              {!profileConfirmed ? (
                <p className="af-entry__hint">
                  <PixelIcon name="info" /> Enter a nickname to play.
                </p>
              ) : null}
            </div>
          </section>

          <div className="af-entry__details">
            <p className="af-entry__desc">{description}</p>
            <div className="af-entry__badges">
              <Badge icon="users">{playerRange(game)} players</Badge>
              {badges.map((b) => (
                <Badge key={b.key} icon={b.icon} color={b.color}>
                  {b.key === 'chips' ? 'Virtual chips only' : b.label}
                </Badge>
              ))}
            </div>
            <div className="af-entry__controls">
              <h2 className="af-entry__label">Controls</h2>
              <ul>
                {game.controls.map((c) => (
                  <li key={c}>
                    <PixelIcon name="play" /> {c}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </GameTheme>
  );
}
