/**
 * Neon 7s — the DASino slot machine. The server decides and settles each spin;
 * the reels animate to the server's stops, then winning lines light up and the
 * win counter ticks up. The info screen publishes the full model: paytable,
 * paylines, reel-strip composition and the exact RTP.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Button, IconButton, Kbd, Modal, Segmented, cx } from '@dascade/ui';
import {
  SLOT_LINE_OPTIONS,
  SLOT_PAYLINES,
  SLOT_PAYLINE_NAMES,
  SLOT_PAYTABLE,
  SLOT_REELS,
  SLOT_SYMBOLS,
  SLOT_SYMBOL_NAMES,
  slotStats,
  slotStripComposition,
  type SlotStops,
  type SlotSymbol,
} from '@dascade/game-core/dasino';
import {
  DASINO_MSG,
  DASINO_TIMING,
  slotLineBets,
  type DasinoPrivatePayload,
  type DasinoPublicState,
  type DasinoSeatView,
  type DasinoSettings,
  type SlotResultPayload,
} from '@dascade/shared/games/dasino';
import type { ActionErrorPayload } from '@dascade/shared';
import { session, useLatestMessage, useRoomMessage } from '../../net/hooks.ts';
import { synth } from '../../audio/audio.ts';
import { SlotReels, type SlotReelsHandle } from './SlotReels.tsx';
import { Sprite } from './Sprite.tsx';
import { SLOT_SPRITES } from './sprites.ts';
import { Celebration, winTitle, type CelebrationInfo } from './Celebration.tsx';
import { TableCrowd, useTween } from './parts.tsx';
import { fmt, play, signed, useDasinoUi, useMotion } from './ui.ts';

const LINE_COLORS = ['#ffd23f', '#5eead4', '#ff4fd8', '#c084fc', '#60a5fa'];
const DEFAULT_STOPS: SlotStops = [6, 9, 3];
/** Extra wait after the server lock so an honest client never trips it. */
const LOCK_SLACK_MS = 80;

type Mode = 'idle' | 'spinning' | 'presenting';

