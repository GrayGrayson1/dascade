/**
 * Drawer tab / lobby section "Preflight" (OPS-03 B): one GO / NO-GO for the crew, with live checks
 * and the fix next to anything that fails. It asks the server for its crew-only facts when it opens
 * and every 10 s while it's on screen; manual confirmations are remembered per room on this device.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { SHOWDOWN_AUDIO_READY, SHOWDOWN_AUDIO_SILENT, type ShowdownLook, type ShowdownPublicState } from '@dascade/shared/games/showdown';
import { Button, PixelIcon } from '@dascade/ui';
import { useRoomSelector } from '../../../net/hooks.ts';
import { useSessionStore } from '../../../net/session.ts';
import { useApp } from '../../../app/store.ts';
import { audioReady, onAudioReadyChange, sfx } from '../../../audio/audio.ts';
import { showdownApi } from '../api.ts';
import { copyLink } from '../consoleParts.tsx';
import { openStageWindow, useStageWindow } from '../stageWindow.ts';
import { useCan, useEvent, usePreflightData, useShowSounds, useStation } from '../state.ts';
import {
  STATE_ICON,
  STATE_WORD,
  evaluatePreflight,
  loadManual,
  preflightSummary,
  saveManual,
  type CheckRow,
  type ManualConfirms,
  type ManualId,
} from './preflight.ts';
import { useServerNow } from './useTicker.ts';
import './panels.css';

/** Re-ask the server this often while the panel is on screen. */
const REFRESH_MS = 10_000;

// The stage window opened at least once on this device (pop-ups are allowed), across panel mounts.
let stageOpenedOnce = false;
let popupBlockedOnce = false;
const popupListeners = new Set<() => void>();
const popupVersion = { v: 0 };
function notePopup(opened: boolean): void {
  if (opened) stageOpenedOnce = true;
  else popupBlockedOnce = true;
  popupVersion.v++;
  for (const l of [...popupListeners]) l();
}

export function joinLink(code: string): string {
  return `${typeof location === 'undefined' ? '' : location.origin}/r/${code}`;
}

export function PreflightPanel({ look, code, title }: { look: ShowdownLook; code: string; title: string }) {
  const event = Boolean(useEvent());
  const canRead = useCan('preflight.read');
  const data = usePreflightData();
  const myId = useSessionStore((s) => s.playerId);
  const presenterId = useRoomSelector<ShowdownPublicState, string>((s) => s.presenterId) ?? '';
  const customRounds = useRoomSelector<ShowdownPublicState, number>((s) => s.customRounds) ?? 0;
  const stageWin = useStageWindow();
  const station = useStation();
  const ready = useSyncExternalStore(onAudioReadyChange, audioReady, () => true);
  const muted = useApp((s) => s.settings.muted);
  const [sounds] = useShowSounds('presenter');
  const now = useServerNow(true, 1000);
  const [manual, setManual] = useState<ManualConfirms>(() => loadManual(code));
  useSyncExternalStore(
    (fn) => {
      popupListeners.add(fn);
      return () => popupListeners.delete(fn);
    },
    () => popupVersion.v,
  );
  useEffect(() => {
    if (stageWin.open && !stageOpenedOnce) notePopup(true);
  }, [stageWin.open]);

  useEffect(() => setManual(loadManual(code)), [code]);

  const ask = useCallback(() => {
    if (event && canRead) showdownApi.preflight();
  }, [event, canRead]);
  useEffect(() => {
    ask();
    if (!event || !canRead) return;
    const t = setInterval(ask, REFRESH_MS);
    return () => clearInterval(t);
  }, [ask, event, canRead]);

  const presenterDevice = Boolean(myId && myId === presenterId);
  const holderAudio = station.audio[station.holderId];
  const rows = evaluatePreflight({
    // Only this room's answer counts (a previous room's facts may still be cached).
    data: data && event && canRead ? data : null,
    event,
    now,
    presenterDevice,
    stageOpen: stageWin.open,
    stageOpened: stageOpenedOnce,
    popupBlocked: popupBlockedOnce && !stageWin.open,
    station: {
      name: station.station ? station.holderName : `Presenter console${station.holderName ? ` (${station.holderName})` : ''}`,
      seenAt: station.seenAt,
      ready: holderAudio === SHOWDOWN_AUDIO_READY ? true : holderAudio === SHOWDOWN_AUDIO_SILENT ? false : null,
    },
    local: { ready, muted, sounds },
    manual,
    customRounds,
  });
  const summary = preflightSummary(rows);

  const confirm = (id: ManualId) => {
    sfx('select');
    setManual((m) => {
      const next = { ...m, [id]: !m[id] };
      if (!next[id]) delete next[id];
      saveManual(code, next);
      return next;
    });
  };
  const openStage = () => {
    // Must run inside the click (pop-up blockers allow only user-initiated windows).
    const ok = openStageWindow(code, title);
    notePopup(ok);
    if (!ok) useApp.getState().toast('warning', 'Your browser blocked the stage window — allow pop-ups for this site, then try again.');
  };

  if (event && !canRead) {
    return (
      <section className="sdp-panel" aria-labelledby="sdp-pre-title" data-part="showdown-preflight">
        <h3 className="sd-panel__title" id="sdp-pre-title">
          <PixelIcon name="check" /> Preflight
        </h3>
        <p className="sdp-empty">The preflight is for the presenter and the producer.</p>
      </section>
    );
  }

  const checkedAgo = data && event ? Math.max(0, Math.round((now - data.at) / 1000)) : null;

  return (
    <section className="sdp-panel sdp-preflight" data-look={look} aria-labelledby="sdp-pre-title" data-part="showdown-preflight">
      <h3 className="sd-panel__title" id="sdp-pre-title">
        <PixelIcon name="check" /> Preflight
      </h3>
      <div
        className="sdp-verdict"
        data-verdict={summary.verdict}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-part="showdown-preflight-verdict"
      >
        <b className="sdp-verdict__word">{summary.headline}</b>
        <span className="sdp-verdict__sub">{summary.sub}</span>
      </div>
      <div className="sdp-block__head">
        <span className="sdp-note">
          {!event
            ? 'Server checks run in event rooms (load a DAS-O-Ween preset).'
            : checkedAgo === null
              ? 'Asking the server…'
              : `Checked ${checkedAgo} s ago · again every 10 s.`}
        </span>
        {event ? (
          <Button
            size="sm"
            variant="ghost"
            icon="refresh"
            onClick={() => {
              sfx('select');
              ask();
            }}
          >
            Check again
          </Button>
        ) : null}
      </div>
      <ul className="sdp-checks" aria-label="Preflight checks">
        {rows.map((row) => (
          <CheckItem key={row.id} row={row} code={code} onConfirm={confirm} onOpenStage={openStage} />
        ))}
      </ul>
    </section>
  );
}

