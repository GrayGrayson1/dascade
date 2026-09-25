/**
 * /play/:gameId — the cabinet's title screen: Create / Join / Solo + nickname.
 * Reached by selecting a cabinet on the arcade floor. Styled as the zoomed-in
 * cabinet screen: the game's attract art fills a big pixelated "screen" behind
 * glass, with the title card and an "Insert coin" panel on top.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router';
import { GAME_CATALOG, isGameId, normalizeRoomCode } from '@dascade/shared';
import { Badge, Button, GameTheme, PixelIcon, TextInput } from '@dascade/ui';
import { session, useSessionStore } from '../net/session.ts';
import { useApp } from '../app/store.ts';
import { loadGameModule } from '../games/registry.ts';
import { sfx } from '../audio/audio.ts';
import { AttractCanvas } from '../arcade/AttractCanvas.tsx';
import { MarqueeLogo } from '../arcade/Marquee.tsx';
import { PixelWord } from '../arcade/PixelWord.tsx';
import { playerRange } from '../arcade/Plaque.tsx';
import { rememberCabinet, runViewTransition } from '../arcade/transition.ts';
import { NotFoundScreen } from './RoomScreen.tsx';
import { ProfileEditor } from './common.tsx';
import '../arcade/entry.css';

const CATEGORY: Record<string, string> = {
  party: 'Party game',
  casino: 'Casino table',
  racing: 'Racing',
  adventure: 'Co-op adventure',
};

export function CabinetEntry() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const profileConfirmed = useApp((s) => s.profileConfirmed);
  const openModal = useApp((s) => s.openModal);
  const reducedMotion = useApp((s) => s.settings.reducedMotion);
  const error = useSessionStore((s) => s.error);
  const [busy, setBusy] = useState<'create' | 'solo' | 'join' | null>(null);
  const [code, setCode] = useState('');
  const [showJoin, setShowJoin] = useState(false);

  useEffect(() => {
    if (gameId && isGameId(gameId)) {
      void loadGameModule(gameId).catch(() => undefined); // warm the code-split chunk
      rememberCabinet(gameId);
    }
    session.clearNotices();
  }, [gameId]);

  if (!gameId || !isGameId(gameId)) return <NotFoundScreen />;
  const game = GAME_CATALOG[gameId];

  const create = async (solo: boolean) => {
    setBusy(solo ? 'solo' : 'create');
    sfx('coin');
    const roomCode = await session.createRoom(gameId, solo ? { solo: true } : {});
    setBusy(null);
    if (roomCode) navigate(`/room/${roomCode}`);
  };
  const join = async () => {
    const c = normalizeRoomCode(code);
    setBusy('join');
    const res = await session.joinRoom(c);
    setBusy(null);
    if (res.ok) navigate(`/room/${c}`);
  };
  const back = () => {
    sfx('back');
    if (reducedMotion || !runViewTransition('exit', () => navigate('/'), '[data-arcade-floor]')) navigate('/');
  };

  return (
    <GameTheme
      accent={game.accent}
      as="main"
      className="af-entry"
      id="main"
      data-cabinet-entry={gameId}
      data-game={gameId}
      style={{ '--p': game.accent.primary, '--s': game.accent.secondary, '--d': game.accent.deep } as CSSProperties}
    >
      <div className="af-entry__bg" aria-hidden>
        <div className="af-entry__screen">
          <AttractCanvas game={game} fit="cover" resolution={132} hud={false} active fps={20} className="af-entry__art" />
          <span className="af-entry__scan" />
          <span className="af-entry__scrim" />
          <span className="af-entry__glass" />
        </div>
      </div>

      <div className="af-entry__frame">
        <header className="af-entry__top">
          <Button variant="ghost" icon="arrow-left" onClick={back} className="af-entry__back">
            Arcade floor
          </Button>
          <div className="af-entry__marquee">
            <MarqueeLogo game={game} />
          </div>
          <Button variant="ghost" icon="help" onClick={() => openModal('help', gameId)} className="af-entry__help">
            How to play
          </Button>
        </header>

        <div className="af-entry__grid">
          <div className="af-entry__head">
            <p className="af-entry__kicker">
              {CATEGORY[game.category] ?? 'Arcade'} · {playerRange(game)} players
            </p>
            <h1 id="ce-title" className="af-entry__title">
              <span className="visually-hidden">{game.title}</span>
              <PixelWord text={game.title} variant="title" />
            </h1>
            <p className="af-entry__tagline">{game.tagline}</p>
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
                  <Button type="submit" variant="primary" size="lg" loading={busy === 'join'} disabled={!profileConfirmed || code.length !== 5 || busy !== null}>
                    Join
                  </Button>
                </form>
              ) : (
                <Button variant="secondary" size="lg" block icon="users" disabled={busy !== null} onClick={() => setShowJoin(true)}>
                  Join with code
                </Button>
              )}
              {!profileConfirmed ? (
                <p className="af-entry__hint">
                  <PixelIcon name="info" /> Enter a nickname to play.
                </p>
              ) : null}
            </div>
          </section>

          <div className="af-entry__details">
            <p className="af-entry__desc">{game.description}</p>
            <div className="af-entry__badges">
              <Badge icon="users">{playerRange(game)} players</Badge>
              {game.capacity.supportsSpectators ? (
                <Badge icon="eye" color="var(--purple)">
                  Spectators
                </Badge>
              ) : null}
              {game.capacity.supportsSolo ? (
                <Badge icon="user" color="var(--cyan)">
                  Solo mode
                </Badge>
              ) : null}
              {game.virtualChips ? (
                <Badge icon="chip" color="var(--yellow)">
                  Virtual chips only
                </Badge>
              ) : null}
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
