/**
 * Results: every round's winners with their winning card and pattern, the final
 * standings and the revealed card seed (with a local verification of your own card).
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { BingoPublicState, BingoSettings } from '@dascade/shared/games/bingo';
import { verifyCard } from '@dascade/game-core/bingo';
import { Avatar, Badge, PixelIcon } from '@dascade/ui';
import type { GameContext } from '../../net/hooks.ts';
import { ResultsActions } from '../../shell/common.tsx';
import { Ball } from './Caller.tsx';
import { Confetti } from './Celebration.tsx';
import { WinnerCard } from './Panels.tsx';
import { BINGO_LETTERS, LETTER_COLORS, parsePlan, standings, useMyCard } from './util.ts';

export function Results({ game }: { game: GameContext<BingoPublicState, BingoSettings> }) {
  const { state, settings, playerId } = game;
  const plan = useMemo(() => parsePlan(state.planJson), [state.planJson]);
  const items = useMemo(() => settings.items ?? [], [settings.items]);
  const card = useMyCard(state.matchId);
  const rows = useMemo(() => standings(state, playerId), [state, playerId]);
  const winners = state.winners;
  const iWon = winners.some((w) => w.playerId === playerId);
  const [burst, setBurst] = useState(0);
  useEffect(() => {
    if (winners.length > 0) setBurst(1);
  }, [winners.length]);

  const verified = useMemo(() => {
    if (!card || !state.seed) return null;
    return verifyCard({ mode: state.mode, size: state.size, free: state.free, poolSize: state.poolSize }, state.seed, card.deal, card.serial, card.cells);
  }, [card, state.seed, state.mode, state.size, state.free, state.poolSize]);

  const eager = rows.filter((r) => r.falseClaims > 0).sort((a, b) => b.falseClaims - a.falseClaims)[0];
  const title = winners.length === 0 ? 'No BINGO this time' : iWon ? 'You got BINGO!' : 'BINGO!';

  return (
    <div className="bg-results">
      <Confetti burst={burst} behind />
      <header className="bg-results__hero">
        <div className="bg-results__balls" aria-hidden>
          {BINGO_LETTERS.map((l, i) => (
            <span key={l} className="bg-results__ball" style={{ '--tone': LETTER_COLORS[i], '--i': i } as CSSProperties}>
              {l}
            </span>
          ))}
        </div>
        <h1 className="dc-title bg-results__title">{title}</h1>
        <p className="bg-results__sub">
          {plan.length > 1 ? `${plan.length} rounds · ` : `${state.calls.length} call${state.calls.length === 1 ? '' : 's'} · `}
          {winners.length} winner{winners.length === 1 ? '' : 's'}
        </p>
      </header>

      <div className="bg-results__rounds">
        {plan.map((round) => {
          const roundWinners = winners.filter((w) => w.round === round.index + 1);
          return (
            <section key={round.index} className="bg-results__round dc-panel dc-panel--brackets" aria-label={plan.length > 1 ? `Round ${round.index + 1} results` : 'Game results'}>
              <header className="bg-results__round-head">
                <span className="dc-label">{plan.length > 1 ? `Round ${round.index + 1}` : 'The game'}</span>
                <strong>{round.title}</strong>
                {round.prize ? (
                  <Badge color="var(--yellow)" icon="trophy">
                    {round.prize}
                  </Badge>
                ) : null}
              </header>
              {roundWinners.length ? (
                <div className="bg-results__winners">
                  {roundWinners.map((w) => (
                    <WinnerCard key={w.playerId} winner={w} mode={state.mode} items={items} size={state.size} />
                  ))}
                </div>
              ) : (
                <p className="bg-empty-note">{state.round > round.index ? 'Nobody claimed this round.' : 'Not played — the game ended early.'}</p>
              )}
            </section>
          );
        })}
      </div>

      <div className="bg-results__extras">
        <section className="dc-panel bg-results__panel" aria-label="Final standings">
          <header className="dc-panel__header">
            <h2 className="dc-panel__title">Final standings</h2>
          </header>
          <ol className="bg-final">
            {rows.map((r, i) => (
              <li key={r.id} className="bg-final__row" data-you={r.isYou ? 'true' : undefined}>
                <span className="bg-final__rank">{i + 1}</span>
                <Avatar avatar={r.avatar} color={r.color} size={28} />
                <span className="bg-final__name">{r.name}</span>
                {r.falseClaims ? (
                  <span className="bg-leader__false" title="False alarms">
                    <PixelIcon name="warning" /> {r.falseClaims}
                  </span>
                ) : null}
                <span className="bg-final__wins">
                  <PixelIcon name="trophy" /> {r.wins}
                </span>
              </li>
            ))}
          </ol>
          {eager ? (
            <p className="bg-results__fun">
              <PixelIcon name="warning" /> Most eager dauber: <strong>{eager.name}</strong> ({eager.falseClaims} false alarm{eager.falseClaims === 1 ? '' : 's'})
            </p>
          ) : null}
        </section>

        <section className="dc-panel bg-results__panel" aria-label="Fair play">
          <header className="dc-panel__header">
            <h2 className="dc-panel__title">Fair play</h2>
          </header>
          <div className="dc-panel__body bg-fair">
            <p>Every card was dealt from this seed, and every claim was checked by the server against the real calls.</p>
            <code className="bg-fair__seed">{state.seed || '—'}</code>
            {verified === null ? null : verified ? (
              <p className="bg-fair__ok">
                <PixelIcon name="check" /> Your card #{String(card?.serial ?? 0).padStart(4, '0')} matches the seed.
              </p>
            ) : (
              <p className="bg-fair__bad">
                <PixelIcon name="warning" /> Your card doesn’t match this seed.
              </p>
            )}
            {state.calls.length ? (
              <div className="bg-fair__calls" aria-label="Final call sequence">
                {state.calls.slice(-12).map((t, i) => (
                  <Ball key={`${i}-${t}`} token={t} mode={state.mode} items={items} size="xs" animate={false} />
                ))}
                {state.calls.length > 12 ? <span className="dc-muted">+{state.calls.length - 12} earlier</span> : null}
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <ResultsActions />
    </div>
  );
}
