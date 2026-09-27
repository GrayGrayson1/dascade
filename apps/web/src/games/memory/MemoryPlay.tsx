/**
 * Memory Matrix — play screen. Server-driven: the pattern arrives with a server start time and
 * is played back locally on the synced clock; every tap is judged by the server (private
 * feedback), and the answer is revealed to everyone when the round closes.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CLASSICS_MSG, type RunVerdict } from '@dascade/shared/games/classics';
import {
  MEMORY_MSG,
  type MemoryFeedback,
  type MemoryPatternMsg,
  type MemoryPublicState,
  type MemoryReveal,
  type MemorySettings,
  type MemoryYou,
} from '@dascade/shared/games/memory';
import { Button, PixelIcon, Segmented, cx } from '@dascade/ui';
import { useCountdown, useLatestMessage, useRoomMessage, useRoomSelector, useSettings } from '../../net/hooks.ts';
import { serverNow, session } from '../../net/session.ts';
import { useApp } from '../../app/store.ts';
import {
  ClassicsShell,
  CountdownCard,
  GameOverCard,
  HighScoreBoard,
  HudLives,
  HudStat,
  SpectatorHud,
  InstructionsCard,
  RailPanel,
  StandingsPanel,
  classicSfx,
  formatScore,
  useClassicsMeta,
  useHighScores,
  useMyId,
  useMyStanding,
  usePersonalBest,
  useStandings,
  type ClassicsGameInfo,
  type FinalResult,
} from '../_classics/index.ts';

export const MEMORY_INFO: ClassicsGameInfo = {
  gameId: 'memory',
  howTo: [
    { icon: 'eye', text: 'Watch the tiles light up — one after another (SEQUENCE) or all at once (FLASH).' },
    { icon: 'grip', text: 'Then repeat it: sequences in the same order, flashes in any order.' },
    { icon: 'bolt', text: 'Every round is longer and faster, and the grid grows. Answer fast for bonus points.' },
    { icon: 'heart', text: 'A wrong tile or running out of time costs a life (or ends your run in Sudden Death).' },
  ],
  keys: [
    { keys: ['1–9'], action: 'Tap tiles (3×3 grid)' },
    { keys: ['Tab', 'Enter'], action: 'Any tile, any grid' },
    { keys: ['Enter'], action: 'Start / play again' },
  ],
  touch: ['Tap the tiles', 'Watch first — taps unlock on YOUR TURN'],
  statLabel: 'Rounds',
};

/** 25 tile hues so patterns are colourful and memorable (game art palette). */
const TILE_HUES = [
  '#ff4fd8', '#7cf5ff', '#ffd23f', '#2de38f', '#a78bfa',
  '#ff8a3d', '#60a5fa', '#f472b6', '#a3e635', '#22d3ee',
  '#fb7185', '#facc15', '#34d399', '#c084fc', '#38bdf8',
  '#fda4af', '#fde047', '#6ee7b7', '#d8b4fe', '#93c5fd',
  '#f9a8d4', '#bef264', '#67e8f9', '#fdba74', '#e879f9',
];

const DIGIT_KEYS: Record<string, number> = {};
for (let i = 1; i <= 9; i++) {
  DIGIT_KEYS[`Digit${i}`] = i - 1;
  DIGIT_KEYS[`Numpad${i}`] = i - 1;
}

