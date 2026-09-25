/**
 * In-game panels: caller, required pattern, host controls, leaderboard and intermission.
 */
import { useState, type CSSProperties } from 'react';
import { BINGO_LIMITS, BINGO_MSG, type BingoPlanRound, type BingoPublicState, type BingoWinnerView } from '@dascade/shared/games/bingo';
import { Avatar, Badge, Button, IconButton, PixelIcon, Segmented, Slider, cx } from '@dascade/ui';
import { useCountdown } from '../../net/hooks.ts';
import { Ball, CallTimer } from './Caller.tsx';
import { BingoCardView, PatternCycler } from './Card.tsx';
import { maskOf, tokenLabel, tokenText, useDebouncedCommit, type Standing } from './util.ts';

// ---------------------------------------------------------------------------
// Caller
// ---------------------------------------------------------------------------

export function CallerPanel({
  state,
  items,
  serverNow,
  voice,
  onVoice,
  voiceAvailable,
  onFirstCall,
}: {
  state: BingoPublicState;
  items: readonly string[];
  serverNow: () => number;
  onFirstCall?: () => void;
  voice: boolean;
  onVoice: (on: boolean) => void;
  voiceAvailable: boolean;
}) {
  const calls = state.calls;
  const latest = calls.length ? (calls[calls.length - 1] as number) : null;
  const recent = calls.slice(-6, -1).reverse();
  const nextIn = useCountdown(state.nextCallAt || null);
  const remaining = state.nextCallAt ? Math.max(0, state.nextCallAt - serverNow()) : 0;
  const status =
    state.roundStatus === 'claiming'
      ? 'BINGO called — checking for ties…'
      : state.roundStatus === 'closed'
        ? 'Round over'
        : state.paused
          ? 'Paused by the host'
          : state.callerMode === 'manual'
            ? 'The host is calling'
            : state.nextCallAt
              ? `Next call in ${Math.ceil(nextIn / 1000)}s`
              : calls.length >= state.poolSize
                ? 'Every ball is out!'
                : 'Shuffling the balls…';
  return (
    <section className="bg-caller" aria-label="Caller">
      <div className="bg-caller__stage">
        <CallTimer key={state.nextCallAt} remainingMs={remaining} intervalMs={state.callIntervalMs} />
        <Ball key={`${calls.length}:${latest ?? 'none'}`} token={latest} mode={state.mode} items={items} />
      </div>
      <div className="bg-caller__plaque" aria-live="polite">
        <span className="dc-label">{calls.length ? `Call ${calls.length} of ${state.poolSize}` : 'Caller'}</span>
        <strong className={cx('bg-caller__label', state.mode === 'text' && 'bg-caller__label--text')}>
          {latest === null ? 'Get ready…' : state.mode === 'numbers' ? tokenLabel('numbers', latest, items).replace(' ', '-') : tokenText('text', latest, items)}
        </strong>
        {onFirstCall ? (
          <Button className="bg-caller__first" variant="primary" icon="bolt" onClick={onFirstCall}>
            Call the first ball
          </Button>
        ) : (
          <span className="bg-caller__status" data-paused={state.paused ? 'true' : undefined}>
            {state.paused ? <PixelIcon name="pause" /> : <PixelIcon name="clock" />} {status}
          </span>
        )}
      </div>
      <div className="bg-caller__recent" aria-label="Previous calls">
        {recent.map((t, i) => (
          <Ball key={`${calls.length - 1 - i}:${t}`} token={t} mode={state.mode} items={items} size="xs" animate={false} />
        ))}
      </div>
      {voiceAvailable ? (
        <IconButton
          className="bg-caller__voice"
          icon={voice ? 'sound-on' : 'sound-off'}
          label={voice ? 'Turn off the voice caller' : 'Turn on the voice caller'}
          size="sm"
          aria-pressed={voice}
          onClick={() => onVoice(!voice)}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Required pattern
// ---------------------------------------------------------------------------

export function PatternPanel({
  round,
  roundNo,
  totalRounds,
  size,
  freeIndex,
  compact,
}: {
  round: BingoPlanRound | undefined;
  roundNo: number;
  totalRounds: number;
  size: number;
  freeIndex: number | null;
  compact?: boolean;
}) {
  if (!round) return null;
  const shown = round.patterns.slice(0, compact ? 1 : 4);
  return (
    <section className={cx('bg-pattern', compact && 'bg-pattern--compact')} aria-label="Winning pattern">
      <div className="bg-pattern__head">
        <span className="dc-label">
          <span className="bg-pattern__long">{totalRounds > 1 ? `Round ${roundNo} of ${totalRounds}` : 'To win'}</span>
          <span className="bg-pattern__short">{totalRounds > 1 ? `Round ${roundNo}/${totalRounds}` : 'To win'}</span>
        </span>
        {round.prize ? (
          <Badge color="var(--yellow)" icon="trophy">
            {round.prize}
          </Badge>
        ) : null}
      </div>
      <div className="bg-pattern__list" data-count={shown.length}>
        {shown.map((p, i) => (
          <figure key={`${p.name}-${i}`} className="bg-pattern__item">
            <PatternCycler size={size} masks={p.masks} freeIndex={freeIndex} className="bg-pgrid--hero" label={`${p.name} pattern`} />
            <figcaption>
              <span className="bg-pattern__name">{p.name}</span>
              <span className="bg-pattern__tags">
                {p.family ? <Badge color="var(--accent)">Any of {p.masks.length}</Badge> : null}
                {p.rotate ? <Badge color="var(--accent-2)">Rotations</Badge> : null}
                {p.mirror ? <Badge color="var(--accent-2)">Mirrors</Badge> : null}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
      {round.patterns.length > shown.length ? (
        <p className="bg-pattern__more">
          or {round.patterns.length - shown.length} more pattern{round.patterns.length - shown.length === 1 ? '' : 's'} — any one wins
        </p>
      ) : round.patterns.length > 1 ? (
        <p className="bg-pattern__more">Any one of these wins</p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Host controls
// ---------------------------------------------------------------------------

export function HostControls({ state, send, phase }: { state: BingoPublicState; send: (type: string, payload?: unknown) => void; phase: string }) {
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [speed, setSpeed] = useDebouncedCommit(Math.round(state.callIntervalMs / 1000), (seconds) => send(BINGO_MSG.speed, { seconds }), 250);
  const calling = phase === 'PLAYING' && state.roundStatus === 'calling';
  const bagEmpty = state.calls.length >= state.poolSize;
  return (
    <section className="bg-host" aria-label="Host controls">
      <div className="bg-host__row">
        <span className="dc-label">
          <PixelIcon name="crown" /> Host controls
        </span>
      </div>
      <Segmented
        label="Caller mode"
        value={state.callerMode}
        options={[
          { value: 'auto', label: 'Auto caller' },
          { value: 'manual', label: 'Manual' },
        ]}
        onChange={(mode) => send(BINGO_MSG.callerMode, { mode })}
      />
      {state.callerMode === 'auto' ? (
        <>
          <div className="bg-host__row">
            <Button
              size="sm"
              variant={state.paused ? 'primary' : 'secondary'}
              icon={state.paused ? 'play' : 'pause'}
              onClick={() => send(BINGO_MSG.pause, { paused: !state.paused })}
            >
              {state.paused ? 'Resume' : 'Pause'}
            </Button>
            <Button size="sm" variant="ghost" icon="bolt" disabled={!calling || bagEmpty} onClick={() => send(BINGO_MSG.call, {})}>
              Call now
            </Button>
          </div>
          <label className="bg-host__speed">
            <span className="dc-label">Call every {speed}s</span>
            <Slider value={speed} min={BINGO_LIMITS.minCallSeconds} max={BINGO_LIMITS.maxCallSeconds} onChange={setSpeed} aria-label="Seconds between calls" />
          </label>
        </>
      ) : (
        <div className="bg-host__row">
          <Button size="md" variant="primary" icon="bolt" disabled={!calling || bagEmpty} onClick={() => send(BINGO_MSG.call, {})}>
            Call next
          </Button>
          {state.manualPick ? (
            // Only hand-picked balls can be taken back; random draws are final.
            <Button size="sm" variant="ghost" icon="arrow-left" disabled={!state.canUndo} onClick={() => send(BINGO_MSG.undo, {})}>
              Undo last pick
            </Button>
          ) : null}
        </div>
      )}
      {state.callerMode === 'manual' && state.manualPick ? <p className="bg-host__hint">Tip: tap any unlit ball on the call board to call it. Hand-picking balls takes you out of the running for the round.</p> : null}
      <div className="bg-host__row">
        {phase === 'INTERMISSION' ? (
          <Button size="sm" variant="primary" icon="play" onClick={() => send(BINGO_MSG.nextRound, {})}>
            Start next round
          </Button>
        ) : null}
        {confirmEnd ? (
          <span className="dc-row" role="group" aria-label="Confirm end game">
            <Button size="sm" variant="danger" onClick={() => send(BINGO_MSG.endGame, {})}>
              End game now
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmEnd(false)}>
              Keep playing
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" icon="flag" onClick={() => setConfirmEnd(true)}>
            End game
          </Button>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export function Leaderboard({ rows, showProgress, now }: { rows: Standing[]; showProgress: boolean; now: number }) {
  if (rows.length === 0) return <p className="bg-empty-note">No players seated.</p>;
  return (
    <ol className="bg-leader" aria-label="Players">
      {rows.map((r) => {
        const locked = r.lockedUntil > now;
        return (
          <li key={r.id} className={cx('bg-leader__row', r.isYou && 'is-you', !r.connected && 'is-away')}>
            <Avatar avatar={r.avatar} color={r.color} size={28} offline={!r.connected} />
            <span className="bg-leader__name">
              {r.name}
              {r.isYou ? <Badge color="var(--cyan)">You</Badge> : null}
            </span>
            <span className="bg-leader__stats">
              {locked ? (
                <Badge color="var(--red)" icon="lock">
                  Benched
                </Badge>
              ) : null}
              {r.falseClaims > 0 ? (
                <span className="bg-leader__false" title={`${r.falseClaims} false alarm${r.falseClaims === 1 ? '' : 's'}`}>
                  <PixelIcon name="warning" /> {r.falseClaims}
                </span>
              ) : null}
              {showProgress && r.need >= 0 ? (
                <span className="bg-need" data-hot={r.need <= 1 ? 'true' : undefined} data-zero={r.need === 0 ? 'true' : undefined}>
                  {r.need === 0 ? 'BINGO?!' : `${r.need} to go`}
                </span>
              ) : null}
              {r.wins > 0 ? (
                <span className="bg-leader__wins" aria-label={`${r.wins} win${r.wins === 1 ? '' : 's'}`}>
                  <PixelIcon name="trophy" /> {r.wins}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Winners (intermission + results)
// ---------------------------------------------------------------------------

export function WinnerCard({
  winner,
  mode,
  items,
  size,
}: {
  winner: BingoWinnerView;
  mode: 'numbers' | 'text';
  items: readonly string[];
  size: number;
}) {
  const mask = maskOf(winner.mask);
  const marks = new Set(mask.flatMap((on, i) => (on ? [i] : [])));
  return (
    <article className="bg-winner" style={{ '--player': winner.color } as CSSProperties}>
      <header className="bg-winner__head">
        <Avatar avatar={winner.avatar} color={winner.color} size={34} />
        <div>
          <strong className="bg-winner__name">{winner.name}</strong>
          <span className="bg-winner__meta">
            {winner.patternName} · call #{winner.callCount}
          </span>
        </div>
      </header>
      <BingoCardView
        size={size}
        cells={winner.cells}
        mode={mode}
        items={items}
        called={new Set()}
        marks={marks}
        highlight={mask}
        compact
        serial={winner.serial}
        label={`${winner.name}'s winning card`}
      />
    </article>
  );
}

export function Intermission({
  state,
  plan,
  items,
  isHost,
  send,
  freeIndex,
}: {
  state: BingoPublicState;
  plan: BingoPlanRound[];
  items: readonly string[];
  isHost: boolean;
  send: (type: string, payload?: unknown) => void;
  freeIndex: number | null;
}) {
  const left = useCountdown(state.phaseEndsAt);
  const done = state.round;
  const next = plan[done];
  const winners = state.winners.filter((w) => w.round === done);
  return (
    <div className="bg-inter" role="dialog" aria-modal="false" aria-labelledby="bg-inter-title">
      <div className="bg-inter__panel dc-panel dc-panel--glow dc-panel--brackets">
        <p className="dc-label">Round {done} complete</p>
        <h2 id="bg-inter-title" className="bg-inter__title">
          {winners.length === 0 ? 'No winner this round' : winners.length === 1 ? `${winners[0]!.name} wins!` : `${winners.length} winners share it!`}
        </h2>
        {winners.length > 0 ? (
          <div className="bg-inter__winners" data-count={Math.min(3, winners.length)}>
            {winners.slice(0, 3).map((w) => (
              <WinnerCard key={w.playerId} winner={w} mode={state.mode} items={items} size={state.size} />
            ))}
            {winners.length > 3 ? <p className="dc-muted">+ {winners.slice(3).map((w) => w.name).join(', ')}</p> : null}
          </div>
        ) : null}
        {next ? (
          <div className="bg-inter__next">
            <PatternCycler size={state.size} masks={next.patterns[0]?.masks ?? []} freeIndex={freeIndex} className="bg-pgrid--sm" label={`${next.title} pattern`} />
            <div>
              <span className="dc-label">Up next · round {done + 1}</span>
              <strong>{next.title}</strong>
              {next.prize ? <span className="dc-muted"> · {next.prize}</span> : null}
            </div>
            <span className="bg-inter__count" aria-label={`Starts in ${Math.ceil(left / 1000)} seconds`}>
              {Math.ceil(left / 1000)}
            </span>
          </div>
        ) : null}
        {isHost ? (
          <Button variant="primary" icon="play" onClick={() => send(BINGO_MSG.nextRound, {})}>
            Start round {done + 1} now
          </Button>
        ) : null}
      </div>
    </div>
  );
}