function CheckItem({
  row,
  code,
  onConfirm,
  onOpenStage,
}: {
  row: CheckRow;
  code: string;
  onConfirm: (id: ManualId) => void;
  onOpenStage: () => void;
}) {
  const manualId = row.manual ? (row.id as ManualId) : null;
  return (
    <li className="sdp-check" data-state={row.state} data-check={row.id}>
      <span className="sdp-check__icon" aria-hidden>
        {STATE_ICON[row.state]}
      </span>
      <span className="sdp-check__body">
        <span className="sdp-check__label">
          <b>{row.label}</b>
          <span className="sdp-check__state">{STATE_WORD[row.state]}</span>
        </span>
        <span className="sdp-check__detail">{row.detail}</span>
        {row.state !== 'ok' && row.fix && row.action !== 'openStage' ? <span className="sdp-check__fix">Fix: {row.fix}</span> : null}
        {row.id === 'join' ? (
          <span className="sdp-check__extra">
            <code className="sdp-code">{joinLink(code)}</code>
            <Button
              size="sm"
              variant="ghost"
              icon="copy"
              onClick={() => void copyLink(joinLink(code), 'Join link copied — paste it in the meeting chat')}
            >
              Copy join link
            </Button>
          </span>
        ) : null}
        {row.id === 'freeze' ? (
          <span className="sdp-check__extra">
            Run <code className="sdp-code">scripts/freeze.sh on</code> (and <code className="sdp-code">off</code> after the show).
          </span>
        ) : null}
      </span>
      <span className="sdp-check__act">
        {row.action === 'openStage' && row.state !== 'ok' ? (
          <Button size="sm" variant="primary" icon="maximize" onClick={onOpenStage} data-part="showdown-preflight-fix">
            Open stage window
          </Button>
        ) : null}
        {manualId ? (
          <Button
            size="sm"
            variant={row.state === 'ok' ? 'ghost' : 'secondary'}
            icon={row.state === 'ok' ? undefined : 'check'}
            aria-pressed={row.state === 'ok'}
            aria-label={row.state === 'ok' ? `Undo: ${row.label}` : `Confirm: ${row.label}`}
            onClick={() => onConfirm(manualId)}
          >
            {row.state === 'ok' ? 'Undo' : 'Confirm'}
          </Button>
        ) : null}
      </span>
    </li>
  );
}
