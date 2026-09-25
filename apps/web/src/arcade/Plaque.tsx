/** The info plaque under the cabinet row: what the selected game is and a big Play button. */
import type { CSSProperties } from 'react';
import type { GameCatalogEntry } from '@dascade/shared';
import { Badge, Button } from '@dascade/ui';
import { useApp } from '../app/store.ts';
import { sfx } from '../audio/audio.ts';
import { PixelWord } from './PixelWord.tsx';

const CATEGORY: Record<GameCatalogEntry['category'], string> = {
  party: 'Party game',
  casino: 'Casino table',
  racing: 'Racing',
  adventure: 'Co-op adventure',
};

export function playerRange(game: GameCatalogEntry): string {
  const { minPlayers, maxPlayersLimit } = game.capacity;
  return minPlayers === maxPlayersLimit ? `${minPlayers}` : `${minPlayers}–${maxPlayersLimit}`;
}

export function Plaque({ game, onPlay, busy }: { game: GameCatalogEntry | null; onPlay: () => void; busy: boolean }) {
  const openModal = useApp((s) => s.openModal);
  if (!game) {
    return (
      <section className="af-plaque af-plaque--welcome" aria-labelledby="plaque-title">
        <div className="af-plaque__id">
          <span className="af-plaque__kicker">Welcome to the floor</span>
          <h2 id="plaque-title" className="af-plaque__title">
            <span className="visually-hidden">Pick a cabinet</span>
            <PixelWord text="Pick a cabinet" variant="title" />
          </h2>
          <p className="af-plaque__tagline">Eight multiplayer machines. No installs, no accounts.</p>
        </div>
        <div className="af-plaque__info">
          <p className="af-plaque__desc">
            Click or tap any machine to see what it’s about, then press <strong>Play</strong>. Got a room code from a teammate? Jump straight in.
          </p>
        </div>
        <div className="af-plaque__actions">
          <Button
            variant="primary"
            size="lg"
            icon="users"
            onClick={() => {
              sfx('click');
              openModal('join');
            }}
          >
            Join with code
          </Button>
          <Button variant="ghost" icon="help" onClick={() => openModal('help')}>
            How it works
          </Button>
        </div>
      </section>
    );
  }
  const players = playerRange(game);
  return (
    <section
      className="af-plaque"
      data-game={game.id}
      aria-labelledby="plaque-title"
      style={{ '--accent': game.accent.primary, '--accent-2': game.accent.secondary, '--accent-deep': game.accent.deep } as CSSProperties}
    >
      <div className="af-plaque__id" key={`id-${game.id}`}>
        <span className="af-plaque__kicker">{CATEGORY[game.category]}</span>
        <h2 id="plaque-title" className="af-plaque__title">
          <span className="visually-hidden">{game.title}</span>
          <PixelWord text={game.title} variant="title" />
        </h2>
        <p className="af-plaque__tagline">{game.tagline}</p>
      </div>
      <div className="af-plaque__info" key={`info-${game.id}`}>
        <p className="af-plaque__desc">{game.description}</p>
        <div className="af-plaque__badges">
          <Badge icon="users">{players} players</Badge>
          {game.capacity.supportsSpectators ? (
            <Badge icon="eye" color="var(--purple)">
              Spectators
            </Badge>
          ) : null}
          {game.capacity.supportsSolo ? (
            <Badge icon="user" color="var(--cyan)">
              Solo play
            </Badge>
          ) : null}
          {game.virtualChips ? (
            <Badge icon="chip" color="var(--yellow)">
              Virtual chips
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="af-plaque__actions">
        <Button variant="primary" size="xl" icon="play" className="af-plaque__play" aria-label={`Play ${game.title}`} loading={busy} onClick={onPlay}>
          Play
        </Button>
        <Button variant="ghost" icon="help" className="af-plaque__help" onClick={() => openModal('help', game.id)}>
          How to play
        </Button>
      </div>
    </section>
  );
}
