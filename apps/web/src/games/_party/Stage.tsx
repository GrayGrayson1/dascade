/**
 * Party kit — stage layout and chrome: PartyStage, PromptCard, StageChip, TimerBar/StageTimer,
 * HostBar (+ paused banner) and the rules reference drawer.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import type { GameId } from '@dascade/shared';
import { PARTY_MSG, type PartyHostAction, type PartyPublicView } from '@dascade/shared/party';
import { AVATAR_ART, Button, ICONS, IconButton, Modal, PixelArt, PixelIcon, TimerRing, cx, type IconName } from '@dascade/ui';
import { GameStage } from '../../shell/common.tsx';
import { session, useRoomSelector } from '../../net/hooks.ts';
import { useSessionStore } from '../../net/session.ts';
import { useStageTimer } from './hooks.ts';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface PartyStageProps {
  gameId: GameId;
  /** Top bar: round counter, chips, timer, host controls (see PartyTopBar). */
  top?: ReactNode;
  /** Main column (prompt + answers). */
  children: ReactNode;
  /** Right column on desktop (leaderboard). Hidden on compact layouts unless `sideOnCompact`. */
  side?: ReactNode;
  sideOnCompact?: boolean;
  /** Bottom strip (who has answered). */
  bottom?: ReactNode;
  className?: string;
  /** Stage name for CSS hooks (data-stage). */
  stage?: string;
}

/** Full party layout wrapped in the game's themed GameStage. */
export function PartyStage({ gameId, top, children, side, sideOnCompact, bottom, className, stage }: PartyStageProps) {
  return (
    <GameStage gameId={gameId} className={cx('pk-stage', className)}>
      <div
        className={cx('pk-layout', Boolean(side) && 'pk-layout--side', Boolean(side && sideOnCompact) && 'pk-layout--side-compact')}
        data-stage={stage}
      >
        {top ? <div className="pk-top">{top}</div> : null}
        <div className="pk-main">{children}</div>
        {side ? (
          <aside className="pk-side" aria-label="Scores">
            {side}
          </aside>
        ) : null}
        {bottom ? <div className="pk-bottom">{bottom}</div> : null}
      </div>
    </GameStage>
  );
}

/** The standard top bar: left cluster (counter + chips), timer, right cluster (host + rules). */
export function PartyTopBar({ left, timer, right }: { left?: ReactNode; timer?: ReactNode; right?: ReactNode }) {
  return (
    <header className="pk-topbar">
      <div className="pk-topbar__left">{left}</div>
      <div className="pk-topbar__timer">{timer}</div>
      <div className="pk-topbar__right">{right}</div>
    </header>
  );
}

/** "Question 3 / 10" style counter (numbers in the numeric font). */
export function RoundCounter({ label = 'Round', round, total }: { label?: string; round: number; total: number }) {
  return (
    <span className="pk-counter" aria-label={`${label} ${round} of ${total}`}>
      <span className="pk-counter__label">{label}</span>
      <span className="pk-counter__num dc-num">
        {round}
        <span className="pk-counter__of">/{total}</span>
      </span>
    </span>
  );
}

/**
 * Icon by name from either the UI icon set (PixelIcon) or the avatar art set (pizza, alien, disk,
 * joystick…). Unknown names fall back to a star. Decorative unless `title` is given.
 */
export function ArtIcon({ name, size = 14, title, className }: { name: string; size?: number; title?: string; className?: string }) {
  if (name in ICONS) return <PixelIcon name={name as IconName} size={size} title={title} className={className} />;
  const rows = AVATAR_ART[name];
  if (rows) return <PixelArt rows={rows} title={title} className={cx('dc-icon', className)} style={{ width: size, height: size }} />;
  return <PixelIcon name="star" size={size} title={title} className={className} />;
}

