/**
 * Overlays rendered inside the canvas frame: word choice (artist), "choosing…" (everyone
 * else), the turn reveal with points, a round banner and the correct-guess burst.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Avatar, Badge, PixelArt, PixelIcon, ProgressBar } from '@dascade/ui';
import type { PlayerView } from '@dascade/shared';
import {
  DASKETCH_MSG,
  SKETCH_CATEGORY_LABELS,
  type DasketchPublicState,
  type SketchChoice,
  type SketchGameEvent,
} from '@dascade/shared/games/dasketch';
import { useCountdown, useRoomMessage, session } from '../../net/hooks.ts';
import { sfx } from '../../audio/audio.ts';
import { SKETCH_ICONS } from './icons.ts';
import { useSketchFx } from './hooks.ts';

export function ChooseWordOverlay({ choices, endsAt }: { choices: SketchChoice[]; endsAt: number }) {
  const remaining = useCountdown(endsAt, true);
  const [total] = useState(() => Math.max(1000, remaining));
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <div className="sk-overlay sk-overlay--choose" role="dialog" aria-modal="false" aria-labelledby="sk-choose-title">
      <div className="sk-card sk-card--choose" data-part="prompt-card">
        <PixelArt rows={SKETCH_ICONS.easel} className="sk-card__art" />
        <h2 id="sk-choose-title" className="sk-card__title">
          Pick your word
        </h2>
        <p className="sk-card__sub">Only you can see these. No letters or numbers in your drawing!</p>
        <div className="sk-choices" data-part="answer-grid">
          {choices.map((c, i) => (
            <button
              key={c.word}
              type="button"
              className="sk-choice"
              data-part="word-card"
              aria-label={`Draw “${c.word}”`}
              disabled={picked !== null}
              data-picked={picked === i ? 'true' : undefined}
              style={{ '--i': i } as CSSProperties}
              onClick={() => {
                setPicked(i);
                sfx('select');
                session.send(DASKETCH_MSG.choose, { index: i });
              }}
            >
              <span className="sk-choice__word">{c.word}</span>
              <span className="sk-choice__cat">{c.category === 'custom' ? 'Custom word' : SKETCH_CATEGORY_LABELS[c.category]}</span>
            </button>
          ))}
        </div>
        <div className="sk-card__timer">
          <ProgressBar value={remaining / total} label="Time left to choose" />
          <span className="dc-num">{Math.ceil(remaining / 1000)}s · a word is picked for you when time runs out</span>
        </div>
      </div>
    </div>
  );
}

export function WaitingOverlay({ artist, round, totalRounds }: { artist: PlayerView | undefined; round: number; totalRounds: number }) {
  return (
    <div className="sk-overlay sk-overlay--wait" aria-live="polite">
      <div className="sk-card sk-card--wait" data-part="prompt-card">
        <span className="dc-label">
          Round {Math.max(1, round)} of {Math.max(1, totalRounds)}
        </span>
        {artist ? <Avatar avatar={artist.avatar} color={artist.color} size={64} /> : null}
        <h2 className="sk-card__title">
          <span style={{ color: artist?.color }}>{artist?.name ?? 'The artist'}</span> is choosing a word
          <span className="sk-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </h2>
        <p className="sk-card__sub">Get your guessing fingers ready.</p>
      </div>
    </div>
  );
}

export function GetReadyOverlay() {
  return (
    <div className="sk-overlay sk-overlay--ready">
      <div className="sk-card sk-card--wait" data-part="prompt-card">
        <PixelArt rows={SKETCH_ICONS.easel} className="sk-card__art" />
        <h2 className="sk-card__title">Sharpen your pencils</h2>
        <p className="sk-card__sub">The first artist is up in a moment.</p>
      </div>
    </div>
  );
}

const REASON_TEXT: Record<string, string> = {
  all: 'Everyone got it!',
  time: 'Time’s up!',
  artist_left: 'The artist left the room.',
  empty: 'No guessers left.',
};

export function RevealOverlay({ state, players, meId }: { state: DasketchPublicState; players: PlayerView[]; meId: string | null }) {
  const gains = useMemo(() => {
    return players
      .filter((p) => !p.spectator)
      .map((p) => ({ p, sk: state.sketch?.[p.id] }))
      .filter(({ p, sk }) => (sk?.turnPoints ?? 0) > 0 || p.id === state.artistId)
      .sort((a, b) => (b.sk?.turnPoints ?? 0) - (a.sk?.turnPoints ?? 0));
  }, [players, state.sketch, state.artistId]);
  const shown = gains.slice(0, 6);
  const nobody = state.guessedCount === 0;
  return (
    <div className="sk-overlay sk-overlay--reveal" aria-live="polite">
      <div className="sk-card sk-card--reveal" data-part="reveal-card">
        <span className="dc-label">{REASON_TEXT[state.revealReason] ?? 'Turn over'}</span>
        <p className="sk-reveal__lead">The word was</p>
        <h2 className="sk-reveal__word">{state.word || '—'}</h2>
        {nobody ? (
          <p className="sk-card__sub">Nobody got it this time. Tough one!</p>
        ) : (
          <p className="sk-card__sub">
            {state.guessedCount} of {Math.max(state.eligibleCount, state.guessedCount)} guessed it
          </p>
        )}
        {shown.length > 0 ? (
          <ul className="sk-gains">
            {shown.map(({ p, sk }) => (
              <li key={p.id} className="sk-gain" data-me={p.id === meId ? 'true' : undefined}>
                <Avatar avatar={p.avatar} color={p.color} size={24} />
                <span className="sk-gain__name">{p.name}</span>
                {p.id === state.artistId ? (
                  <Badge color="var(--accent)" icon="pencil">
                    Artist
                  </Badge>
                ) : sk?.rank ? (
                  <Badge color="var(--green)">#{sk.rank}</Badge>
                ) : null}
                <span className="sk-gain__pts dc-num">+{sk?.turnPoints ?? 0}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {gains.length > shown.length ? <p className="sk-card__sub">and {gains.length - shown.length} more</p> : null}
      </div>
    </div>
  );
}

/** "ROUND 2" sticker when a new round starts (never shown over the artist's word choices). */
export function RoundBanner({ hidden }: { hidden: boolean }) {
  const [banner, setBanner] = useState<{ round: number; total: number; key: number } | null>(null);
  useRoomMessage<SketchGameEvent>(DASKETCH_MSG.event, (e) => {
    if (e.type === 'round') setBanner({ round: e.round, total: e.totalRounds, key: Date.now() });
  });
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 2200);
    return () => clearTimeout(t);
  }, [banner]);
  if (!banner || hidden) return null;
  return (
    <div className="sk-banner" key={banner.key} role="status">
      <span className="sk-banner__label">{banner.round === banner.total ? 'Final round' : 'Round'}</span>
      <span className="sk-banner__num">
        {banner.round}
        <small>/{banner.total}</small>
      </span>
    </div>
  );
}

