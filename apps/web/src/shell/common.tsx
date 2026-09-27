/**
 * Small shared shell components: toasts, profile editor, chat, results actions,
 * game stage wrapper, connection indicator, pending view.
 */
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { AVATARS, GAME_CATALOG, LIMITS, cabinetForGame, cabinetPath, isGameId, type Avatar, type ChatMessage, type GameId } from '@dascade/shared';
import {
  Avatar as AvatarBadge,
  Button,
  EmptyState,
  GameTheme,
  IconButton,
  PixelIcon,
  PlayerChip,
  Spinner,
  TextInput,
  cx,
  handleRovingKeys,
  rovingTabIndex,
  type IconName,
} from '@dascade/ui';
import { useApp } from '../app/store.ts';
import { getStateSnapshot, session, useSessionStore } from '../net/session.ts';
import { useGame, useRoomSelector } from '../net/hooks.ts';
import { sfx } from '../audio/audio.ts';
import { leaveRoomTo, useTournamentExit } from '../tournament/exit.ts';

export { Toasts } from './Toasts.tsx';

/** Profile changes propagate to the current room only where the server allows them. */
function canEditRoomProfile(): boolean {
  const phase = getStateSnapshot()?.phase;
  return phase === 'LOBBY' || phase === 'RESULTS';
}

