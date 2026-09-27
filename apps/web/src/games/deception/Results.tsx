/**
 * DASception results: the winning team, a full role reveal for everyone (spectators included),
 * awards, and the night-by-night "case file" of every secret action.
 */
import { useMemo, type CSSProperties } from 'react';
import { Avatar, cx } from '@dascade/ui';
import { Icon } from './Icon.tsx';
import {
  DECEPTION_ROLE_INFO,
  DECEPTION_TEAM_INFO,
  roleTeam,
  type DeceptionFinalReport,
  type DeceptionLogEntry,
  type DeceptionPrivate,
  type DeceptionPublicState,
} from '@dascade/shared/games/deception';
import { GameStage, ResultsActions } from '../../shell/common.tsx';
import { Confetti, parseJson } from '../_party/index.ts';
import { ROLE_COLOR, TEAM_COLOR, TEAM_ICON } from './art.ts';
import { sortedNodes, type NodeEntry } from './hooks.ts';
import { RoleEmblem } from './RoleCard.tsx';

const REASON: Record<DeceptionFinalReport['reason'], string> = {
  purged: 'Every Glitch was found and disconnected.',
  takeover: 'The Glitches now equal the Sysops — the network is theirs.',
  timeout: 'The audit ran out of time and the Glitches slipped away.',
};

const AWARD_LABEL: Record<
  DeceptionFinalReport['awards'][number]['id'],
  { title: string; icon: 'eye' | 'lock' | 'star' | 'skull' | 'trophy' }
> = {
  sharp: { title: 'Sharpest eye', icon: 'star' },
  scanner: { title: 'Top scanner', icon: 'eye' },
  shield: { title: 'Iron firewall', icon: 'lock' },
  mastermind: { title: 'Mastermind', icon: 'skull' },
  survivor: { title: 'Last one standing', icon: 'trophy' },
};

function fateText(row: DeceptionFinalReport['roles'][number], node: NodeEntry | undefined): string {
  if (row.alive) return 'Survived';
  const when = node?.outCycle ? ` · ${row.fate === 'corrupted' ? 'night' : 'day'} ${node.outCycle}` : '';
  if (row.fate === 'corrupted') return `Corrupted${when}`;
  if (row.fate === 'disconnected') return `Disconnected${when}`;
  return 'Left the game';
}

