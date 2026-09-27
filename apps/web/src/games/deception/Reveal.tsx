/**
 * Public reveals: the dawn "system log" and the vote verdict (tally bars + outcome).
 */
import type { CSSProperties } from 'react';
import { Avatar, cx } from '@dascade/ui';
import { Icon } from './Icon.tsx';
import {
  DECEPTION_ROLE_INFO,
  roleTeam,
  type DeceptionDawnReport,
  type DeceptionIntel,
  type DeceptionRole,
  type DeceptionVerdict,
} from '@dascade/shared/games/deception';
import { ROLE_COLOR, TEAM_COLOR } from './art.ts';
import { RoleEmblem } from './RoleCard.tsx';
import type { NodeEntry } from './hooks.ts';
import { IntelLine } from './Intel.tsx';

function RevealedRole({ role }: { role: DeceptionRole | '' | undefined }) {
  if (!role) return <span className="dx-reveal__role dc-muted">Role stays hidden</span>;
  const team = roleTeam(role);
  return (
    <span className="dx-reveal__role" style={{ '--role': ROLE_COLOR[role], '--team': TEAM_COLOR[team] } as CSSProperties}>
      <RoleEmblem role={role} size={22} />
      They were a <strong>{DECEPTION_ROLE_INFO[role].name}</strong>
      <span className="dx-reveal__team">{team === 'glitches' ? '· Glitch team' : '· Sysop team'}</span>
    </span>
  );
}

