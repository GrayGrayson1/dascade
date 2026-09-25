/**
 * Final standings: podium, full ranking, awards and a gallery of this match's drawings.
 */
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { Avatar, PixelArt, PixelIcon, cx, type IconName } from '@dascade/ui';
import { ordinal } from '@dascade/shared';
import type { SketchAwardId } from '@dascade/shared/games/dasketch';
import { GameStage, ResultsActions } from '../../shell/common.tsx';
import { sfx } from '../../audio/audio.ts';
import { parseAwards, parseHistory, useSketchFx, useSketchGame } from './hooks.ts';
import { useGallery } from './gallery.ts';
import { SKETCH_ICONS } from './icons.ts';

const AWARD_META: Record<SketchAwardId, { title: string; blurb: string; icon: IconName }> = {
  fastest: { title: 'Quick Draw', blurb: 'Fastest correct guess', icon: 'bolt' },
  artist: { title: 'Master Artist', blurb: 'Most guesses on their drawings', icon: 'star' },
  sharp: { title: 'Sharp Eye', blurb: 'Most words guessed', icon: 'eye' },
};

export function SketchResults() {
  const game = useSketchGame();
  const gallery = useGallery();
  const fx = useSketchFx();
  const played = useRef(false);

  const standings = useMemo(() => {
    if (!game) return [];
    const seated = game.players.filter((p) => !p.spectator);
    const sorted = [...seated].sort((a, b) => b.score - a.score || a.joinOrder - b.joinOrder);
    let place = 0;
    let prev: number | null = null;
    return sorted.map((p, i) => {
      if (prev === null || p.score !== prev) place = i + 1;
      prev = p.score;
      return { p, place };
    });
  }, [game]);

  const myPlace = standings.find((s) => s.p.id === game?.playerId)?.place ?? 0;
  useEffect(() => {
    if (played.current || standings.length === 0) return;
    played.current = true;
    sfx(myPlace === 1 ? 'bigwin' : 'win');
  }, [myPlace, standings.length]);

  if (!game) return null;
  const history = parseHistory(game.state.historyJson);
  const awards = parseAwards(game.state.awardsJson);
  const podium = [standings[1], standings[0], standings[2]].filter(Boolean) as typeof standings;
  const rest = standings.slice(3);
  const confetti = fx.particles > 0 && fx.motion;

  return (
    <GameStage gameId="dasketch" className="sk-stage sk-results">
      <div className="sk-results__inner">
        <header className="sk-results__head">
          <span className="dc-label">DASketch · Final standings</span>
          <h1 className="sk-results__title">
            {standings[0] ? (
              <>
                <span style={{ color: standings[0].p.color }}>{standings[0].p.name}</span> takes the gallery!
              </>
            ) : (
              'That’s a wrap!'
            )}
          </h1>
          <p className="dc-muted">
            {game.state.round} round{game.state.round === 1 ? '' : 's'} · {history.length} drawing{history.length === 1 ? '' : 's'}
            {myPlace ? ` · You finished ${ordinal(myPlace)}` : ''}
          </p>
        </header>

        <section className="sk-podium" aria-label="Podium">
          {confetti ? (
            <div className="sk-confetti" aria-hidden="true">
              {Array.from({ length: Math.round(fx.particles * 1.4) }, (_, i) => (
                <i
                  key={i}
                  style={
                    {
                      '--x': `${(i * 37) % 100}%`,
                      '--dur': `${2.6 + ((i * 7) % 10) * 0.18}s`,
                      '--delay': `${((i * 3) % 12) * 0.2}s`,
                      '--c': ['#ff4fd8', '#ffd23f', '#22d3ee', '#2de38f', '#a78bfa'][i % 5],
                    } as CSSProperties
                  }
                />
              ))}
            </div>
          ) : null}
          {podium.map(({ p, place }) => (
            <div key={p.id} className={cx('sk-podium__slot', `sk-podium__slot--${place}`, p.id === game.playerId && 'is-me')} style={{ '--player': p.color } as CSSProperties}>
              {place === 1 ? <PixelIcon name="crown" className="sk-podium__crown" title="Winner" /> : null}
              <Avatar avatar={p.avatar} color={p.color} size={place === 1 ? 76 : 58} />
              <span className="sk-podium__name">{p.name}</span>
              <span className="sk-podium__score dc-num">{p.score.toLocaleString('en-US')} pts</span>
              <div className="sk-podium__block">
                <span className="sk-podium__place">{place}</span>
              </div>
            </div>
          ))}
        </section>

        <div className="sk-results__grid">
          {rest.length > 0 ? (
            <section className="sk-panel" aria-label="Full standings">
              <h2 className="sk-panel__title">Standings</h2>
              <ol className="sk-standings">
                {rest.map(({ p, place }) => (
                  <li key={p.id} className={cx('sk-standing', p.id === game.playerId && 'is-me')}>
                    <span className="sk-standing__place">{ordinal(place)}</span>
                    <Avatar avatar={p.avatar} color={p.color} size={28} />
                    <span className="sk-standing__name">{p.name}</span>
                    <span className="sk-standing__score dc-num">{p.score.toLocaleString('en-US')}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {awards.length > 0 ? (
            <section className="sk-panel" aria-label="Awards">
              <h2 className="sk-panel__title">Awards</h2>
              <ul className="sk-awards">
                {awards.map((a) => {
                  const meta = AWARD_META[a.id];
                  const player = game.state.players[a.playerId];
                  return (
                    <li key={a.id} className="sk-award">
                      <span className="sk-award__icon">
                        <PixelIcon name={meta.icon} />
                      </span>
                      <span className="sk-award__text">
                        <strong>{meta.title}</strong>
                        <span className="dc-muted">{meta.blurb}</span>
                      </span>
                      <span className="sk-award__who">
                        <span style={{ color: player?.color }}>{a.name}</span>
                        <span className="dc-num">{a.value}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>

        {history.length > 0 ? (
          <section className="sk-gallery" aria-label="Tonight’s drawings">
            <h2 className="sk-panel__title">
              <PixelArt rows={SKETCH_ICONS.easel} className="sk-gallery__icon" /> Tonight’s gallery
            </h2>
            <ul className="sk-gallery__grid">
              {history.map((h) => {
                const shot = gallery.find((g) => g.turn === h.turn);
                return (
                  <li key={h.turn} className="sk-frame">
                    {shot ? (
                      <img src={shot.src} alt={`${h.artistName}’s drawing of ${h.word}`} className="sk-frame__img" loading="lazy" />
                    ) : (
                      <div className="sk-frame__img sk-frame__img--empty" aria-hidden="true">
                        <PixelArt rows={SKETCH_ICONS.easel} />
                      </div>
                    )}
                    <div className="sk-frame__plate">
                      <strong>{h.word}</strong>
                      <span>
                        by {h.artistName} · {h.guessers}/{Math.max(h.eligible, h.guessers)} guessed
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <ResultsActions />
      </div>
    </GameStage>
  );
}
