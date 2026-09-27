/**
 * Round intro card: mode, round number, rules (fuller on round 1) and the scoring legend — this is
 * DASwords' countdown (the room skips the shared 3-2-1).
 */
import { WORDS_MODE_INFO, type WordsMode, type WordsPublicState, type WordsSettings } from '@dascade/shared/games/words';
import { StageTimer } from '../_party/index.ts';
import { ModeGlyph, ScoreLegend } from './Common.tsx';

function modeDetail(mode: WordsMode, s: WordsSettings, state: WordsPublicState): string {
  switch (mode) {
    case 'grid':
      return `${s.gridSize}×${s.gridSize} board · ${s.gridSeconds}s · words of ${s.gridMinLength}+ letters${s.uniqueOnly ? ' · only unique words score' : ''}`;
    case 'anagram':
      return `${s.rackSize} letters · ${s.anagramSeconds}s`;
    case 'chain':
      return `${s.chainRule === 'last2' ? 'Last two letters' : 'Last letter'} → first · ${s.chainLives} heart${s.chainLives === 1 ? '' : 's'} · up to ${state.chainLinks || s.chainLinks} links`;
    case 'forbidden':
      return `${s.forbiddenSeconds}s · ${s.review === 'host' ? 'host checks unknown answers' : 'dictionary words trusted'}`;
  }
}

export function RoundIntro({ state, settings }: { state: WordsPublicState; settings: WordsSettings }) {
  const mode = (state.mode || settings.mode) as WordsMode;
  const info = WORDS_MODE_INFO[mode];
  const first = state.round <= 1;
  return (
    <section className="wd-intro" key={state.round} aria-live="polite">
      <div className="wd-intro__glyphwrap">
        <ModeGlyph mode={mode} className="wd-intro__glyph" />
      </div>
      <p className="wd-intro__kicker">
        Round <span className="dc-num">{state.round}</span> of <span className="dc-num">{state.totalRounds}</span>
      </p>
      <h2 className="wd-intro__title">{info.title}</h2>
      <p className="wd-intro__tagline">{info.tagline}</p>
      <p className="wd-intro__detail">{modeDetail(mode, settings, state)}</p>
      {first ? (
        <ul className="wd-intro__rules">
          {info.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      <ScoreLegend mode={mode} uniqueOnly={settings.uniqueOnly} />
      <div className="wd-intro__timer">
        <StageTimer size={64} label="Starting in" />
        <span className="dc-label">Get ready</span>
      </div>
    </section>
  );
}
