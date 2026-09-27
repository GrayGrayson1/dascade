import { useEffect, useId, useState } from 'react';
import { GAME_CATALOG, type GameId } from '@dascade/shared';
import { Badge, Button, IconButton, PixelIcon } from '@dascade/ui';
import { useApp } from '../app/store.ts';
import { useRoomSelector } from '../net/hooks.ts';
import { sfx } from '../audio/audio.ts';
import { ConnectionDot, LeaveButton } from './common.tsx';
import { crumbCabinet } from './crumbs.ts';
import { ThemeButton } from '../themes/ThemeButton.tsx';

const PHASE_LABEL: Record<string, string> = {
  LOBBY: 'Lobby',
  COUNTDOWN: 'Starting…',
  PLAYING: 'Live',
  INTERMISSION: 'Intermission',
  RESULTS: 'Results',
  ENDED: 'Ended',
};

export function RoomCodeChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const link = `${location.origin}/room/${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      sfx('pop');
      useApp.getState().toast('success', `Invite link copied — code ${code}`);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      useApp.getState().toast('info', `Room code: ${code}`);
    }
  };
  return (
    <button
      type="button"
      className="code-chip"
      data-part="room-code-chip"
      onClick={copy}
      aria-label={`Room code ${code}. Copy invite link`}
      title="Copy invite link"
    >
      <span className="code-chip__label">Room</span>
      <span className="code-chip__code">{code}</span>
      <PixelIcon name={copied ? 'check' : 'copy'} />
    </button>
  );
}

/** Shared top bar for lobby + games. */
export function TopBar({ gameId, code }: { gameId: GameId; code: string }) {
  const openModal = useApp((s) => s.openModal);
  const muted = useApp((s) => s.settings.muted);
  const updateSettings = useApp((s) => s.updateSettings);
  const phase = useRoomSelector((s) => s.phase);
  const counts = useRoomSelector((s) => {
    const ps = Object.values(s.players ?? {});
    return { players: ps.filter((p) => !p.spectator).length, spectators: ps.filter((p) => p.spectator).length };
  });
  const locked = useRoomSelector((s) => s.locked);
  const game = GAME_CATALOG[gameId];
  const cabinet = crumbCabinet(gameId);
  const multi = cabinet !== null;
  return (
    <header className="topbar" data-part="top-bar" style={{ '--accent': game.accent.primary } as React.CSSProperties}>
      <div className="topbar__left" data-part="top-bar-left">
        <LeaveButton size="sm" compact popover="below" />
        <span
          className="topbar__title dc-pixel"
          data-part="top-bar-title"
          title={multi && cabinet ? `${cabinet.title} › ${game.title}` : game.title}
        >
          {multi && cabinet ? (
            <>
              <span className="topbar__cabinet">{cabinet.marquee}</span>
              <span className="topbar__sep" aria-hidden>
                ›
              </span>
            </>
          ) : null}
          <span>{game.marquee}</span>
        </span>
        <RoomCodeChip code={code} />
        {locked ? (
          <span className="topbar__lock" title="Room locked — no new players">
            <PixelIcon name="lock" title="Room locked" />
          </span>
        ) : null}
      </div>
      <div className="topbar__center" data-part="top-bar-center">
        {phase ? (
          <Badge color={phase === 'PLAYING' ? 'var(--green)' : phase === 'RESULTS' ? 'var(--yellow)' : 'var(--accent)'}>
            {PHASE_LABEL[phase] ?? phase}
          </Badge>
        ) : null}
      </div>
      <div className="topbar__right" data-part="top-bar-actions">
        {counts ? (
          <span className="topbar__count" title={`${counts.players} players, ${counts.spectators} spectators`}>
            <PixelIcon name="users" /> {counts.players}
            {counts.spectators ? (
              <>
                <PixelIcon name="eye" style={{ marginLeft: 6 }} /> {counts.spectators}
              </>
            ) : null}
          </span>
        ) : null}
        <ConnectionDot />
        <IconButton
          icon={muted ? 'sound-off' : 'sound-on'}
          label={muted ? 'Unmute' : 'Mute'}
          size="sm"
          onClick={() => updateSettings({ muted: !muted })}
        />
        <IconButton icon="help" label="How to play" size="sm" onClick={() => openModal('help', gameId)} />
        <ThemeButton size="sm" />
        <IconButton icon="gear" label="Settings" size="sm" onClick={() => openModal('settings')} />
      </div>
    </header>
  );
}

/** Minimal floating menu for immersive games (top bar hidden). */
export function ShellMenu({ gameId, code }: { gameId: GameId; code: string }) {
  const openModal = useApp((s) => s.openModal);
  const muted = useApp((s) => s.settings.muted);
  const updateSettings = useApp((s) => s.updateSettings);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const game = GAME_CATALOG[gameId];
  const cabinet = crumbCabinet(gameId);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <div
      className="shell-menu"
      data-part="shell-menu"
      data-open={open ? 'true' : undefined}
      style={{ '--accent': game.accent.primary } as React.CSSProperties}
    >
      <IconButton
        icon={open ? 'close' : 'gear'}
        label={open ? 'Close menu' : 'Open menu'}
        variant="secondary"
        size="sm"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
      />
      {open ? (
        <div className="shell-menu__panel dc-panel" data-part="shell-menu-panel" id={panelId}>
          <p className="shell-menu__title dc-pixel">
            {cabinet ? <span className="topbar__cabinet">{cabinet.marquee} › </span> : null}
            {game.marquee}
          </p>
          <div className="shell-menu__status">
            <RoomCodeChip code={code} />
            <ConnectionDot />
          </div>
          <div className="shell-menu__actions">
            <Button size="sm" variant="ghost" icon="help" onClick={() => (setOpen(false), openModal('help', gameId))}>
              How to play
            </Button>
            <Button size="sm" variant="ghost" icon="gear" onClick={() => (setOpen(false), openModal('settings'))}>
              Settings
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={muted ? 'sound-off' : 'sound-on'}
              aria-pressed={muted}
              onClick={() => updateSettings({ muted: !muted })}
            >
              {muted ? 'Unmute' : 'Mute'}
            </Button>
            <LeaveButton size="sm" className="shell-menu__leave" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