export function SlotsTable({ state, settings, seat }: { state: DasinoPublicState; settings: DasinoSettings; seat: DasinoSeatView | undefined }) {
  const reels = useRef<SlotReelsHandle>(null);
  const { reduced } = useMotion();
  const lines = useDasinoUi((s) => s.lines);
  const setLines = useDasinoUi((s) => s.setLines);
  const lineBet = useDasinoUi((s) => s.lineBet);
  const setLineBet = useDasinoUi((s) => s.setLineBet);
  const setFreeze = useDasinoUi((s) => s.setFreeze);
  const slotLog = useDasinoUi((s) => s.slotLog);
  const priv = useLatestMessage<DasinoPrivatePayload>(DASINO_MSG.private);
  const [mode, setMode] = useState<Mode>('idle');
  const [result, setResult] = useState<SlotResultPayload | null>(null);
  const [focusLine, setFocusLine] = useState<number | null>(null);
  const [winCount, setWinCount] = useState(0);
  const [celebrate, setCelebrate] = useState<CelebrationInfo | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [lever, setLever] = useState(false);
  const [lockUntil, setLockUntil] = useState(0);
  const [, tick] = useState(0);
  const pending = useRef(false);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initial = useRef<SlotStops>(priv?.lastSlot?.stops ?? DEFAULT_STOPS);

  const bets = useMemo(() => slotLineBets(settings, lines), [settings, lines]);
  const validBet = bets.includes(lineBet);
  const totalBet = lineBet * lines;
  const balance = seat?.balance ?? 0;
  const now = performance.now();
  const locked = now < lockUntil;
  const canSpin = Boolean(seat) && mode !== 'spinning' && validBet && totalBet <= balance && !locked;

  // Keep the line bet valid for the current limits / line count.
  useEffect(() => {
    if (bets.length && !bets.includes(lineBet)) {
      const next = bets.reduce((best, b) => (Math.abs(b - lineBet) < Math.abs(best - lineBet) ? b : best), bets[0]!);
      setLineBet(next);
    }
  }, [bets, lineBet, setLineBet]);

  // Re-render when the spin lock expires so the button re-enables.
  useEffect(() => {
    if (!locked) return;
    const t = setTimeout(() => tick((n) => n + 1), lockUntil - performance.now() + 5);
    return () => clearTimeout(t);
  }, [locked, lockUntil]);

  // Unmount mid-spin: never leave the balance frozen.
  useEffect(() => () => setFreeze(null), [setFreeze]);

  const present = useCallback(
    (res: SlotResultPayload) => {
      setFreeze(null);
      setResult(res);
      setMode('presenting');
      if (res.totalWin > 0) {
        const multiple = res.totalWin / res.totalBet;
        if (multiple >= 10) {
          play('bigwin');
          setCelebrate({ key: `${res.id}-${res.at}`, title: winTitle(multiple), amount: res.totalWin, subtitle: `${multiple.toFixed(1)}× your bet` });
        } else play('win');
      } else play('lose', 60);
    },
    [setFreeze],
  );

  useRoomMessage<SlotResultPayload>(DASINO_MSG.slotResult, (res) => {
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    pending.current = false;
    setLockUntil(performance.now() + DASINO_TIMING.slotSpinMs + LOCK_SLACK_MS);
    const r = reels.current;
    if (!r || reduced) {
      r?.snap(res.stops);
      present(res);
      return;
    }
    r.land(
      res.stops,
      () => synth.tone({ type: 'square', freq: 150, to: 90, dur: 0.07, gain: 0.12 }),
      () => present(res),
    );
  });

  useRoomMessage<ActionErrorPayload>('sys:error', (err) => {
    if (err.type !== DASINO_MSG.spin || !pending.current) return;
    pending.current = false;
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    reels.current?.abort();
    setFreeze(null);
    setMode('idle');
  });

  const spin = useCallback(() => {
    if (!canSpin || !seat) {
      if (seat && totalBet > balance) play('error');
      return;
    }
    play('spin');
    setMode('spinning');
    setResult(null);
    setFocusLine(null);
    setWinCount(0);
    setFreeze(balance - totalBet);
    if (!reduced) reels.current?.start();
    pending.current = true;
    session.send(DASINO_MSG.spin, { lineBet, lines });
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    pendingTimer.current = setTimeout(() => {
      if (!pending.current) return;
      pending.current = false;
      reels.current?.abort();
      setFreeze(null);
      setMode('idle');
    }, 6000);
  }, [canSpin, seat, totalBet, balance, reduced, setFreeze, lineBet, lines]);

  // Space bar spins (unless typing / focused on another control).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.closest('input, textarea, select, button, [contenteditable="true"], dialog[open]') || el.isContentEditable)) return;
      e.preventDefault();
      spin();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spin]);

  // Win presentation: count up, then cycle through the winning lines.
  const wins = useMemo(() => result?.wins ?? [], [result]);
  const shownWin = useTween(mode === 'presenting' ? winCount : 0, reduced ? 0 : 900);
  useEffect(() => {
    if (mode !== 'presenting' || !result || result.totalWin <= 0) return;
    setWinCount(result.totalWin);
    if (reduced) return;
    let n = 0;
    const coin = setInterval(() => {
      play('coin', 90);
      if (++n > 6) clearInterval(coin);
    }, 130);
    return () => clearInterval(coin);
  }, [mode, result, reduced]);
  useEffect(() => {
    if (mode !== 'presenting' || wins.length < 2) {
      setFocusLine(null);
      return;
    }
    let i = -1;
    const id = setInterval(() => {
      i = (i + 1) % (wins.length + 1);
      setFocusLine(i === wins.length ? null : wins[i]!.line);
    }, 1100);
    return () => clearInterval(id);
  }, [mode, wins]);

  const pull = () => {
    if (!canSpin) return;
    setLever(true);
    setTimeout(() => setLever(false), 420);
    spin();
  };

  const stepBet = (dir: 1 | -1) => {
    const i = bets.indexOf(lineBet);
    const next = bets[Math.max(0, Math.min(bets.length - 1, (i < 0 ? 0 : i) + dir))];
    if (next !== undefined && next !== lineBet) {
      play('click');
      setLineBet(next);
    }
  };

  const displayLine = focusLine !== null ? wins.find((w) => w.line === focusLine) : null;
  let message: React.ReactNode = 'Good luck!';
  if (!seat) message = 'Spectating — take a seat to spin';
  else if (mode === 'spinning') message = 'Spinning…';
  else if (mode === 'presenting' && result) {
    if (displayLine) message = `Line ${displayLine.line + 1} · ${displayLine.count}× ${SLOT_SYMBOL_NAMES[displayLine.symbol as SlotSymbol]} · ${fmt(displayLine.pay)}`;
    else if (result.totalWin > 0) message = `${wins.length} winning line${wins.length === 1 ? '' : 's'}`;
    else message = 'No win this time';
  } else if (!validBet) message = 'Pick a bet within the table limits';
  else if (totalBet > balance) message = 'Not enough chips for this bet';

  const litCells = new Set(wins.filter((w) => focusLine === null || w.line === focusLine).flatMap((w) => w.cells.map(([r, row]) => `${r}:${row}`)));

  return (
    <div className="dn-slots">
      <div className="dn-slots__stage">
        <div className={cx('dn-machine', mode === 'presenting' && result && result.totalWin > 0 && 'is-winning')}>
          <div className="dn-machine__marquee" aria-hidden>
            <span className="dn-bulbs" />
            <span className="dn-machine__title">
              NEON <b>7</b>s
            </span>
            <span className="dn-bulbs" />
          </div>
          <div className="dn-machine__window">
            <LineMarkers side="left" lines={lines} focus={focusLine} wins={wins.map((w) => w.line)} />
            <div className="dn-reels" data-spinning={mode === 'spinning' ? 'true' : undefined}>
              <SlotReels ref={reels} initial={initial.current} label={result ? `Reels stopped: ${describeStops(result.stops)}` : 'Slot reels'} />
              <svg className="dn-winlines" viewBox="0 0 3 3" preserveAspectRatio="none" aria-hidden>
                {mode === 'presenting'
                  ? wins
                      .filter((w) => focusLine === null || w.line === focusLine)
                      .map((w) => (
                        <polyline
                          key={w.line}
                          points={SLOT_PAYLINES[w.line]!.map((row, reel) => `${reel + 0.5},${row + 0.5}`).join(' ')}
                          style={{ '--lc': LINE_COLORS[w.line] } as CSSProperties}
                        />
                      ))
                  : null}
              </svg>
              <div className="dn-reels__cells" aria-hidden>
                {[0, 1, 2].map((reel) =>
                  [0, 1, 2].map((row) => (
                    <i
                      key={`${reel}:${row}`}
                      className={cx(mode === 'presenting' && litCells.has(`${reel}:${row}`) && 'is-lit')}
                      style={{ gridColumn: reel + 1, gridRow: row + 1 }}
                    />
                  )),
                )}
              </div>
              <div className="dn-reels__glass" aria-hidden />
            </div>
            <LineMarkers side="right" lines={lines} focus={focusLine} wins={wins.map((w) => w.line)} />
          </div>
          <div className="dn-machine__display" aria-live="polite">
            <div className="dn-lcd">
              <span className="dn-lcd__label">Win</span>
              <span className="dn-lcd__value dc-num">{fmt(shownWin)}</span>
            </div>
            <div className="dn-lcd dn-lcd--msg">{message}</div>
            <div className="dn-lcd">
              <span className="dn-lcd__label">Bet</span>
              <span className="dn-lcd__value dc-num">{fmt(totalBet)}</span>
            </div>
          </div>
          <div className="dn-machine__controls">
            <div className="dn-ctl">
              <span className="dc-label">Lines</span>
              <Segmented
                label="Lines played"
                value={String(lines) as '1' | '3' | '5'}
                disabled={mode === 'spinning'}
                onChange={(v) => {
                  play('click');
                  setLines(Number(v) as 1 | 3 | 5);
                }}
                options={SLOT_LINE_OPTIONS.map((n) => ({ value: String(n) as '1' | '3' | '5', label: String(n), disabled: slotLineBets(settings, n).length === 0 }))}
              />
            </div>
            <div className="dn-ctl">
              <span className="dc-label">Line bet</span>
              <div className="dn-stepper">
                <IconButton icon="minus" label="Lower line bet" size="sm" variant="secondary" disabled={mode === 'spinning' || bets.indexOf(lineBet) <= 0} onClick={() => stepBet(-1)} />
                <span className="dn-stepper__value dc-num" aria-live="polite" aria-label={`Line bet ${lineBet}`}>
                  {fmt(lineBet)}
                </span>
                <IconButton
                  icon="plus"
                  label="Raise line bet"
                  size="sm"
                  variant="secondary"
                  disabled={mode === 'spinning' || bets.indexOf(lineBet) >= bets.length - 1}
                  onClick={() => stepBet(1)}
                />
              </div>
            </div>
            <Button variant="gold" size="xl" className="dn-spin" icon="play" disabled={!canSpin} onClick={spin} aria-label={`Spin for ${totalBet} chips`} aria-keyshortcuts="Space">
              Spin
            </Button>
            <IconButton icon="info" label="Paytable and odds" variant="secondary" onClick={() => setInfoOpen(true)} />
          </div>
          <p className="dn-machine__hint">
            <Kbd>Space</Kbd> to spin · total bet = line bet × lines · results are decided by the server
          </p>
          <Celebration info={celebrate} onDone={() => setCelebrate(null)} />
        </div>
        <button type="button" className={cx('dn-lever', lever && 'is-pulled')} aria-label="Pull the lever to spin" disabled={!canSpin} onClick={pull}>
          <span className="dn-lever__rod" />
          <span className="dn-lever__knob" />
          <span className="dn-lever__base" />
        </button>
      </div>

      <aside className="dn-slots__side">
        <section className="dn-glass dn-side">
          <header className="dn-side__head">
            <h2 className="dn-h3">Paytable</h2>
            <Button size="sm" variant="ghost" icon="info" onClick={() => setInfoOpen(true)}>
              Full info
            </Button>
          </header>
          <ul className="dn-paymini">
            {(['das', 'seven', 'rocket', 'coin', 'bell', 'floppy', 'joystick', 'cherry'] as SlotSymbol[]).map((sym) => (
              <li key={sym}>
                <span className="dn-paymini__syms">
                  {[0, 1, 2].map((i) => (
                    <Sprite key={i} rows={SLOT_SPRITES[sym]} size={22} />
                  ))}
                </span>
                <span className="dn-paymini__pay dc-num">{SLOT_PAYTABLE[sym][3]}×</span>
              </li>
            ))}
            <li className="dn-paymini__extra">
              <span>
                <Sprite rows={SLOT_SPRITES.seven} size={18} />
                <Sprite rows={SLOT_SPRITES.seven} size={18} /> any
              </span>
              <span className="dc-num">5×</span>
            </li>
            <li className="dn-paymini__extra">
              <span>
                <Sprite rows={SLOT_SPRITES.cherry} size={18} />
                <Sprite rows={SLOT_SPRITES.cherry} size={18} /> any · <Sprite rows={SLOT_SPRITES.cherry} size={18} /> any any
              </span>
              <span className="dc-num">2× · 1×</span>
            </li>
          </ul>
          <p className="dn-muted dn-small dn-wildnote">
            <Sprite rows={SLOT_SPRITES.das} size={18} /> <span>DAS is wild. Pays × line bet, left to right.</span>
          </p>
        </section>
        <section className="dn-glass dn-side">
          <header className="dn-side__head">
            <h2 className="dn-h3">Your spins</h2>
            <TableCrowd state={state} table="slots" />
          </header>
          {slotLog.length ? (
            <ol className="dn-spinlog">
              {slotLog.slice(0, 8).map((r) => (
                <li key={`${r.id}-${r.at}`}>
                  <span className="dn-spinlog__syms" aria-hidden>
                    {[0, 1, 2].map((reel) => (
                      <Sprite key={reel} rows={SLOT_SPRITES[middleSymbol(r.stops, reel)]} size={16} />
                    ))}
                  </span>
                  <span className="dc-num dn-muted">{fmt(r.totalBet)}</span>
                  <span className={cx('dc-num', r.totalWin > r.totalBet ? 'is-up' : r.totalWin === 0 ? 'is-down' : undefined)}>{signed(r.totalWin - r.totalBet)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="dn-muted dn-small">No spins yet this visit. RTP is {(slotStats().rtp * 100).toFixed(2)}% — see the info screen for how it’s computed.</p>
          )}
        </section>
      </aside>
      <SlotInfoModal open={infoOpen} onClose={() => setInfoOpen(false)} />
    </div>
  );
}

function middleSymbol(stops: readonly number[], reel: number): SlotSymbol {
  const strip = SLOT_REELS[reel]!;
  return strip[((stops[reel]! % strip.length) + strip.length) % strip.length]!;
}

function describeStops(stops: readonly number[]): string {
  return [0, 1, 2].map((r) => SLOT_SYMBOL_NAMES[middleSymbol(stops, r)]).join(', ');
}

function LineMarkers({ side, lines, focus, wins }: { side: 'left' | 'right'; lines: number; focus: number | null; wins: number[] }) {
  // Row (0–2) where each payline enters (left) / exits (right) the window.
  const rows = SLOT_PAYLINES.map((l) => (side === 'left' ? l[0] : l[2]));
  const groups: number[][] = [[], [], []];
  rows.forEach((row, line) => groups[row]!.push(line));
  return (
    <div className={`dn-linemarks dn-linemarks--${side}`} aria-hidden>
      {groups.map((group, row) => (
        <div key={row} className="dn-linemarks__row">
          {group.map((line) => (
            <span
              key={line}
              className={cx('dn-linemark', line < lines && 'is-on', wins.includes(line) && 'is-win', focus === line && 'is-focus')}
              style={{ '--lc': LINE_COLORS[line] } as CSSProperties}
            >
              {line + 1}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transparent information screen
// ---------------------------------------------------------------------------
export function SlotInfoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const stats = useMemo(() => (open ? slotStats() : null), [open]);
  const comp = useMemo(() => slotStripComposition(), []);
  const order: SlotSymbol[] = ['das', 'seven', 'rocket', 'coin', 'bell', 'floppy', 'joystick', 'cherry'];
  return (
    <Modal open={open} onClose={onClose} wide title="Neon 7s · how it pays">
      <div className="dn-info">
        <section>
          <h3 className="dn-h3">Paytable (× line bet)</h3>
          <table className="dn-table">
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col">3 in a row</th>
                <th scope="col">2 from left</th>
                <th scope="col">1 on reel 1</th>
              </tr>
            </thead>
            <tbody>
              {order.map((sym) => (
                <tr key={sym}>
                  <th scope="row">
                    <span className="dn-sym">
                      <Sprite rows={SLOT_SPRITES[sym]} size={28} />
                      <span>{SLOT_SYMBOL_NAMES[sym]}</span>
                    </span>
                  </th>
                  <td className="dc-num">{SLOT_PAYTABLE[sym][3] ?? '—'}</td>
                  <td className="dc-num">{SLOT_PAYTABLE[sym][2] ?? '—'}</td>
                  <td className="dc-num">{SLOT_PAYTABLE[sym][1] ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="dn-rules">
            <li>
              <strong>DAS is wild:</strong> it stands in for any symbol. Three DAS pay the 300× jackpot.
            </li>
            <li>Lines are read from the left reel. Each line pays only its single highest combination.</li>
            <li>Total bet = line bet × lines played (1, 3 or 5). Wins are added up across lines.</li>
          </ul>
        </section>
        <section>
          <h3 className="dn-h3">Paylines</h3>
          <div className="dn-paylines">
            {SLOT_PAYLINES.map((rows, line) => (
              <figure key={line} className="dn-payline">
                <svg viewBox="0 0 3 3" aria-hidden>
                  {[0, 1, 2].map((reel) => [0, 1, 2].map((row) => <rect key={`${reel}${row}`} x={reel + 0.08} y={row + 0.08} width={0.84} height={0.84} rx={0.12} className={rows[reel] === row ? 'on' : undefined} style={{ '--lc': LINE_COLORS[line] } as CSSProperties} />))}
                </svg>
                <figcaption>
                  {line + 1}. {SLOT_PAYLINE_NAMES[line]}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
        <section>
          <h3 className="dn-h3">Reel strips (32 stops each)</h3>
          <table className="dn-table dn-table--compact">
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col">Reel 1</th>
                <th scope="col">Reel 2</th>
                <th scope="col">Reel 3</th>
              </tr>
            </thead>
            <tbody>
              {SLOT_SYMBOLS.map((sym) => (
                <tr key={sym}>
                  <th scope="row">
                    <span className="dn-sym">
                      <Sprite rows={SLOT_SPRITES[sym]} size={20} />
                      <span>{SLOT_SYMBOL_NAMES[sym]}</span>
                    </span>
                  </th>
                  {comp.map((c, i) => (
                    <td key={i} className="dc-num">
                      {c[sym]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="dn-fair">
          <h3 className="dn-h3">Fairness</h3>
          <p>
            When you press Spin, the server picks each reel’s stop independently with a cryptographic random number generator — 32 × 32 × 32 ={' '}
            <strong>{stats ? fmt(stats.combinations) : '32,768'}</strong> equally likely outcomes — settles the spin, and only then tells your screen where to stop.
          </p>
          <dl className="dn-stats">
            <div>
              <dt>Return to player</dt>
              <dd className="dc-num">{stats ? `${(stats.rtp * 100).toFixed(2)}%` : '…'}</dd>
            </div>
            <div>
              <dt>Lines that pay</dt>
              <dd className="dc-num">{stats ? `${(stats.lineHitRate * 100).toFixed(1)}%` : '…'}</dd>
            </div>
            <div>
              <dt>5-line spins that pay</dt>
              <dd className="dc-num">{stats ? `${(stats.spinHitRate * 100).toFixed(1)}%` : '…'}</dd>
            </div>
            <div>
              <dt>Top prize</dt>
              <dd className="dc-num">300× line bet</dd>
            </div>
          </dl>
          <p className="dn-muted dn-small">
            The RTP is exact: it is computed by evaluating every one of the {stats ? fmt(stats.combinations) : '32,768'} stop combinations on all five lines ({stats ? fmt(stats.totalReturn) : '…'} line bets returned per{' '}
            {stats ? fmt(stats.combinations * 5) : '…'} wagered). Every line has the same odds, so the RTP is the same for 1, 3 or 5 lines. Virtual chips only — nothing here can be bought or cashed out.
          </p>
        </section>
      </div>
    </Modal>
  );
}