export function DawnReport({
  report,
  nodes,
  intel,
}: {
  report: DeceptionDawnReport;
  nodes: Record<string, NodeEntry>;
  intel: DeceptionIntel[];
}) {
  const victim = report.playerId ? nodes[report.playerId] : null;
  const mine = intel.filter((i) => i.cycle === report.cycle && i.kind !== 'attack');
  return (
    <section
      className="dx-reveal dx-reveal--dawn"
      data-part="system-log"
      data-outcome={report.outcome}
      aria-live="polite"
      aria-label={`System log, night ${report.cycle}`}
    >
      <header className="dx-terminal__bar">
        <span className="dx-terminal__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="dx-terminal__title">system.log — night {report.cycle}</span>
      </header>
      <div className="dx-terminal__body">
        <p className="dx-terminal__line">&gt; reboot complete · scanning nodes…</p>
        {report.outcome === 'corrupted' && victim ? (
          <>
            <p className="dx-terminal__line dx-terminal__line--alert">&gt; NODE LOST</p>
            <div className="dx-reveal__victim">
              <span className="dx-reveal__avatar">
                <Avatar avatar={victim.avatar} color={victim.color} size={64} offline />
                <Icon name="skull" className="dx-reveal__stamp" />
              </span>
              <div>
                <h2 className="dx-reveal__headline">{victim.name} was corrupted</h2>
                <RevealedRole role={report.role} />
              </div>
            </div>
          </>
        ) : report.outcome === 'blocked' ? (
          <div className="dx-reveal__victim dx-reveal__victim--safe">
            <span className="dx-reveal__avatar dx-reveal__avatar--shield">
              <RoleEmblem role="firewall" size={64} />
            </span>
            <div>
              <p className="dx-terminal__line dx-terminal__line--ok">&gt; INTRUSION BLOCKED</p>
              <h2 className="dx-reveal__headline">A Firewall shield held!</h2>
              <p className="dc-muted">The Glitches struck, but nobody was lost tonight.</p>
            </div>
          </div>
        ) : (
          <div className="dx-reveal__victim dx-reveal__victim--safe">
            <span className="dx-reveal__avatar dx-reveal__avatar--quiet">
              <Icon name="check" />
            </span>
            <div>
              <p className="dx-terminal__line dx-terminal__line--ok">&gt; no intrusions detected</p>
              <h2 className="dx-reveal__headline">A quiet night</h2>
              <p className="dc-muted">Nobody was corrupted.</p>
            </div>
          </div>
        )}
        {mine.length ? (
          <div className="dx-reveal__intel" aria-label="What your ability revealed">
            <span className="dc-label">Private · only you see this</span>
            <ul>
              {mine.map((entry, i) => (
                <IntelLine key={i} entry={entry} nodes={nodes} />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function VerdictReveal({ verdict, nodes }: { verdict: DeceptionVerdict; nodes: Record<string, NodeEntry> }) {
  const out = verdict.playerId ? nodes[verdict.playerId] : null;
  const max = Math.max(1, ...verdict.tally.map((t) => t.votes));
  const votersFor = (target: string) =>
    verdict.votes.filter((v) => v.target === target).map((v) => ({ node: nodes[v.voterId], weight: v.weight }));
  const tiedNames = (verdict.tied ?? []).map((id) => nodes[id]?.name ?? 'Player');
  const headline =
    verdict.outcome === 'disconnected' && out
      ? `${out.name} is disconnected`
      : verdict.outcome === 'runoff'
        ? 'It’s a tie — runoff!'
        : verdict.outcome === 'tie'
          ? 'Tied — nobody is disconnected'
          : verdict.outcome === 'skipped'
            ? 'The network skipped'
            : 'No votes — nobody is disconnected';
  return (
    <section className="dx-reveal dx-reveal--verdict" data-part="vote-result" data-outcome={verdict.outcome} aria-live="polite" aria-label="Vote result">
      <p className="dx-reveal__kicker">{verdict.runoff ? 'Runoff result' : 'Vote result'}</p>
      <div className="dx-reveal__victim">
        {out ? (
          <span className="dx-reveal__avatar">
            <Avatar avatar={out.avatar} color={out.color} size={64} offline />
            <Icon name="wifi-off" className="dx-reveal__stamp" />
          </span>
        ) : null}
        <div>
          <h2 className="dx-reveal__headline">{headline}</h2>
          {verdict.outcome === 'disconnected' ? <RevealedRole role={verdict.role} /> : null}
          {verdict.outcome === 'runoff' ? <p className="dc-muted">Next: a runoff vote between {tiedNames.join(' and ')}.</p> : null}
          {verdict.outcome === 'tie' ? <p className="dc-muted">Tied: {tiedNames.join(', ')}.</p> : null}
        </div>
      </div>
      {verdict.tally.length ? (
        <ol className="dx-tally" data-part="vote-tally" aria-label="Vote totals">
          {verdict.tally.map((t) => {
            const node = t.target === 'skip' ? null : nodes[t.target];
            const name = t.target === 'skip' ? 'Skip' : (node?.name ?? 'Player');
            const voters = verdict.mode === 'full' ? votersFor(t.target) : [];
            return (
              <li
                key={t.target}
                className={cx('dx-tally__row', t.target === verdict.playerId && 'is-out', t.target === 'skip' && 'is-skip')}
              >
                <span className="dx-tally__who">
                  {node ? <Avatar avatar={node.avatar} color={node.color} size={22} /> : <Icon name="arrow-right" size={16} />}
                  <span className="dx-tally__name">{name}</span>
                </span>
                <span className="dx-tally__bar" aria-hidden="true">
                  <i style={{ '--w': `${(t.votes / max) * 100}%` } as CSSProperties} />
                </span>
                <span className="dx-tally__count dc-num" aria-label={`${t.votes} vote${t.votes === 1 ? '' : 's'}`}>
                  {t.votes}
                </span>
                {voters.length ? (
                  <span
                    className="dx-tally__voters"
                    aria-label={`Voted by ${voters.map((v) => `${v.node?.name ?? 'Player'}${v.weight > 1 ? ' (Sudo ×2)' : ''}`).join(', ')}`}
                  >
                    {voters.map((v, i) =>
                      v.node ? (
                        <span
                          key={i}
                          className={cx('dx-tally__voter', v.weight > 1 && 'is-sudo')}
                          title={`${v.node.name}${v.weight > 1 ? ' · Sudo ×2' : ''}`}
                        >
                          <Avatar avatar={v.node.avatar} color={v.node.color} size={18} />
                          {v.weight > 1 ? <span className="dx-tally__x2 dc-num">×2</span> : null}
                        </span>
                      ) : null,
                    )}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      <p className="dx-reveal__foot dc-muted">
        {verdict.sudo ? (
          <span className="dx-reveal__sudo">
            <Icon name="bolt" size={12} /> A Sudo vote (×2) was cast.
          </span>
        ) : null}
        {verdict.abstained > 0 ? ` ${verdict.abstained} abstained.` : ''}
        {verdict.mode === 'tally' ? ' Only totals are shown in this game.' : ''}
      </p>
    </section>
  );
}
