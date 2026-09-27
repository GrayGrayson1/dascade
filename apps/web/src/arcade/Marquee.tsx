/** The lit marquee logo shared by the lineup cabinets, the cabinet picker and the title screen. */
import { PixelWord } from './PixelWord.tsx';

/** Anything with a marquee: a cabinet (CabinetDef) or a game (GameCatalogEntry). */
export interface MarqueeSubject {
  id: string;
  marquee: string;
}

export function marqueeParts(marquee: string): { top?: string; main: string; badge?: string } {
  const words = marquee.trim().split(/\s+/);
  const last = words[words.length - 1] ?? marquee;
  if (words.length > 1 && /^\d+$/.test(last)) return { main: words.slice(0, -1).join(' '), badge: last };
  if (words.length > 1) return { top: words.slice(0, -1).join(' '), main: last };
  return { main: marquee };
}

export function MarqueeLogo({ subject, className }: { subject: MarqueeSubject; className?: string }) {
  const { top, main, badge } = marqueeParts(subject.marquee);
  return (
    <span className={className ? `af-mq ${className}` : 'af-mq'} data-mq={subject.id} aria-hidden>
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
