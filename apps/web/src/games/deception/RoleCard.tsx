/**
 * Role card: emblem, name, team, one-sentence rule and tip. The hero variant is the boot reveal;
 * the compact variant lives in the side panel with a "hide" toggle for players sharing a table.
 */
import type { CSSProperties } from 'react';
import { Badge, IconButton, PixelArt, cx } from '@dascade/ui';
import { Icon } from './Icon.tsx';
import {
  DECEPTION_ROLE_INFO,
  DECEPTION_TEAM_INFO,
  type DeceptionPrivate,
  type DeceptionRole,
  type DeceptionTeam,
} from '@dascade/shared/games/deception';
import { HIDDEN_ART, ROLE_ART, ROLE_COLOR, TEAM_COLOR, TEAM_ICON } from './art.ts';
import type { NodeEntry } from './hooks.ts';

export function RoleEmblem({ role, size = 64, className }: { role: DeceptionRole | null; size?: number; className?: string }) {
  const color = role ? ROLE_COLOR[role] : 'var(--text-3)';
  return (
    <span className={cx('dx-emblem', className)} style={{ '--role': color, width: size, height: size } as CSSProperties} aria-hidden="true">
      <PixelArt rows={role ? ROLE_ART[role] : HIDDEN_ART} mainColor={color} />
    </span>
  );
}

export function TeamBadgeX({ team, size = 'md' }: { team: DeceptionTeam; size?: 'sm' | 'md' }) {
  return (
    <Badge className={cx('dx-team', size === 'sm' && 'dx-team--sm')} color={TEAM_COLOR[team]}>
      <Icon name={TEAM_ICON[team]} size={11} />
      {DECEPTION_TEAM_INFO[team].name}
    </Badge>
  );
}

export function RoleChip({ role }: { role: DeceptionRole }) {
  return (
    <span className="dx-rolechip" style={{ '--role': ROLE_COLOR[role] } as CSSProperties}>
      <RoleEmblem role={role} size={16} />
      {DECEPTION_ROLE_INFO[role].name}
    </span>
  );
}

interface RoleCardProps {
  me: DeceptionPrivate;
  nodes: Record<string, NodeEntry>;
  meId: string | null;
  variant: 'hero' | 'compact';
  hidden?: boolean;
  onToggleHidden?: (hidden: boolean) => void;
}

export function RoleCard({ me, nodes, meId, variant, hidden, onToggleHidden }: RoleCardProps) {
  const role = me.role!;
  const info = DECEPTION_ROLE_INFO[role];
  const team = info.team;
  const allies = me.allies.filter((a) => a.id !== meId);
  const concealed = variant === 'compact' && hidden;
  return (
    <section
      className={cx('dx-rolecard', `dx-rolecard--${variant}`, concealed && 'is-concealed', !me.alive && 'is-offline')}
      data-part="role-card"
      style={{ '--role': ROLE_COLOR[role], '--team': TEAM_COLOR[team] } as CSSProperties}
      aria-label={concealed ? 'Your role (hidden)' : `Your role: ${info.name}`}
    >
      <div className="dx-rolecard__head">
        <RoleEmblem role={concealed ? null : role} size={variant === 'hero' ? 112 : 44} className="dx-rolecard__emblem" />
        <div className="dx-rolecard__titles">
          <span className="dx-rolecard__kicker">
            {variant === 'hero' ? 'Your secret role' : me.alive ? 'Your role' : 'Your role · offline'}
          </span>
          <h2 className="dx-rolecard__name">{concealed ? 'Hidden' : info.name}</h2>
          {concealed ? null : <TeamBadgeX team={team} size={variant === 'hero' ? 'md' : 'sm'} />}
        </div>
        {variant === 'compact' && onToggleHidden ? (
          <IconButton
            icon="eye"
            size="sm"
            variant="ghost"
            className="dx-rolecard__peek"
            label={hidden ? 'Show my role' : 'Hide my role'}
            aria-pressed={hidden}
            onClick={() => onToggleHidden(!hidden)}
          />
        ) : null}
      </div>
      {concealed ? (
        <p className="dx-rolecard__rule dc-muted">Hidden so nobody at your table can peek. Tap the eye to show it.</p>
      ) : (
        <>
          <p className="dx-rolecard__rule">{info.rule}</p>
          {variant === 'hero' ? <p className="dx-rolecard__tip">{info.tip}</p> : null}
          <p className="dx-rolecard__goal">
            <Icon name="flag" size={12} /> {DECEPTION_TEAM_INFO[team].goal}
          </p>
          {team === 'glitches' ? (
            <div className="dx-rolecard__allies">
              <span className="dc-label">{allies.length ? 'Your fellow Glitches' : 'You are the only Glitch'}</span>
              {allies.length ? (
                <ul>
                  {allies.map((a) => (
                    <li key={a.id} className={cx(!a.alive && 'is-offline')}>
                      <RoleEmblem role={a.role} size={18} />
                      <span className="dx-rolecard__ally">{nodes[a.id]?.name ?? 'Ally'}</span>
                      <span className="dc-muted">{DECEPTION_ROLE_INFO[a.role].name}</span>
                      {!a.alive ? <span className="dc-muted">· offline</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {role === 'sudo' ? (
            <p className={cx('dx-rolecard__power', me.sudoUsed && 'is-spent')}>
              <Icon name="bolt" size={12} /> {me.sudoUsed ? 'Sudo vote used' : 'Sudo vote ready (×2, once per game)'}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
