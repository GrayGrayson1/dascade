/**
 * Final results: party podium + DASwords awards + a recap of every round.
 */
import { WORDS_MODE_INFO, type WordsPublicState, type WordsRoundSummary } from '@dascade/shared/games/words';
import { PixelIcon, Spinner } from '@dascade/ui';
import { GameStage } from '../../shell/common.tsx';
import { PartyResults, usePodium } from '../_party/index.ts';
import { ModeGlyph } from './Common.tsx';
import { useJson } from './hooks.ts';

interface Award {
  id: string;
  label: string;
  playerId: string;
  name: string;
  value: string;
}

export function WordsResults({ state, meId }: { state: WordsPublicState; meId: string | null }) {
  const podium = usePodium();
  const history = useJson<WordsRoundSummary[]>(state.historyJson, []);
  if (!podium) {
    return (
      <GameStage gameId="words">
        <div className="center-screen">
          <Spinner label="Tallying scores" />
        </div>
      </GameStage>
    );
  }
  const awards = (podium.extras?.awards as Award[] | undefined) ?? [];
  const mode = history[0]?.mode ?? 'grid';
  return (
    <PartyResults gameId="words" kicker={`DASwords · ${WORDS_MODE_INFO[mode].title} · Final standings`} podium={podium} meId={meId}>
      {awards.length ? (
        <section className="wd-awards" aria-label="Awards">
          {awards.map((a) => (
            <div key={a.id} className="wd-award" data-me={a.playerId === meId ? 'true' : undefined}>
              <PixelIcon name={a.id === 'longest' ? 'star' : a.id === 'most' ? 'trophy' : a.id === 'links' ? 'bolt' : 'sparkle'} className="wd-award__icon" />
              <span className="dc-label">{a.label}</span>
              <strong className="wd-award__name">{a.name}</strong>
              <span className="wd-award__value">{a.value}</span>
            </div>
          ))}
        </section>
      ) : null}
      {history.length ? (
        <section className="pk-panel wd-recap" aria-label="Round recap">
          <h2 className="pk-panel__title">Round recap</h2>
          <ol className="wd-recap__list">
            {history.map((h) => (
              <li key={h.round} className="wd-recap__row">
                <ModeGlyph mode={h.mode} className="wd-recap__glyph" />
                <span className="wd-recap__round dc-num">R{h.round}</span>
                <span className="wd-recap__label">{h.label}</span>
                {h.best ? (
                  <span className="wd-recap__best">
                    <strong>{h.best.word.toUpperCase()}</strong> · {h.best.name} · <span className="dc-num">{h.best.points}</span> pts
                  </span>
                ) : (
                  <span className="wd-recap__best">No words this round</span>
                )}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </PartyResults>
  );
}
