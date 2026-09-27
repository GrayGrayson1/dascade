/**
 * Overlay cards of the Classics kit: instructions (before play), countdown, pause, game over
 * (with the server-verified result and the high-score board) and "waiting for others".
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GAME_CATALOG } from '@dascade/shared';
import { Badge, Button, Kbd, PixelIcon, Spinner, Toggle, cx } from '@dascade/ui';
import { useApp } from '../../app/store.ts';
import { serverNow } from '../../net/session.ts';
import { BackToClassicsButton, type ClassicsGameInfo } from './ClassicsShell.tsx';
import { HighScoreBoard } from './Boards.tsx';
import { CountUp, formatScore } from './Hud.tsx';
import { classicSfx } from './sfx.ts';
import { useHighScores } from './useClassics.ts';

function Card({ children, className, label, wide }: { children: ReactNode; className?: string; label: string; wide?: boolean }) {
  return (
    <section className={cx('cl-card', wide && 'cl-card--wide', className)} role="dialog" aria-modal="false" aria-label={label}>
      <span className="cl-card__corner cl-card__corner--tl" aria-hidden />
      <span className="cl-card__corner cl-card__corner--br" aria-hidden />
      {children}
    </section>
  );
}

/** Enter / Space (outside inputs) triggers `fn` while mounted. */
function useEnterKey(fn: (() => void) | undefined, enabled = true): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'button' || tag === 'select') return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        ref.current?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

