/**
 * The DASino floor: three lit-up tables to choose from, each with live status,
 * plus a live standings board for everyone on the floor.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Avatar, Button, PixelIcon, cx, type IconName } from '@dascade/ui';
import { diceOdds, formatMultiplier, slotStats } from '@dascade/game-core/dasino';
import { seatNet, type DasinoPublicState, type DasinoTable } from '@dascade/shared/games/dasino';
import { useCountdown } from '../../net/hooks.ts';
import { RouletteWheel } from './RouletteWheel.tsx';
import { RouletteHistoryPills } from './Roulette.tsx';
import { Die3D } from './Dice.tsx';
import { Sprite } from './Sprite.tsx';
import { SLOT_SPRITES } from './sprites.ts';
import { TableCrowd, goToTable } from './parts.tsx';
import { fmt, signed, useDasinoUi } from './ui.ts';

const TABLE_ICON: Record<DasinoTable, IconName> = { floor: 'star', roulette: 'refresh', slots: 'bolt', dice: 'dice' };

function Card({
  kind,
  title,
  subtitle,
  art,
  status,
  children,
  seated,
  cta,
}: {
  kind: 'roulette' | 'slots' | 'dice';
  title: string;
  subtitle: string;
  art: ReactNode;
  status: ReactNode;
  children?: ReactNode;
  seated: boolean;
  cta: string;
}) {
  return (
    <article className={`dn-card dn-card--${kind}`} data-part="table-card" aria-labelledby={`dn-card-${kind}`}>
      <div className="dn-card__art" onClick={() => goToTable(kind, seated)} aria-hidden>
        {art}
      </div>
      <div className="dn-card__body">
        <h2 id={`dn-card-${kind}`} className="dn-card__title">
          {title}
        </h2>
        <p className="dn-card__sub">{subtitle}</p>
        <div className="dn-card__status">{status}</div>
        {children}
      </div>
      <Button variant="primary" block icon="play" onClick={() => goToTable(kind, seated)} aria-label={cta}>
        {cta}
      </Button>
    </article>
  );
}

function LiveLine({ endsAt, label, live }: { endsAt: number; label: string; live: boolean }) {
  const remaining = useCountdown(live ? endsAt : 0);
  return (
    <span className={cx('dn-live', live && 'is-live')}>
      <i aria-hidden />
      {label}
      {live ? <b className="dc-num"> · {Math.ceil(remaining / 1000)}s</b> : null}
    </span>
  );
}

export function Floor({ state, playerId, seated }: { state: DasinoPublicState; playerId: string | null; seated: boolean }) {
  const r = state.roulette;
  const d = state.dice;
  const point = d.pointA + d.pointB;
  const lastSlot = useDasinoUi((s) => s.slotLog[0]);
  const rtp = (slotStats().rtp * 100).toFixed(2);
  const rouletteLabel =
    r.phase === 'BETTING' ? 'Bets open' : r.phase === 'CLOSED' ? 'No more bets' : r.phase === 'SPINNING' ? 'Spinning' : r.phase === 'RESULT' ? `${r.result} just hit` : 'Warming up';
  const diceLabel = d.phase === 'BETTING' ? 'Bets open' : d.phase === 'ROLLING' ? 'Rolling' : d.phase === 'RESULT' ? `Rolled ${d.rollA + d.rollB}` : 'Warming up';
  const higher = point >= 2 ? diceOdds(point)[0] : null;

  const standings = Object.values(state.seats)
    .map((s) => ({ seat: s, player: state.players[s.id] }))
    .filter((x) => x.player)
    .sort((a, b) => seatNet(b.seat) - seatNet(a.seat));

  return (
    <div className="dn-floor">
      <header className="dn-floor__sign">
        <h1 className="dn-sign" aria-label="DASino">
          <span>DAS</span>
          <em>INO</em>
        </h1>
        <p className="dn-floor__tag">Three tables, one balance · virtual chips only</p>
      </header>

      <div className="dn-floor__tables">
        <Card
          kind="roulette"
          title="Roulette"
          subtitle="European single zero · shared wheel"
          seated={seated}
          cta="Play roulette"
          art={<RouletteWheel roulette={r} className="dn-card__wheel" label="Live roulette wheel" />}
          status={<LiveLine endsAt={r.endsAt} label={rouletteLabel} live={r.phase === 'BETTING'} />}
        >
          <RouletteHistoryPills numbers={r.history} />
          <TableCrowd state={state} table="roulette" />
        </Card>

        <Card
          kind="slots"
          title="Neon 7s"
          subtitle={`3 reels · 5 lines · ${rtp}% RTP`}
          seated={seated}
          cta="Play slots"
          art={
            <div className="dn-minislot">
              <span className="dn-minislot__bulbs" />
              <div className="dn-minislot__reels">
                {(['seven', 'das', 'seven'] as const).map((s, i) => (
                  <span key={i} className="dn-minislot__reel">
                    <Sprite rows={SLOT_SPRITES[s]} size="72%" />
                  </span>
                ))}
              </div>
            </div>
          }
          status={
            <span className="dn-live is-live">
              <i aria-hidden />
              Spin any time
            </span>
          }
        >
          <p className="dn-card__meta">
            {lastSlot ? (
              <>
                Your last spin:{' '}
                <b className={cx('dc-num', lastSlot.totalWin > lastSlot.totalBet ? 'is-up' : 'is-down')}>{signed(lastSlot.totalWin - lastSlot.totalBet)}</b>
              </>
            ) : (
              'Top prize: DAS · DAS · DAS pays 300× the line bet'
            )}
          </p>
          <TableCrowd state={state} table="slots" />
        </Card>

        <Card
          kind="dice"
          title="Dice High/Low"
          subtitle="Beat the point · shared rolls"
          seated={seated}
          cta="Play dice"
          art={
            <div className="dn-card__dice">
              <Die3D value={Math.max(1, d.pointA)} size={64} />
              <Die3D value={Math.max(1, d.pointB)} size={64} />
            </div>
          }
          status={<LiveLine endsAt={d.endsAt} label={diceLabel} live={d.phase === 'BETTING'} />}
        >
          <p className="dn-card__meta">
            {point >= 2 ? (
              <>
                Point <b className="dc-num">{point}</b>
                {higher?.open ? <> · Higher pays {formatMultiplier(higher.multiplier100)}</> : <> · only Same is open</>}
              </>
            ) : (
              'First point rolls when the floor opens'
            )}
          </p>
          <TableCrowd state={state} table="dice" />
        </Card>
      </div>

      <section className="dn-glass dn-standings" data-part="scoreboard" aria-labelledby="dn-standings">
        <header className="dn-side__head">
          <h2 id="dn-standings" className="dn-h3">
            On the floor
          </h2>
          <span className="dn-muted dn-small">Ranked by session net</span>
        </header>
        {standings.length ? (
          <ol className="dn-standings__list">
            {standings.map(({ seat, player }, i) => {
              const net = seatNet(seat);
              return (
                <li key={seat.id} className={seat.id === playerId ? 'is-me' : undefined} style={{ '--c': player!.color } as CSSProperties}>
                  <span className="dn-standings__rank dc-num">{i + 1}</span>
                  <Avatar avatar={player!.avatar} color={player!.color} size={28} offline={!player!.connected} />
                  <span className="dn-standings__name">{player!.name}</span>
                  <span className="dn-standings__where" title={`At ${seat.table}`}>
                    <PixelIcon name={TABLE_ICON[seat.table]} /> {seat.table === 'floor' ? 'Floor' : seat.table === 'slots' ? 'Slots' : seat.table === 'dice' ? 'Dice' : 'Roulette'}
                  </span>
                  <span className="dc-num dn-standings__bal">{fmt(seat.balance + seat.inPlay)}</span>
                  <span className={cx('dc-num dn-standings__net', net > 0 && 'is-up', net < 0 && 'is-down')}>{signed(net)}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="dn-muted dn-small">The floor opens in a moment…</p>
        )}
      </section>
    </div>
  );
}