export function DeceptionResults({ state, me, meId }: { state: DeceptionPublicState; me: DeceptionPrivate | null; meId: string | null }) {
  const report = useMemo(() => parseJson<DeceptionFinalReport | null>(state.finalJson, null), [state.finalJson]);
  const nodes = useMemo(() => Object.fromEntries(sortedNodes(state.nodes).map((n) => [n.id, n])), [state.nodes]);
  const log = useMemo(() => parseJson<DeceptionLogEntry[]>(state.logJson, []), [state.logJson]);
  if (!report) {
    return (
      <GameStage gameId="deception" className="dx-stage dx-results">
        <div className="dx-booting">
          <p className="dx-booting__title">Match over</p>
          <ResultsActions />
        </div>
      </GameStage>
    );
  }
  const winner = report.winner;
  const myRow = report.roles.find((r) => r.playerId === meId) ?? null;
  const iWon = myRow ? roleTeam(myRow.role) === winner : null;
  const ordered = [...report.roles].sort(
    (a, b) => Number(roleTeam(b.role) === winner) - Number(roleTeam(a.role) === winner) || b.score - a.score,
  );
  const name = (id: string | null) => (id ? (nodes[id]?.name ?? report.roles.find((r) => r.playerId === id)?.name ?? 'Player') : 'nobody');
  const roleOf = (id: string) => report.roles.find((r) => r.playerId === id)?.role;
  void me;
  return (
    <GameStage gameId="deception" className={cx('dx-stage', 'dx-results')} style={{ '--team': TEAM_COLOR[winner] } as CSSProperties}>
      {iWon ? <Confetti /> : null}
      <div className="dx-results__wrap">
        <header className="dx-results__banner" data-winner={winner}>
          <span className="dx-results__icon" aria-hidden="true">
            <Icon name={TEAM_ICON[winner]} />
          </span>
          <p className="dx-results__kicker">
            Game over{report.nights.length ? ` · ${report.nights.length} night${report.nights.length === 1 ? '' : 's'}` : ''}
          </p>
          <h1 className="dx-results__title">{winner === 'sysops' ? 'The Sysops secured the network' : 'The Glitches took over'}</h1>
          <p className="dx-results__reason">{REASON[report.reason]}</p>
          {myRow ? (
            <p className={cx('dx-results__you', iWon ? 'is-win' : 'is-loss')}>
              <RoleEmblem role={myRow.role} size={22} />
              You {iWon ? 'won' : 'lost'} as{' '}
              {DECEPTION_ROLE_INFO[myRow.role].name === 'Sysop' ? 'a Sysop' : `the ${DECEPTION_ROLE_INFO[myRow.role].name}`} ·{' '}
              <span className="dc-num">{myRow.score}</span> pts
            </p>
          ) : null}
        </header>

        <div className="dx-results__actions">
          <ResultsActions />
        </div>

        <section className="dx-results__roles" aria-label="Everyone’s role">
          <h2 className="dx-section-title">Everyone’s role</h2>
          <ul className="dx-reveal-grid">
            {ordered.map((row) => {
              const node = nodes[row.playerId];
              const team = roleTeam(row.role);
              return (
                <li
                  key={row.playerId}
                  className={cx(
                    'dx-revealcard',
                    team === winner && 'is-winner',
                    !row.alive && 'is-offline',
                    row.playerId === meId && 'is-me',
                  )}
                  style={{ '--role': ROLE_COLOR[row.role], '--team': TEAM_COLOR[team] } as CSSProperties}
                >
                  <span className="dx-revealcard__who">
                    <Avatar avatar={node?.avatar ?? 'rocket'} color={node?.color ?? '#ffffff'} size={36} offline={!row.alive} />
                    <span className="dx-revealcard__name">
                      {row.name}
                      {row.playerId === meId ? <span className="dx-node__you">You</span> : null}
                    </span>
                  </span>
                  <span className="dx-revealcard__role">
                    <RoleEmblem role={row.role} size={30} />
                    <span>
                      <strong>{DECEPTION_ROLE_INFO[row.role].name}</strong>
                      <span className="dx-revealcard__team">
                        <Icon name={TEAM_ICON[team]} size={10} /> {DECEPTION_TEAM_INFO[team].name}
                      </span>
                    </span>
                  </span>
                  <span className="dx-revealcard__fate">{fateText(row, node)}</span>
                  <span className="dx-revealcard__score dc-num" aria-label={`${row.score} points`}>
                    {row.score}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {report.awards.length ? (
          <section className="dx-results__awards" aria-label="Awards">
            <ul>
              {report.awards.map((a) => (
                <li key={`${a.id}-${a.playerId}`} className="dx-award">
                  <Icon name={AWARD_LABEL[a.id].icon} />
                  <span>
                    <span className="dx-award__title">{AWARD_LABEL[a.id].title}</span>
                    <span className="dx-award__who">
                      {a.name} · {a.value}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {report.nights.length ? (
          <section className="dx-results__case" aria-label="Case file">
            <h2 className="dx-section-title">Case file — what really happened</h2>
            <ol className="dx-case">
              {report.nights.map((n) => {
                const verdict = log.find((e) => e.kind === 'verdict' && e.cycle === n.cycle);
                return (
                  <li key={n.cycle} className="dx-case__night">
                    <h3 className="dx-case__title">
                      Night <span className="dc-num">{n.cycle}</span>
                    </h3>
                    <ul>
                      <li>
                        <Icon name="skull" size={12} />{' '}
                        {n.attackTarget ? (
                          <>
                            Glitches targeted <strong>{name(n.attackTarget)}</strong> — {n.blocked ? 'blocked by a shield' : 'corrupted'}
                          </>
                        ) : (
                          'The Glitches didn’t strike'
                        )}
                      </li>
                      {n.shields.map((s, i) => (
                        <li key={`s${i}`}>
                          <Icon name="lock" size={12} /> {name(s.actorId)} (Firewall) shielded <strong>{name(s.targetId)}</strong>
                          {s.jammed ? ' — jammed' : ''}
                        </li>
                      ))}
                      {n.scans.map((s, i) => (
                        <li key={`c${i}`}>
                          <Icon name="eye" size={12} /> {name(s.actorId)} (Scanner) scanned <strong>{name(s.targetId)}</strong> →{' '}
                          {s.result === 'jammed' ? 'JAMMED' : s.result === 'glitch' ? 'GLITCH' : 'CLEAN'}
                        </li>
                      ))}
                      {n.jams.map((j, i) => (
                        <li key={`j${i}`}>
                          <Icon name="wifi-off" size={12} /> {name(j.actorId)} (Jammer) jammed <strong>{name(j.targetId)}</strong>
                          {roleOf(j.targetId) ? ` (${DECEPTION_ROLE_INFO[roleOf(j.targetId)!].name})` : ''}
                        </li>
                      ))}
                      {n.clues.map((c, i) => (
                        <li key={`t${i}`}>
                          <Icon name="sparkle" size={12} /> {name(c.actorId)} (Tracer){' '}
                          {c.jammed ? 'was jammed' : c.pair ? `got the clue ${name(c.pair[0])} / ${name(c.pair[1])}` : 'had no signal'}
                        </li>
                      ))}
                      {verdict && verdict.kind === 'verdict' ? (
                        <li className="dx-case__day">
                          <Icon name="flag" size={12} /> Day {n.cycle}:{' '}
                          {verdict.outcome === 'disconnected' ? (
                            <>
                              voted out <strong>{name(verdict.playerId ?? null)}</strong>
                            </>
                          ) : verdict.outcome === 'tie' ? (
                            'tied vote'
                          ) : verdict.outcome === 'skipped' ? (
                            'skipped'
                          ) : (
                            'no votes'
                          )}
                        </li>
                      ) : null}
                    </ul>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null}
      </div>
    </GameStage>
  );
}