/** Coloured chip with icon + text (category, round type, difficulty…). Colour is never the only signal. */
export function StageChip({ icon, color, children, title }: { icon?: string; color?: string; children: ReactNode; title?: string }) {
  return (
    <span className="pk-chip" style={color ? ({ '--chip': color } as CSSProperties) : undefined} title={title}>
      {icon ? <ArtIcon name={icon} size={12} /> : null}
      <span>{children}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export interface PromptCardProps {
  /** Small line above the prompt (e.g. "Question 3", "Final round"). */
  kicker?: ReactNode;
  /** The prompt text (rendered as a heading). */
  children: ReactNode;
  /** Chips / meta shown under the prompt. */
  meta?: ReactNode;
  /** Visual emphasis: 'final' adds the gold treatment. */
  tone?: 'default' | 'final' | 'reveal';
  /** Re-key to replay the entry animation (e.g. the prompt seq). */
  animKey?: string | number;
  size?: 'md' | 'lg';
}

export function PromptCard({ kicker, children, meta, tone = 'default', animKey, size = 'lg' }: PromptCardProps) {
  return (
    <section key={animKey} className={cx('pk-prompt', `pk-prompt--${size}`)} data-tone={tone} aria-live="polite">
      <i className="pk-prompt__corner pk-prompt__corner--tl" aria-hidden="true" />
      <i className="pk-prompt__corner pk-prompt__corner--br" aria-hidden="true" />
      {kicker ? <p className="pk-prompt__kicker">{kicker}</p> : null}
      <h2 className="pk-prompt__text">{children}</h2>
      {meta ? <div className="pk-prompt__meta">{meta}</div> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

/** Horizontal draining bar for the current stage timer (hidden when the stage is untimed). */
export function TimerBar({ label = 'Time left', className }: { label?: string; className?: string }) {
  const t = useStageTimer(true);
  if (!t.timed) return <div className={cx('pk-timerbar', 'pk-timerbar--idle', className)} aria-hidden="true" />;
  const urgent = !t.paused && t.seconds <= 5;
  return (
    <div
      className={cx('pk-timerbar', className)}
      data-urgent={urgent ? 'true' : undefined}
      data-paused={t.paused ? 'true' : undefined}
      role="timer"
      aria-label={t.paused ? `${label}: paused` : `${label}: ${t.seconds} seconds`}
    >
      <div className="pk-timerbar__fill" style={{ transform: `scaleX(${t.fraction})` }} />
    </div>
  );
}

/** Round countdown (TimerRing) for the current stage; shows a pause glyph while paused. */
export function StageTimer({ size = 58, label = 'Time left' }: { size?: number; label?: string }) {
  const t = useStageTimer(true);
  if (!t.timed) return null;
  if (t.paused) {
    return (
      <span className="pk-paused-ring" style={{ width: size, height: size }} role="timer" aria-label={`${label}: paused`}>
        <PixelIcon name="pause" />
      </span>
    );
  }
  return <TimerRing seconds={t.remainingMs / 1000} progress={t.fraction} size={size} label={label} />;
}

// ---------------------------------------------------------------------------
// Host controls
// ---------------------------------------------------------------------------

/** Host controls name the stage they target, so a double tap never skips two stages. */
function sendHost(action: PartyHostAction, stageSeq: number | null) {
  session.send(PARTY_MSG.host, stageSeq === null ? { action } : { action, stageSeq });
}

/**
 * Host-only controls (pause / resume / skip). Renders nothing for other players. `skipLabel`
 * names what skipping does in this stage ("Reveal now", "Next question"…); omit to hide Skip.
 */
export function HostBar({ skipLabel, canPause = true, compact }: { skipLabel?: string | null; canPause?: boolean; compact?: boolean }) {
  const hostId = useRoomSelector<PartyPublicView, string>((s) => s.hostId);
  const phase = useRoomSelector<PartyPublicView, string>((s) => s.phase);
  const stageSeq = useRoomSelector<PartyPublicView, number>((s) => s.stageSeq);
  const playerId = useSessionStore((s) => s.playerId);
  const t = useStageTimer();
  if (!playerId || hostId !== playerId || phase !== 'PLAYING') return null;
  return (
    <div className="pk-hostbar" role="group" aria-label="Host controls">
      {canPause && t.timed ? (
        t.paused ? (
          <Button size="sm" variant="secondary" icon="play" onClick={() => sendHost('resume', stageSeq)}>
            {compact ? <span className="dc-collapse-label">Resume</span> : 'Resume'}
          </Button>
        ) : (
          <IconButton icon="pause" label="Pause timer" size="sm" onClick={() => sendHost('pause', stageSeq)} />
        )
      ) : null}
      {skipLabel ? (
        <Button size="sm" variant="ghost" icon="arrow-right" onClick={() => sendHost('skip', stageSeq)}>
          {skipLabel}
        </Button>
      ) : null}
    </div>
  );
}

/** Banner shown to everyone while the host has paused the timer. */
export function PausedBanner() {
  const paused = useRoomSelector<PartyPublicView, boolean>((s) => s.paused);
  if (!paused) return null;
  return (
    <div className="pk-paused" role="status">
      <PixelIcon name="pause" /> Paused by the host
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rules reference drawer
// ---------------------------------------------------------------------------

export interface RulesSection {
  title: string;
  icon?: IconName;
  items: ReactNode[];
}

/** A "Rules" button that opens a reference sheet. `highlight` names the section for the current stage. */
export function RulesDrawer({
  title,
  sections,
  highlight,
  compact,
}: {
  title: string;
  sections: RulesSection[];
  highlight?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {compact ? (
        <IconButton icon="help" label="Rules" size="sm" onClick={() => setOpen(true)} />
      ) : (
        <Button size="sm" variant="ghost" icon="help" onClick={() => setOpen(true)}>
          Rules
        </Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={title} className="pk-rules">
        <div className="pk-rules__body">
          {sections.map((s) => (
            <section key={s.title} className="pk-rules__section" data-current={highlight === s.title ? 'true' : undefined}>
              <h3 className="pk-rules__title">
                {s.icon ? <PixelIcon name={s.icon} size={14} /> : null}
                {s.title}
                {highlight === s.title ? <span className="pk-rules__now">Now</span> : null}
              </h3>
              <ul>
                {s.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Waiting / interstitial card
// ---------------------------------------------------------------------------

/** Centered interstitial ("Get ready", "Waiting for the host…"). */
export function Interstitial({
  icon = 'sparkle',
  kicker,
  title,
  children,
  animKey,
}: {
  icon?: IconName;
  kicker?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  animKey?: string | number;
}) {
  return (
    <div key={animKey} className="pk-interstitial">
      <span className="pk-interstitial__icon" aria-hidden="true">
        <PixelIcon name={icon} />
      </span>
      {kicker ? <p className="pk-interstitial__kicker">{kicker}</p> : null}
      <h2 className="pk-interstitial__title">{title}</h2>
      {children ? <div className="pk-interstitial__body">{children}</div> : null}
    </div>
  );
}