// ---------------------------------------------------------------------------
export function ProfileEditor({ compact = false, onSubmit }: { compact?: boolean; onSubmit?: () => void }) {
  const profile = useApp((s) => s.profile);
  const updateProfile = useApp((s) => s.updateProfile);
  const [name, setName] = useState(profile.name);
  // Unique ids: the editor can be on screen twice (entry card + settings modal).
  const hintId = useId();
  const avatarLabelId = useId();
  useEffect(() => setName(profile.name), [profile.name]);
  const commit = () => {
    if (name.trim() && name.trim() !== profile.name) {
      updateProfile({ name });
      if (canEditRoomProfile()) session.lobby.profile({ name });
    }
  };
  return (
    <div className="profile-editor">
      {!compact ? (
        <div className="profile-preview">
          <span className="dc-label">How others see you</span>
          <PlayerChip name={name.trim() || 'Pick a nickname'} avatar={profile.avatar} color="var(--accent)" size={40} />
        </div>
      ) : null}
      <label className="dc-field">
        <span className="dc-field__label">Your name</span>
        <TextInput
          value={name}
          maxLength={LIMITS.nickname}
          placeholder="Pick a nickname"
          autoComplete="nickname"
          onChange={(e) => setName(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit();
              onSubmit?.();
            }
          }}
          aria-describedby={hintId}
        />
        <span id={hintId} className="dc-field__hint">
          Shown to other players. {LIMITS.nickname} characters max.
        </span>
      </label>
      <div className="dc-field">
        <span className="dc-field__label" id={avatarLabelId}>
          Avatar
        </span>
        <div
          className={cx('avatar-grid', compact && 'avatar-grid--compact')}
          role="radiogroup"
          aria-labelledby={avatarLabelId}
          onKeyDown={(e) => handleRovingKeys(e, 'radio')}
        >
          {AVATARS.map((a, i) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={profile.avatar === a}
              tabIndex={rovingTabIndex(profile.avatar === a, i, AVATARS.includes(profile.avatar))}
              aria-label={a}
              className="avatar-grid__item"
              onClick={() => {
                sfx('click');
                updateProfile({ avatar: a as Avatar });
                if (canEditRoomProfile()) session.lobby.profile({ avatar: a });
              }}
            >
              <AvatarBadge avatar={a} color={profile.avatar === a ? 'var(--accent)' : 'var(--text-2)'} size={compact ? 30 : 38} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function ChatPanel({
  placeholder = 'Say something…',
  className,
  disabled,
  renderMessage,
  onSend,
  emptyText = 'No messages yet. Say hi!',
}: {
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  renderMessage?: (m: ChatMessage) => ReactNode;
  onSend?: (text: string) => void;
  emptyText?: string;
}) {
  const chat = useSessionStore((s) => s.chat);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.length]);
  const send = () => {
    const t = text.trim();
    if (!t) return;
    if (onSend) onSend(t);
    else session.lobby.chat(t);
    setText('');
  };
  return (
    <div className={cx('chat', className)}>
      <div
        className="chat__list"
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-label="Room chat"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {chat.length === 0 ? <div className="chat__empty">{emptyText}</div> : null}
        {chat.map((m) =>
          renderMessage ? (
            <div key={m.id}>{renderMessage(m)}</div>
          ) : (
            <div key={m.id} className="chat__msg" data-kind={m.kind}>
              {m.playerId && m.kind !== 'system' && m.kind !== 'correct' ? (
                <span className="chat__name" style={{ color: m.color }}>
                  {m.name}
                </span>
              ) : null}
              <span className="chat__text">{m.text}</span>
            </div>
          ),
        )}
      </div>
      <form
        className="chat__form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <TextInput
          value={text}
          maxLength={LIMITS.chat}
          disabled={disabled}
          placeholder={placeholder}
          aria-label="Chat message"
          enterKeyHint="send"
          onChange={(e) => setText(e.currentTarget.value)}
        />
        <IconButton icon="arrow-right" label="Send message" type="submit" variant="primary" disabled={disabled || !text.trim()} />
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
/**
 * Host: "Play again" (back to lobby) · Everyone: "Back to cabinet" (leave → the cabinet's picker or
 * title screen) and "Leave" (→ arcade floor). Use on results screens. In a Tournament Center match
 * room: no "Play again" (the series runs itself) and the way out is "Back to tournament".
 */
export function ResultsActions({ extra }: { extra?: ReactNode }) {
  // Selectors, not useGame(): results screens can keep receiving game patches.
  const hostId = useRoomSelector((s) => s.hostId);
  const playerId = useSessionStore((s) => s.playerId);
  const tournament = useTournamentExit();
  if (hostId === null) return null;
  if (tournament) {
    // Tournament Center match: the series runs itself — no "Play again". Participants stay for the
    // next game; once the match is over (or for spectators) the way out leads back to the kiosk.
    return (
      <div className="results-actions">
        {extra}
        {tournament.over || !tournament.participant ? (
          <BackToCabinetButton />
        ) : (
          <span className="dc-muted results-actions__wait">
            <Spinner label="Next game" /> The next game of the series starts automatically…
          </span>
        )}
      </div>
    );
  }
  const isHost = Boolean(playerId && hostId === playerId);
  return (
    <div className="results-actions">
      {isHost ? (
        <Button variant="primary" size="lg" icon="refresh" onClick={() => session.lobby.toLobby()}>
          Play again
        </Button>
      ) : (
        <span className="dc-muted results-actions__wait">
          <Spinner label="Waiting for host" /> Waiting for the host to start another round…
        </span>
      )}
      {extra}
      <BackToCabinetButton />
      <LeaveButton />
    </div>
  );
}

/**
 * Leaves the room and returns to the game's cabinet (multi-game picker, or the title screen) — or,
 * in a Tournament Center match room, to the tournament kiosk ("Back to tournament").
 */
export function BackToCabinetButton({ size = 'lg' }: { size?: 'sm' | 'md' | 'lg' }) {
  const navigate = useNavigate();
  const gameId = useSessionStore((s) => s.gameId);
  const tournament = useTournamentExit();
  const [busy, setBusy] = useState(false);
  if (tournament) {
    const back = async () => {
      setBusy(true);
      await leaveRoomTo(navigate, tournament);
      setBusy(false);
    };
    return (
      <Button size={size} variant="secondary" icon="arrow-left" loading={busy} onClick={back} title={`Return to ${tournament.name}`}>
        Back to tournament
      </Button>
    );
  }
  if (!gameId || !isGameId(gameId)) return null;
  const cabinet = cabinetForGame(gameId);
  if (!cabinet) return null;
  const go = async () => {
    setBusy(true);
    await session.leaveRoom();
    navigate(cabinetPath(cabinet));
  };
  return (
    <Button size={size} variant="secondary" icon="arrow-left" loading={busy} onClick={go} title={`Leave the room and return to ${cabinet.title}`}>
      Back to cabinet
    </Button>
  );
}

/**
 * Standard results layout games can adopt: a centered header (title, optional icon and subtitle),
 * the game's own results content, and a sticky action row — "Play again" for the host, "Leave" for
 * everyone, plus optional extra `actions`. Render it inside your <GameStage>.
 */
export function ResultsShell({
  title,
  subtitle,
  icon,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: IconName;
  /** Extra buttons for the action row (e.g. "Share results"). */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section className={cx('results-shell', className)} aria-labelledby={headingId}>
      <header className="results-shell__header">
        {icon ? <PixelIcon name={icon} className="results-shell__icon" /> : null}
        <h1 id={headingId} className="dc-title results-shell__title">
          {title}
        </h1>
        {subtitle ? <p className="results-shell__subtitle">{subtitle}</p> : null}
      </header>
      <div className="results-shell__body">{children}</div>
      <footer className="results-shell__actions">
        <ResultsActions extra={actions} />
      </footer>
    </section>
  );
}

export function LeaveButton({
  size = 'lg',
  compact,
  className,
  collapseLabel,
}: {
  size?: 'sm' | 'md' | 'lg';
  compact?: boolean;
  className?: string;
  /** Wrap the label so a layout can hide it visually (it stays the accessible name). */
  collapseLabel?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const navigate = useNavigate();
  // Tournament match rooms lead back to the kiosk (the kiosk itself to the Tournament Center landing).
  const tournament = useTournamentExit();
  const label = tournament ? 'Leave match' : 'Leave room';
  const leave = () => leaveRoomTo(navigate, tournament);
  if (confirming) {
    return (
      <span className={cx('dc-row', className)} role="group" aria-label="Confirm leave">
        <Button size={size === 'lg' ? 'md' : 'sm'} variant="danger" onClick={leave}>
          {label}
        </Button>
        <Button size={size === 'lg' ? 'md' : 'sm'} variant="ghost" onClick={() => setConfirming(false)}>
          Stay
        </Button>
      </span>
    );
  }
  return compact ? (
    <IconButton icon="leave" label={label} className={className} onClick={() => setConfirming(true)} />
  ) : (
    <Button size={size} variant="ghost" icon="leave" className={className} onClick={() => setConfirming(true)}>
      {collapseLabel ? <span className="dc-collapse-label">Leave</span> : 'Leave'}
    </Button>
  );
}

// ---------------------------------------------------------------------------
/** Full-bleed themed container for a game view (below the top bar). */
export function GameStage({ gameId, className, children, style }: { gameId: GameId; className?: string; children: ReactNode; style?: CSSProperties }) {
  const accent = GAME_CATALOG[gameId].accent;
  // While auto-reconnecting every action would be dropped: make the stage inert (no clicks/focus)
  // and dim it, so players aren't pressing buttons that silently do nothing. The top bar / shell
  // menu (outside the stage) keeps Leave reachable.
  const reconnecting = useSessionStore((s) => s.status === 'reconnecting');
  return (
    <GameTheme
      accent={accent}
      as="main"
      className={cx('game-stage dc-game-backdrop', className)}
      style={style}
      id="main"
      inert={reconnecting || undefined}
      aria-busy={reconnecting || undefined}
      data-reconnecting={reconnecting ? 'true' : undefined}
    >
      {children}
    </GameTheme>
  );
}

// ---------------------------------------------------------------------------
export function ConnectionDot() {
  const status = useSessionStore((s) => s.status);
  const ping = useSessionStore((s) => s.pingMs);
  const label =
    status === 'connected'
      ? `Connected${ping !== null ? ` · ${ping}ms` : ''}`
      : status === 'reconnecting'
        ? 'Reconnecting…'
        : status === 'connecting'
          ? 'Connecting…'
          : 'Offline';
  const tone = status === 'connected' ? (ping !== null && ping > 250 ? 'var(--yellow)' : 'var(--green)') : status === 'reconnecting' || status === 'connecting' ? 'var(--yellow)' : 'var(--red)';
  // Not a live region: the ping changes every few seconds and would be re-announced each time.
  // Connection changes are announced by the reconnect banner (role=alert) and toasts instead.
  return (
    <span className="conn-dot" title={label} style={{ '--tone': tone } as CSSProperties}>
      <i data-pulse={status !== 'connected' ? 'true' : undefined} aria-hidden />
      <span className="conn-dot__text" aria-hidden>
        {status === 'connected' && ping !== null ? `${ping}ms` : status === 'connected' ? 'Online' : label}
      </span>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
/** Centered notice card shared by the error, not-found and connection-lost screens. */
export function NoticeCard({
  icon,
  tone = 'warning',
  crumb,
  title,
  children,
  actions,
  role,
}: {
  icon: IconName;
  tone?: 'warning' | 'danger' | 'info' | 'accent';
  crumb?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  role?: 'alert' | 'status';
}) {
  const headingId = useId();
  return (
    <section className="notice-card dc-panel dc-panel--brackets" data-tone={tone} role={role} aria-labelledby={headingId}>
      <div className="notice-card__icon" aria-hidden>
        <PixelIcon name={icon} />
      </div>
      {crumb ? <p className="notice-card__crumb">{crumb}</p> : null}
      <h1 id={headingId} className="notice-card__title">
        {title}
      </h1>
      {children}
      {actions ? <div className="notice-card__actions">{actions}</div> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
export function PendingGameView() {
  const game = useGame();
  const gameId = useSessionStore((s) => s.gameId);
  const title = useMemo(() => (gameId && isGameId(gameId) ? GAME_CATALOG[gameId].title : 'Game'), [gameId]);
  return (
    <GameStage gameId={gameId ?? 'wheel'}>
      <div className="center-screen">
        <EmptyState icon="sparkle" title={`${title} is loading its cartridge…`}>
          This cabinet is being wired up. Phase: {game?.phase ?? '—'}
        </EmptyState>
        <ResultsActions />
      </div>
    </GameStage>
  );
}
