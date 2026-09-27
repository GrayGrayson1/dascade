/**
 * Final-round wager: category reveal + a private wager (game points only).
 */
import { useState } from 'react';
import { SYS } from '@dascade/shared';
import { TRIVIA_CATEGORIES, TRIVIA_MSG, type TriviaAnyCategoryId, type TriviaPrivate } from '@dascade/shared/games/trivia';
import { Button, NumberInput, Slider } from '@dascade/ui';
import { session, useRoomMessage } from '../../net/hooks.ts';
import { ArtIcon, LockNote } from '../_party/index.ts';

export function WagerPanel({
  category,
  priv,
  canWager,
  score,
}: {
  category: string;
  priv: TriviaPrivate | null;
  canWager: boolean;
  score: number;
}) {
  const meta = TRIVIA_CATEGORIES[category as TriviaAnyCategoryId] ?? TRIVIA_CATEGORIES.custom;
  const wager = priv?.wager ?? null;
  const max = wager?.max ?? 0;
  const [amount, setAmount] = useState(() => Math.round(max / 2));
  const [sent, setSent] = useState<number | null>(null);
  // A refused wager (e.g. the host paused the game) is rolled back so it can be placed again.
  useRoomMessage<{ type?: string }>(SYS.error, (e) => {
    if (e?.type === TRIVIA_MSG.wager) setSent(null);
  });
  const locked = Boolean(wager?.locked) || sent !== null;
  const clamp = (n: number) => Math.max(0, Math.min(max, Math.round(Number.isFinite(n) ? n : 0)));
  const lock = () => {
    if (!priv || locked) return;
    const v = clamp(amount);
    setSent(v);
    session.send(TRIVIA_MSG.wager, { seq: priv.seq, amount: v });
  };
  return (
    <section className="tv-wager" data-part="wager-card" aria-labelledby="tv-wager-title">
      <p className="tv-wager__kicker">Final question</p>
      <h2 id="tv-wager-title" className="tv-wager__title">
        Place your wager
      </h2>
      <div className="tv-wager__category" style={{ '--chip': meta.color } as React.CSSProperties}>
        <ArtIcon name={meta.icon} size={20} />
        <span>
          Category: <strong>{meta.title}</strong>
        </span>
      </div>
      {!canWager || !wager ? (
        <LockNote tone="warning">Players are placing their wagers…</LockNote>
      ) : locked ? (
        <LockNote tone="success">
          Wager locked: <strong className="dc-num">{(wager.locked ? wager.amount : (sent ?? 0)).toLocaleString('en-US')}</strong> points.
          Waiting for the others…
        </LockNote>
      ) : (
        <div className="tv-wager__form">
          <p className="tv-wager__help">
            You have <strong className="dc-num">{score.toLocaleString('en-US')}</strong> points. Wager 0–
            <strong className="dc-num">{max.toLocaleString('en-US')}</strong>: win it if you’re right, lose it if you’re wrong (never below
            zero).
          </p>
          <div className="tv-wager__row">
            <Slider
              aria-label="Wager amount"
              min={0}
              max={max}
              step={Math.max(1, Math.round(max / 100))}
              value={clamp(amount)}
              onChange={(v) => setAmount(v)}
            />
            <NumberInput
              aria-label="Wager points"
              className="tv-wager__num"
              value={clamp(amount)}
              min={0}
              max={max}
              step={50}
              onChange={(v) => setAmount(clamp(v))}
            />
          </div>
          <div className="tv-wager__quick" role="group" aria-label="Quick wagers">
            <Button size="sm" variant="secondary" onClick={() => setAmount(0)}>
              Play it safe (0)
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setAmount(Math.round(max / 2))}>
              Half
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setAmount(max)}>
              All in
            </Button>
          </div>
          <Button variant="gold" size="lg" icon="lock" onClick={lock}>
            Lock wager
          </Button>
        </div>
      )}
      <p className="tv-wager__note">Game points only — nothing of value is at stake.</p>
    </section>
  );
}
