import { useState } from 'react';
import { GAME_CATALOG, type GameId } from '@dascade/shared';
import { Badge, IconButton, PixelIcon } from '@dascade/ui';
import { useApp } from '../app/store.ts';
import { useRoomSelector } from '../net/hooks.ts';
import { sfx } from '../audio/audio.ts';
import { ConnectionDot, LeaveButton } from './common.tsx';

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
    <button type="button" className="code-chip" onClick={copy} aria-label={`Room code ${code}. Copy invite link`} title="Copy invite link">
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
  const game = GAME_CATALOG[gameId];
  return (
    <header className="topbar" style={{ '--accent': game.accent.primary } as React.CSSProperties}>
      <div className="topbar__left">
        <LeaveButton size="sm" compact />
        <span className="topbar__title dc-pixel">{game.marquee}</span>
        <RoomCodeChip code={code} />
      </div>
      <div className="topbar__center">
        {phase ? (
          <Badge color={phase === 'PLAYING' ? 'var(--green)' : phase === 'RESULTS' ? 'var(--yellow)' : 'var(--accent)'}>
            {PHASE_LABEL[phase] ?? phase}
          </Badge>
        ) : null}
      </div>
      <div className="topbar__right">
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
        <IconButton icon={muted ? 'sound-off' : 'sound-on'} label={muted ? 'Unmute' : 'Mute'} size="sm" onClick={() => updateSettings({ muted: !muted })} />
        <IconButton icon="help" label="How to play" size="sm" onClick={() => openModal('help', gameId)} />
        <IconButton icon="gear" label="Settings" size="sm" onClick={() => openModal('settings')} />
      </div>
    </header>
  );
}

/** Minimal floating menu for immersive games (top bar hidden). */
export function ShellMenu({ gameId, code }: { gameId: GameId; code: string }) {
  const openModal = useApp((s) => s.openModal);
  const [open, setOpen] = useState(false);
  return (
    <div className="shell-menu" data-open={open ? 'true' : undefined}>
      <IconButton icon={open ? 'close' : 'gear'} label={open ? 'Close menu' : 'Open menu'} variant="secondary" size="sm" onClick={() => setOpen(!open)} />
      {open ? (
        <div className="shell-menu__panel dc-panel">
          <RoomCodeChip code={code} />
          <ConnectionDot />
          <IconButton icon="help" label="How to play" size="sm" onClick={() => openModal('help', gameId)} />
          <IconButton icon="gear" label="Settings" size="sm" onClick={() => openModal('settings')} />
          <LeaveButton size="sm" />
        </div>
      ) : null}
    </div>
  );
}
