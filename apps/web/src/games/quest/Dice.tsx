/**
 * Dramatic d20 roll: a pixel die tumbles, lands on the server's roll, then the math
 * ("14 + 3 WITS = 17 vs DC 15") and the verdict appear. Group checks show a die per
 * hero. Instant with reduced motion; dismissible once the verdict is shown.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button, PixelArt, cx } from '@dascade/ui';
import { QUEST_ARCHETYPES, QUEST_STAT_INFO, type QuestDieView, type QuestRollView } from '@dascade/shared/games/quest';
import { useApp } from '../../app/store.ts';
import { D20_INNER, D20_OUTER, PORTRAITS } from './art.ts';
import { questSound } from './util.ts';

type Phase = 'tumble' | 'land' | 'math' | 'verdict';

export function D20({ value, size = 120, state, color }: { value: number | string; size?: number; state: 'tumble' | 'rest' | 'crit' | 'fumble' | 'pass' | 'fail'; color?: string }) {
  return (
    <span className={cx('qs-d20', `qs-d20--${state}`)} style={{ '--size': `${size}px`, '--hero': color ?? 'var(--accent)' } as CSSProperties} aria-hidden>
      <svg viewBox="0 0 24 24" shapeRendering="crispEdges">
        <polygon points={D20_OUTER} className="qs-d20__face" />
        <polygon points={D20_INNER} className="qs-d20__facet" />
        <polyline points="12,1 12,5 5,16.5 2,17.5" className="qs-d20__edge" />
        <polyline points="12,5 19,16.5 22,17.5" className="qs-d20__edge" />
        <polyline points="5,16.5 12,23 19,16.5" className="qs-d20__edge" />
        <polyline points="2,6.5 12,5 22,6.5" className="qs-d20__edge" />
      </svg>
      <span className="qs-d20__num">{value}</span>
    </span>
  );
}

function useCycling(active: boolean): number {
  const [n, setN] = useState(() => 1 + Math.floor(Math.random() * 20));
  useEffect(() => {
    if (!active) return;
    let ticks = 0;
    const id = setInterval(() => {
      setN(1 + Math.floor(Math.random() * 20));
      if (ticks++ % 2 === 0) questSound.diceTick();
    }, 70);
    return () => clearInterval(id);
  }, [active]);
  return n;
}

function dieState(d: QuestDieView, phase: Phase): 'tumble' | 'rest' | 'crit' | 'fumble' | 'pass' | 'fail' {
  if (phase === 'tumble') return 'tumble';
  if (phase === 'land') return 'rest';
  if (d.crit === 'success') return 'crit';
  if (d.crit === 'failure') return 'fumble';
  return d.success ? 'pass' : 'fail';
}

function RollMath({ d, dc, stat }: { d: QuestDieView; dc: number; stat: string }) {
  const extras = d.parts.slice(1);
  return (
    <p className="qs-roll__math" aria-label={`${d.kept} plus ${d.modifier} equals ${d.total} against DC ${dc}`}>
      <span className="qs-roll__n">{d.kept}</span>
      <span className="qs-roll__op">{d.parts[0]!.value >= 0 ? '+' : '−'}</span>
      <span>
        {Math.abs(d.parts[0]!.value)} <b>{stat}</b>
      </span>
      {extras.map((p) => (
        <span key={p.label} className="qs-roll__extra">
          {p.value >= 0 ? '+' : '−'} {Math.abs(p.value)} <i>{p.label}</i>
        </span>
      ))}
      <span className="qs-roll__op">=</span>
      <span className="qs-roll__n">{d.total}</span>
      <span className="qs-roll__vs">vs DC {dc}</span>
    </p>
  );
}

export function DiceOverlay({ roll, onClose, instant = false }: { roll: QuestRollView; onClose: () => void; instant?: boolean }) {
  const reduced = useApp((s) => s.settings.reducedMotion);
  // `instant`: a reconnect mid-roll shows the verdict straight away instead of re-tumbling.
  const skip = reduced || instant;
  const [phase, setPhase] = useState<Phase>(skip ? 'verdict' : 'tumble');
  const cycling = useCycling(phase === 'tumble');
  const closeRef = useRef<HTMLButtonElement>(null);
  const stat = QUEST_STAT_INFO[roll.stat].short;
  const single = roll.dice.length === 1 ? roll.dice[0]! : null;

  useEffect(() => {
    if (skip) {
      setPhase('verdict');
      if (!instant) (roll.success ? questSound.success : questSound.failure)(roll.crit !== null);
      return;
    }
    questSound.diceStart();
    const timers = [
      setTimeout(() => {
        setPhase('land');
        questSound.diceLand();
      }, 1300),
      setTimeout(() => setPhase('math'), 1650),
      setTimeout(() => {
        setPhase('verdict');
        (roll.success ? questSound.success : questSound.failure)(roll.crit !== null);
      }, 2150),
    ];
    return () => timers.forEach(clearTimeout);
  }, [roll.id, skip, instant, roll.success, roll.crit]);

  useEffect(() => {
    if (phase === 'verdict') closeRef.current?.focus({ preventScroll: true });
  }, [phase]);

  const verdict = roll.crit === 'success' ? 'Critical success!' : roll.crit === 'failure' ? 'Critical fumble!' : roll.success ? 'Success' : 'Failure';
  const passed = roll.dice.filter((d) => d.success).length;
  const showMath = phase === 'math' || phase === 'verdict';

  return (
    <div
      data-part="dice"
      className="qs-roll"
      role="dialog"
      aria-modal="false"
      aria-label={`${QUEST_STAT_INFO[roll.stat].name} check`}
      data-phase={phase}
      data-result={roll.success ? 'success' : 'failure'}
      onClick={phase === 'verdict' ? onClose : undefined}
    >
      <div className="qs-roll__card" onClick={(e) => e.stopPropagation()}>
        <p className="qs-roll__eyebrow">
          <span className="dc-label">{QUEST_STAT_INFO[roll.stat].name} check</span>
          <span className="qs-roll__choice">“{roll.choiceLabel}”</span>
        </p>
        {single ? (
          <>
            <div className="qs-roll__who">
              <PixelArt rows={PORTRAITS[single.archetype]} mainColor={single.color} className="qs-roll__portrait" />
              <span>
                <b style={{ color: single.color }}>{single.name}</b> the {QUEST_ARCHETYPES[single.archetype].name} rolls
                {single.naturals.length > 1 ? ' with advantage' : ''}
              </span>
            </div>
            <div className="qs-roll__stage">
              {single.naturals.length > 1 && phase !== 'tumble' ? (
                <D20 value={Math.min(...single.naturals)} size={64} state="rest" color="var(--text-3)" />
              ) : null}
              <D20 value={phase === 'tumble' ? cycling : single.kept} size={132} state={dieState(single, phase)} color={single.color} />
            </div>
            {single.rerolledFrom !== undefined && showMath ? (
              <p className="qs-roll__reroll">
                Silver Tongue{roll.rerollBy ? ` (${roll.rerollBy})` : ''}: rerolled a {single.rerolledFrom}!
              </p>
            ) : null}
            {showMath ? <RollMath d={single} dc={roll.dc} stat={stat} /> : <p className="qs-roll__math qs-roll__math--pending">Rolling…</p>}
          </>
        ) : (
          <>
            <p className="qs-roll__who">
              Everyone rolls {QUEST_STAT_INFO[roll.stat].name} — {roll.needed} of {roll.dice.length} must reach DC {roll.dc}
            </p>
            <ul className="qs-roll__group">
              {roll.dice.map((d) => (
                <li key={d.heroPlayerId + d.name} className="qs-roll__member" data-pass={phase === 'verdict' || phase === 'math' ? String(d.success) : undefined}>
                  <D20 value={phase === 'tumble' ? cycling : d.kept} size={58} state={dieState(d, phase)} color={d.color} />
                  <span className="qs-roll__name" style={{ color: d.color }}>
                    {d.name}
                  </span>
                  {showMath ? (
                    <span className="qs-roll__small">
                      {d.kept} {d.modifier >= 0 ? '+' : '−'} {Math.abs(d.modifier)} = <b>{d.total}</b>
                      {d.rerolledFrom !== undefined ? ' ↻' : ''}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {showMath ? (
              <p className="qs-roll__math">
                <span className="qs-roll__n">{passed}</span> of {roll.dice.length} passed · needed {roll.needed}
              </p>
            ) : (
              <p className="qs-roll__math qs-roll__math--pending">Rolling…</p>
            )}
          </>
        )}
        <p className={cx('qs-roll__verdict', phase === 'verdict' && 'is-shown')} aria-live="assertive">
          {phase === 'verdict' ? verdict : ' '}
        </p>
        <Button ref={closeRef} className="qs-roll__close" size="sm" variant="ghost" onClick={onClose} disabled={phase !== 'verdict'}>
          Continue
        </Button>
      </div>
    </div>
  );
}
