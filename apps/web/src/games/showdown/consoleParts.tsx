/**
 * Presenter widgets shared by the consoles (Team Showdown, Presenter Showcase), the lobby's setup
 * card and the results screen: the stage window and big-screen buttons, the stage cards, the
 * device's sound status, and the presenter tools (pass, hand-over).
 *
 * Everything here is presenter chrome on the presenter's own screen: none of it is ever mirrored to
 * the stage window (the stage window only renders <Stage>).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
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
import { Button, IconButton, Kbd, PixelIcon, Select, cx } from '@dascade/ui';
import { playersEqual, session, useRoomSelector } from '../../net/hooks.ts';
import { useApp } from '../../app/store.ts';
import { audioReady, onAudioReadyChange, sfx } from '../../audio/audio.ts';
import { copyText, presenterLink, screenLink } from './access.ts';
import { openStageWindow, useStageFullscreen, useStageWindow } from './stageWindow.ts';
import { playShowSound } from './sounds.ts';
import { useCard, useJoinPop, useShowSounds, useStandingsCard, useThemeMusicPref } from './state.ts';
import { QrCode, copyJoinQr, joinQrText } from './qr.tsx';
import { joinAddress } from './look.ts';

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
  const full = useStageFullscreen();
  // Open but not full screen: its browser bar is on the share, so the button says how to lose it.
  const bar = stageWin.open && !full;
  return (
    <Button
      size={size}
      variant={stageWin.open ? 'success' : 'primary'}
      icon={stageWin.open ? 'check' : 'maximize'}
      className={className}
      data-part="showdown-stage-window"
      data-fullscreen={stageWin.open ? String(full) : undefined}
      onClick={() => openStage(code, title)}
      aria-label={stageWin.open ? (bar ? 'Stage window open — not full screen' : 'Stage window open, full screen') : openLabel}
      title={
        bar
          ? 'The stage window is open but not full screen: its browser bar shows on the share. Click here to bring it to the front, then press F in it.'
          : stageWin.open
            ? 'The stage window is open and full screen — click to bring it to the front'
            : 'Open the stage (no answers) in its own window, to share in the meeting'
      }
    >
      {/* (A narrow console bar keeps the icon only; the name stays the button's accessible name.) */}
      <span className="sdc-lbl-wide">{stageWin.open ? (bar ? 'Stage open · press F in it' : 'Stage full screen') : openLabel}</span>
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
  // The Standings card (two-tier scoring) isn't one of these four, but it's a card on the stage: Off isn't pressed.
  const standingsUp = useStandingsCard();
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
        aria-pressed={card === null && !standingsUp}
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

/** The Join pop-up on every stage (J): the join ticket over the board for 20 s; pressed again, it comes down. */
export function putJoinPop(on: boolean): void {
  sfx('select');
  session.send(SHOWDOWN_MSG.joinPop, { on });
}

/**
 * The join QR for the Teams chat and the invite (QR A): a preview, Copy QR image (a PNG on the
 * clipboard; saved instead where the browser can't copy images) and Copy link. With `popup`, the
 * Join pop-up button too.
 */
export function JoinQrTools({ code, popup = false }: { code: string; popup?: boolean }) {
  const [said, setSaid] = useState('');
  const up = useJoinPop() === 'in';
  if (!code) return null;
  const join = joinAddress(code);
  return (
    <div className="sdc-joinqr" data-part="showdown-join-qr">
      <QrCode text={joinQrText(code)} label={`QR code for ${join.short}`} className="sdc-joinqr__qr" />
      <div className="sdc-joinqr__side">
        <span className="sdc-joinqr__addr">{join.short}</span>
        <div className="sd-row sd-row--wrap">
          <Button
            size="sm"
            variant="secondary"
            icon="copy"
            onClick={async () => {
              const how = await copyJoinQr(code);
              setSaid(
                how === 'copied'
                  ? 'QR image copied: paste it in the Teams chat.'
                  : how === 'saved'
                    ? 'This browser can’t copy images: the QR image was saved instead.'
                    : 'Couldn’t make the QR image. Copy the link instead.',
              );
            }}
            data-part="showdown-copy-qr"
          >
            Copy QR image
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="copy"
            onClick={async () => setSaid((await copyText(join.url)) ? 'Link copied.' : join.url)}
          >
            Copy link
          </Button>
          {popup ? (
            <Button
              size="sm"
              variant={up ? 'primary' : 'secondary'}
              icon="eye"
              aria-pressed={up}
              onClick={() => putJoinPop(!up)}
              data-part="showdown-join-pop-button"
            >
              {up ? 'Take the Join pop-up down' : 'Join pop-up'} <Kbd>J</Kbd>
            </Button>
          ) : null}
        </div>
        <span className="sd-muted" role="status">
          {said}
        </span>
      </div>
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

// ---------------------------------------------------------------------------
// Share-safe styling (PRS-05 C): the console can't be mistaken for the stage in a window picker
// ---------------------------------------------------------------------------

/** The console tab's title while the console is open (the stage window says "… — STAGE (share this)"). */
export const CONSOLE_WINDOW_TITLE = "🔒 PRESENTER — don't share";

/** A red lock: the console tab's icon while the console is open (inline, so it works offline). */
export const CONSOLE_FAVICON = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='#c8102e'/>" +
    "<path d='M21 29v-7a11 11 0 0 1 22 0v7' fill='none' stroke='#fff' stroke-width='7'/>" +
    "<rect x='14' y='28' width='36' height='27' rx='5' fill='#fff'/><rect x='29' y='35' width='6' height='12' rx='3' fill='#c8102e'/></svg>",
)}`;

/**
 * While the presenter console is mounted: the tab is titled "🔒 PRESENTER — don't share" and its icon
 * is a red lock, so the console stands out in a meeting app's window picker and in the browser's tab
 * strip. Both go back to what they were when the console closes.
 */
export function usePresenterWindowChrome(): void {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = CONSOLE_WINDOW_TITLE;
    const icons = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
    const saved = icons.map((l) => ({ l, href: l.getAttribute('href'), type: l.getAttribute('type') }));
    let added: HTMLLinkElement | null = null;
    if (icons.length) {
      for (const l of icons) {
        l.setAttribute('href', CONSOLE_FAVICON);
        l.setAttribute('type', 'image/svg+xml');
      }
    } else {
      added = document.createElement('link');
      added.rel = 'icon';
      added.type = 'image/svg+xml';
      added.href = CONSOLE_FAVICON;
      document.head.appendChild(added);
    }
    return () => {
      // Someone else renamed the tab meanwhile (a route of its own): leave theirs.
      if (document.title === CONSOLE_WINDOW_TITLE) document.title = prevTitle;
      for (const { l, href, type } of saved) {
        if (href === null) l.removeAttribute('href');
        else l.setAttribute('href', href);
        if (type === null) l.removeAttribute('type');
        else l.setAttribute('type', type);
      }
      added?.remove();
    };
  }, []);
}

/** The striped PRIVATE band across the top of the console (real text, high contrast). */
export function PrivateBand() {
  return (
    <div className="sdc-private-band" data-part="showdown-private-band">
      <span className="sdc-private-band__text">
        <PixelIcon name="lock" /> <b>PRIVATE</b> — presenter console · share the <b>STAGE</b> window, never this one
      </span>
    </div>
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
