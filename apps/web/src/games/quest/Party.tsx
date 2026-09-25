/**
 * Party HUD: hero cards (portrait in the player's color, HP bar, statuses, vote
 * state), a compact strip for phones, and the shared party inventory.
 */
import { useState, type CSSProperties } from 'react';
import { Badge, Button, PixelArt, PixelIcon, cx } from '@dascade/ui';
import { QUEST_ARCHETYPES, type QuestCatalogView, type QuestHeroView, type QuestItemView } from '@dascade/shared/games/quest';
import type { PlayerView } from '@dascade/shared';
import { PORTRAITS, UNKNOWN_PORTRAIT, glyph } from './art.ts';
import { parseStatus } from './util.ts';

export function Portrait({ hero, size = 44, className }: { hero: Pick<QuestHeroView, 'archetype' | 'color' | 'ko'>; size?: number; className?: string }) {
  const rows = hero.archetype ? PORTRAITS[hero.archetype] : UNKNOWN_PORTRAIT;
  return (
    <span className={cx('qs-portrait', hero.ko && 'is-ko', className)} style={{ '--size': `${size}px`, '--hero': hero.color } as CSSProperties}>
      <PixelArt rows={rows} mainColor={hero.color} />
      {hero.ko ? <span className="qs-portrait__ko">KO</span> : null}
    </span>
  );
}

export function HpBar({ hp, maxHp, compact }: { hp: number; maxHp: number; compact?: boolean }) {
  const pctValue = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  const tone = pctValue > 0.6 ? 'good' : pctValue > 0.3 ? 'warn' : 'bad';
  return (
    <span
      className={cx('qs-hp', compact && 'qs-hp--compact')}
      data-tone={tone}
      role="meter"
      aria-label="Health"
      aria-valuemin={0}
      aria-valuemax={maxHp}
      aria-valuenow={hp}
      aria-valuetext={`${hp} of ${maxHp} HP`}
      style={{ '--hp': `${pctValue * 100}%` } as CSSProperties}
    >
      <span className="qs-hp__fill" />
      {compact ? null : (
        <span className="qs-hp__text">
          {hp}/{maxHp}
        </span>
      )}
    </span>
  );
}

function StatusChips({ hero, catalog }: { hero: QuestHeroView; catalog: QuestCatalogView | null }) {
  if (!hero.statuses.length) return null;
  return (
    <span className="qs-statuses">
      {hero.statuses.map((raw) => {
        const s = parseStatus(raw);
        const def = catalog?.statuses[s.id];
        return (
          <span key={s.id} className="qs-status" data-tone={def?.tone ?? 'debuff'} title={def ? `${def.name}: ${def.description}` : s.id}>
            {def?.tone === 'buff' ? '▲' : '▼'} {def?.name ?? s.id}
            {s.turns > 0 ? <i>{s.turns}</i> : null}
          </span>
        );
      })}
    </span>
  );
}

export interface HeroCardProps {
  hero: QuestHeroView;
  player?: PlayerView;
  me: boolean;
  voted: boolean;
  votingOpen: boolean;
  catalog: QuestCatalogView | null;
}

export function HeroCard({ hero, player, me, voted, votingOpen, catalog }: HeroCardProps) {
  const arche = hero.archetype ? QUEST_ARCHETYPES[hero.archetype] : null;
  const away = !hero.present || (player && !player.connected);
  return (
    <li className={cx('qs-hero', me && 'is-me', hero.ko && 'is-ko', away && 'is-away')} style={{ '--hero': hero.color } as CSSProperties}>
      <Portrait hero={hero} size={46} />
      <div className="qs-hero__body">
        <div className="qs-hero__top">
          <span className="qs-hero__name">{hero.name}</span>
          {player?.isHost ? <PixelIcon name="crown" title="Party leader (host)" className="qs-hero__crown" /> : null}
          {me ? <Badge color="var(--cyan)">You</Badge> : null}
          <span className="dc-spacer" />
          {votingOpen && !hero.ko && !away ? (
            <span className={cx('qs-hero__vote', voted && 'is-voted')} title={voted ? 'Voted' : 'Still deciding'}>
              <PixelIcon name={voted ? 'check' : 'clock'} />
              <span className="visually-hidden">{voted ? 'Voted' : 'Deciding'}</span>
            </span>
          ) : null}
        </div>
        <div className="qs-hero__class">
          {arche?.name ?? 'Choosing…'}
          {away ? <span className="qs-hero__away">{hero.present ? 'reconnecting' : 'left the party'}</span> : null}
        </div>
        <HpBar hp={hero.hp} maxHp={hero.maxHp} />
        <StatusChips hero={hero} catalog={catalog} />
      </div>
    </li>
  );
}

