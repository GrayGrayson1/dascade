/**
 * Room DJ tab (lazy chunk — it's the only jukebox code that touches the room session).
 *   host      enable Room DJ, allow queueing / skip votes, play or queue from the library into the room
 *   everyone  current room track + status, "Listen with room" (local choice), vote skip, queue if allowed
 * Local mute/volume stay in the player's always-visible controls and always win.
 */
import { useEffect, useId, useState } from 'react';
import { djPositionAt, type DjState } from '@dascade/shared';
import { jukebox, useJukebox } from '../audio/jukebox/index.ts';
import { serverNow, useSessionStore } from '../net/session.ts';
import { useRoomSelector } from '../net/hooks.ts';
import { formatTime, voteText } from './format.ts';
import { Glyph } from './icons.tsx';
import { Library, type LibraryActions } from './Library.tsx';

function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label className="jb-switch" htmlFor={id} data-disabled={disabled ? 'true' : undefined}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      <span className="jb-switch__track" aria-hidden>
        <span className="jb-switch__thumb" />
      </span>
      <span className="jb-switch__text">
        <span className="jb-switch__label">{label}</span>
        {hint ? (
          <span className="jb-switch__hint" id={`${id}-hint`}>
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/** A switch that flips at once and settles on the server's answer (or reverts after 3 s without one). */
function useOptimisticFlag(server: boolean): [boolean, (v: boolean) => void] {
  const [pending, setPending] = useState<boolean | null>(null);
  useEffect(() => {
    if (pending === null) return;
    if (pending === server) {
      setPending(null);
      return;
    }
    const t = window.setTimeout(() => setPending(null), 3000);
    return () => window.clearTimeout(t);
  }, [pending, server]);
  return [pending ?? server, setPending];
}

/** Seconds into the room's track, refreshed once a second while visible (text only). */
function useRoomClock(room: DjState | null, active: boolean): number {
  const [pos, setPos] = useState(() => (room ? djPositionAt(room, serverNow()) : 0));
  useEffect(() => {
    if (!room) return;
    setPos(djPositionAt(room, serverNow()));
    if (!active || !room.playing) return;
    const id = window.setInterval(() => setPos(djPositionAt(room, serverNow())), 1000);
    return () => window.clearInterval(id);
  }, [room, active]);
  return pos;
}

/**
 * No DJ state yet. The server only starts sending `dj:state` once the host enables the Room DJ (until
 * then everyone assumes it's off). Permissions and the "on" command go through the engine like every
 * other DJ action (`djPermissions()` grants the room host control before any state exists); if no
 * state arrives after the host's "on", this server has no Room DJ.
 */
function DjOff({ announce }: { announce: (msg: string) => void }) {
  // Subscribed so a host hand-over / our welcome re-renders; the decision itself is the engine's.
  useSessionStore((s) => s.playerId);
  useRoomSelector((s) => s.hostId);
  const hostName = useRoomSelector((s) => (s.hostId ? (s.players?.[s.hostId]?.name ?? null) : null));
  const isHost = jukebox.djPermissions().control;
  const [state, setState] = useState<'idle' | 'pending' | 'unavailable'>('idle');
  useEffect(() => {
    if (state !== 'pending') return;
    const t = window.setTimeout(() => setState('unavailable'), 4000);
    return () => window.clearTimeout(t);
  }, [state]);
  return (
    <div
      className="jb-dj"
      data-part="dj"
      data-available={state === 'unavailable' ? 'false' : 'true'}
      data-enabled="false"
      data-role={isHost ? 'host' : 'guest'}
    >
      <section className="jb-dj__status" data-part="dj-status" aria-label="Room DJ status">
        <p className="jb-dj__line">
          <Glyph name="radio" size={14} />
          {state === 'unavailable' ? (
            <span>Room DJ isn’t available on this server. Your own jukebox keeps playing just for you.</span>
          ) : (
            <span>
              Room DJ is <strong>off</strong>
              {isHost ? ' — turn it on to play music for everyone.' : ` — ${hostName ?? 'the host'} can turn it on.`}
            </span>
          )}
        </p>
      </section>
      {isHost && state !== 'unavailable' ? (
        <fieldset className="jb-dj__host">
          <legend className="jb-section-label">Host controls</legend>
          <Switch
            checked={state === 'pending'}
            disabled={state === 'pending'}
            onChange={(v) => {
              if (!v || !jukebox.djPermissions().control) return;
              jukebox.dj.configure({ enabled: true });
              setState('pending');
              announce('Turning on the Room DJ');
            }}
            label="Room DJ"
            hint="Play one soundtrack for everyone in the room."
          />
        </fieldset>
      ) : null}
    </div>
  );
}

export default function DjPanel({ active, announce }: { active: boolean; announce: (msg: string) => void }) {
  const room = useJukebox((s) => s.room);
  const source = useJukebox((s) => s.source);
  const optOut = useJukebox((s) => s.roomOptOut);
  const tracks = useJukebox((s) => s.library.tracks);
  const playerId = useSessionStore((s) => s.playerId);
  // Live host (re-renders on a hand-over; djId can lag while the DJ is off).
  const hostId = useRoomSelector((s) => s.hostId);
  const names = useRoomSelector((s) => Object.fromEntries(Object.values(s.players ?? {}).map((p) => [p.id, p.name]))) ?? {};
  const pos = useRoomClock(room, active);
  const [votedFor, setVotedFor] = useState<string | null>(null);
  const [enabled, setEnabled] = useOptimisticFlag(room?.enabled ?? false);
  const [allowQueue, setAllowQueue] = useOptimisticFlag(room?.allowQueue ?? false);
  const [allowSkip, setAllowSkip] = useOptimisticFlag(room?.allowSkipVote ?? false);
  // The server refuses the Room DJ in Tournament Center matches: say so instead of offering a switch.
  const tournament = useRoomSelector((s) => Boolean(s.tournamentJson));

  if (tournament && !room?.enabled) {
    return (
      <div className="jb-dj" data-part="dj" data-available="false" data-enabled="false">
        <section className="jb-dj__status" data-part="dj-status" aria-label="Room DJ status">
          <p className="jb-dj__line">
            <Glyph name="radio" size={14} />
            <span>Room DJ is off during tournament matches. Your own jukebox keeps playing just for you.</span>
          </p>
        </section>
      </div>
    );
  }
  if (!room) return <DjOff announce={announce} />;

  // Re-evaluated every render (room state / player id changes re-render this component).
  const perm = jukebox.djPermissions();
  const title = (id: string) => tracks.find((t) => t.id === id)?.title ?? id;
  const djName = names[hostId || room.djId] ?? 'The host';
  const current = room.current;
  const voteKey = current ? `${current.trackId}:${current.addedBy}:${room.anchorServerTime}` : null;
  // The server's public voter list is the truth (survives seeks, reconnects and re-opening this tab);
  // the local key only bridges the moment between click and the server's echo.
  const serverVoted = Boolean(playerId && current && (room.skipVoters ?? []).includes(playerId));
  const voted = serverVoted || (voteKey !== null && votedFor === voteKey);

  const configure = (optimistic: (v: boolean) => void, patch: Parameters<typeof jukebox.dj.configure>[0], msg: string) => {
    optimistic(Object.values(patch)[0] === true);
    jukebox.dj.configure(patch);
    announce(msg);
  };

  const hostActions: LibraryActions = {
    currentId: current?.trackId ?? null,
    play: (id) => {
      jukebox.dj.play(id);
      announce(`Playing ${title(id)} for the room`);
    },
    playLabel: (t) => `Play ${t.title} for the room`,
    playNext: (id) => {
      jukebox.dj.enqueue(id, true);
      announce(`${title(id)} will play next in the room`);
    },
    queue: (id) => {
      jukebox.dj.enqueue(id);
      announce(`${title(id)} added to the room queue`);
    },
  };
  const guestActions: LibraryActions = {
    currentId: current?.trackId ?? null,
    play: (id) => {
      jukebox.dj.enqueue(id);
      announce(`${title(id)} added to the room queue`);
    },
    playLabel: (t) => `Add ${t.title} to the room queue`,
  };

  return (
    <div
      className="jb-dj"
      data-part="dj"
      data-available="true"
      data-enabled={room.enabled ? 'true' : 'false'}
      data-role={perm.control ? 'host' : 'guest'}
    >
      <section className="jb-dj__status" data-part="dj-status" aria-label="Room DJ status">
        <p className="jb-dj__line">
          <Glyph name="radio" size={14} />
          {room.enabled ? (
            <span>
              Room DJ is <strong>on</strong> · DJ: <strong>{perm.control ? 'you' : djName}</strong>
            </span>
          ) : (
            <span>
              Room DJ is <strong>off</strong>
              {perm.control ? ' — turn it on to play music for everyone.' : ` — ${djName} can turn it on.`}
            </span>
          )}
        </p>
        {room.enabled ? (
          <p className="jb-dj__now">
            {current ? (
              <>
                <span className="jb-dj__state">{room.playing ? 'Now playing' : 'Paused'}</span>
                <span className="jb-dj__title">{title(current.trackId)}</span>
                <span className="jb-dj__time">
                  {formatTime(pos)} / {formatTime(current.duration)}
                </span>
              </>
            ) : (
              <span className="jb-dj__state">Nothing playing in the room yet.</span>
            )}
          </p>
        ) : null}
        {room.enabled ? (
          <p className="jb-dj__you" data-following={source === 'room' ? 'true' : 'false'}>
            {optOut
              ? 'You opted out — you hear your own music.'
              : source === 'room'
                ? 'You’re listening with the room.'
                : 'Joining the room’s music…'}
          </p>
        ) : null}
      </section>

      {room.enabled ? (
        <Switch
          checked={!optOut}
          onChange={(listen) => {
            jukebox.setRoomOptOut(!listen);
            announce(listen ? 'Listening with the room' : 'Opted out of room music');
          }}
          label="Listen with room"
          hint="Just for you. Your volume and mute always win."
        />
      ) : null}

      {room.enabled && room.allowSkipVote && current ? (
        <div className="jb-dj__vote">
          <button
            type="button"
            className="jb-btn jb-btn--pill"
            disabled={!perm.vote || voted}
            aria-pressed={voted}
            onClick={() => {
              jukebox.dj.voteSkip();
              setVotedFor(voteKey);
              announce('Skip vote sent');
            }}
          >
            <Glyph name="next" size={14} />
            {voted ? 'Voted to skip' : 'Vote to skip'}
          </button>
          <span className="jb-dj__votes" aria-live="polite">
            {voteText(room.skipVotes, room.skipNeeded || 1)}
          </span>
        </div>
      ) : null}

      {perm.control ? (
        <fieldset className="jb-dj__host">
          <legend className="jb-section-label">Host controls</legend>
          <Switch
            checked={enabled}
            onChange={(v) => configure(setEnabled, { enabled: v }, v ? 'Room DJ on' : 'Room DJ off')}
            label="Room DJ"
            hint="Play one soundtrack for everyone in the room."
          />
          <Switch
            checked={allowQueue}
            disabled={!enabled}
            onChange={(v) => configure(setAllowQueue, { allowQueue: v }, v ? 'Everyone can queue tracks' : 'Only you can queue tracks')}
            label="Allow everyone to queue"
          />
          <Switch
            checked={allowSkip}
            disabled={!enabled}
            onChange={(v) => configure(setAllowSkip, { allowSkipVote: v }, v ? 'Skip votes on' : 'Skip votes off')}
            label="Allow skip vote"
            hint="A majority of listeners skips the track."
          />
        </fieldset>
      ) : null}

      {room.enabled && room.queue.length > 0 ? (
        <section className="jb-dj__queue" aria-label="Room queue">
          <div className="jb-queue__head">
            <span className="jb-section-label">Room queue · {room.queue.length}</span>
            {perm.control ? (
              <button
                type="button"
                className="jb-btn jb-btn--text"
                onClick={() => {
                  jukebox.dj.clearQueue();
                  announce('Room queue cleared');
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
          <ol className="jb-tracks jb-tracks--queue">
            {room.queue.map((e, i) => (
              <li key={e.entryId} className="jb-track jb-qitem" data-part="queue-item">
                <span className="jb-track__main jb-track__main--static">
                  <span className="jb-qitem__pos">{i + 1}</span>
                  <span className="jb-track__text">
                    <span className="jb-track__title">{title(e.trackId)}</span>
                    <span className="jb-track__artist">added by {e.addedBy === playerId ? 'you' : (names[e.addedBy] ?? 'a player')}</span>
                  </span>
                  <span className="jb-track__dur">{formatTime(e.duration)}</span>
                </span>
                {perm.control || e.addedBy === playerId ? (
                  <button
                    type="button"
                    className="jb-btn jb-btn--icon jb-btn--row"
                    onClick={() => {
                      jukebox.dj.dequeue(e.entryId);
                      announce(`${title(e.trackId)} removed from the room queue`);
                    }}
                    aria-label={`Remove ${title(e.trackId)} from the room queue`}
                    title="Remove"
                  >
                    <Glyph name="trash" />
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {room.enabled && (perm.control || perm.queue) ? (
        <section className="jb-dj__library" aria-label={perm.control ? 'Play for the room' : 'Queue for the room'}>
          <span className="jb-section-label">{perm.control ? 'Play for the room' : 'Queue for the room'}</span>
          <Library actions={perm.control ? hostActions : guestActions} compact />
        </section>
      ) : null}
    </div>
  );
}
