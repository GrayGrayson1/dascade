/**
 * Drawer tab "Sound" (AUD-02 C): which ONE device plays the show's sound in an event room, when it was
 * last heard, the devices that can hold it (the presenter's console and connected big screens) and
 * "Make this the sound station". States are words plus an icon, never colour alone. Outside event
 * rooms the console plays the sound as it always has: just its status and toggles. (The console adds
 * its cue buttons below this panel.)
 */
import { useEffect, useMemo, useState } from 'react';
import {
  SHOWDOWN_AUDIO_READY,
  SHOWDOWN_AUDIO_SILENT,
  SHOWDOWN_MSG,
  SHOWDOWN_STATION_TIMEOUT_MS,
  type ShowdownEvent,
  type ShowdownLook,
  type ShowdownPublicState,
} from '@dascade/shared/games/showdown';
import { Button, PixelIcon } from '@dascade/ui';
import { playersEqual, useRoomMessage, useRoomSelector } from '../../../net/hooks.ts';
import { useSessionStore } from '../../../net/session.ts';
import { sfx } from '../../../audio/audio.ts';
import { showdownApi } from '../api.ts';
import { AudioStatus, ShowSoundToggle, ThemeMusicToggle } from '../consoleParts.tsx';
import { useCan, useStation } from '../state.ts';
import { useServerNow } from './useTicker.ts';
import './panels.css';

const NO_SCREENS: Record<string, boolean> = {};

type Health = 'ok' | 'silent' | 'lost' | 'waiting';

const HEALTH_ICON: Record<Health, string> = { ok: '✓', silent: '!', lost: '✕', waiting: '…' };

export function SoundPanel({ look }: { look: ShowdownLook }) {
  const station = useStation();
  const canMove = useCan('audio.station');
  const playerId = useSessionStore((s) => s.playerId);
  const presenterId = useRoomSelector<ShowdownPublicState, string>((s) => s.presenterId) ?? '';
  const players = useRoomSelector<ShowdownPublicState, ShowdownPublicState['players']>((s) => s.players, playersEqual);
  const screens = useRoomSelector<ShowdownPublicState, Record<string, boolean>>((s) => s.screens ?? NO_SCREENS) ?? NO_SCREENS;
  const now = useServerNow(station.event, 1000);
  const [said, setSaid] = useState('');

  // A station change in words: moved by crew, or lost (the console took over).
  useRoomMessage<ShowdownEvent>(SHOWDOWN_MSG.event, (ev) => {
    if (ev?.type !== 'station') return;
    const name = ev.playerId ? (players?.[ev.playerId]?.name ?? 'a big screen') : 'the presenter console';
    setSaid(
      ev.lost
        ? `The sound station stopped answering. ${capital(name)} plays the show’s sound now.`
        : `${capital(name)} is the sound station now.`,
    );
  });
  useEffect(() => {
    if (!said) return;
    const t = setTimeout(() => setSaid(''), 8000);
    return () => clearTimeout(t);
  }, [said]);

  const devices = useMemo(() => {
    const list: Array<{ id: string; stationId: string; name: string; kind: string }> = [];
    if (presenterId)
      list.push({ id: presenterId, stationId: '', name: 'Presenter console', kind: players?.[presenterId]?.name ?? 'The presenter' });
    for (const id of Object.keys(screens)) {
      const p = players?.[id];
      if (screens[id] && p?.connected) list.push({ id, stationId: id, name: p.name, kind: 'Big screen' });
    }
    return list;
  }, [presenterId, players, screens]);

  if (!station.event) {
    return (
      <section className="sdp-panel sdp-sound" aria-labelledby="sdp-sound-title" data-part="showdown-sound-panel">
        <h3 className="sd-panel__title" id="sdp-sound-title">
          <PixelIcon name="sound-on" /> Sound
        </h3>
        <p className="sdp-lead">This console plays the show’s sound. In Teams, share the stage window with “Include computer sound”.</p>
        <div className="sdp-sound__local">
          <AudioStatus look={look} />
          <ShowSoundToggle />
          <ThemeMusicToggle />
        </div>
      </section>
    );
  }

  const holderAudio = station.audio[station.holderId];
  const ago = station.seenAt > 0 ? Math.max(0, now - station.seenAt) : null;
  const health: Health =
    ago === null ? 'waiting' : ago > SHOWDOWN_STATION_TIMEOUT_MS ? 'lost' : holderAudio === SHOWDOWN_AUDIO_SILENT ? 'silent' : 'ok';
  const holderName = station.station
    ? station.holderName || 'A big screen'
    : `Presenter console${station.holderName ? ` (${station.holderName})` : ''}`;
  const heard = ago === null ? 'not heard yet' : `heard ${Math.round(ago / 1000)} s ago`;
  const headline =
    health === 'ok'
      ? `Sound: ${holderName} ${HEALTH_ICON.ok} ${heard}`
      : health === 'silent'
        ? `Sound: ${holderName} can’t play right now (muted, sounds off or waiting for a click) · ${heard}`
        : health === 'lost'
          ? `Sound: ${holderName} — ${heard}; the console takes over if it stays silent`
          : `Sound: ${holderName} — waiting for its first heartbeat`;

  const move = (stationId: string, name: string) => {
    sfx('select');
    showdownApi.station(stationId);
    setSaid(`Moving the sound station to ${name}…`);
  };

  return (
    <section className="sdp-panel sdp-sound" aria-labelledby="sdp-sound-title" data-part="showdown-sound-panel">
      <h3 className="sd-panel__title" id="sdp-sound-title">
        <PixelIcon name="sound-on" /> Sound station
      </h3>
      <p className="sdp-status" data-state={health} data-part="showdown-sound-status">
        <span className="sdp-status__icon" aria-hidden>
          {HEALTH_ICON[health]}
        </span>
        <span>{headline}</span>
      </p>
      <p className="sdp-lead">Exactly one device plays the show’s sound. If it goes quiet for 5 s, the presenter’s console takes over.</p>

      <ul className="sdp-devices" aria-label="Devices that can play the show’s sound">
        {devices.map((d) => {
          const holds = d.id === station.holderId;
          const a = station.audio[d.id];
          const state = a === SHOWDOWN_AUDIO_READY ? 'Ready' : a === SHOWDOWN_AUDIO_SILENT ? 'Silent' : 'No report yet';
          return (
            <li key={d.id} data-holds={holds ? 'true' : undefined}>
              <span className="sdp-devices__name">
                <PixelIcon name={holds ? 'sound-on' : 'sound-off'} />
                <span>
                  <b>{d.name}</b>
                  {d.id === playerId ? ' (this device)' : ''}
                  <small>
                    {d.kind} · {state}
                    {holds ? ' · plays the sound' : ''}
                  </small>
                </span>
              </span>
              {holds ? (
                <span className="sdp-tag">
                  <PixelIcon name="check" /> Sound station
                </span>
              ) : canMove ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => move(d.stationId, d.name)}
                  aria-label={`Make ${d.name} the sound station`}
                >
                  Make this the sound station
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {devices.length < 2 ? <p className="sdp-empty">A big screen that joins with the big-screen link can hold the sound too.</p> : null}

      <h4 className="sdp-sub">This console</h4>
      <div className="sdp-sound__local">
        <AudioStatus look={look} />
        <ShowSoundToggle />
        <ThemeMusicToggle />
      </div>
      <p className="sdp-notice" role="status" aria-live="polite">
        {said}
      </p>
    </section>
  );
}

const capital = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
