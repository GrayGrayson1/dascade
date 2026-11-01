/**
 * The armory between battles: every crew shops at once over the dimmed next battlefield.
 * Category tabs of cards (glyph, blurb, bundle × price, owned, Buy / Sell back), my credits,
 * the last battle's payout, the match standings with who is ready, and a big READY toggle.
 * The server checks every purchase; the shop closes at stageEndsAt or when all are ready.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import {
  GRAVITY_LABEL,
  MAX_STOCK,
  PERSONA_INFO,
  TANKS_MSG,
  TANKS_TIMING,
  TEAM_NAMES,
  TERRAIN_LABEL,
  WALL_LABEL,
  shopInfo,
  type FleetView,
  type ShopId,
  type TanksPublicState,
  type TanksSettings,
} from '@dascade/shared/games/tanks';
import { Badge, PixelArt, PixelIcon, Tabs, TimerRing, cx } from '@dascade/ui';
import { useCountdown, useRoomSelector, useSettings } from '../../../net/hooks.ts';
import { getStateSnapshot, session, useSessionStore } from '../../../net/session.ts';
import { sfx } from '../../../audio/audio.ts';
import { TEAM_TINT } from '../art/themes.ts';
import { shopArt } from '../hud/weaponArt.ts';
import {
  basketCount,
  buyCheck,
  earningsRows,
  formatCredits,
  formatDelta,
  parseBasket,
  rankPlaces,
  shopGroups,
  sortStandings,
  stockOf,
  teamScores,
  type ShopGroupKey,
} from './helpers.ts';

const GROUPS = shopGroups();

type Row = Pick<
  FleetView,
  'id' | 'name' | 'color' | 'team' | 'cpu' | 'persona' | 'score' | 'wins' | 'damage' | 'kills' | 'place' | 'ready' | 'gone' | 'credits'
>;

function useShopInfo() {
  const me = useSessionStore((s) => s.playerId);
  const head = useRoomSelector((s: TanksPublicState) => {
    const b = s.battle;
    return {
      battleNo: b?.battleNo ?? 1,
      battles: b?.battles ?? 1,
      style: b?.style ?? 'hills',
      walls: b?.walls ?? 'open',
      gravity: b?.gravity ?? 'normal',
      mode: b?.mode ?? 'ffa',
      stageEndsAt: b?.stageEndsAt ?? 0,
    };
  });
  // One string key for the fleet so the standings re-render only when something shown changes.
  const fleetKey = useRoomSelector((s: TanksPublicState) =>
    Object.values(s.fleet ?? {})
      .map(
        (f) =>
          `${f.id}:${f.name}:${f.color}:${f.team}:${f.cpu ? 1 : 0}:${f.persona}:${f.score}:${f.wins}:${f.ready ? 1 : 0}:${f.gone ? 1 : 0}:${f.credits}:${f.place}`,
      )
      .join('|'),
  );
  const mineKey = useRoomSelector((s: TanksPublicState) => {
    const f = me ? s.fleet?.[me] : undefined;
    if (!f) return '';
    return JSON.stringify([
      f.credits,
      f.ammo,
      f.items,
      f.basket,
      f.ready,
      f.earned,
      f.earnBase,
      f.earnDamage,
      f.earnKills,
      f.earnSurvive,
      f.earnWin,
      f.earnPenalty,
      f.battleScore,
    ]);
  });
  const fleet = useMemo<Row[]>(() => {
    const s = getStateSnapshot<TanksPublicState>();
    return fleetKey ? Object.values(s?.fleet ?? {}) : [];
  }, [fleetKey]);
  const mine = useMemo<FleetView | null>(() => {
    const s = getStateSnapshot<TanksPublicState>();
    return mineKey && me ? (s?.fleet?.[me] ?? null) : null;
  }, [mineKey, me]);
  return { me, head, fleet, mine };
}

export function Shop() {
  const { me, head, fleet, mine } = useShopInfo();
  const settings = useSettings<TanksSettings>();
  const remaining = useCountdown(head?.stageEndsAt || 0);
  const [tab, setTab] = useState<ShopGroupKey>('blast');
  if (!head) return null;
  const drivingOff = (settings?.movement ?? 'short') === 'off';
  const canShop = Boolean(mine && !mine.gone);
  const basket = parseBasket(mine?.basket);
  const spent = Object.entries(basket).reduce((sum, [id, n]) => sum + shopInfo(id as ShopId).price * (n ?? 0), 0);
  const group = GROUPS.find((g) => g.key === tab) ?? GROUPS[0]!;
  const crews = fleet.filter((f) => !f.gone);
  const readyCount = crews.filter((f) => f.ready || f.cpu).length;
  const firstBattle = head.battleNo <= 1;
  const buy = (id: ShopId) => {
    session.send(TANKS_MSG.buy, { id });
    sfx('coin');
  };
  const sell = (id: ShopId) => {
    session.send(TANKS_MSG.sell, { id });
    sfx('back');
  };
  const toggleReady = () => {
    session.send(TANKS_MSG.ready, { ready: !mine?.ready });
    sfx(mine?.ready ? 'back' : 'ready');
  };

  return (
    <div className="tk-shop" data-part="shop" role="dialog" aria-labelledby="tk-shop-title" aria-modal="false">
      <div className="tk-shop__frame">
        <header className="tk-shop__head tk-glass">
          <div className="tk-shop__heading">
            <span className="tk-shop__kicker">
              <PixelIcon name="bolt" size={12} /> Armory
            </span>
            <h2 id="tk-shop-title" className="tk-shop__title">
              {firstBattle ? 'Gear up' : 'Resupply'} · Battle {head.battleNo}
              {head.battles > 1 ? ` of ${head.battles}` : ''}
            </h2>
            <div className="tk-shop__chips" aria-label="Next battlefield">
              <span className="tk-chip">
                <PixelIcon name="flag" size={11} /> {TERRAIN_LABEL[head.style]}
              </span>
              <span className="tk-chip">{WALL_LABEL[head.walls]} walls</span>
              <span className="tk-chip">{GRAVITY_LABEL[head.gravity]} gravity</span>
            </div>
          </div>
          {head.stageEndsAt ? (
            <div className="tk-shop__clock">
              <TimerRing
                seconds={remaining / 1000}
                progress={remaining / TANKS_TIMING.shopMs}
                urgentAt={10}
                size={52}
                label="Shop closes in"
              />
            </div>
          ) : null}
          {canShop ? (
            <div className="tk-shop__wallet" aria-live="polite" aria-atomic="true">
              <span className="tk-shop__wallet-label">Credits</span>
              <b className="tk-shop__credits" data-part="credits">
                {formatCredits(mine!.credits)}
              </b>
              {spent > 0 ? <small>{formatCredits(spent)} spent this visit</small> : null}
            </div>
          ) : (
            <div className="tk-shop__wallet tk-shop__wallet--watch">
              <PixelIcon name="eye" size={14} /> Watching the crews shop
            </div>
          )}
        </header>

        <div className="tk-shop__body">
          <section className="tk-shop__store tk-glass" aria-label="Store">
            <Tabs
              value={tab}
              label="Shop categories"
              className="tk-shop__tabs"
              onChange={(v) => {
                setTab(v);
                sfx('click');
              }}
              tabs={GROUPS.map((g) => {
                const owned = mine ? g.ids.reduce((n, id) => n + (stockOf(mine, id) > 0 ? 1 : 0), 0) : 0;
                return {
                  value: g.key,
                  label: (
                    <>
                      {g.label}
                      {owned > 0 ? <span className="tk-shop__tabcount">{owned}</span> : null}
                    </>
                  ),
                };
              })}
            />
            <div className="tk-shop__grid" role="tabpanel" aria-label={group.label}>
              {group.ids.map((id) => (
                <ShopCard
                  key={id}
                  id={id}
                  stock={stockOf(mine, id)}
                  credits={mine?.credits ?? 0}
                  sellable={basketCount(mine?.basket, id)}
                  canShop={canShop && !mine?.ready}
                  ready={Boolean(mine?.ready)}
                  drivingOff={drivingOff}
                  onBuy={() => buy(id)}
                  onSell={() => sell(id)}
                />
              ))}
            </div>
          </section>

          <aside className="tk-shop__side" aria-label="Battle report">
            {mine ? (
              <Payout mine={mine} firstBattle={firstBattle} lastBattle={head.battleNo - 1} startCredits={settings?.startCredits ?? 0} />
            ) : null}
            <Standings rows={crews} me={me} teams={head.mode === 'teams'} />
          </aside>
        </div>

        <footer className="tk-shop__foot tk-glass">
          <span className="tk-shop__readycount" aria-live="polite">
            <b>{readyCount}</b> of {crews.length} crews ready
          </span>
          {canShop ? (
            <button
              type="button"
              className="tk-ready"
              data-part="shop-ready"
              aria-label="Ready"
              aria-pressed={Boolean(mine?.ready)}
              onClick={toggleReady}
            >
              <PixelIcon name={mine?.ready ? 'check' : 'play'} size={18} />
              <span className="tk-ready__label">{mine?.ready ? 'Ready!' : 'Ready'}</span>
              <small>{mine?.ready ? 'Tap to keep shopping' : 'Done shopping'}</small>
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

function ShopCard({
  id,
  stock,
  credits,
  sellable,
  canShop,
  ready,
  drivingOff,
  onBuy,
  onSell,
}: {
  id: ShopId;
  stock: number;
  credits: number;
  sellable: number;
  canShop: boolean;
  ready: boolean;
  drivingOff: boolean;
  onBuy: () => void;
  onSell: () => void;
}) {
  const info = shopInfo(id);
  const check = buyCheck(credits, stock, id, { drivingOff });
  const why = !canShop ? (ready ? 'You’re ready' : '') : check.text;
  const disabled = !canShop || !check.ok;
  const reasonId = `tk-why-${id}`;
  return (
    <article
      className={cx('tk-card', stock > 0 && 'is-owned', disabled && 'is-locked')}
      data-shop-id={id}
      data-reason={check.reason ?? undefined}
    >
      <PixelArt rows={shopArt(id)} className="tk-card__art" />
      <div className="tk-card__text">
        <h3 className="tk-card__name">{info.name}</h3>
        <p className="tk-card__blurb">{info.blurb}</p>
      </div>
      <div className="tk-card__meta">
        <span className="tk-card__bundle" aria-label={`${info.bundle} per bundle`}>
          ×{info.bundle}
        </span>
        <span className="tk-card__price" aria-label={`${formatCredits(info.price)} credits`}>
          <span aria-hidden>¢</span>
          {formatCredits(info.price)}
        </span>
        <span className="tk-card__owned" aria-label={`${stock} owned`}>
          {stock > 0 ? `Own ${stock}` : 'None'}
          {stock >= MAX_STOCK ? ' (max)' : ''}
        </span>
      </div>
      <div className="tk-card__actions">
        <button
          type="button"
          className="tk-buy"
          aria-label={`Buy ${info.name}`}
          aria-describedby={why ? reasonId : undefined}
          disabled={disabled}
          onClick={onBuy}
        >
          <PixelIcon name="plus" size={14} /> Buy
        </button>
        {sellable > 0 && canShop ? (
          <button type="button" className="tk-sell" aria-label={`Sell back ${info.name}`} onClick={onSell}>
            <PixelIcon name="minus" size={14} /> Sell back
          </button>
        ) : null}
      </div>
      {why ? (
        <span className="tk-card__why" id={reasonId}>
          {why}
        </span>
      ) : null}
    </article>
  );
}

function Payout({
  mine,
  firstBattle,
  lastBattle,
  startCredits,
}: {
  mine: FleetView;
  firstBattle: boolean;
  lastBattle: number;
  startCredits: number;
}) {
  const rows = earningsRows(mine);
  if (firstBattle || (rows.length === 0 && mine.earned === 0)) {
    return (
      <section className="tk-panel tk-glass" aria-labelledby="tk-payout-title">
        <h3 id="tk-payout-title" className="tk-panel__title">
          War chest
        </h3>
        <p className="tk-panel__lede">
          Every crew starts with <b className="tk-num">{formatCredits(startCredits)}</b> credits. Damage, knockouts and surviving earn more
          after each battle — and unspent ammo carries over.
        </p>
      </section>
    );
  }
  return (
    <section className="tk-panel tk-glass" aria-labelledby="tk-payout-title" data-part="payout">
      <h3 id="tk-payout-title" className="tk-panel__title">
        Battle {lastBattle} payout
      </h3>
      <ul className="tk-payout">
        {rows.map((r) => (
          <li key={r.key} data-neg={r.amount < 0 ? 'true' : undefined}>
            <span>{r.label}</span>
            <b className="tk-num">{formatDelta(r.amount)}</b>
          </li>
        ))}
        <li className="tk-payout__total">
          <span>Earned</span>
          <b className="tk-num">{formatDelta(mine.earned)}</b>
        </li>
      </ul>
      <p className="tk-panel__note">
        <PixelIcon name="star" size={11} /> <b className="tk-num">{formatDelta(mine.battleScore)}</b> points this battle
      </p>
    </section>
  );
}

export function Standings({ rows, me, teams, showReady = true }: { rows: Row[]; me: string | null; teams: boolean; showReady?: boolean }) {
  const sorted = sortStandings(rows);
  const places = rankPlaces(sorted);
  const totals = teams ? teamScores(rows) : null;
  return (
    <section className="tk-panel tk-glass" aria-labelledby="tk-standings-title" data-part="match-standings">
      <h3 id="tk-standings-title" className="tk-panel__title">
        Match standings
      </h3>
      {totals ? (
        <div className="tk-teamscore">
          {[0, 1].map((team) => (
            <span key={team} style={{ '--team': TEAM_TINT[team] } as CSSProperties}>
              {TEAM_NAMES[team]} <b className="tk-num">{totals[team]}</b>
            </span>
          ))}
        </div>
      ) : null}
      <ol className="tk-board">
        {sorted.map((f, i) => {
          const persona = f.persona ? PERSONA_INFO[f.persona]?.label : '';
          return (
            <li key={f.id} className={cx('tk-board__row', f.id === me && 'is-me')}>
              <span className="tk-board__place tk-num">{places[i]}</span>
              <span className="tk-board__chip" style={{ background: f.color }} aria-hidden />
              <span className="tk-board__name">
                <span className="tk-board__label">{f.name}</span>
                {f.id === me ? <small>(you)</small> : null}
                {f.cpu ? <small className="tk-cpu">{persona || 'CPU'}</small> : null}
                {teams && f.team >= 0 ? (
                  <Badge color={TEAM_TINT[f.team]} className="tk-board__team">
                    {TEAM_NAMES[f.team]}
                  </Badge>
                ) : null}
              </span>
              <span className="tk-board__score tk-num" aria-label={`${f.score} points, ${f.wins} battle wins`}>
                {f.score}
                <small>{f.wins > 0 ? ` · ${f.wins}W` : ''}</small>
              </span>
              {showReady ? (
                <span
                  className="tk-board__ready"
                  data-on={f.ready || f.cpu ? 'true' : undefined}
                  aria-label={f.ready || f.cpu ? 'ready' : 'still shopping'}
                >
                  <PixelIcon name={f.ready || f.cpu ? 'check' : 'clock'} size={12} />
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
