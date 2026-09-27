/**
 * Lobby "Your setup": team pick (teams mode) and a field manual — the arsenal with ammo
 * for the chosen arsenal setting, plus the controls.
 */
import type { CSSProperties } from 'react';
import { TANKS_MSG, TEAM_NAMES, WEAPONS, WEAPON_IDS, type TanksPublicState, type TanksSettings } from '@dascade/shared/games/tanks';
import { PixelArt, PixelIcon, cx } from '@dascade/ui';
import { useRoomSelector, useSettings } from '../../net/hooks.ts';
import { session, useSessionStore } from '../../net/session.ts';
import { sfx } from '../../audio/audio.ts';
import { TEAM_TINT } from './art/themes.ts';
import { WEAPON_ART } from './hud/weaponArt.ts';

export function TeamSetup() {
  const settings = useSettings<TanksSettings>();
  const me = useSessionStore((s) => s.playerId);
  const crew = useRoomSelector((s: TanksPublicState) =>
    Object.entries(s.crew ?? {})
      .filter(([id]) => s.players?.[id] && !s.players[id]!.spectator)
      .map(([id, c]) => `${id}:${c.team}:${s.players?.[id]?.name ?? ''}`)
      .join('|'),
  );
  const teams = settings?.mode === 'teams';
  const arsenal = settings?.arsenal ?? 'standard';
  const members = (crew ?? '')
    .split('|')
    .filter(Boolean)
    .map((row) => {
      const [id, team, ...name] = row.split(':');
      return { id: id!, team: Number(team), name: name.join(':') };
    });
  const myTeam = members.find((m) => m.id === me)?.team ?? -1;
  const pick = (team: number) => {
    sfx('select');
    session.send(TANKS_MSG.team, { team });
  };
  return (
    <div className="tk-setup">
      {teams ? (
        <div className="tk-teams" role="radiogroup" aria-label="Your team">
          {[0, 1].map((team) => (
            <button
              key={team}
              type="button"
              role="radio"
              aria-checked={myTeam === team}
              className={cx('tk-team', myTeam === team && 'is-on')}
              style={{ '--team': TEAM_TINT[team] } as CSSProperties}
              onClick={() => pick(team)}
            >
              <span className="tk-team__name">
                <PixelIcon name="flag" size={14} /> Team {TEAM_NAMES[team]}
              </span>
              <span className="tk-team__members">
                {members.filter((m) => m.team === team).map((m) => m.name).join(', ') || 'No one yet'}
              </span>
            </button>
          ))}
          <button type="button" role="radio" aria-checked={myTeam === -1} className={cx('tk-team tk-team--auto', myTeam === -1 && 'is-on')} onClick={() => pick(-1)}>
            <span className="tk-team__name">
              <PixelIcon name="dice" size={14} /> Auto
            </span>
            <span className="tk-team__members">Balance me in</span>
          </button>
        </div>
      ) : (
        <p className="tk-setup__mode">
          <PixelIcon name="users" size={14} /> <b>Free-for-all</b> — every tank for itself. Last one standing wins.
        </p>
      )}

      <div className="tk-manual">
        <h3 className="tk-manual__title">Arsenal</h3>
        <ul className="tk-manual__weapons">
          {WEAPON_IDS.map((id) => {
            const n = WEAPONS[id].ammo[arsenal];
            return (
              <li key={id} className={cx(n === 0 && 'is-off')}>
                <PixelArt rows={WEAPON_ART[id]} className="tk-manual__art" />
                <span className="tk-manual__name">{WEAPONS[id].name}</span>
                <span className="tk-manual__ammo">{n < 0 ? '∞' : n === 0 ? '—' : `×${n}`}</span>
                <span className="tk-manual__blurb">{WEAPONS[id].blurb}</span>
              </li>
            );
          })}
        </ul>
        <p className="tk-manual__keys">
          <kbd>←</kbd>
          <kbd>→</kbd> angle · <kbd>↑</kbd>
          <kbd>↓</kbd> power · <kbd>A</kbd>
          <kbd>D</kbd> drive · <kbd>Tab</kbd> weapon · <kbd>Space</kbd> fire. On touch: drag the battlefield to aim, fine-tune with the ± buttons, tap FIRE.
        </p>
      </div>
    </div>
  );
}
