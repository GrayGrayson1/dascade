/**
 * Presenter widgets shared by the consoles (Team Showdown, Presenter Showcase), the lobby's setup
 * card and the results screen: the stage window and big-screen buttons, the stage cards, the
 * device's sound status, and the presenter tools (pass, hand-over).
 *
 * Everything here is presenter chrome on the presenter's own screen: none of it is ever mirrored to
 * the stage window (the stage window only renders <Stage>).
 */
import { useState, useSyncExternalStore } from 'react';
import {
  SHOWDOWN_CARDS,
  SHOWDOWN_CARD_INFO,
  SHOWDOWN_EVENT_IDS,
  SHOWDOWN_MSG,
  type ShowdownCard,
  type ShowdownEventId,
  type ShowdownLook,
  type ShowdownPublicState,
} from '@dascade/shared/games/showdown';
import { Button, IconButton, PixelIcon, Select, cx } from '@dascade/ui';
import { playersEqual, session, useRoomSelector } from '../../net/hooks.ts';
import { useApp } from '../../app/store.ts';
import { audioReady, onAudioReadyChange, sfx } from '../../audio/audio.ts';
import { copyText, presenterLink, screenLink } from './access.ts';
import { openStageWindow, useStageWindow } from './stageWindow.ts';
import { playShowSound } from './sounds.ts';
import { useCard, useShowSounds, useThemeMusicPref } from './state.ts';

// ---------------------------------------------------------------------------
// Which event preset this presenter loaded (the server only says "rehearsal" and how many rounds)
// ---------------------------------------------------------------------------

const PRESET_KEY = 'dascade:showdown:preset';
const presetListeners = new Set<() => void>();
let presetMemo: { code: string; id: ShowdownEventId } | null = null;

function readLoadedPreset(): { code: string; id: ShowdownEventId } | null {
  if (presetMemo) return presetMemo;
  try {
    const raw = JSON.parse(sessionStorage.getItem(PRESET_KEY) ?? 'null') as { code?: unknown; id?: unknown } | null;
    if (raw && typeof raw.code === 'string' && (SHOWDOWN_EVENT_IDS as readonly unknown[]).includes(raw.id))
      presetMemo = { code: raw.code, id: raw.id as ShowdownEventId };
  } catch {
    /* storage unavailable */
  }
  return presetMemo;
}