/** Floating "+points" and pixel confetti when *I* guess correctly. */
export function CorrectBurst({ meId }: { meId: string | null }) {
  const fx = useSketchFx();
  const [burst, setBurst] = useState<{ points: number; key: number } | null>(null);
  useRoomMessage<SketchGameEvent>(DASKETCH_MSG.event, (e) => {
    if (e.type === 'correct' && e.playerId === meId) setBurst({ points: e.points, key: Date.now() });
  });
  useEffect(() => {
    if (!burst) return;
    const t = setTimeout(() => setBurst(null), 1800);
    return () => clearTimeout(t);
  }, [burst]);
  const bits = useMemo(
    () =>
      Array.from({ length: fx.particles }, (_, i) => ({
        x: Math.cos((i / Math.max(1, fx.particles)) * Math.PI * 2) * (80 + (i % 5) * 26),
        y: Math.sin((i / Math.max(1, fx.particles)) * Math.PI * 2) * (60 + (i % 4) * 22) - 30,
        c: ['#ff4fd8', '#ffd23f', '#22d3ee', '#2de38f'][i % 4],
      })),
    [fx.particles],
  );
  if (!burst) return null;
  return (
    <div className="sk-burst" key={burst.key} data-motion={fx.motion ? 'true' : undefined} aria-hidden="true">
      <span className="sk-burst__pts">
        <PixelIcon name="check" /> +{burst.points}
      </span>
      {fx.motion ? bits.map((b, i) => <i key={i} className="sk-burst__bit" style={{ '--x': `${b.x}px`, '--y': `${b.y}px`, '--c': b.c } as CSSProperties} />) : null}
    </div>
  );
}
