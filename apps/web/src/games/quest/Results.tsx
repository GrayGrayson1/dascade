/**
 * Ending & results: the final scene art, ending title and epilogue, party stats,
 * fun awards and the full decisions timeline, then Play again / Leave.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { Badge, Panel, PixelIcon, cx } from '@dascade/ui';
import { QUEST_ARCHETYPES, QUEST_STAT_INFO, type QuestResultView } from '@dascade/shared/games/quest';
import { ResultsActions } from '../../shell/common.tsx';
import { SceneCanvas } from './scene/SceneCanvas.tsx';
import { HpBar, Portrait } from './Party.tsx';
import { emphasis, questSound } from './util.ts';

const TIER_LABEL: Record<QuestResultView['tier'], string> = {
  great: 'Best ending',
  good: 'Good ending',
  bittersweet: 'Bittersweet ending',
  bad: 'Bad ending',
  comedic: 'Comedic ending',
};

const TIER_COLOR: Record<QuestResultView['tier'], string> = {
  great: '#a3e635',
  good: '#22d3ee',
  bittersweet: '#ffd23f',
  bad: '#ff5a5f',
  comedic: '#ff4fd8',
};

export function QuestResults({ result, myId }: { result: QuestResultView; myId: string | null }) {
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    questSound.ending(result.tier !== 'bad');
  }, [result.endingId, result.tier]);
  const timeline = showAll ? result.timeline : result.timeline.slice(-8);
  return (
    <div className="qs-results" style={{ '--tier': TIER_COLOR[result.tier] } as CSSProperties}>
      <section className="qs-results__hero" aria-labelledby="qs-ending-title">
        <SceneCanvas theme={result.theme} seed={`ending:${result.endingId}`} art={[]} label={`Ending scene: ${result.title}`} className="qs-results__scene">
          <div className="qs-results__overlay">
            <span className="qs-results__tier">{TIER_LABEL[result.tier]}</span>
            <h1 id="qs-ending-title" className="qs-results__title">
              {result.title}
            </h1>
            <p className="qs-results__pack">
              {result.packTitle} · The End
            </p>
          </div>
        </SceneCanvas>
      </section>

      <div className="qs-results__grid">
        <Panel className="qs-results__epilogue" title="Epilogue" brackets>
          <div className="qs-prose">
            {result.epilogue.map((p, i) => (
              <p key={i}>{emphasis(p).map((seg, j) => (seg.em ? <em key={j}>{seg.text}</em> : <span key={j}>{seg.text}</span>))}</p>
            ))}
          </div>
          <dl className="qs-results__stats">
            <div>
              <dt>Party score</dt>
              <dd className="dc-num">{result.score.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Decisions</dt>
              <dd className="dc-num">{result.turns}</dd>
            </div>
            <div>
              <dt>Clocked out</dt>
              <dd className="dc-num">{result.clock}</dd>
            </div>
            <div>
              <dt>Endings found here</dt>
              <dd className="dc-num">
                {result.endingsFound}/{result.endingsTotal}
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel className="qs-results__party" title="The party">
          <ul className="qs-results__heroes">
            {result.heroes.map((h) => (
              <li key={h.playerId + h.name} className={cx('qs-rhero', h.playerId === myId && 'is-me')} style={{ '--hero': h.color } as CSSProperties}>
                <Portrait hero={h} size={52} />
                <div className="qs-rhero__body">
                  <div className="qs-rhero__name">
                    {h.name} {h.playerId === myId ? <Badge color="var(--cyan)">You</Badge> : null}
                  </div>
                  <div className="qs-rhero__class">{QUEST_ARCHETYPES[h.archetype].name}</div>
                  <HpBar hp={h.hp} maxHp={h.maxHp} />
                  <div className="qs-rhero__nums">
                    <span title="Checks rolled">
                      <PixelIcon name="dice" /> {h.successes}/{h.rolls}
                    </span>
                    <span title="Natural 20s">★ {h.crits}</span>
                    <span title="Damage taken">
                      <PixelIcon name="heart" /> −{h.damageTaken}
                    </span>
                    {h.healing ? <span title="Healing given">+{h.healing} healed</span> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel className="qs-results__awards" title="Awards">
          {result.awards.length === 0 ? <p className="qs-empty">A quiet adventure — no awards this time.</p> : null}
          <ul className="qs-awards">
            {result.awards.map((a) => (
              <li key={a.id} className="qs-award" style={{ '--hero': a.color } as CSSProperties}>
                <PixelIcon name="trophy" className="qs-award__icon" />
                <div>
                  <strong>{a.title}</strong>
                  <span className="qs-award__who">
                    <Portrait hero={{ archetype: a.archetype, color: a.color, ko: false }} size={18} /> {a.name}
                  </span>
                  <span className="qs-award__desc">{a.description}</span>
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          className="qs-results__timeline"
          title="Decisions"
          actions={
            result.timeline.length > 8 ? (
              <button type="button" className="qs-linkbtn" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                {showAll ? 'Show recent' : `Show all ${result.timeline.length}`}
              </button>
            ) : null
          }
        >
          <ol className="qs-timeline">
            {timeline.map((t) => (
              <li key={t.turn} className="qs-timeline__item" data-result={t.success === undefined ? 'none' : t.success ? 'pass' : 'fail'}>
                <span className="qs-timeline__turn dc-num">{t.turn}</span>
                <div>
                  <span className="qs-timeline__node">
                    Ch. {t.chapter} · {t.nodeTitle}
                  </span>
                  <span className="qs-timeline__choice">{t.choiceLabel}</span>
                  <span className="qs-timeline__meta">
                    {t.votes}/{t.voters} votes
                    {t.tieRule ? ` · ${t.tieRule}` : ''}
                    {t.stat ? ` · ${QUEST_STAT_INFO[t.stat].name} ${t.success ? 'success' : 'failure'}${t.crit ? ` (${t.crit === 'success' ? 'nat 20' : 'nat 1'})` : ''}` : ''}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <div className="qs-results__actions">
        <ResultsActions />
      </div>
    </div>
  );
}
