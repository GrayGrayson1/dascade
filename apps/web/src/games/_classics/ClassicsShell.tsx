/**
 * The DAScade Classics cabinet shell: a framed, modern-pixel game screen with a HUD strip,
 * optional side rails (hold/next/standings), an overlay layer for the kit cards and an
 * on-screen control deck. Every Classics game renders inside it.
 *
 *   <ClassicsShell info={INFO} hud={<>…</>} right={…} overlay={card} touch={<TouchDeck …/>} aspect={0.5}>
 *     <canvas …/>
 *   </ClassicsShell>
 */
import { forwardRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { GAME_CATALOG, type GameId } from '@dascade/shared';
import { Button, IconButton, cx, type IconName } from '@dascade/ui';
import { GameStage } from '../../shell/common.tsx';
import { useApp } from '../../app/store.ts';
import { session } from '../../net/session.ts';
import { sfx } from '../../audio/audio.ts';
import { leaveRoomTo, useTournamentExit } from '../../tournament/exit.ts';

export interface ClassicsGameInfo {
  gameId: GameId;
  /** Short rules, one line each. */
  howTo: Array<{ icon?: IconName; text: string }>;
  /** Keyboard hints, e.g. { keys: ['←', '→'], action: 'Move' }. */
  keys: Array<{ keys: string[]; action: string }>;
  /** Touch hints. */
  touch: string[];
  /** Standings/high-score stat column label (e.g. "Lines"). */
  statLabel: string;
}

export const CLASSICS_PATH = '/cabinet/classics';

/** Leave the room and go back to the Classics picker (from a Tournament Center match: back to the tournament). */
export function useBackToClassics(): () => Promise<void> {
  const navigate = useNavigate();
  const tournament = useTournamentExit();
  return async () => {
    if (tournament) return leaveRoomTo(navigate, tournament);
    sfx('back');
    await session.leaveRoom();
    navigate(CLASSICS_PATH);
  };
}

/** "Back to Classics" with an optional confirm step (multiplayer: leaving forfeits the race). */
export function BackToClassicsButton({
  confirm,
  size = 'md',
  variant = 'ghost',
  compact,
  className,
}: {
  confirm?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'secondary' | 'primary';
  compact?: boolean;
  className?: string;
}) {
  const back = useBackToClassics();
  const label = useTournamentExit() ? 'Back to tournament' : 'Back to Classics';
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <span className={cx('cl-confirm', className)} role="group" aria-label="Confirm leaving">
        <span className="cl-confirm__text">{confirm}</span>
        <Button size="sm" variant="danger" onClick={() => void back()}>
          Leave
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
          Stay
        </Button>
      </span>
    );
  }
  const onClick = () => (confirm ? setAsking(true) : void back());
  return compact ? (
    <IconButton
      icon="arrow-left"
      label={label}
      size={size === 'lg' ? 'md' : 'sm'}
      variant={variant}
      className={className}
      onClick={onClick}
    />
  ) : (
    <Button size={size} variant={variant} icon="arrow-left" className={className} onClick={onClick}>
      {label}
    </Button>
  );
}

export interface ClassicsShellProps {
  info: ClassicsGameInfo;
  hud: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  /** Strip under the header (e.g. compact standings on phones). */
  ticker?: ReactNode;
  overlay?: ReactNode;
  touch?: ReactNode;
  /** Width / height of the playfield (the screen box keeps this aspect). */
  aspect: number;
  /** Solo pause button handler (hidden when absent). */
  onPause?: () => void;
  paused?: boolean;
  /** Confirmation text for Back to Classics (e.g. mid-race). */
  leaveConfirm?: string;
  /**
   * Phones (≤ 720px): `true` hides the left rail (put what matters from it into the right rail with
   * .cl-show-sm); `'none'` hides both rails so the screen gets the full width.
   */
  compactRails?: boolean | 'none';
  className?: string;
  children: ReactNode;
}

export const ClassicsShell = forwardRef<HTMLDivElement, ClassicsShellProps>(function ClassicsShell(
  { info, hud, left, right, ticker, overlay, touch, aspect, onPause, paused, leaveConfirm, compactRails, className, children },
  screenRef,
) {
  const game = GAME_CATALOG[info.gameId];
  const muted = useApp((s) => s.settings.muted);
  const updateSettings = useApp((s) => s.updateSettings);
  const openModal = useApp((s) => s.openModal);
  return (
    <GameStage gameId={info.gameId} className={cx('cl-stage', className)}>
      <div
        className="cl-shell"
        style={{ '--cl-aspect': String(aspect) } as CSSProperties}
        data-game={info.gameId}
        data-overlay={overlay ? 'true' : undefined}
      >
        <header className="cl-top" data-part="header">
          <div className="cl-top__nav">
            <BackToClassicsButton compact confirm={leaveConfirm} />
            <div className="cl-top__title">
              <span className="cl-top__kicker">Classics</span>
              <h1 className="cl-top__name">{game.title}</h1>
            </div>
          </div>
          <div className="cl-top__hud" data-part="hud" role="group" aria-label="Game status">
            {hud}
          </div>
          <div className="cl-top__tools">
            {onPause ? (
              <IconButton
                icon={paused ? 'play' : 'pause'}
                label={paused ? 'Resume' : 'Pause'}
                size="sm"
                variant="secondary"
                onClick={onPause}
              />
            ) : null}
            <IconButton
              icon={muted ? 'sound-off' : 'sound-on'}
              label={muted ? 'Unmute' : 'Mute'}
              size="sm"
              onClick={() => updateSettings({ muted: !muted })}
            />
            <IconButton icon="help" label="How to play" size="sm" className="cl-top__help" onClick={() => openModal('help', info.gameId)} />
          </div>
        </header>
        {ticker ? <div className="cl-ticker" data-part="ticker">{ticker}</div> : null}
        <div className="cl-body">
          <div
            className="cl-main"
            data-compact-rails={compactRails === 'none' ? 'none' : compactRails ? 'true' : undefined}
            style={{ '--rails': String((left ? 1 : 0) + (right ? 1 : 0)) } as CSSProperties}
          >
            <div className="cl-grid">
              {left ? <aside className="cl-rail cl-rail--left" data-part="rail">{left}</aside> : null}
              <div className="cl-screen" data-part="screen" ref={screenRef}>
                <span className="cl-screen__bezel" data-part="bezel" aria-hidden />
                {children}
                <span className="cl-screen__glass" data-part="glass" aria-hidden />
              </div>
              {right ? <aside className="cl-rail cl-rail--right" data-part="rail">{right}</aside> : null}
            </div>
            {overlay ? <div className="cl-overlay" data-part="overlay">{overlay}</div> : null}
          </div>
        </div>
        {touch ? <div className="cl-touch" data-part="touch-controls">{touch}</div> : null}
      </div>
    </GameStage>
  );
});

/** Small labelled panel for rails (Hold, Next, Power-ups…). */
export function RailPanel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cx('cl-panel', className)} data-part="panel" aria-label={title}>
      <h2 className="cl-panel__title">{title}</h2>
      <div className="cl-panel__body">{children}</div>
    </section>
  );
}