export function PartyStrip({ heroes, myId, votes, onOpen }: { heroes: QuestHeroView[]; myId: string | null; votes: Record<string, string>; onOpen: (panel: 'party' | 'bag' | 'log') => void }) {
  return (
    <div className="qs-strip" role="group" aria-label="Party">
      <button type="button" className="qs-strip__heroes" onClick={() => onOpen('party')} aria-label="Show party details">
        {heroes.map((h) => (
          <span key={h.playerId} className={cx('qs-strip__hero', h.playerId === myId && 'is-me')} style={{ '--hero': h.color } as CSSProperties}>
            <Portrait hero={h} size={30} />
            <HpBar hp={h.hp} maxHp={h.maxHp} compact />
            {votes[h.playerId] ? <span className="qs-strip__voted" aria-hidden /> : null}
          </span>
        ))}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export function ItemGlyph({ icon, size = 28 }: { icon: string; size?: number }) {
  return <PixelArt rows={glyph(icon)} mainColor="var(--accent)" className="qs-glyph" style={{ width: size, height: size }} />;
}

export function Inventory({
  inventory,
  credits,
  catalog,
  heroes,
  canUse,
  onUse,
}: {
  inventory: Record<string, number>;
  credits: number;
  catalog: QuestCatalogView | null;
  heroes: QuestHeroView[];
  canUse: boolean;
  onUse: (itemId: string, targetId: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const items = Object.entries(inventory)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => ({ id, n, def: catalog?.items[id] }))
    .sort((a, b) => Number(b.def?.usable ?? false) - Number(a.def?.usable ?? false) || (a.def?.name ?? a.id).localeCompare(b.def?.name ?? b.id));
  const selected = items.find((i) => i.id === open);
  return (
    <div className="qs-bag">
      <div className="qs-bag__credits">
        <PixelIcon name="chip" /> <b className="dc-num">{credits}</b> credits
      </div>
      {items.length === 0 ? <p className="qs-empty">The party’s pockets are empty.</p> : null}
      <ul className="qs-bag__grid">
        {items.map(({ id, n, def }) => (
          <li key={id}>
            <button
              type="button"
              className={cx('qs-item', open === id && 'is-open', def?.usable && 'is-usable')}
              aria-expanded={open === id}
              aria-label={`${def?.name ?? id}${n > 1 ? ` ×${n}` : ''}`}
              onClick={() => setOpen(open === id ? null : id)}
            >
              <ItemGlyph icon={def?.icon ?? 'box'} />
              <span className="qs-item__name">{def?.name ?? id}</span>
              {n > 1 ? <span className="qs-item__count">×{n}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {selected ? <ItemDetail item={selected.def} id={selected.id} heroes={heroes} canUse={canUse} onUse={(target) => (onUse(selected.id, target), setOpen(null))} /> : null}
    </div>
  );
}

function ItemDetail({ item, id, heroes, canUse, onUse }: { item: QuestItemView | undefined; id: string; heroes: QuestHeroView[]; canUse: boolean; onUse: (targetId: string) => void }) {
  return (
    <div className="qs-item-detail" role="region" aria-label={item?.name ?? id}>
      <div className="qs-item-detail__head">
        <ItemGlyph icon={item?.icon ?? 'box'} size={36} />
        <div>
          <strong>{item?.name ?? id}</strong>
          <p>{item?.description}</p>
          {item?.bonus ? <Badge color="var(--accent)">Passive {item.bonus}</Badge> : null}
          {item?.key && !item.usable ? <Badge color="var(--text-2)">Key item</Badge> : null}
        </div>
      </div>
      {item?.usable ? (
        canUse && item.useTarget === 'party' ? (
          <Button size="sm" variant="primary" onClick={() => onUse(heroes[0]?.playerId ?? '')}>
            {item.useLabel ?? 'Use'} — whole party
          </Button>
        ) : canUse ? (
          <div className="qs-item-detail__targets">
            <span className="dc-label">{item.useLabel ?? 'Use'} — choose a hero</span>
            <div className="qs-item-detail__row">
              {heroes.map((h) => (
                <Button key={h.playerId} size="sm" onClick={() => onUse(h.playerId)} style={{ '--btn-edge': h.color } as CSSProperties}>
                  <Portrait hero={h} size={20} /> {h.name}
                  {h.ko ? ' (KO)' : ` ${h.hp}/${h.maxHp}`}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <p className="qs-empty">Items can be used while the party is voting.</p>
        )
      ) : null}
    </div>
  );
}
