/**
 * Dice High/Low: the table shows a point (the last roll), everyone bets HIGHER,
 * SAME or LOWER on the next 2d6 total, then the server rolls. Multipliers come
 * from the true odds with a 3% edge and are printed on the buttons.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Button, ChipStack, PixelIcon, cx } from '@dascade/ui';
import { DICE_RETURN_PERCENT, diceMinStake, diceOdds, formatMultiplier, type DicePick } from '@dascade/game-core/dasino';
import {
  DASINO_MSG,
  tableChips,
  type DasinoPrivatePayload,
  type DasinoPublicState,
  type DasinoSeatView,
  type DasinoSettings,
  type DiceSettledPayload,
} from '@dascade/shared/games/dasino';
import { serverNow, session, useLatestMessage, useRoomMessage } from '../../net/hooks.ts';
import { DIE_PIPS } from './sprites.ts';
import { Celebration, winTitle, type CelebrationInfo } from './Celebration.tsx';
import { ChipRack, PhaseTimer, TableCrowd } from './parts.tsx';
import { fmt, payoutLine, play, useDasinoUi, useMotion } from './ui.ts';

const PICK_META: Record<DicePick, { label: string; icon: 'chevron-up' | 'chevron-down' | 'minus'; hint: string }> = {
  higher: { label: 'Higher', icon: 'chevron-up', hint: 'Next total beats the point' },
  same: { label: 'Same', icon: 'minus', hint: 'Next total equals the point' },
  lower: { label: 'Lower', icon: 'chevron-down', hint: 'Next total is under the point' },
};

/** Cube rotation that shows a face value at the front. */
const FACE_ROT: Record<number, [number, number]> = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };

function PipFace({ value }: { value: number }) {
  const rows = DIE_PIPS[value] ?? DIE_PIPS[1]!;
  return (
    <svg viewBox="0 0 9 9" shapeRendering="crispEdges" aria-hidden>
      {rows.flatMap((row, y) =>
        [...row].map((ch, x) => (ch === '#' ? <rect key={`${x}-${y}`} x={x - 0.15} y={y - 0.15} width={1.3} height={1.3} className={value === 1 ? 'pip pip--ace' : 'pip'} /> : null)),
      )}
    </svg>
  );
}

