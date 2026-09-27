/**
 * Roulette table: the shared wheel, the betting felt (every European bet has a
 * real hit area: numbers, edges for splits/streets, corners for corners/six
 * lines/trios/first four), chip rack and bet controls. Touch layouts get a
 * bet-type picker so inside bets stay easy to place with a thumb.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Button, ChipStack, Modal, PixelIcon, Segmented, chipBreakdown, cx } from '@dascade/ui';
import {
  INSIDE_BET_TYPES,
  ROULETTE_PAYOUTS,
  insideBetsForNumber,
  rouletteColor,
  rouletteNumberInfo,
  type InsideBetType,
  type RouletteBetDef,
} from '@dascade/game-core/dasino';
import {
  DASINO_MSG,
  tableChips,
  type DasinoPrivatePayload,
  type DasinoPublicState,
  type DasinoSeatView,
  type DasinoSettings,
  type RouletteSettledPayload,
} from '@dascade/shared/games/dasino';
import { session, useLatestMessage, useRoomMessage } from '../../net/hooks.ts';
import { BOARD, BOARD_H, BOARD_W, SPOT_BY_KEY, pointPercent, toPercent, type BoardSpot, type Orientation } from './boardLayout.ts';
import { RouletteWheel } from './RouletteWheel.tsx';
import { ChipRack, PhaseTimer, TableCrowd } from './parts.tsx';
import { fmt, payoutLine, play, signed, useDasinoUi, useMedia, useMotion } from './ui.ts';

const BET_MODE_LABEL: Record<InsideBetType, string> = { straight: 'Straight', split: 'Split', street: 'Street', corner: 'Corner', line: 'Six line' };

function payoutText(def: RouletteBetDef): string {
  return `pays ${def.payout} to 1`;
}

export function RouletteTable({ state, settings, seat, playerId }: { state: DasinoPublicState; settings: DasinoSettings; seat: DasinoSeatView | undefined; playerId: string | null }) {
  const r = state.roulette;
  const chips = useMemo(() => tableChips(settings), [settings]);
  const chip = useDasinoUi((s) => s.chip);
  const betMode = useDasinoUi((s) => s.betMode);
  const setBetMode = useDasinoUi((s) => s.setBetMode);
  const vertical = useMedia('(max-width: 720px)');
  const touch = useMedia('(max-width: 720px), (pointer: coarse)');
  const orientation: Orientation = vertical ? 'vertical' : 'horizontal';
  const priv = useLatestMessage<DasinoPrivatePayload>(DASINO_MSG.private);
  const [chooser, setChooser] = useState<{ n: number; options: RouletteBetDef[] } | null>(null);
  const [lastSettle, setLastSettle] = useState<RouletteSettledPayload | null>(null);
  const betting = r.phase === 'BETTING';
  const seated = Boolean(seat);

  const myBets = r.bets.filter((b) => b.playerId === playerId);
  const myStake = myBets.reduce((s, b) => s + b.amount, 0);
  const myPayout = r.phase === 'RESULT' ? r.payouts.find((p) => p.playerId === playerId) : undefined;

  useRoomMessage(DASINO_MSG.rouletteSpin, () => play('spin'));
  useRoomMessage<RouletteSettledPayload>(DASINO_MSG.rouletteSettled, (p) => {
    setLastSettle(p);
    const mine = p.payouts.find((x) => x.playerId === playerId);
    if (!mine) return;
    if (mine.returned >= mine.staked * 10) play('bigwin');
    else if (mine.returned > 0) play('win');
    else play('lose');
  });
  useEffect(() => {
    if (!betting) setChooser(null);
  }, [betting]);
  // Phones: bring the wheel into view when the ball is launched.
  const wheelRef = useRef<HTMLElement>(null);
  const { reduced } = useMotion();
  useEffect(() => {
    if (r.phase !== 'SPINNING' || !vertical) return;
    const el = wheelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.bottom < 80 || rect.top > window.innerHeight - 80) el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }, [r.phase, vertical, reduced]);

  const place = (key: string) => {
    if (!seated) return;
    if (!betting) {
      play('error');
      return;
    }
    play('chip');
    session.send(DASINO_MSG.rouletteBet, { spot: key, amount: chip });
  };

  const onNumber = (n: number) => {
    if (!touch || betMode === 'straight') return place(`straight:${n}`);
    const options = insideBetsForNumber(n, betMode);
    if (options.length === 0) {
      play('error');
      return;
    }
    if (options.length === 1) return place(options[0]!.key);
    setChooser({ n, options });
  };

  const control = (type: string) => {
    play('click');
    session.send(type, { table: 'roulette' });
  };

  const settledHere = lastSettle && lastSettle.round === r.round ? lastSettle : null;
  const resultInfo = r.result >= 0 ? rouletteNumberInfo(r.result) : null;

  return (
    <div className="dn-roulette">
      <section className="dn-roulette__wheel dn-glass" aria-label="Wheel" ref={wheelRef}>
        <div className="dn-wheelwrap" data-part="wheel">
          <RouletteWheel roulette={r} label={resultInfo && r.phase !== 'SPINNING' ? `Roulette wheel, last result ${r.result} ${resultInfo.color}` : 'Roulette wheel'} />
          <WheelOverlay state={state} />
        </div>
        <StatusBar state={state} settings={settings} myStake={myStake} myPayout={myPayout} seated={seated} />
        <History numbers={r.history} />
      </section>

      <section className="dn-roulette__felt" data-part="table" aria-label="Betting table">
        <header className="dn-felt__head">
          <div>
            <h2 className="dn-h2">European Roulette</h2>
            <p className="dn-sub">Single zero · 2.70% house edge · max {fmt(settings.maxBet)} per spot</p>
          </div>
          <TableCrowd state={state} table="roulette" />
        </header>
        {touch ? (
          <div className="dn-betmode">
            <span className="dc-label">Tap a number to bet</span>
            <Segmented
              label="Inside bet type"
              value={betMode}
              onChange={(m) => {
                play('select');
                setBetMode(m);
              }}
              options={INSIDE_BET_TYPES.map((t) => ({ value: t, label: `${BET_MODE_LABEL[t]} ${ROULETTE_PAYOUTS[t]}:1` }))}
            />
          </div>
        ) : (
          <p className="dn-hint">
            <PixelIcon name="info" /> Click a number for a straight bet, a line between numbers for a split or street, and a corner for a corner, six line or first four.
          </p>
        )}
        <RouletteBoard
          state={state}
          playerId={playerId}
          orientation={orientation}
          touch={touch}
          disabled={!seated}
          onSpot={place}
          onNumber={onNumber}
        />
        <div className="dn-felt__controls">
          <ChipRack chips={chips} balance={seat?.balance ?? 0} disabled={!seated} />
          <div className="dn-actions" role="group" aria-label="Bet controls">
            <Button size="sm" icon="arrow-left" disabled={!betting || myStake === 0} onClick={() => control(DASINO_MSG.undo)}>
              Undo
            </Button>
            <Button size="sm" icon="trash" disabled={!betting || myStake === 0} onClick={() => control(DASINO_MSG.clear)}>
              Clear
            </Button>
            {myStake > 0 ? (
              <Button size="sm" icon="plus" disabled={!betting || (seat?.balance ?? 0) < myStake || myBets.some((b) => b.amount * 2 > settings.maxBet)} onClick={() => control(DASINO_MSG.double)}>
                Double
              </Button>
            ) : (
              <Button size="sm" icon="refresh" disabled={!betting || !priv?.lastRoulette.length} onClick={() => control(DASINO_MSG.rebet)}>
                Rebet
              </Button>
            )}
          </div>
        </div>
        <RoundBoard state={state} settled={settledHere} playerId={playerId} />
      </section>

      <Modal open={Boolean(chooser)} onClose={() => setChooser(null)} title={chooser ? `${BET_MODE_LABEL[betMode]} bets on ${chooser.n}` : 'Choose a bet'}>
        <div className="dn-chooser">
          {chooser?.options.map((def) => (
            <Button
              key={def.key}
              block
              onClick={() => {
                place(def.key);
                setChooser(null);
              }}
            >
              <span>{def.label}</span>
              <span className="dn-chooser__pay">{def.payout}:1</span>
            </Button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
function WheelOverlay({ state }: { state: DasinoPublicState }) {
  const r = state.roulette;
  const { reduced } = useMotion();
  if (r.phase === 'RESULT' && r.result >= 0) {
    const info = rouletteNumberInfo(r.result);
    return (
      <div className="dn-wheel-result" data-color={info.color} key={r.round} role="status">
        <span className="dn-wheel-result__n">{r.result}</span>
        <span className="dn-wheel-result__c">{info.color}</span>
      </div>
    );
  }
  if (r.phase === 'SPINNING' && reduced) {
    return (
      <div className="dn-wheel-result dn-wheel-result--wait" role="status">
        <span className="dn-wheel-result__c">Spinning…</span>
      </div>
    );
  }
  return null;
}

function StatusBar({
  state,
  settings,
  myStake,
  myPayout,
  seated,
}: {
  state: DasinoPublicState;
  settings: DasinoSettings;
  myStake: number;
  myPayout: { staked: number; returned: number } | undefined;
  seated: boolean;
}) {
  const r = state.roulette;
  let title = 'Waiting for players';
  let detail: string | null = null;
  if (r.phase === 'BETTING') {
    title = 'Place your bets';
    detail = myStake > 0 ? `Your chips: ${fmt(myStake)}` : seated ? 'Pick a chip, then tap the felt' : 'Watching the table';
  } else if (r.phase === 'CLOSED') {
    title = 'No more bets';
    detail = myStake > 0 ? `Riding: ${fmt(myStake)}` : null;
  } else if (r.phase === 'SPINNING') {
    title = 'Spinning…';
    detail = myStake > 0 ? `Riding: ${fmt(myStake)}` : null;
  } else if (r.phase === 'RESULT' && r.result >= 0) {
    const info = rouletteNumberInfo(r.result);
    const tags = [info.color.toUpperCase(), info.parity?.toUpperCase(), info.half === 'low' ? '1–18' : info.half === 'high' ? '19–36' : null].filter(Boolean);
    title = `${r.result} · ${tags.join(' · ')}`;
    if (myPayout) detail = payoutLine(myPayout);
  }
  const tone = r.phase === 'RESULT' && myPayout ? (myPayout.returned > myPayout.staked ? 'win' : myPayout.returned < myPayout.staked ? 'loss' : undefined) : undefined;
  return (
    <div className="dn-status" data-phase={r.phase} data-tone={tone} aria-live="polite">
      {r.phase === 'BETTING' ? <PhaseTimer endsAt={r.endsAt} totalMs={settings.rouletteBettingSeconds * 1000} label="Betting closes in" /> : <span className="dn-status__icon" aria-hidden />}
      <div className="dn-status__text">
        <strong>{title}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
    </div>
  );
}

function History({ numbers }: { numbers: number[] }) {
  const recent = [...numbers].reverse();
  const counts = { red: 0, black: 0, green: 0 };
  for (const n of numbers) counts[rouletteColor(n)]++;
  return (
    <div className="dn-history" data-part="history">
      <div className="dn-history__head">
        <span className="dc-label">{numbers.length === 1 ? 'Last spin' : `Last ${numbers.length || ''} spins`}</span>
        {numbers.length ? (
          <span className="dn-history__split" aria-label={`${counts.red} red, ${counts.black} black, ${counts.green} zero`}>
            <i data-c="red" style={{ flex: counts.red || 0.001 }} />
            <i data-c="green" style={{ flex: counts.green || 0.001 }} />
            <i data-c="black" style={{ flex: counts.black || 0.001 }} />
          </span>
        ) : null}
      </div>
      {recent.length ? (
        <ol className="dn-history__list" aria-label="Recent results, newest first">
          {recent.map((n, i) => (
            <li key={`${numbers.length - i}-${n}`} data-c={rouletteColor(n)} className={i === 0 ? 'is-latest' : undefined}>
              {n}
            </li>
          ))}
        </ol>
      ) : (
        <p className="dn-muted">No spins yet — the first ball drops soon.</p>
      )}
    </div>
  );
}

function RoundBoard({ state, settled, playerId }: { state: DasinoPublicState; settled: RouletteSettledPayload | null; playerId: string | null }) {
  const r = state.roulette;
  const rows = useMemo(() => {
    const totals = new Map<string, number>();
    for (const b of r.bets) totals.set(b.playerId, (totals.get(b.playerId) ?? 0) + b.amount);
    return [...totals.entries()].map(([id, staked]) => {
      const payout = r.phase === 'RESULT' ? (settled?.payouts ?? r.payouts).find((p) => p.playerId === id) : undefined;
      return { id, staked, net: payout ? payout.returned - payout.staked : null };
    });
  }, [r.bets, r.phase, r.payouts, settled]);
  if (rows.length === 0) return null;
  return (
    <ul className="dn-roundboard" aria-label="Bets this spin">
      {rows.map((row) => {
        const p = state.players[row.id];
        return (
          <li key={row.id} className={row.id === playerId ? 'is-me' : undefined}>
            <i style={{ background: p?.color }} aria-hidden />
            <span className="dn-roundboard__name">{p?.name ?? 'Player'}</span>
            <span className="dc-num">{fmt(row.staked)}</span>
            {row.net !== null ? <span className={cx('dc-num dn-roundboard__net', row.net > 0 && 'is-up', row.net < 0 && 'is-down')}>{signed(row.net)}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// The felt
// ---------------------------------------------------------------------------
function RouletteBoard({
  state,
  playerId,
  orientation,
  touch,
  disabled,
  onSpot,
  onNumber,
}: {
  state: DasinoPublicState;
  playerId: string | null;
  orientation: Orientation;
  touch: boolean;
  disabled: boolean;
  onSpot: (key: string) => void;
  onNumber: (n: number) => void;
}) {
  const r = state.roulette;
  const [hover, setHover] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [unit, setUnit] = useState(48);
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      setUnit(orientation === 'horizontal' ? w / BOARD_W : w / BOARD_H);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [orientation]);
  const chipSize = Math.round(Math.max(18, Math.min(30, unit * (orientation === 'horizontal' ? 0.5 : 0.34))));

  const covered = hover ? new Set(SPOT_BY_KEY.get(hover)?.def.numbers ?? []) : null;
  const showResult = r.phase === 'RESULT' && r.result >= 0;
  const mine = new Map<string, number>();
  const others = new Map<string, Array<{ id: string; amount: number }>>();
  for (const b of r.bets) {
    if (b.playerId === playerId) mine.set(b.spot, (mine.get(b.spot) ?? 0) + b.amount);
    else others.set(b.spot, [...(others.get(b.spot) ?? []), { id: b.playerId, amount: b.amount }]);
  }
  const wins = (key: string) => Boolean(showResult && SPOT_BY_KEY.get(key)?.def.numbers.includes(r.result));

  const hoverProps = (key: string) =>
    touch
      ? {}
      : {
          onPointerEnter: () => setHover(key),
          onFocus: () => setHover(key),
          onBlur: () => setHover((h) => (h === key ? null : h)),
        };

  const cellButton = (s: BoardSpot) => {
    const n = s.def.numbers[0]!;
    const color = rouletteColor(n);
    const mineAmt = mine.get(s.key);
    return (
      <button
        key={s.key}
        type="button"
        className={cx('dn-cell', `dn-cell--${color}`, s.kind === 'zero' && 'dn-cell--zero', covered?.has(n) && 'is-covered', showResult && n === r.result && 'is-winner')}
        style={toPercent(s.rect, orientation)}
        aria-label={`${n} ${color}, straight ${payoutText(s.def)}${mineAmt ? `, your bet ${mineAmt}` : ''}`}
        disabled={disabled}
        onClick={() => onNumber(n)}
        {...hoverProps(s.key)}
      >
        <span>{s.text}</span>
      </button>
    );
  };

  return (
    <div
      className="dn-board"
      data-part="felt"
      data-orientation={orientation}
      data-touch={touch ? 'true' : undefined}
      data-open={r.phase === 'BETTING' ? 'true' : undefined}
      ref={boardRef}
      onPointerLeave={() => setHover(null)}
      style={{ '--unit': `${unit}px` } as CSSProperties}
    >
      <div className="dn-board__felt">
        {BOARD.numbers.map(cellButton)}
        {BOARD.outside.map((s) => {
          const mineAmt = mine.get(s.key);
          const isCovered = covered && s.def.numbers.every((n) => covered.has(n)) && hover === s.key;
          return (
            <button
              key={s.key}
              type="button"
              className={cx('dn-out', `dn-out--${s.kind}`, isCovered && 'is-covered', s.key === 'red' && 'dn-out--red', s.key === 'black' && 'dn-out--black', wins(s.key) && 'is-winner')}
              style={toPercent(s.rect, orientation)}
              aria-label={`${s.def.label}, ${payoutText(s.def)}${mineAmt ? `, your bet ${mineAmt}` : ''}`}
              disabled={disabled}
              onClick={() => onSpot(s.key)}
              {...hoverProps(s.key)}
            >
              {s.key === 'red' || s.key === 'black' ? <i className="dn-diamond" aria-hidden /> : null}
              <span>{s.text}</span>
            </button>
          );
        })}
        {touch
          ? null
          : BOARD.inside.map((s) => (
              <button
                key={s.key}
                type="button"
                className={cx('dn-hit', `dn-hit--${s.kind}`)}
                style={toPercent(s.rect, orientation)}
                aria-label={`${s.def.label}, ${payoutText(s.def)}${mine.get(s.key) ? `, your bet ${mine.get(s.key)}` : ''}`}
                disabled={disabled}
                onClick={() => onSpot(s.key)}
                {...hoverProps(s.key)}
              >
                <i aria-hidden />
              </button>
            ))}
      </div>
      {r.phase === 'CLOSED' ? (
        <div className="dn-board__banner" role="status">
          No more bets
        </div>
      ) : null}
      <div className="dn-board__chips" aria-hidden>
        {[...others.entries()].map(([key, list]) => {
          const s = SPOT_BY_KEY.get(key);
          if (!s) return null;
          const total = list.reduce((a, b) => a + b.amount, 0);
          return (
            <span key={`o-${key}`} className={cx('dn-others', showResult && (wins(key) ? 'is-won' : 'is-lost'))} style={pointPercent(s.anchor, orientation)} title={`${fmt(total)} from others`}>
              {list.slice(0, 3).map((b) => (
                <i key={b.id} style={{ background: state.players[b.id]?.color ?? '#888' }} />
              ))}
            </span>
          );
        })}
        {[...mine.entries()].map(([key, amount]) => {
          const s = SPOT_BY_KEY.get(key);
          if (!s) return null;
          const won = wins(key);
          return (
            <span
              key={`m-${key}`}
              className={cx('dn-stack', showResult && (won ? 'is-won' : 'is-lost'))}
              style={{ ...pointPercent(s.anchor, orientation), '--chip': `${chipSize}px` } as CSSProperties}
            >
              <ChipStack amount={amount} size={chipSize} maxChips={5} />
              {chipBreakdown(amount, 99).length > 1 ? <em className="dc-num">{amount >= 1000 ? `${+(amount / 1000).toFixed(1)}K` : amount}</em> : null}
              {showResult && won ? <b className="dn-stack__win dc-num">+{fmt(amount * s.def.payout)}</b> : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Tiny static roulette board summary for the floor card. */
export function RouletteHistoryPills({ numbers, max = 6 }: { numbers: number[]; max?: number }) {
  const recent = [...numbers].reverse().slice(0, max);
  if (!recent.length) return <span className="dn-muted">No spins yet</span>;
  return (
    <span className="dn-pills" aria-label={`Last results: ${recent.join(', ')}`}>
      {recent.map((n, i) => (
        <i key={i} data-c={rouletteColor(n)}>
          {n}
        </i>
      ))}
    </span>
  );
}
