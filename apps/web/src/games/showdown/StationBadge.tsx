/**
 * The sound station's status (AUD-02 C), in words and an icon — never colour alone:
 *  - on the presenter's console (or a crew device): "Sound: Stage TV ✓ heard 2 s ago", or
 *    "✗ not heard for 8 s" when the station stops answering;
 *  - on a big screen: "This screen plays the show’s sound", or "Silent — the sound plays on …".
 * The seconds refresh once a second; screen readers hear only a calm summary when it changes (the
 * console also gets a toast when a big-screen station drops: useShowSync). Nothing outside event rooms.
 */
import { useEffect, useRef, useState } from 'react';
import type { ShowdownPublicState } from '@dascade/shared/games/showdown';
import { PixelIcon, cx } from '@dascade/ui';
import { serverNow, useRoomSelector } from '../../net/hooks.ts';
import { useSessionStore } from '../../net/session.ts';
import { useScreenMode } from './access.ts';
import { agoText, consoleStationCopy, screenStationCopy, stationDevice, stationHealth } from './showAudio.ts';
import { useStation } from './state.ts';
import './stationBadge.css';

export function StationBadge({ compact = false }: { compact?: boolean }) {
  const st = useStation();
  const playerId = useSessionStore((s) => s.playerId);
  const code = useSessionStore((s) => s.code);
  const presenterId = useRoomSelector<ShowdownPublicState, string>((s) => s.presenterId) ?? '';
  const localScreen = useScreenMode(code);
  const now = useServerClock(st.event);

  const presenting = Boolean(playerId) && playerId === presenterId;
  const view = !presenting && localScreen ? 'screen' : 'console';
  const reading = stationHealth({ seenAt: st.seenAt, flag: st.audio[st.holderId], now });
  const device = stationDevice({ station: st.station, holderName: st.holderName, presenting, mine: st.mine });
  const copy = view === 'screen' ? screenStationCopy(st.mine, device, reading) : consoleStationCopy(device, reading);
  const announce = useAnnouncement(st.event ? copy.spoken : '');

  if (!st.event) return null;
  const good = view === 'screen' ? st.mine && reading.health !== 'silent' : reading.health === 'ok';
  // Compact (a crowded top bar): the device, the mark and the seconds; the full line stays readable.
  const short = view === 'console' && compact ? compactLine(device, copy.mark, reading.health, reading.agoS) : null;
  return (
    <span
      className={cx('sd-station', compact && 'sd-station--compact')}
      data-part="showdown-station-badge"
      data-view={view}
      data-state={reading.health}
      data-mine={st.mine ? 'true' : 'false'}
      data-good={good ? 'true' : 'false'}
      data-holder={st.holderId}
      title={copy.text}
    >
      <PixelIcon name={good ? 'sound-on' : 'sound-off'} className="sd-station__icon" />
      {short === null ? (
        <span className="sd-station__text">{withNumbers(copy.text)}</span>
      ) : (
        <>
          <span className="sd-station__text" aria-hidden>
            {withNumbers(short)}
          </span>
          <span className="visually-hidden">{copy.text}</span>
        </>
      )}
      <span className="visually-hidden" role="status" aria-live="polite">
        {announce}
      </span>
    </span>
  );
}

/** "Sound: Stage TV ✓ 2 s", "Sound: this console ✗ silent", "Sound: Stage TV ✗ 9 s". */
function compactLine(device: string, mark: string, health: string, agoS: number | null): string {
  const tail = health === 'ok' || health === 'stale' ? ` ${agoText(agoS ?? 0)}` : health === 'silent' ? ' silent' : ' not heard';
  return `Sound: ${device} ${mark}${tail}`;
}

/** Server time, refreshed once a second while `on` (for "heard 2 s ago"). */
function useServerClock(on: boolean): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (!on) return;
    setNow(serverNow());
    const t = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

/** The summary to announce: nothing at first (the badge itself reads it), then each change. */
function useAnnouncement(spoken: string): string {
  const first = useRef<string | null>(null);
  const [said, setSaid] = useState('');
  useEffect(() => {
    if (first.current === null) {
      first.current = spoken;
      return;
    }
    setSaid(spoken);
  }, [spoken]);
  return said;
}

/** Digits in the house number font (--font-num via .dc-num). */
function withNumbers(text: string) {
  return text.split(/(\d+)/).map((part, i) =>
    /^\d+$/.test(part) ? (
      <span key={i} className="dc-num">
        {part}
      </span>
    ) : (
      part
    ),
  );
}
