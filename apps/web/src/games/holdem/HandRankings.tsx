/** The hand-rankings card in the table drawer: best hand first, the hero's current hand marked. */
import { PlayingCard } from '@dascade/ui';
import { HAND_RANKINGS, cardsLabel } from './rankings.ts';

export function HandRankings({ current }: { current: string | null }) {
  return (
    <div className="hd-ranks" data-part="hand-rankings">
      <p className="hd-ranks__intro">Best hand first. You play the best five of your two cards and the five on the board.</p>
      <ol className="hd-ranks__list" aria-label="Hand rankings, best first">
        {HAND_RANKINGS.map((row, i) => {
          const mine = row.key === current;
          return (
            <li key={row.key} className="hd-ranks__row" data-current={mine ? 'true' : undefined} aria-current={mine ? 'true' : undefined}>
              <span className="hd-ranks__num" aria-hidden>
                {i + 1}
              </span>
              <span className="hd-ranks__text">
                <span className="hd-ranks__name">
                  {row.name}
                  {mine ? <span className="hd-ranks__you">Your hand</span> : null}
                </span>
                <span className="hd-ranks__blurb">{row.blurb}</span>
              </span>
              <span className="hd-ranks__cards" role="img" aria-label={`For example: ${cardsLabel(row.cards)}`}>
                {row.cards.map((c, j) => (
                  <PlayingCard key={c} code={c} width={34} dim={j >= row.made} className="hd-ranks__card" />
                ))}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="hd-ranks__foot">
        Same hand? Higher cards win, then the kickers (the dimmed cards). Suits never break a tie: an exact tie splits the pot.
      </p>
    </div>
  );
}
