/**
 * Final results: the kit podium + standings, then DASterpiece's awards and the Hall of Fame
 * (every winning answer of the match, with its prompt and author).
 */
import { useMemo } from 'react';
import { Avatar, PixelArt, PixelIcon, Spinner, type IconName } from '@dascade/ui';
import { MP_PROMPT_TYPE_INFO, type MasterpiecePublicState, type MpAwardId, type MpPodiumExtras } from '@dascade/shared/games/masterpiece';
import type { PlayerView } from '@dascade/shared';
import { GameStage } from '../../shell/common.tsx';
import { PartyResults, usePodium } from '../_party/index.ts';
import { MP_ART } from './art.tsx';
import { useHall } from './hooks.ts';

const AWARD_META: Record<MpAwardId, { title: string; blurb: string; icon: IconName }> = {
  crowd: { title: 'Crowd Favourite', blurb: 'Most votes received', icon: 'heart' },
  sweeper: { title: 'Clean Sweep', blurb: 'Most “It’s a DASterpiece!” sweeps', icon: 'sparkle' },
  consistent: { title: 'Showstopper', blurb: 'Most showdowns won', icon: 'trophy' },
  audience: { title: 'Audience Darling', blurb: 'Most audience picks', icon: 'users' },
  quick: { title: 'Quick Wit', blurb: 'Fastest to hand in', icon: 'bolt' },
};

export function MpResults({ state, players, meId }: { state: MasterpiecePublicState; players: PlayerView[]; meId: string | null }) {
  const podium = usePodium();
  const hall = useHall(state.hallJson);
  const extras = (podium?.extras ?? null) as MpPodiumExtras | null;
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const winsBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of hall) m.set(h.authorId, (m.get(h.authorId) ?? 0) + 1);
    return m;
  }, [hall]);
  const gallery = useMemo(() => [...hall].sort((a, b) => Number(b.sweep) - Number(a.sweep) || b.points - a.points || a.round - b.round).slice(0, 9), [hall]);

  if (!podium) {
    return (
      <GameStage gameId="masterpiece" className="pk-stage">
        <div className="center-screen">
          <Spinner label="Tallying the final scores" />
        </div>
      </GameStage>
    );
  }

  const awards = extras?.awards ?? [];
  return (
    <PartyResults
      gameId="masterpiece"
      kicker="DASterpiece · Final standings"
      podium={podium}
      meId={meId}
      statFor={(e) => {
        const wins = winsBy.get(e.id) ?? 0;
        return wins ? `${wins} showdown${wins === 1 ? '' : 's'} won` : null;
      }}
    >
      {awards.length > 0 ? (
        <section className="mp-awards" data-part="awards" aria-label="Awards">
          <h2 className="mp-section-title">
            <PixelArt rows={MP_ART.ribbon} className="mp-section-title__art" /> Awards
          </h2>
          <ul className="mp-awards__list">
            {awards.map((a) => {
              const meta = AWARD_META[a.id];
              const p = byId.get(a.playerId);
              return (
                <li key={a.id} className="mp-award">
                  <span className="mp-award__icon" aria-hidden="true">
                    <PixelIcon name={meta.icon} />
                  </span>
                  <span className="mp-award__text">
                    <strong>{meta.title}</strong>
                    <span className="mp-muted">{meta.blurb}</span>
                  </span>
                  <span className="mp-award__who">
                    {p ? <Avatar avatar={p.avatar} color={p.color} size={24} /> : null}
                    <span style={p ? { color: p.color } : undefined}>{a.name}</span>
                    <span className="dc-num mp-muted">{a.value}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {gallery.length > 0 ? (
        <section className="mp-hall" data-part="hall-of-fame" aria-label="Hall of Fame">
          <h2 className="mp-section-title">
            <PixelArt rows={MP_ART.frame} className="mp-section-title__art" /> Hall of Fame
            {extras?.sweeps ? (
              <span className="mp-hall__sweeps dc-num">
                {extras.sweeps} sweep{extras.sweeps === 1 ? '' : 's'}
              </span>
            ) : null}
          </h2>
          <ul className="mp-hall__grid">
            {gallery.map((h, i) => {
              const p = byId.get(h.authorId);
              return (
                <li key={`${h.round}-${i}`} className="mp-hall__item" data-sweep={h.sweep ? 'true' : undefined}>
                  <span className="mp-hall__theme">
                    {MP_PROMPT_TYPE_INFO[h.type].label} · Exhibition <span className="dc-num">{h.round}</span>
                  </span>
                  <p className="mp-hall__prompt">{h.prompt}</p>
                  <blockquote className="mp-hall__text">{h.text}</blockquote>
                  <p className="mp-hall__author">
                    {p ? <Avatar avatar={p.avatar} color={p.color} size={20} /> : null}
                    <strong style={p ? { color: p.color } : undefined}>{h.authorName}</strong>
                    <span className="dc-num">+{h.points.toLocaleString('en-US')}</span>
                    {h.sweep ? <span className="mp-badge mp-badge--sweep">Sweep</span> : null}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </PartyResults>
  );
}
