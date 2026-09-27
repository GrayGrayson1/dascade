/**
 * Top HUD: round counter, the word (tiles for guessers, the word for the artist and
 * players who got it) and the turn timer.
 */
import { useEffect, useRef, type CSSProperties } from 'react';
import { TimerRing, cx } from '@dascade/ui';
import { wordLengths } from '@dascade/game-core/dasketch';
import { isHintLetter, type DasketchPublicState, type SketchPrivate } from '@dascade/shared/games/dasketch';
import { useCountdown } from '../../net/hooks.ts';
import { sfx } from '../../audio/audio.ts';

export function WordTiles({ pattern, tone = 'hidden', label }: { pattern: string; tone?: 'hidden' | 'known' | 'reveal'; label: string }) {
  const chars = Array.from(pattern);
  const letters = chars.filter((c) => c !== ' ').length;
  return (
    <div className="sk-tiles" data-part="word-card" data-tone={tone} role="img" aria-label={label} style={{ '--n': Math.max(letters, 4) } as CSSProperties}>
      {pattern.split(' ').map((word, wi) => (
        <span key={wi} className="sk-tiles__word">
          {Array.from(word).map((ch, i) => {
            const hidden = ch === '_';
            const letter = !hidden && isHintLetter(ch);
            return (
              <span key={i} className={cx('sk-tile', hidden && 'sk-tile--blank', !hidden && !letter && 'sk-tile--mark', letter && 'sk-tile--letter')} aria-hidden="true">
                {hidden ? '' : ch}
              </span>
            );
          })}
        </span>
      ))}
    </div>
  );
}

function describePattern(pattern: string): string {
  const lengths = wordLengths(pattern);
  const revealed = Array.from(pattern).filter((c) => c !== '_' && c !== ' ' && isHintLetter(c)).join('');
  const parts = lengths.length > 1 ? `${lengths.length} words: ${lengths.join(', ')} letters` : `${lengths[0] ?? 0} letters`;
  return `Hidden word, ${parts}${revealed ? `. Revealed letters: ${revealed.toUpperCase()}` : ''}`;
}

export function SketchTimer({ endsAt, stage }: { endsAt: number; stage: string }) {
  const remaining = useCountdown(endsAt || null);
  const total = useRef({ endsAt: 0, ms: 1 });
  if (total.current.endsAt !== endsAt) total.current = { endsAt, ms: Math.max(1, remaining) };
  const seconds = Math.ceil(remaining / 1000);
  const lastTick = useRef(-1);
  useEffect(() => {
    if (stage !== 'drawing' || seconds <= 0 || seconds > 10 || seconds === lastTick.current) return;
    lastTick.current = seconds;
    sfx('tick');
  }, [seconds, stage]);
  if (!endsAt) return <div className="sk-timer sk-timer--idle" data-part="timer" aria-hidden="true" />;
  return (
    <div className="sk-timer" data-part="timer">
      <TimerRing seconds={seconds} progress={remaining / total.current.ms} urgentAt={stage === 'drawing' ? 10 : 3} size={56} label={stage === 'choosing' ? 'Time to choose' : 'Time left to draw'} />
    </div>
  );
}

export function SketchHud({ state, priv, artistName, isArtist }: { state: DasketchPublicState; priv: SketchPrivate | null; artistName: string; isArtist: boolean }) {
  const stage = state.stage;
  const known = priv?.word ?? null;
  let label = 'Get ready';
  let body: React.ReactNode = <span className="sk-hud__status">Sharpen your pencils…</span>;

  if (stage === 'choosing') {
    label = isArtist ? 'Your turn' : 'Up next';
    body = <span className="sk-hud__status">{isArtist ? 'Pick a word to draw' : `${artistName} is choosing a word…`}</span>;
  } else if (stage === 'drawing') {
    if (isArtist && known) {
      label = 'Draw this';
      body = <WordTiles pattern={known} tone="known" label={`Your word: ${known}`} />;
    } else if (known) {
      label = 'You got it!';
      body = <WordTiles pattern={known} tone="known" label={`You guessed it: ${known}`} />;
    } else {
      label = 'Guess the word';
      body = <WordTiles pattern={state.hint} label={describePattern(state.hint)} />;
    }
  } else if (stage === 'reveal') {
    label = 'The word was';
    body = <WordTiles pattern={state.word} tone="reveal" label={`The word was ${state.word}`} />;
  }

  const lengths = stage === 'drawing' && !known ? wordLengths(state.hint) : [];
  return (
    <header className="sk-hud" data-part="hud" data-stage={stage}>
      <div className="sk-hud__round">
        <span className="dc-label">Round</span>
        <span className="sk-hud__round-num" key={state.round}>
          {Math.max(1, state.round)}
          <small>/{Math.max(1, state.totalRounds)}</small>
        </span>
      </div>
      <div className="sk-hud__word" aria-live="polite">
        <span className="dc-label sk-hud__label">
          {label}
          {lengths.length > 0 ? <span className="sk-hud__len">{lengths.join(' · ')}</span> : null}
        </span>
        {body}
      </div>
      <SketchTimer endsAt={stage === 'choosing' || stage === 'drawing' ? state.phaseEndsAt : 0} stage={stage} />
    </header>
  );
}
