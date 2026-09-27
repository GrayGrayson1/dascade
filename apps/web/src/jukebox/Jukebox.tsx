/**
 * DASCADE Jukebox UI root — mounted once in App.tsx (inside the router, outside <Routes>), lazily.
 * The engine (apps/web/src/audio/jukebox) owns playback and outlives every route; this is only the
 * face: the dock (collapsed mini player), the expanded player and a polite live region.
 * A crash anywhere in here renders nothing — the arcade never depends on the jukebox.
 */
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { installJukebox, jukebox, useJukebox } from '../audio/jukebox/index.ts';
import { Dock, type DockInfo } from './Dock.tsx';
import { Player, type PlayerAnchor } from './Player.tsx';
import './jukebox.css';

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: Error): void {
    console.warn('[DASCADE] jukebox UI failed; the arcade continues without it', error);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

function anchorFor(dock: DockInfo): PlayerAnchor {
  if (dock.kind === 'float' && (dock.corner === 'bl' || dock.corner === 'l')) return 'bottom-left';
  if (dock.kind === 'float') return 'bottom-right';
  return 'top-right';
}

/** Announces track changes politely, debounced so skipping through tracks doesn't chatter. */
function useTrackAnnouncements(say: (msg: string) => void): void {
  const currentId = useJukebox((s) => s.currentId);
  const playing = useJukebox((s) => s.playing);
  const source = useJukebox((s) => s.source);
  const first = useRef(true);
  const lastSaid = useRef<string | null>(null);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      lastSaid.current = currentId;
      return;
    }
    if (!currentId || !playing || currentId === lastSaid.current) return;
    const t = window.setTimeout(() => {
      const track = jukebox.track(currentId);
      if (!track) return;
      lastSaid.current = currentId;
      say(`${source === 'room' ? 'Room DJ' : 'Now playing'}: ${track.title}${track.artist ? ` by ${track.artist}` : ''}`);
    }, 900);
    return () => window.clearTimeout(t);
  }, [currentId, playing, source, say]);
}

function JukeboxUi() {
  const expanded = useJukebox((s) => s.expanded);
  const room = useJukebox((s) => s.room);
  const { pathname } = useLocation();
  const [everOpened, setEverOpened] = useState(expanded);
  const [dock, setDock] = useState<DockInfo>({ kind: 'float', corner: 'br' });
  const [message, setMessage] = useState('');
  const returnFocus = useRef<HTMLElement | null>(null);
  const inRoom = pathname.startsWith('/room/') || room !== null;

  useEffect(() => {
    installJukebox(); // idempotent (audio boot normally did it already)
  }, []);

  useEffect(() => {
    if (expanded) setEverOpened(true);
  }, [expanded]);

  const announce = useCallback((msg: string) => {
    // Re-set even when identical so screen readers repeat it.
    setMessage('');
    window.setTimeout(() => setMessage(msg), 30);
  }, []);
  useTrackAnnouncements(announce);

  const open = useCallback(() => {
    const active = document.activeElement;
    returnFocus.current = active instanceof HTMLElement ? active : null;
    jukebox.setExpanded(true);
  }, []);

  const close = useCallback((restoreFocus = true) => {
    jukebox.setExpanded(false);
    if (!restoreFocus) {
      returnFocus.current = null;
      return;
    }
    // Back to where the user came from, else the dock's open button (if it's visible).
    const target = returnFocus.current?.isConnected
      ? returnFocus.current
      : document.querySelector<HTMLElement>('[data-jukebox] [data-part="mini-open"]');
    returnFocus.current = null;
    target?.focus({ preventScroll: true });
  }, []);

  const toggle = useCallback(() => (useJukebox.getState().expanded ? close() : open()), [open, close]);

  return (
    <>
      <Dock expanded={expanded} onToggleOpen={toggle} onDock={setDock} />
      {everOpened ? <Player open={expanded} anchor={anchorFor(dock)} inRoom={inRoom} onClose={close} announce={announce} /> : null}
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-jukebox-live="">
        {message}
      </div>
    </>
  );
}

export function Jukebox() {
  return (
    <Boundary>
      <JukeboxUi />
    </Boundary>
  );
}
