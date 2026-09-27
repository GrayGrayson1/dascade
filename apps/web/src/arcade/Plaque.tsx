/**
 * The info plaque under the lineup: what the centred cabinet is, what's inside
 * a multi-game cabinet (without walking in), feature badges and a big
 * Play / Open button.
 */
import type { CSSProperties } from 'react';
import { GAME_CATALOG, cabinetPlayersLabel, type CabinetDef } from '@dascade/shared';
import { Badge, Button } from '@dascade/ui';
import { useApp } from '../app/store.ts';
import { cabinetBadges } from './cabinetInfo.ts';
import { PixelWord } from './PixelWord.tsx';

export { playerRange } from './cabinetInfo.ts';

export function Plaque({ cabinet, onOpen, busy }: { cabinet: CabinetDef; onOpen: () => void; busy: boolean }) {
  const openModal = useApp((s) => s.openModal);
  const multi = cabinet.games.length > 1;
  const only = cabinet.games[0]!;
  const badges = cabinetBadges(cabinet).slice(0, multi ? 5 : 4);
  const verb = multi ? 'Open' : 'Play';
  return (
    <section
      className="af-plaque"
      data-cabinet={cabinet.id}
      aria-labelledby="plaque-title"
      style={
        {
          '--accent': cabinet.accent.primary,
          '--accent-2': cabinet.accent.secondary,
          '--accent-deep': cabinet.accent.deep,
        } as CSSProperties
      }
    >
      <div className="af-plaque__id" key={`id-${cabinet.id}`}>
        <span className="af-plaque__kicker">
          {cabinet.family}
          {multi ? <span className="af-plaque__count"> · {cabinet.games.length} games</span> : null}
          <span className="af-plaque__players"> · {cabinetPlayersLabel(cabinet)}</span>
        </span>
        <h2 id="plaque-title" className="af-plaque__title">
          <span className="visually-hidden">{cabinet.title}</span>
          <PixelWord text={cabinet.title} variant="title" />
        </h2>
        <p className="af-plaque__tagline">{cabinet.tagline}</p>
      </div>
      <div className="af-plaque__info" key={`info-${cabinet.id}`}>
        {multi ? (
          <ul className="af-plaque__games" aria-label={`Games in ${cabinet.title}`}>
            {cabinet.games.map((g) => (
              <li key={g.key}>{g.title}</li>
            ))}
          </ul>
        ) : (
          <p className="af-plaque__desc">{cabinet.description}</p>
        )}
        <div className="af-plaque__badges">
          <Badge icon="users">{cabinetPlayersLabel(cabinet)}</Badge>
          {badges.map((b) => (
            <Badge key={b.key} icon={b.icon} color={b.color}>
              {b.label}
            </Badge>
          ))}
        </div>
      </div>
      <div className="af-plaque__actions">
        <Button
          variant="primary"
          size="xl"
          icon={multi ? 'arrow-right' : 'play'}
          className="af-plaque__play"
          aria-label={`${verb} ${cabinet.title}`}
          loading={busy}
          onClick={onOpen}
        >
          {verb}
        </Button>
        {multi ? null : (
          <Button variant="ghost" icon="help" className="af-plaque__help" onClick={() => openModal('help', only.gameId)}>
            How to play
          </Button>
        )}
      </div>
    </section>
  );
}

/** Short, screen-reader friendly summary used by the live region. */
export function plaqueAnnouncement(cabinet: CabinetDef, index: number, count: number): string {
  const inside =
    cabinet.games.length > 1
      ? ` ${cabinet.games.length} games: ${cabinet.games.map((g) => g.title).join(', ')}.`
      : ` ${GAME_CATALOG[cabinet.games[0]!.gameId].tagline}`;
  return `${cabinet.title}, ${index + 1} of ${count}. ${cabinet.family}.${inside}`;
}