export function Die3D({
  value,
  size = 72,
  tumble,
  className,
}: {
  value: number;
  size?: number;
  /** Tumble animation (key it by round); `elapsed` lets late joiners jump in mid-roll. */
  tumble?: { key: string; durationMs: number; elapsed: number; spin: number };
  className?: string;
}) {
  const [rx, ry] = FACE_ROT[value] ?? [0, 0];
  const style = {
    '--s': `${size}px`,
    '--rx': `${rx}deg`,
    '--ry': `${ry}deg`,
    '--rx0': `${rx + 720 + (tumble?.spin ?? 0) * 90}deg`,
    '--ry0': `${ry - 1080 - (tumble?.spin ?? 0) * 90}deg`,
    '--rz0': `${(tumble?.spin ?? 0) % 2 ? 180 : -180}deg`,
    '--dur': `${tumble?.durationMs ?? 0}ms`,
    '--delay': `${-(tumble?.elapsed ?? 0)}ms`,
  } as CSSProperties;
  return (
    <div className={cx('dn-die', tumble && 'is-tumbling', className)} style={style} role="img" aria-label={`Die showing ${value}`}>
      <div className="dn-die__toss" key={tumble?.key}>
        <div className="dn-die__tilt">
          <div className="dn-die__cube">
            {[1, 2, 3, 4, 5, 6].map((f) => (
              <div key={f} className={`dn-die__face dn-die__face--${f}`}>
                <PipFace value={f} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="dn-die__shadow" aria-hidden />
    </div>
  );
}

export function DiceTable({ state, settings, seat, playerId }: { state: DasinoPublicState; settings: DasinoSettings; seat: DasinoSeatView | undefined; playerId: string | null }) {
  const d = state.dice;
  const { reduced } = useMotion();
  const chips = useMemo(() => tableChips(settings), [settings]);
  const chip = useDasinoUi((s) => s.chip);
  const priv = useLatestMessage<DasinoPrivatePayload>(DASINO_MSG.private);
  const [celebrate, setCelebrate] = useState<CelebrationInfo | null>(null);
  const point = d.pointA + d.pointB;
  const odds = useMemo(() => (point >= 2 ? diceOdds(point) : []), [point]);
  const betting = d.phase === 'BETTING';
  const rollTotal = d.rollA + d.rollB;
  const showRoll = (d.phase === 'ROLLING' || d.phase === 'RESULT') && d.rollA > 0;
  const outcome: DicePick | null = d.phase === 'RESULT' && rollTotal > 0 ? (rollTotal > point ? 'higher' : rollTotal < point ? 'lower' : 'same') : null;

  const myBets = new Map<DicePick, number>();
  const crowd = new Map<DicePick, Array<{ id: string; amount: number }>>();
  for (const b of d.bets) {
    if (b.playerId === playerId) myBets.set(b.pick, (myBets.get(b.pick) ?? 0) + b.amount);
    else crowd.set(b.pick, [...(crowd.get(b.pick) ?? []), { id: b.playerId, amount: b.amount }]);
  }
  const myStake = [...myBets.values()].reduce((a, b) => a + b, 0);
  const myPayout = d.phase === 'RESULT' ? d.payouts.find((p) => p.playerId === playerId) : undefined;

  useRoomMessage(DASINO_MSG.diceRoll, () => play('dice'));
  useRoomMessage<DiceSettledPayload>(DASINO_MSG.diceSettled, (p) => {
    const mine = p.payouts.find((x) => x.playerId === playerId);
    if (!mine) return;
    if (mine.returned > 0) {
      const multiple = mine.returned / mine.staked;
      if (multiple >= 5) {
        play('bigwin');
        setCelebrate({ key: p.round, title: winTitle(multiple * 2), amount: mine.returned, subtitle: `${p.outcome.toUpperCase()} on ${p.point} — rolled ${p.total}` });
      } else play('win');
    } else play('lose');
  });

  /**
   * Chips a click places on a pick: the selected chip, raised to the pick's
   * minimum stake (whole-chip payouts: e.g. 20 at 1.05× so a win pays more than the stake).
   */
  const stakeFor = (pick: DicePick) => Math.max(chip, diceMinStake(point, pick) - (myBets.get(pick) ?? 0));
  const bet = (pick: DicePick) => {
    if (!seat) return;
    if (!betting) {
      play('error');
      return;
    }
    play('chip');
    session.send(DASINO_MSG.diceBet, { pick, amount: stakeFor(pick) });
  };
  const control = (type: string) => {
    play('click');
    session.send(type, { table: 'dice' });
  };

  // Late joiners see the tumble from where it is.
  const elapsed = Math.max(0, serverNow() - d.rollStartAt);
  const tumbleMs = Math.round(d.rollMs * 0.82);
  const [, force] = useState(0);
  useEffect(() => {
    if (d.phase !== 'ROLLING') return;
    const t = setTimeout(() => force((n) => n + 1), Math.max(0, d.rollMs - elapsed) + 30);
    return () => clearTimeout(t);
  }, [d.phase, d.rollMs, elapsed]);
  const landed = d.phase === 'RESULT' || (d.phase === 'ROLLING' && elapsed >= tumbleMs);

  let title = 'Waiting for players';
  let detail: string | null = null;
  if (betting) {
    title = `Higher or lower than ${point}?`;
    detail = myStake > 0 ? `Your chips: ${fmt(myStake)}` : seat ? 'Pick a chip, then choose' : 'Watching the table';
  } else if (d.phase === 'ROLLING') {
    title = landed ? `${rollTotal}!` : 'Rolling…';
    detail = myStake > 0 ? `Riding: ${fmt(myStake)}` : null;
  } else if (d.phase === 'RESULT' && outcome) {
    title = `${rollTotal} · ${outcome === 'same' ? 'SAME!' : outcome.toUpperCase()}`;
    detail = myPayout ? payoutLine(myPayout) : `Next point: ${rollTotal}`;
  }
  const tone = myPayout ? (myPayout.returned > myPayout.staked ? 'win' : myPayout.returned < myPayout.staked ? 'loss' : undefined) : undefined;

  return (
    <div className="dn-dice">
      <section className="dn-dice__stage dn-glass" aria-label="Dice table">
        <header className="dn-felt__head">
          <div>
            <h2 className="dn-h2">Dice High / Low</h2>
            <p className="dn-sub">Two dice · pays true odds minus {100 - DICE_RETURN_PERCENT}% · every roll becomes the next point</p>
          </div>
          <TableCrowd state={state} table="dice" />
        </header>

        <div className="dn-dice__arena">
          <div className="dn-point" aria-label={`Point ${point}`}>
            <span className="dc-label">Point</span>
            <div className="dn-point__dice">
              <Die3D value={Math.max(1, d.pointA)} size={44} />
              <Die3D value={Math.max(1, d.pointB)} size={44} />
            </div>
            <span className="dn-point__num dc-num">{point >= 2 ? point : '–'}</span>
          </div>

          <div className="dn-tray" data-phase={d.phase} data-outcome={outcome ?? undefined}>
            {showRoll ? (
              <div className="dn-tray__dice">
                <Die3D
                  value={d.rollA}
                  size={86}
                  tumble={reduced ? undefined : { key: `a${d.round}`, durationMs: tumbleMs, elapsed, spin: d.round % 4 }}
                />
                <Die3D
                  value={d.rollB}
                  size={86}
                  tumble={reduced ? undefined : { key: `b${d.round}`, durationMs: tumbleMs + 120, elapsed, spin: (d.round + 1) % 4 }}
                />
              </div>
            ) : (
              <div className="dn-tray__idle">
                <PixelIcon name="dice" />
                <span>{betting ? 'Bets open — the dice roll when the timer runs out' : 'Next roll soon'}</span>
              </div>
            )}
            {showRoll && landed ? (
              <div className="dn-tray__total" key={`t${d.round}`}>
                <span className="dc-num">{rollTotal}</span>
                {outcome ? (
                  <em data-outcome={outcome}>
                    <PixelIcon name={PICK_META[outcome].icon} /> {PICK_META[outcome].label}
                  </em>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="dn-status" data-phase={d.phase} data-tone={tone} aria-live="polite">
            {betting ? <PhaseTimer endsAt={d.endsAt} totalMs={settings.diceBettingSeconds * 1000} label="Dice roll in" /> : <span className="dn-status__icon" aria-hidden />}
            <div className="dn-status__text">
              <strong>{title}</strong>
              {detail ? <span>{detail}</span> : null}
            </div>
          </div>
        </div>

        <div className="dn-picks" role="group" aria-label="Your pick">
          {odds.map((o) => {
            const mine = myBets.get(o.pick) ?? 0;
            const others = crowd.get(o.pick) ?? [];
            const won = outcome === o.pick;
            const minStake = o.open ? diceMinStake(point, o.pick) : 0;
            const playable = o.open && minStake <= settings.maxBet;
            const stake = stakeFor(o.pick);
            const winPays = Math.floor(((mine + stake) * o.multiplier100) / 100);
            const minNote = minStake > chips[0]! ? ` · min ${fmt(minStake)}` : '';
            return (
              <button
                key={o.pick}
                type="button"
                className={cx('dn-pick', `dn-pick--${o.pick}`, !playable && 'is-closed', won && 'is-winner', outcome && !won && 'is-loser')}
                disabled={!playable || !seat || !betting || stake > (seat?.balance ?? 0)}
                onClick={() => bet(o.pick)}
                title={playable ? `Bet ${fmt(stake)}: a win returns ${fmt(winPays)}${mine ? ` for your ${fmt(mine + stake)}` : ''}` : undefined}
                aria-label={
                  playable
                    ? `${PICK_META[o.pick].label}: pays ${formatMultiplier(o.multiplier100)}, ${(o.probability * 100).toFixed(1)}% chance${minStake > 1 ? `, minimum stake ${minStake}` : ''}${mine ? `, your bet ${mine}` : ''}`
                    : `${PICK_META[o.pick].label}: closed on a point of ${point}`
                }
              >
                <span className="dn-pick__icon">
                  <PixelIcon name={PICK_META[o.pick].icon} />
                </span>
                <span className="dn-pick__label">{PICK_META[o.pick].label}</span>
                <span className="dn-pick__mult dc-num">{playable ? formatMultiplier(o.multiplier100) : 'Closed'}</span>
                <span className="dn-pick__prob">
                  {playable ? `${o.ways}/36 · ${(o.probability * 100).toFixed(1)}%${minNote}` : o.ways === 0 ? 'Can’t happen' : o.open ? `Min ${fmt(minStake)} > table max` : 'Pays under 1×'}
                </span>
                {mine > 0 ? (
                  <span className="dn-pick__chips">
                    <ChipStack amount={mine} size={28} maxChips={5} />
                    <em className="dc-num">{fmt(mine)}</em>
                  </span>
                ) : null}
                {others.length ? (
                  <span className="dn-pick__others" title={`${others.length} other bet${others.length === 1 ? '' : 's'}`}>
                    {others.slice(0, 5).map((b) => (
                      <i key={b.id} style={{ background: state.players[b.id]?.color ?? '#888' }} />
                    ))}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="dn-felt__controls">
          <ChipRack chips={chips} balance={seat?.balance ?? 0} disabled={!seat} />
          <div className="dn-actions" role="group" aria-label="Bet controls">
            <Button size="sm" icon="arrow-left" disabled={!betting || myStake === 0} onClick={() => control(DASINO_MSG.undo)}>
              Undo
            </Button>
            <Button size="sm" icon="trash" disabled={!betting || myStake === 0} onClick={() => control(DASINO_MSG.clear)}>
              Clear
            </Button>
            {myStake > 0 ? (
              <Button size="sm" icon="plus" disabled={!betting || (seat?.balance ?? 0) < myStake || [...myBets.values()].some((a) => a * 2 > settings.maxBet)} onClick={() => control(DASINO_MSG.double)}>
                Double
              </Button>
            ) : (
              <Button size="sm" icon="refresh" disabled={!betting || !priv?.lastDice.length} onClick={() => control(DASINO_MSG.rebet)}>
                Rebet
              </Button>
            )}
          </div>
        </div>
        <Celebration info={celebrate} onDone={() => setCelebrate(null)} />
      </section>

      <aside className="dn-dice__side">
        <section className="dn-glass dn-side">
          <header className="dn-side__head">
            <h2 className="dn-h3">Roll history</h2>
          </header>
          {d.history.length ? (
            <ol className="dn-dicelog">
              {[...d.history].reverse().map((h) => (
                <li key={h.round} data-outcome={h.outcome}>
                  <span className="dn-muted dc-num">{h.point}</span>
                  <PixelIcon name="arrow-right" />
                  <span className="dc-num dn-dicelog__roll">{h.a + h.b}</span>
                  <em>
                    <PixelIcon name={PICK_META[h.outcome].icon} /> {PICK_META[h.outcome].label}
                  </em>
                </li>
              ))}
            </ol>
          ) : (
            <p className="dn-muted dn-small">The first roll is coming up.</p>
          )}
        </section>
        <section className="dn-glass dn-side">
          <header className="dn-side__head">
            <h2 className="dn-h3">How it pays</h2>
          </header>
          <ul className="dn-rules dn-small">
            <li>Pick whether the next two-dice total is higher, lower or the same as the point.</li>
            <li>
              Multiplier = 0.97 × 36 ÷ winning combinations, rounded down. Your return is stake × multiplier (whole chips).
            </li>
            <li>Higher and Lower lose on a tie. A pick closes when it can’t win or can’t pay more than 1×.</li>
            <li>Wins are paid in whole chips, rounded down, so small stakes give up a little extra. A pick needs a stake that wins more than it risks (e.g. 20 chips at 1.05×).</li>
          </ul>
          {point >= 2 ? (
            <table className="dn-table dn-table--compact">
              <thead>
                <tr>
                  <th scope="col">Pick</th>
                  <th scope="col">Odds</th>
                  <th scope="col">Pays</th>
                  <th scope="col" title="House edge before rounding to whole chips">Edge</th>
                </tr>
              </thead>
              <tbody>
                {odds.map((o) => (
                  <tr key={o.pick}>
                    <th scope="row">{PICK_META[o.pick].label}</th>
                    <td className="dc-num">{o.ways}/36</td>
                    <td className="dc-num">{o.open ? formatMultiplier(o.multiplier100) : '—'}</td>
                    <td className="dc-num">{o.open ? `${(o.houseEdge * 100).toFixed(2)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      </aside>
    </div>
  );
}