export function HowToList({ info, compact }: { info: ClassicsGameInfo; compact?: boolean }) {
  return (
    <div className={cx('cl-howto', compact && 'cl-howto--compact')}>
      <ul className="cl-howto__rules">
        {info.howTo.map((r) => (
          <li key={r.text}>
            <PixelIcon name={r.icon ?? 'play'} size={14} />
            <span>{r.text}</span>
          </li>
        ))}
      </ul>
      <div className="cl-howto__controls">
        <div className="cl-howto__col cl-only-fine">
          <h3 className="cl-howto__label">Keyboard</h3>
          <ul>
            {info.keys.map((k, i) => (
              <li key={`${i}-${k.action}`}>
                <span className="cl-howto__keys">
                  {k.keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </span>
                <span>{k.action}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="cl-howto__col">
          <h3 className="cl-howto__label">Touch</h3>
          <ul>
            {info.touch.map((t) => (
              <li key={t}>
                <PixelIcon name="grip" size={12} />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function InstructionsCard({
  info,
  onStart,
  best,
  startLabel = 'Start',
  busy,
  extra,
}: {
  info: ClassicsGameInfo;
  onStart: () => void;
  best?: number;
  startLabel?: string;
  busy?: boolean;
  extra?: ReactNode;
}) {
  const game = GAME_CATALOG[info.gameId];
  useEnterKey(busy ? undefined : onStart);
  const startRef = useRef<HTMLButtonElement>(null);
  useEffect(() => startRef.current?.focus({ preventScroll: true }), []);
  return (
    <Card label={`${game.title} — how to play`} wide>
      <p className="cl-card__kicker">DAScade Classics</p>
      <h2 className="cl-card__title">{game.title}</h2>
      <p className="cl-card__tagline">{game.tagline}</p>
      <HowToList info={info} />
      {extra}
      <div className="cl-card__actions">
        <Button ref={startRef} variant="primary" size="xl" icon="play" loading={busy} onClick={onStart} className="cl-card__go">
          {startLabel}
        </Button>
        {best ? (
          <span className="cl-card__best">
            <PixelIcon name="trophy" size={14} /> Your best <strong>{formatScore(best)}</strong>
          </span>
        ) : null}
      </div>
      <p className="cl-card__hint cl-only-fine">
        Press <Kbd>Enter</Kbd> to start
      </p>
    </Card>
  );
}

/** 3-2-1-GO (or READY… GO with `ready`) against a server-epoch start time. Renders nothing once started. */
export function CountdownCard({ startAt, label = 'Get ready', sub, ready }: { startAt: number; label?: string; sub?: ReactNode; ready?: boolean }) {
  const [left, setLeft] = useState(() => startAt - serverNow());
  const lastN = useRef<number | null>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const ms = startAt - serverNow();
      setLeft(ms);
      const n = ms > 0 ? Math.ceil(ms / 1000) : 0;
      if (n !== lastN.current) {
        lastN.current = n;
        if (n > 0 && n <= 3 && !ready) classicSfx('count');
        if (n === 0) classicSfx('go');
      }
      if (ms > -700) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [startAt, ready]);
  if (left <= -700) return null;
  const n = Math.ceil(left / 1000);
  return (
    <div className="cl-countdown" role="status" aria-live="assertive" aria-label={left > 0 ? `Starting in ${n}` : 'Go'}>
      <span className="cl-countdown__label">{left > 0 ? label : ''}</span>
      <span key={left > 0 ? (ready ? 'ready' : n) : 'go'} className={cx('cl-countdown__num', left <= 0 && 'is-go')}>
        {left > 0 ? (n > 3 || ready ? 'READY' : n) : 'GO!'}
      </span>
      {sub ? <span className="cl-countdown__sub">{sub}</span> : null}
    </div>
  );
}

export function PauseCard({ info, onResume, onRestart }: { info: ClassicsGameInfo; onResume: () => void; onRestart?: () => void }) {
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const openModal = useApp((s) => s.openModal);
  const resumeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => resumeRef.current?.focus({ preventScroll: true }), []);
  useEnterKey(onResume);
  return (
    <Card label="Paused">
      <p className="cl-card__kicker">{GAME_CATALOG[info.gameId].title}</p>
      <h2 className="cl-card__title">Paused</h2>
      <div className="cl-card__stack">
        <Button ref={resumeRef} variant="primary" size="lg" block icon="play" onClick={onResume}>
          Resume
        </Button>
        {onRestart ? (
          <Button variant="secondary" size="lg" block icon="refresh" onClick={onRestart}>
            Restart
          </Button>
        ) : null}
      </div>
      <div className="cl-card__settings">
        <Toggle label="Sound" checked={!settings.muted} onChange={(on) => updateSettings({ muted: !on })} />
        <Toggle label="Reduced motion" checked={settings.reducedMotion} onChange={(reducedMotion) => updateSettings({ reducedMotion })} />
      </div>
      <div className="cl-card__row">
        <Button variant="ghost" size="sm" icon="help" onClick={() => openModal('help', info.gameId)}>
          How to play
        </Button>
        <BackToClassicsButton size="sm" />
      </div>
    </Card>
  );
}

export interface FinalResult {
  score: number;
  /** Extra stat rows: [label, value]. */
  rows: Array<[string, ReactNode]>;
  reason?: string;
  best?: boolean;
  rank?: number | null;
  entryId?: string | null;
  board: string;
}

const REASON_TITLE: Record<string, string> = {
  over: 'Game over',
  time: 'Time!',
  lag: 'Run ended',
  rejected: 'Run rejected',
  left: 'Run ended',
  quit: 'Run ended',
};

export function GameOverCard({
  info,
  result,
  verifying,
  onRetry,
  retryLabel = 'Play again',
  personalBest,
  waiting,
  footer,
}: {
  info: ClassicsGameInfo;
  result: FinalResult | null;
  verifying?: boolean;
  onRetry?: () => void;
  retryLabel?: string;
  personalBest?: number;
  /** Multiplayer: this player is done, others still playing. */
  waiting?: ReactNode;
  footer?: ReactNode;
}) {
  const board = useHighScores(info.gameId, result?.board ?? '', result?.entryId ?? result?.score ?? 0);
  const retryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (result && onRetry) retryRef.current?.focus({ preventScroll: true });
  }, [result, onRetry]);
  useEnterKey(result && onRetry ? onRetry : undefined);
  useEffect(() => {
    if (result?.rank && result.rank <= 3) classicSfx('record');
  }, [result?.rank]);
  if (!result || verifying) {
    return (
      <Card label="Verifying your run">
        <h2 className="cl-card__title cl-card__title--sm">Verifying…</h2>
        <p className="cl-card__tagline">
          <Spinner label="Verifying" /> The server is replaying your run.
        </p>
      </Card>
    );
  }
  const title = REASON_TITLE[result.reason ?? 'over'] ?? 'Game over';
  return (
    <Card label={`${title} — final score ${result.score}`} wide className="cl-card--over">
      <p className="cl-card__kicker">{GAME_CATALOG[info.gameId].title}</p>
      <h2 className="cl-card__title">{title}</h2>
      <div className="cl-over__score" aria-label={`Final score ${formatScore(result.score)}`}>
        <span className="cl-over__label">Final score</span>
        <span className="cl-over__value">
          <CountUp value={result.score} />
        </span>
        <span className="cl-over__badges">
          <Badge icon="check" color="var(--green)">
            Server verified
          </Badge>
          {result.best ? (
            <Badge icon="star" color="var(--yellow)">
              New personal best
            </Badge>
          ) : personalBest ? (
            <Badge icon="trophy" color="var(--text-2)">
              Best {formatScore(personalBest)}
            </Badge>
          ) : null}
          {result.rank ? (
            <Badge icon="trophy" color="var(--accent)">
              #{result.rank} on the board
            </Badge>
          ) : null}
        </span>
      </div>
      {result.rows.length ? (
        <dl className="cl-over__rows">
          {result.rows.map(([k, v]) => (
            <div key={k} className="cl-over__row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {waiting ? <div className="cl-over__waiting">{waiting}</div> : null}
      {result.board ? <HighScoreBoard data={board.data} loading={board.loading} error={board.error} highlightId={result.entryId} statLabel={info.statLabel} compact /> : null}
      <div className="cl-card__actions">
        {onRetry ? (
          <Button ref={retryRef} variant="primary" size="lg" icon="refresh" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : null}
        <BackToClassicsButton size="lg" variant="secondary" />
      </div>
      {footer}
    </Card>
  );
}

/** Spectator / between-runs info card. */
export function InfoCard({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <Card label={title}>
      <h2 className="cl-card__title cl-card__title--sm">{title}</h2>
      {children ? <div className="cl-card__tagline">{children}</div> : null}
      {actions ? <div className="cl-card__actions">{actions}</div> : null}
    </Card>
  );
}
