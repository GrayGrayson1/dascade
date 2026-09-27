/**
 * Arcade floor HUD: the DASCADE neon lockup, server status, Join with code,
 * profile chip, sound / motion / settings / help controls, and the footer.
 */
import { memo, useEffect, useState, type ReactNode } from 'react';
import { Avatar, Button, IconButton, Kbd } from '@dascade/ui';
import { useApp } from '../app/store.ts';
import { serverUrl } from '../net/serverUrl.ts';
import { sfx } from '../audio/audio.ts';
import { ClawQuickButton } from './ClawMachine.tsx';
import { NeonWord } from './NeonWord.tsx';
import { CABINET_LIST } from '@dascade/shared';
import { fill, tickerItems, useThemeCopy, useThemeFlavour } from '../themes/copy.ts';
import { ThemeButton } from '../themes/ThemeButton.tsx';

export type ServerStatus = { state: 'checking' | 'online' | 'offline'; rooms: number };

/** Polls /api/health (every ~15s online, ~6s while offline; paused in hidden tabs). */
export function useServerStatus(intervalMs = 15_000): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>({ state: 'checking', rooms: 0 });
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ctrl: AbortController | null = null;
    let offline = false;
    const schedule = () => {
      if (!alive) return;
      clearTimeout(timer);
      timer = setTimeout(poll, offline ? Math.min(6_000, intervalMs) : intervalMs);
    };
    const poll = async () => {
      if (!alive) return;
      if (document.hidden) {
        schedule();
        return;
      }
      ctrl?.abort();
      ctrl = new AbortController();
      const abort = setTimeout(() => ctrl?.abort(), 5_000);
      try {
        const res = await fetch(`${serverUrl()}/api/health`, { cache: 'no-store', signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { ok?: boolean; rooms?: number };
        offline = false;
        if (alive) setStatus({ state: 'online', rooms: Math.max(0, Number(body.rooms) || 0) });
      } catch {
        offline = true;
        if (alive) setStatus((s) => ({ state: 'offline', rooms: s.rooms }));
      } finally {
        clearTimeout(abort);
        schedule();
      }
    };
    void poll();
    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearTimeout(timer);
      ctrl?.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);
  return status;
}

export function ServerStatusPill({ status, className }: { status: ServerStatus; className?: string }) {
  const text =
    status.state === 'online'
      ? `Online · ${status.rooms} ${status.rooms === 1 ? 'room' : 'rooms'} live`
      : status.state === 'offline'
        ? 'Arcade offline — retrying'
        : 'Connecting…';
  return (
    <span
      className={`af-srv ${className ?? ''}`}
      data-state={status.state}
      role="status"
      title={status.state === 'offline' ? 'The game server isn’t reachable right now. We’ll keep trying.' : undefined}
    >
      <i aria-hidden />
      <span>{text}</span>
    </span>
  );
}