function writeLoadedPreset(next: { code: string; id: ShowdownEventId } | null): void {
  presetMemo = next;
  try {
    if (next) sessionStorage.setItem(PRESET_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(PRESET_KEY);
  } catch {
    /* storage unavailable: memory only */
  }
  for (const l of [...presetListeners]) l();
}

/** Loads an event preset into this room (its settings and rounds) and remembers which one it was. */
export function loadEventPreset(code: string, id: ShowdownEventId): void {
  sfx('select');
  session.send(SHOWDOWN_MSG.preset, { id });
  writeLoadedPreset({ code, id });
}

/** The presenter saved their own rounds: they're no longer "the preset". */
export function forgetLoadedPreset(): void {
  writeLoadedPreset(null);
}

/** The event preset this browser loaded into this room (null: none, or rounds edited since). */
export function useLoadedPreset(code: string): ShowdownEventId | null {
  const memo = useSyncExternalStore(
    (fn) => {
      presetListeners.add(fn);
      return () => presetListeners.delete(fn);
    },
    readLoadedPreset,
    () => null,
  );
  return memo && memo.code === code ? memo.id : null;
}

export async function copyLink(text: string, done: string, secret = false): Promise<void> {
  const ok = await copyText(text);
  sfx('pop');
  if (ok) useApp.getState().toast('success', done);
  // The presenter link carries the pass: never put it up in a toast (the console may be screen-shared).
  else if (secret)
    useApp
      .getState()
      .toast(
        'warning',
        'Couldn’t copy the presenter link: this browser blocked the clipboard. Allow clipboard access for this site and try again.',
      );
  else useApp.getState().toast('info', text);
}

/** Opens the stage window (must run in the click). */
export function openStage(code: string, title: string): void {
  if (!openStageWindow(code, title)) {
    useApp
      .getState()
      .toast(
        'warning',
        'Your browser blocked the stage window — allow pop-ups for this site, or open the big-screen link on the projector.',
      );
  }
}

export function StageWindowButton({
  code,
  title,
  size = 'md',
  openLabel = 'Open stage window',
  className,
}: {
  code: string;
  title: string;
  size?: 'sm' | 'md' | 'lg';
  openLabel?: string;
  className?: string;
}) {
  const stageWin = useStageWindow();
  return (
    <Button
      size={size}
      variant={stageWin.open ? 'success' : 'primary'}
      icon={stageWin.open ? 'check' : 'maximize'}
      className={className}
      data-part="showdown-stage-window"
      onClick={() => openStage(code, title)}
      title={
        stageWin.open
          ? 'The stage window is open — click to bring it to the front'
          : 'Open the stage (no answers) in its own window, to share in the meeting'
      }
    >
      {stageWin.open ? 'Stage window open' : openLabel}
    </Button>
  );
}

export function BigScreenLinkButton({
  code,
  size = 'md',
  label = 'Big-screen link',
}: {
  code: string;
  size?: 'sm' | 'md';
  label?: string;
}) {
  return (
    <Button
      size={size}
      variant="ghost"
      icon="copy"
      aria-label={label}
      title="Copy the big-screen link (for a TV or projector computer)"
      onClick={() => void copyLink(screenLink(code), 'Big-screen link copied — open it on the TV or projector computer')}
    >
      <span className="sdc-lbl">{label}</span>
    </Button>
  );
}

/**
 * Holding cards: one click puts a card over every stage (Welcome, Be right back, Prize time, Thanks),
 * and Off takes it down. Works in the lobby, during the show and on the results screen.
 */
export function StageCards({ compact = false, className }: { compact?: boolean; className?: string }) {
  const card = useCard();
  const put = (next: ShowdownCard | '') => {
    sfx('select');
    session.send(SHOWDOWN_MSG.card, { card: next });
  };
  return (
    <div
      className={cx('sdc-cards', compact && 'sdc-cards--compact', className)}
      role="group"
      aria-label="Stage cards"
      data-part="showdown-stage-cards"
    >
      {SHOWDOWN_CARDS.map((c) => (
        <button
          key={c}
          type="button"
          className="sdc-card"
          aria-pressed={card === c}
          title={SHOWDOWN_CARD_INFO[c].blurb}
          onClick={() => put(card === c ? '' : c)}
        >
          <span className="sdc-card__icon" aria-hidden>
            {SHOWDOWN_CARD_INFO[c].icon}
          </span>
          <span className="sdc-card__title">{SHOWDOWN_CARD_INFO[c].title}</span>
          {card === c ? <span className="sdc-card__on">On stage</span> : null}
        </button>
      ))}
      <button
        type="button"
        className="sdc-card sdc-card--off"
        aria-pressed={card === null}
        onClick={() => put('')}
        aria-label="No stage card (show the board)"
      >
        <span className="sdc-card__icon" aria-hidden>
          ✕
        </span>
        <span className="sdc-card__title">Off</span>
      </button>
    </div>
  );
}

/** Show sounds on this device (the presenter's console is where the stage's sound comes from). */
export function ShowSoundToggle({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const [sounds, setSounds] = useShowSounds('presenter');
  return (
    <IconButton
      size={size}
      icon={sounds ? 'sound-on' : 'sound-off'}
      label={sounds ? 'Show sounds on — mute them on this device' : 'Show sounds off — play them on this device'}
      variant={sounds ? 'ghost' : 'secondary'}
      aria-pressed={sounds}
      onClick={() => setSounds(!sounds)}
    />
  );
}

export function ThemeMusicToggle({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const [music, setMusic] = useThemeMusicPref();
  return (
    <IconButton
      size={size}
      icon="music"
      className="sdc-music"
      data-on={music ? 'true' : undefined}
      label={music ? 'Theme music on (opening, title and holding cards) — turn it off' : 'Theme music off — turn it on'}
      variant={music ? 'ghost' : 'secondary'}
      aria-pressed={music}
      onClick={() => setMusic(!music)}
    />
  );
}

/**
 * The sound this device sends to the meeting: browsers start audio only after a click on the page,
 * so a console that reloaded is silent until then. Says what's wrong, and "Test sound" plays a ding
 * here only (to check the meeting hears it with "Include computer sound").
 */
export function AudioStatus({ look, compact = false }: { look: ShowdownLook; compact?: boolean }) {
  const ready = useSyncExternalStore(onAudioReadyChange, audioReady, () => true);
  const muted = useApp((s) => s.settings.muted);
  const [sounds, setSounds] = useShowSounds('presenter');
  let chip;
  if (muted) {
    chip = (
      <button type="button" className="sdc-audio" data-state="warn" onClick={() => useApp.getState().updateSettings({ muted: false })}>
        <PixelIcon name="sound-off" /> Sound muted — unmute
      </button>
    );
  } else if (!sounds) {
    chip = (
      <button type="button" className="sdc-audio" data-state="warn" onClick={() => setSounds(true)}>
        <PixelIcon name="sound-off" /> Show sounds off — turn on
      </button>
    );
  } else if (!ready) {
    chip = (
      // Any click on the page unlocks audio (installAudio's gesture listener): this is where to click.
      <button type="button" className="sdc-audio" data-state="warn" data-part="showdown-console-sound-prompt">
        <PixelIcon name="sound-on" /> Click to enable sound
      </button>
    );
  } else {
    chip = (
      <span className="sdc-audio" data-state="ok" role="status" title="Show sounds play on this device" aria-label="Sound on">
        <i aria-hidden /> <span className="sdc-lbl">Sound on</span>
      </span>
    );
  }
  return (
    <span className={cx('sdc-audiobox', compact && 'sdc-audiobox--compact')}>
      {chip}
      <Button
        size="sm"
        variant="ghost"
        icon="sound-on"
        aria-label="Test sound"
        onClick={() => playShowSound('ding', look)}
        disabled={muted || !sounds}
        title="Plays a ding on this device only — check the meeting hears it"
      >
        <span className="sdc-lbl">Test sound</span>
      </Button>
    </span>
  );
}

/** Stage window, big-screen link, presenter pass and hand-over — shared by the consoles and the lobby. */
export function PresenterTools({ code, pass }: { code: string; pass: string | null }) {
  const players = useRoomSelector<ShowdownPublicState, ShowdownPublicState['players']>((s) => s.players, playersEqual);
  const me = useRoomSelector<ShowdownPublicState, string>((s) => s.presenterId);
  const screens = useRoomSelector<ShowdownPublicState, Record<string, boolean>>((s) => s.screens);
  const [target, setTarget] = useState('');
  // Big screens never present (the server refuses): the answers would go up on the stage.
  const candidates = Object.values(players ?? {}).filter((p) => p.id !== me && p.connected && !screens?.[p.id]);
  return (
    <details className="sd-panel sd-tools">
      <summary className="sd-panel__title">
        <PixelIcon name="crown" /> Presenter tools
      </summary>
      <p className="sd-muted">
        Your presenter pass reclaims the controls from any device. Keep it private — whoever has it sees the answers.
      </p>
      <div className="sd-row sd-row--wrap">
        <Button
          size="sm"
          icon="copy"
          disabled={!pass}
          onClick={() => pass && void copyLink(presenterLink(code, pass), 'Presenter link copied — open it on your other device', true)}
        >
          Copy presenter link
        </Button>
        <Button size="sm" variant="ghost" icon="copy" onClick={() => void copyLink(screenLink(code), 'Big-screen link copied')}>
          Copy big-screen link
        </Button>
      </div>
      {candidates.length ? (
        <div className="sd-row sd-row--wrap sd-handover">
          <Select aria-label="Hand the show to" value={target} onChange={(e) => setTarget(e.currentTarget.value)}>
            <option value="">Hand the show to…</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="secondary"
            disabled={!target}
            onClick={() => target && session.send(SHOWDOWN_MSG.handover, { playerId: target })}
          >
            Hand over
          </Button>
        </div>
      ) : null}
    </details>
  );
}
