/** The lit marquee logo shared by the floor cabinets and the cabinet title screen. */
import type { GameCatalogEntry } from '@dascade/shared';
import { PixelWord } from './PixelWord.tsx';

export function marqueeParts(marquee: string): { top?: string; main: string; badge?: string } {
  const words = marquee.trim().split(/\s+/);
  const last = words[words.length - 1] ?? marquee;
  if (words.length > 1 && /^\d+$/.test(last)) return { main: words.slice(0, -1).join(' '), badge: last };
  if (words.length > 1) return { top: words.slice(0, -1).join(' '), main: last };
  return { main: marquee };
}

export function MarqueeLogo({ game, className }: { game: GameCatalogEntry; className?: string }) {
  const { top, main, badge } = marqueeParts(game.marquee);
  return (
    <span className={className ? `af-mq ${className}` : 'af-mq'} data-game={game.id} aria-hidden>
      <span className="af-mq__art" />
      <span className="af-mq__text">
        {top ? <span className="af-mq__top">{top}</span> : null}
        <span className="af-mq__main">
          <PixelWord text={main} variant="logo" box=".af-mq" fitW={badge ? 0.68 : 0.88} fitH={top ? 0.5 : 0.64} />
          {badge ? <span className="af-mq__badge">{badge}</span> : null}
        </span>
      </span>
      <span className="af-mq__shine" />
    </span>
  );
}
