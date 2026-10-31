/**
 * Lobby "Your setup": team pick (teams mode) and a field manual — how a match works, the
 * arsenal and defenses for the chosen economy (shop prices, the stocked loadout, or shells
 * only), and the controls.
 */
import { useState, type CSSProperties } from 'react';
import {
  CATEGORY_LABEL,
  ITEMS,
  ITEM_IDS,
  STOCKED_LOADOUT,
  TANKS_MSG,
  TEAM_NAMES,
  WEAPONS,
  type ShopId,
  type TanksPublicState,
  type TanksSettings,
} from '@dascade/shared/games/tanks';
import { PixelArt, PixelIcon, Tabs, cx } from '@dascade/ui';
import { useRoomSelector, useSettings } from '../../net/hooks.ts';
import { session, useSessionStore } from '../../net/session.ts';
import { sfx } from '../../audio/audio.ts';
import { TEAM_TINT } from './art/themes.ts';
import { WEAPON_ART, shopArt } from './hud/weaponArt.ts';
import { formatCredits, shopGroups, type ShopGroupKey } from './shop/helpers.ts';

const GROUPS = shopGroups();

export function TeamSetup() {
  const settings = useSettings<TanksSettings>();
  const me = useSessionStore((s) => s.playerId);
  const crew = useRoomSelector((s: TanksPublicState) =>
    Object.entries(s.crew ?? {})
      .filter(([id]) => s.players?.[id] && !s.players[id]!.spectator)
      .map(([id, c]) => `${id}:${c.team}:${s.players?.[id]?.name ?? ''}`)
      .join('|'),
  );
  const [tab, setTab] = useState<ShopGroupKey>('blast');
  const teams = settings?.mode === 'teams';
  const economy = settings?.economy ?? 'shop';
  const battles = settings?.battles ?? 3;
  const volley = settings?.turnMode === 'volley';
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
  const group = GROUPS.find((g) => g.key === tab) ?? GROUPS[0]!;
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
                {members
                  .filter((m) => m.team === team)
                  .map((m) => m.name)
                  .join(', ') || 'No one yet'}
              </span>
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={myTeam === -1}
            className={cx('tk-team tk-team--auto', myTeam === -1 && 'is-on')}
            onClick={() => pick(-1)}
          >
            <span className="tk-team__name">
              <PixelIcon name="dice" size={14} /> Auto
            </span>
            <span className="tk-team__members">Balance me in</span>
          </button>
        </div>
      ) : (
        <p className="tk-setup__mode">
          <PixelIcon name="users" size={14} /> <b>Free-for-all</b> — every tank for itself.
        </p>
      )}

      <div className="tk-manual">
        <h3 className="tk-manual__title">How a match works</h3>
        <ol className="tk-manual__steps">
          <li>
            <b>{battles === 1 ? 'One battle' : `${battles} battles`}</b> on fresh battlefields.{' '}
            {volley
              ? 'Everyone aims at once, locks in, and every shot flies together.'
              : 'Tanks take turns: aim, set power, pick a weapon, fire.'}
          </li>
          <li>
            Damage, knockouts and surviving score <b>points</b>
            {economy === 'shop' ? (
              <>
                {' '}
                and earn <b>credits</b>. Spend them in the <b>armory</b> between battles — unspent ammo carries over.
              </>
            ) : (
              '.'
            )}
          </li>
          <li>Mind the wind, the walls and the ground: craters drop tanks, dirt buries them, and fire flows downhill.</li>
        </ol>

        <h3 className="tk-manual__title">
          {economy === 'shop' ? 'The armory' : economy === 'stocked' ? 'Loadout each battle' : 'Arsenal'}
        </h3>
        {economy === 'shells' ? (
          <ul className="tk-manual__weapons">
            <li>
              <PixelArt rows={WEAPON_ART.shell} className="tk-manual__art" />
              <span className="tk-manual__name">{WEAPONS.shell.name}</span>
              <span className="tk-manual__ammo">∞</span>
              <span className="tk-manual__blurb">Shells only this match — pure aim.</span>
            </li>
          </ul>
        ) : (
          <>
            <Tabs
              value={tab}
              label="Arsenal categories"
              className="tk-manual__tabs"
              onChange={setTab}
              tabs={GROUPS.map((g) => ({ value: g.key, label: g.key === 'defense' ? CATEGORY_LABEL.defense : g.label }))}
            />
            <ul className="tk-manual__weapons" role="tabpanel" aria-label={group.label}>
              {group.ids.map((id) => (
                <ManualRow key={id} id={id} economy={economy} />
              ))}
            </ul>
          </>
        )}

        <h3 className="tk-manual__title">Controls</h3>
        <p className="tk-manual__keys">
          <kbd>←</kbd>
          <kbd>→</kbd> angle · <kbd>↑</kbd>
          <kbd>↓</kbd> power · <kbd>A</kbd>
          <kbd>D</kbd> drive · <kbd>Tab</kbd> weapon · <kbd>Space</kbd> {volley ? 'lock in' : 'fire'} · <kbd>S</kbd> shield · <kbd>B</kbd>{' '}
          battery · <kbd>F</kbd> fuel. On touch: drag the battlefield to aim, fine-tune with the ± buttons, tap{' '}
          {volley ? 'LOCK IN' : 'FIRE'}.
        </p>
      </div>
    </div>
  );
}

function ManualRow({ id, economy }: { id: ShopId; economy: 'shop' | 'stocked' }) {
  const isItem = (ITEM_IDS as readonly string[]).includes(id);
  const info = isItem ? ITEMS[id as keyof typeof ITEMS] : WEAPONS[id as keyof typeof WEAPONS];
  const stocked = STOCKED_LOADOUT[id] ?? 0;
  const off = economy === 'stocked' && stocked === 0;
  return (
    <li className={cx(off && 'is-off')}>
      <PixelArt rows={shopArt(id)} className="tk-manual__art" />
      <span className="tk-manual__name">{info.name}</span>
      <span className="tk-manual__ammo">
        {economy === 'shop' ? `${info.bundle}× ¢${formatCredits(info.price)}` : stocked > 0 ? `×${stocked}` : '—'}
      </span>
      <span className="tk-manual__blurb">{info.blurb}</span>
    </li>
  );
}
