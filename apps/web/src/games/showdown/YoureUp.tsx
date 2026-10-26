/**
 * DSP-03 B — the pick on a participant's phone.
 *
 *   - The picked phone: "You're up, <name>!" — a full-screen alert, text first, with a buzz where the
 *     phone supports it (Android; iPhones get the alert without it). No flashing; reduced motion gets a
 *     still. Dismissable, and gone when the hot seat clears.
 *   - Everyone else: a strip, "<name> is answering".
 *
 * Both wait for `landAt` (server time), so a phone never runs ahead of the stage's spotlight landing.
 * Names come from the synchronized state, so a moderator's rename (JOI-02) shows at once. Phones stay
 * silent: no sound here (the sound station plays the landing).
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { GAME_CATALOG } from '@dascade/shared';
import type { ShowdownLook, ShowdownPublicState } from '@dascade/shared/games/showdown';
import { Button, GameTheme } from '@dascade/ui';
import { serverNow, useRoomSelector } from '../../net/hooks.ts';
import { useSessionStore } from '../../net/session.ts';
import { useMe, useMotion, usePicker } from './state.ts';
import { hasLanded, shouldBuzz } from './poolStatus.ts';

/** True from `landAt` on (server time). Re-renders once, at the landing. */
export function useLanded(landAt: number): boolean {
  const [, wake] = useState(0);
  useEffect(() => {
    if (!landAt) return;
    const wait = landAt - serverNow();
    if (wait <= 0) return;
    const t = setTimeout(() => wake((n) => n + 1), wait + 16);
    return () => clearTimeout(t);
  }, [landAt]);
  return hasLanded(landAt, serverNow());
}

// "You're up" was dismissed for this draw (per tab, so a reload mid-turn doesn't bring it back).
const SEEN_KEY = (code: string) => `dascade:showdown:up-seen:${code}`;

function readSeen(code: string): number {
  try {
    const v = Number(sessionStorage.getItem(SEEN_KEY(code)));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

function writeSeen(code: string, drawNo: number): void {
  try {
    sessionStorage.setItem(SEEN_KEY(code), String(drawNo));
  } catch {
    /* storage unavailable: dismissed until reload */
  }
}

/** Draws this page already buzzed for (a remount mustn't buzz twice). */
const buzzed = new Set<string>();

/** The pick, on a phone: the strip for everyone, the alert for the person picked. */
export function PickMoment({ look }: { look: ShowdownLook }) {
  const me = useMe();
  const playerId = useSessionStore((s) => s.playerId);
  const code = useSessionStore((s) => s.code) ?? '';
  const { hotSeat, hotName, landAt, drawNo } = usePicker();
  const myName = useRoomSelector<ShowdownPublicState, string>((s) => (playerId ? (s.players?.[playerId]?.name ?? '') : '')) ?? '';
  const landed = useLanded(landAt);
  const [seen, setSeen] = useState(() => readSeen(code));
  const on = Boolean(hotSeat) && landed;
  // The private flag says it's you; the public hot seat (same patch as landAt) says which draw.
  const meHot = Boolean(playerId) && hotSeat === playerId;
  const mine = on && meHot && me?.picked === true;
  const alert = mine && seen !== drawNo;
  const dismiss = () => {
    writeSeen(code, drawNo);
    setSeen(drawNo);
  };
  return (
    // Always mounted, so screen readers announce the strip when it appears.
    <div className="sdg-pick" aria-live="polite" data-part="showdown-pick-moment">
      {/* Your own strip comes once the alert is dismissed (the alert says it first). */}
      {on && !alert && (mine || (!meHot && hotName)) ? (
        <p className="sdg-strip" data-mine={mine ? 'true' : undefined} data-part="showdown-answering">
          <span className="sdg-strip__icon" aria-hidden>
            {mine ? '🎤' : look === 'halloween' ? '🎃' : '⭐'}
          </span>
          {mine ? (
            <span>
              <b>You’re answering</b> — unmute and give your answer.
            </span>
          ) : (
            <span>
              <b>{hotName}</b> is answering
            </span>
          )}
        </p>
      ) : null}
      {alert ? <YoureUp key={drawNo} name={myName} look={look} code={code} drawNo={drawNo} landAt={landAt} onDismiss={dismiss} /> : null}
    </div>
  );
}

function YoureUp({
  name,
  look,
  code,
  drawNo,
  landAt,
  onDismiss,
}: {
  name: string;
  look: ShowdownLook;
  code: string;
  drawNo: number;
  landAt: number;
  onDismiss: () => void;
}) {
  const motion = useMotion();
  const button = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const textId = useId();

  // Buzz once for a fresh landing (where supported), take focus, and give it back when dismissed.
  useEffect(() => {
    const key = `${code}:${drawNo}`;
    if (!buzzed.has(key)) {
      buzzed.add(key);
      if (shouldBuzz(landAt, serverNow())) {
        try {
          navigator.vibrate?.([200, 100, 200]);
        } catch {
          /* not allowed here: the alert is enough */
        }
      }
    }
  }, [code, drawNo, landAt]);
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    button.current?.focus({ preventScroll: true });
    return () => {
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onDismiss();
    } else if (e.key === 'Tab') {
      // One control: keep focus in the alert while it's up.
      e.preventDefault();
      button.current?.focus();
    }
  };

  return createPortal(
    <GameTheme
      accent={GAME_CATALOG.showdown.accent}
      className="sdg-up"
      data-look={look}
      data-motion={motion.motion ? 'on' : 'off'}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={textId}
      onKeyDown={onKeyDown}
      data-part="showdown-youre-up"
    >
      <div className="sdg-up__card">
        <span className="sdg-up__icon" aria-hidden>
          {look === 'halloween' ? '🎃' : '🎤'}
        </span>
        <p className="sdg-up__kicker">{look === 'halloween' ? 'Boo picked you!' : 'The picker chose you!'}</p>
        <h2 id={titleId} className="sdg-up__title">
          You’re up{name ? `, ${name}` : ''}!
        </h2>
        <p id={textId} className="sdg-up__text">
          Unmute and give your answer — the stage is on you.
        </p>
        <Button ref={button} variant="primary" size="lg" className="sdg-up__ok" onClick={onDismiss}>
          Got it
        </Button>
      </div>
    </GameTheme>,
    document.body,
  );
}
