/**
 * Final results: the kit's podium + standings, then DAS Survey's awards (prediction skills only)
 * and "your room in numbers" — aggregate highlights that never reveal individual answers.
 */
import type { SurveyAward, SurveyPodiumExtras, SurveyRecapItem } from '@dascade/shared/games/survey';
import { PixelIcon, Spinner, type IconName } from '@dascade/ui';
import { GameStage, ResultsActions } from '../../shell/common.tsx';
import { PartyResults, usePodium } from '../_party/index.ts';
import { useSurveyGame } from './hooks.ts';

const AWARD_INFO: Record<SurveyAward['id'], { title: string; icon: IconName; blurb: string }> = {
  'mind-reader': { title: 'Mind Reader', icon: 'crown', blurb: 'Most majority calls' },
  barometer: { title: 'Human Barometer', icon: 'sparkle', blurb: 'Closest percentage guesses' },
  ranker: { title: 'Room Ranker', icon: 'trophy', blurb: 'Most accurate rankings' },
  bold: { title: 'Bold Caller', icon: 'bolt', blurb: 'Right when most were wrong' },
};

const RECAP_ICON: Record<SurveyRecapItem['id'], IconName> = {
  united: 'users',
  divided: 'flag',
  surprise: 'star',
};

export function SurveyResults() {
  const game = useSurveyGame();
  const podium = usePodium();
  if (!game || !podium) {
    return (
      <GameStage gameId="survey" className="sv-stage">
        <div className="center-screen">
          <Spinner label="Tallying the room" />
          <ResultsActions />
        </div>
      </GameStage>
    );
  }
  const extras = (podium.extras ?? {}) as Partial<SurveyPodiumExtras>;
  const awards = extras.awards ?? [];
  const recap = extras.recap ?? [];
  return (
    <PartyResults gameId="survey" kicker="DAS Survey · Final standings" podium={podium} meId={game.playerId}>
      {awards.length > 0 ? (
        <section className="pk-panel sv-awards" aria-label="Awards">
          <h2 className="pk-panel__title">Awards</h2>
          <ul className="sv-awards__list">
            {awards.map((a) => {
              const info = AWARD_INFO[a.id];
              return (
                <li key={a.id} className="sv-award" data-award={a.id}>
                  <span className="sv-award__icon" aria-hidden="true">
                    <PixelIcon name={info.icon} />
                  </span>
                  <span className="sv-award__title">{info.title}</span>
                  <span className="sv-award__names">{a.names.join(', ')}</span>
                  <span className="sv-award__value">{a.value}</span>
                  <span className="sv-award__blurb">{info.blurb}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {recap.length > 0 ? (
        <section className="pk-panel sv-recap" aria-label="Your room in numbers">
          <h2 className="pk-panel__title">Your room in numbers</h2>
          <ul className="sv-recap__list">
            {recap.map((r) => (
              <li key={r.id} className="sv-recapcard" data-kind={r.id}>
                <span className="sv-recapcard__kicker">
                  <PixelIcon name={RECAP_ICON[r.id]} size={12} /> {r.title}
                </span>
                <span className="sv-recapcard__prompt">{r.prompt}</span>
                <span className="sv-recapcard__detail">{r.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {typeof extras.questions === 'number' ? (
        <p className="sv-results__note" role="note">
          <PixelIcon name="lock" size={12} /> <span className="dc-num">{extras.questions}</span> question{extras.questions === 1 ? '' : 's'}{' '}
          played
          {extras.voided ? (
            <>
              {' '}
              · <span className="dc-num">{extras.voided}</span> skipped for anonymity
            </>
          ) : null}
          . Individual answers were never stored or shown.
        </p>
      ) : null}
    </PartyResults>
  );
}