export const ArcadeHeader = memo(function ArcadeHeader({ status, kiosk }: { status: ServerStatus; kiosk?: ReactNode }) {
  const openModal = useApp((s) => s.openModal);
  const muted = useApp((s) => s.settings.muted);
  const reducedMotion = useApp((s) => s.settings.reducedMotion);
  const updateSettings = useApp((s) => s.updateSettings);
  const profile = useApp((s) => s.profile);
  const confirmed = useApp((s) => s.profileConfirmed);
  const open = (m: 'join' | 'profile' | 'settings' | 'help') => {
    sfx('click');
    openModal(m);
  };
  const t = useThemeCopy();
  const badge = useThemeFlavour('arcade.badge');
  return (
    <header className="af-hud" data-part="arcade-header">
      <div className="af-hud__brand" data-part="arcade-brand">
        <h1 className="af-hud__logo">
          <span className="visually-hidden">DASCADE — Delta Alpha Sierra Arcade</span>
          <NeonWord className="af-hud__word" />
          <span className="af-hud__sub" aria-hidden data-part="arcade-tagline">
            {t('arcade.tagline', 'Delta Alpha Sierra Arcade')}
          </span>
        </h1>
        {badge ? (
          <span className="af-hud__badge" data-part="arcade-badge" aria-hidden>
            {badge}
          </span>
        ) : null}
      </div>
      {kiosk ? <div className="af-hud__kiosk">{kiosk}</div> : null}
      <div className="af-hud__actions" data-part="arcade-hud">
        <ServerStatusPill status={status} className="af-hud__status" />
        <Button variant="secondary" icon="users" className="af-hud__join" onClick={() => open('join')}>
          Join with code
        </Button>
        <button
          type="button"
          className="af-hud__profile"
          onClick={() => open('profile')}
          aria-label={confirmed ? `Profile: ${profile.name}. Edit name and avatar` : 'Set your name and avatar'}
        >
          <Avatar avatar={profile.avatar} color="var(--cyan)" size={28} />
          <span className="af-hud__profile-name" data-empty={confirmed ? undefined : 'true'}>
            {confirmed ? profile.name : 'Set your name'}
          </span>
        </button>
        <span className="af-hud__icons">
          {/* The jukebox's quick control (the jukebox UI portals it in; the machine itself stands on the floor). */}
          <span className="af-hud__jukebox" data-jukebox-slot="hud" data-jukebox-variant="compact" />
          {/* The claw machine's quick control, where the floor has no room for the machine (claw.css). */}
          <ClawQuickButton className="af-hud__claw" />
          <IconButton
            icon={muted ? 'sound-off' : 'sound-on'}
            label={muted ? 'Unmute sound' : 'Mute sound'}
            onClick={() => {
              updateSettings({ muted: !muted });
              if (muted) setTimeout(() => sfx('click'), 30);
            }}
          />
          <IconButton
            icon="motion"
            label={reducedMotion ? 'Turn animations back on' : 'Reduce motion'}
            className="af-hud__motion"
            onClick={() => updateSettings({ reducedMotion: !reducedMotion })}
          />
          <ThemeButton className="af-hud__theme" />
          <IconButton icon="gear" label="Settings" onClick={() => open('settings')} />
          <IconButton icon="help" label="Help and how to play" onClick={() => open('help')} />
        </span>
      </div>
    </header>
  );
});

/**
 * Ambient status ticker slot: a theme's `arcade.status` items ("MODEM READY|{cabinets} CABINETS ONLINE")
 * with live {cabinets} / {rooms} / {online} values. Decorative (aria-hidden); nothing under Delta Neon.
 */
export function ArcadeStatusTicker({ status }: { status: ServerStatus }) {
  const raw = useThemeFlavour('arcade.status');
  const items = tickerItems(raw);
  if (!items.length) return null;
  const vars = {
    cabinets: CABINET_LIST.length,
    rooms: status.rooms,
    online: status.state === 'online' ? 'ONLINE' : status.state === 'offline' ? 'OFFLINE' : 'CONNECTING',
  };
  return (
    <span className="af-ticker" data-part="arcade-status" data-state={status.state} aria-hidden>
      {items.map((item, i) => (
        <span key={i} className="af-ticker__item" data-part="arcade-status-item">
          {fill(item, vars)}
        </span>
      ))}
    </span>
  );
}

export const ArcadeFooter = memo(function ArcadeFooter({ status }: { status: ServerStatus }) {
  return (
    <footer className="af-foot" data-part="arcade-footer">
      <ServerStatusPill status={status} className="af-foot__status" />
      <ArcadeStatusTicker status={status} />
      <span className="af-foot__legal">Virtual chips only — no real money, ever.</span>
      <span className="af-foot__keys" aria-hidden>
        <Kbd>←</Kbd>
        <Kbd>→</Kbd> browse <Kbd>Enter</Kbd> open
      </span>
    </footer>
  );
});