export function MemoryPlay() {
  const meta = useClassicsMeta();
  const me = useMyId();
  const mine = useMyStanding();
  const rows = useStandings();
  const settings = useSettings<MemorySettings>();
  const phase = useRoomSelector((s) => s.phase);
  const isSpectator = useRoomSelector((s) => Boolean(me && s.players?.[me]?.spectator)) ?? false;
  const stage = useRoomSelector<MemoryPublicState, string>((s) => s.stage ?? 'idle') ?? 'idle';
  const stageEndsAt = useRoomSelector<MemoryPublicState, number>((s) => s.stageEndsAt ?? 0) ?? 0;
  const size = useRoomSelector<MemoryPublicState, number>((s) => s.grid || 3) ?? 3;
  const kind = useRoomSelector<MemoryPublicState, string>((s) => s.kind || 'sequence') ?? 'sequence';
  const count = useRoomSelector<MemoryPublicState, number>((s) => s.count ?? 0) ?? 0;
  const round = useRoomSelector((s) => s.round) ?? 0;
  const myMark = useRoomSelector<MemoryPublicState, { progress: number; state: string } | null>((s) => (me ? (s.marks?.[me] ?? null) : null));
  const marks = useRoomSelector<MemoryPublicState, Record<string, { progress: number; state: string }>>((s) => s.marks ?? {}, sameMarks) ?? {};
  const reducedMotion = useApp((s) => s.settings.reducedMotion);
  const solo = Boolean(meta?.solo);
  const board = meta?.board ?? 'classic';
  const [best, submitBest] = usePersonalBest('memory', board);
  const status = mine?.status ?? 'idle';

  // --- pattern playback -----------------------------------------------------------
  const pattern = useLatestMessage<MemoryPatternMsg>(MEMORY_MSG.pattern);
  const [lit, setLit] = useState<number[]>([]);
  useEffect(() => {
    if (!pattern || pattern.round !== round || stage !== 'show') {
      setLit([]);
      return;
    }
    let raf = 0;
    let last = '';
    const total = pattern.kind === 'flash' ? pattern.stepMs : pattern.tiles.length * pattern.stepMs + (pattern.tiles.length - 1) * pattern.gapMs;
    const tick = () => {
      const t = serverNow() - pattern.showAt;
      let on: number[] = [];
      if (t >= 0 && t < total) {
        if (pattern.kind === 'flash') on = pattern.tiles;
        else {
          const period = pattern.stepMs + pattern.gapMs;
          const i = Math.floor(t / period);
          if (i < pattern.tiles.length && t - i * period < pattern.stepMs) on = [pattern.tiles[i]!];
        }
      }
      const key = on.join(',');
      if (key !== last) {
        last = key;
        setLit(on);
        if (on.length === 1) classicSfx('tile', { index: on[0], gap: 0 });
        else if (on.length > 1) classicSfx('tile', { index: 12, gap: 0 });
      }
      if (t < total + 100) raf = requestAnimationFrame(tick);
      else setLit([]);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pattern, round, stage]);

  // --- my taps (private feedback) ------------------------------------------------------
  const [found, setFound] = useState<number[]>([]);
  const [wrong, setWrong] = useState<number | null>(null);
  const [pressed, setPressed] = useState<number | null>(null);
  const roundRef = useRef(round);
  // A new round — or a new run/match that starts again at the same round number (solo Retry after
  // failing round 1, a rematch) — clears the private tap feedback.
  const attempt = `${meta?.matchNo ?? 0}:${mine?.runs ?? 0}:${round}`;
  const attemptRef = useRef(attempt);
  useEffect(() => {
    roundRef.current = round;
    if (attemptRef.current !== attempt) {
      attemptRef.current = attempt;
      setFound([]);
      setWrong(null);
    }
  }, [attempt, round]);
  const you = useLatestMessage<MemoryYou>(MEMORY_MSG.you);
  useEffect(() => {
    if (you && you.round === round) setFound(you.found);
  }, [you, round]);
  useRoomMessage<MemoryFeedback>(MEMORY_MSG.feedback, (fb) => {
    if (fb.round !== roundRef.current) return;
    if (fb.ok) {
      setFound((f) => (f.includes(fb.tile) && kind === 'flash' ? f : [...f, fb.tile]));
      if (fb.done) classicSfx('correct');
    } else {
      setWrong(fb.tile);
      classicSfx('wrong');
    }
  });
  const reveal = useLatestMessage<MemoryReveal>(MEMORY_MSG.reveal);
  useRoomMessage<MemoryReveal>(MEMORY_MSG.reveal, (r) => {
    if (!me || !r.results[me]) return;
    if (r.results[me] === 'done') classicSfx('levelup');
  });
  const showReveal = stage === 'review' && reveal && reveal.round === round;

  const canTap = !isSpectator && stage === 'input' && myMark?.state === 'input';
  const tap = (tile: number) => {
    if (!canTap) return;
    setPressed(tile);
    window.setTimeout(() => setPressed((p) => (p === tile ? null : p)), 160);
    classicSfx('tile', { index: tile, gap: 0 });
    session.send(MEMORY_MSG.tap, { round, tile });
  };
  const lastTouchAt = useRef(0);
  const tapRef = useRef(tap);
  tapRef.current = tap;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      const idx = DIGIT_KEYS[e.code];
      if (idx === undefined || size !== 3) return;
      e.preventDefault();
      tapRef.current(idx);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [size]);

  // --- verdict / overlay --------------------------------------------------------------
  const verdict = useLatestMessage<RunVerdict>(CLASSICS_MSG.verdict);
  const [improved, setImproved] = useState<string | null>(null);
  useEffect(() => {
    if (verdict && submitBest(verdict.score)) setImproved(verdict.runId);
  }, [verdict, submitBest]);
  const [watching, setWatching] = useState(false);
  useEffect(() => {
    if (status !== 'over') setWatching(false);
  }, [status]);

  const result: FinalResult | null =
    status === 'over' && mine
      ? {
          score: mine.score,
          reason: verdict?.reason ?? 'over',
          best: Boolean(verdict && improved === verdict.runId),
          rank: verdict?.rank ?? null,
          entryId: verdict?.entryId ?? null,
          board: verdict?.board ?? board,
          rows: [
            ['Rounds cleared', mine.stat],
            ['Reached round', mine.level],
            ['Mode', settings?.variant === 'mixed' ? 'Mixed' : settings?.variant === 'flash' ? 'Flash' : 'Sequence'],
          ],
        }
      : null;
  const start = () => {
    classicSfx('launch');
    session.send(CLASSICS_MSG.start, {});
  };
  const stillIn = rows.filter((r) => r.status === 'playing').length;

  let overlay: React.ReactNode = null;
  if (!isSpectator) {
    if (solo) {
      if (status === 'ready' || status === 'idle') overlay = <InstructionsCard info={MEMORY_INFO} onStart={start} best={best} extra={<RulePicker settings={settings} />} />;
      else if (status === 'over' && stage !== 'review') overlay = <GameOverCard info={MEMORY_INFO} result={result} onRetry={start} personalBest={best} />;
    } else if (phase === 'COUNTDOWN' && meta?.startAt) {
      overlay = <CountdownCard startAt={meta.startAt} label="Round 1 starts" sub="Same pattern for everyone" />;
    } else if (status === 'over' && !watching && stage !== 'review') {
      overlay = (
        <GameOverCard
          info={MEMORY_INFO}
          result={result}
          personalBest={best}
          waiting={stillIn > 0 ? <span>{stillIn} still in the matrix…</span> : null}
          footer={
            stillIn > 0 ? (
              <Button variant="ghost" size="sm" icon="eye" onClick={() => setWatching(true)}>
                Keep watching
              </Button>
            ) : null
          }
        />
      );
    }
  } else if (phase === 'COUNTDOWN' && meta?.startAt) overlay = <CountdownCard startAt={meta.startAt} label="Round 1 starts" />;

  // --- HUD / rails ----------------------------------------------------------------------
  const hud = (
    <>
      <HudStat label="Score" value={formatScore(mine?.score ?? 0)} emphasis />
      <HudStat label="Round" value={Math.max(1, round)} />
      <HudLives lives={status === 'ready' || status === 'idle' ? (settings?.rule === 'sudden' ? 1 : 3) : (mine?.lives ?? 0)} max={3} />
      {!solo && mine?.rank ? <HudStat label="Rank" value={`#${mine.rank}/${Math.max(1, meta?.entrants ?? rows.length)}`} /> : <HudStat label="Best" icon="trophy" value={formatScore(Math.max(best, mine?.best ?? 0))} className="cl-hide-sm" />}
    </>
  );
  const scores = useHighScores('memory', board, verdict?.runId ?? 0);
  const leftRail = (
    <RailPanel title="This round" className="mm-round">
      <p className="mm-round__kind">{kind === 'flash' ? 'Flash' : 'Sequence'}</p>
      <p className="mm-round__meta">
        <span>{count}</span> tiles · {size}×{size} grid
      </p>
      <p className="mm-round__hint">{kind === 'flash' ? 'Tap every lit tile, any order.' : 'Repeat the tiles in order.'}</p>
      <p className="mm-round__rule">
        <PixelIcon name="heart" size={12} /> {settings?.rule === 'sudden' ? 'Sudden death — one miss and you’re out' : 'Three lives'}
      </p>
    </RailPanel>
  );
  const rightRail = solo ? (
    <section className="cl-panel mm-scores cl-hide-sm">
      <HighScoreBoard data={scores.data} loading={scores.loading} error={scores.error} compact title="High scores" />
    </section>
  ) : (
    <div className="cl-hide-sm">
      <StandingsPanel rows={rows} me={me} statLabel="Rounds" />
    </div>
  );
  const ticker = !solo ? <MarksStrip rows={rows} marks={marks} me={me} /> : undefined;

  const cells = size * size;
  const revealOrder = useMemo(() => {
    const m = new Map<number, number[]>();
    if (showReveal && reveal) reveal.tiles.forEach((t, i) => m.set(t, [...(m.get(t) ?? []), i + 1]));
    return m;
  }, [showReveal, reveal]);

  return (
    <ClassicsShell
      info={MEMORY_INFO}
      hud={isSpectator ? <SpectatorHud rows={rows} /> : hud}
      left={leftRail}
      right={rightRail}
      ticker={ticker}
      overlay={overlay}
      aspect={0.84}
      leaveConfirm={!solo && status === 'playing' && phase === 'PLAYING' ? 'Leave the match? You’ll be placed last.' : undefined}
      className="mm-stage"
      compactRails="none"
    >
      <div className="mm-screen" data-reduced-motion={reducedMotion ? 'true' : undefined}>
        <StageBanner stage={stage} endsAt={stageEndsAt} kind={kind} count={count} progress={myMark?.progress ?? 0} mine={myMark?.state ?? ''} spectator={isSpectator} round={round} />
        <div className="mm-grid" style={{ '--n': String(size) } as CSSProperties} role="grid" aria-label={`Memory grid ${size} by ${size}`}>
          {Array.from({ length: cells }, (_, i) => {
            const isLit = lit.includes(i);
            const isFound = found.includes(i);
            const isWrong = wrong === i;
            const order = revealOrder.get(i);
            const label = `Tile ${i + 1}${isFound ? ', correct' : ''}${isWrong ? ', wrong' : ''}${order ? `, answer ${order.join(' and ')}` : ''}`;
            return (
              <button
                key={`${size}-${i}`}
                type="button"
                className={cx('mm-tile', isLit && 'is-lit', isFound && 'is-found', isWrong && 'is-wrong', pressed === i && 'is-pressed', order && 'is-answer', canTap && 'is-live')}
                style={{ '--hue': TILE_HUES[i % TILE_HUES.length] } as CSSProperties}
                aria-label={label}
                aria-disabled={!canTap}
                onPointerDown={(e) => {
                  if (e.pointerType !== 'mouse') {
                    // Touch/pen: act on press for speed; the synthetic click that follows is ignored.
                    lastTouchAt.current = performance.now();
                    tap(i);
                  }
                }}
                onClick={() => {
                  // Mouse and keyboard activation.
                  if (performance.now() - lastTouchAt.current < 700) return;
                  tap(i);
                }}
              >
                {order ? <span className="mm-tile__order">{kind === 'sequence' ? order.join('·') : ''}</span> : null}
                {isFound && !order ? <PixelIcon name="check" size={16} className="mm-tile__mark" /> : null}
                {isWrong ? <PixelIcon name="close" size={16} className="mm-tile__mark" /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </ClassicsShell>
  );
}

function sameMarks(a: Record<string, { progress: number; state: string }>, b: Record<string, { progress: number; state: string }>): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (a[k]?.progress !== b[k]?.progress || a[k]?.state !== b[k]?.state) return false;
  return true;
}

function StageBanner({ stage, endsAt, kind, count, progress, mine, spectator, round }: { stage: string; endsAt: number; kind: string; count: number; progress: number; mine: string; spectator: boolean; round: number }) {
  const left = useCountdown(stage === 'input' ? endsAt : 0, true);
  const [total, setTotal] = useState(1);
  useEffect(() => {
    if (stage === 'input') setTotal(Math.max(1, endsAt - serverNow()));
  }, [stage, endsAt]);
  let title = 'Get ready';
  let sub = '';
  if (stage === 'intro') {
    title = `Round ${round}`;
    sub = kind === 'flash' ? `Flash · ${count} tiles` : `Sequence · ${count} tiles`;
  } else if (stage === 'show') {
    title = 'Watch!';
    sub = kind === 'flash' ? 'Remember every lit tile' : 'Remember the order';
  } else if (stage === 'input') {
    if (spectator) title = 'Players are answering';
    else if (mine === 'done') title = 'Nailed it!';
    else if (mine === 'failed') title = 'Missed';
    else if (mine === 'out') title = 'You’re out';
    else title = 'Your turn';
    sub = spectator ? '' : `${progress} / ${count}`;
  } else if (stage === 'review') {
    title = 'The answer';
    sub = kind === 'flash' ? 'All lit tiles' : 'In order';
  }
  return (
    <div className={cx('mm-banner', `is-${stage}`, mine && `mine-${mine}`)} role="status" aria-live="polite">
      <span className="mm-banner__title">{title}</span>
      <span className="mm-banner__sub">{sub}</span>
      {stage === 'input' ? <span className="mm-banner__bar" style={{ '--k': String(Math.max(0, Math.min(1, left / total))) } as CSSProperties} aria-hidden /> : null}
    </div>
  );
}

function MarksStrip({ rows, marks, me }: { rows: ReturnType<typeof useStandings>; marks: Record<string, { progress: number; state: string }>; me: string | null }) {
  return (
    <ol className="mm-marks" aria-label="Players this round">
      {rows.map((r) => {
        const m = marks[r.id];
        const state = m?.state ?? 'waiting';
        return (
          <li key={r.id} className={cx('mm-mark', `is-${state}`, r.id === me && 'is-you')} style={{ '--pc': r.color } as CSSProperties}>
            <span className="mm-mark__name">{r.id === me ? 'You' : r.name}</span>
            <span className="mm-mark__state">
              {state === 'done' ? <PixelIcon name="check" size={10} aria-label="done" /> : state === 'failed' ? <PixelIcon name="close" size={10} aria-label="missed" /> : state === 'out' ? 'OUT' : state === 'input' ? `${m?.progress ?? 0}` : '…'}
            </span>
            <span className="mm-mark__score">{formatScore(r.score)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Solo variant/rule picker on the start card (the solo player is the host). */
function RulePicker({ settings }: { settings: MemorySettings | null }) {
  return (
    <div className="mm-picker">
      <div>
        <span className="cl-howto__label">Pattern</span>
        <Segmented
          label="Pattern"
          value={settings?.variant ?? 'mixed'}
          options={[
            { value: 'mixed', label: 'Mixed' },
            { value: 'sequence', label: 'Sequence' },
            { value: 'flash', label: 'Flash' },
          ]}
          onChange={(v) => {
            classicSfx('move');
            session.lobby.settings({ variant: v });
          }}
        />
      </div>
      <div>
        <span className="cl-howto__label">Rule</span>
        <Segmented
          label="Rule"
          value={settings?.rule ?? 'lives'}
          options={[
            { value: 'lives', label: '3 lives' },
            { value: 'sudden', label: 'Sudden death' },
          ]}
          onChange={(v) => {
            classicSfx('move');
            session.lobby.settings({ rule: v });
          }}
        />
      </div>
    </div>
  );
}
