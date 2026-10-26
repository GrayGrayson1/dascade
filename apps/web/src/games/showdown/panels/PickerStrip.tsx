/**
 * The rail's picker controls (PCK-01…05), always on screen while a Presenter Showcase runs:
 *
 *   Pick someone (K) · 37 in the pool
 *   → "Priya S. — on stage in 2 s"  (the server already drew her: the presenter reads the name first)
 *   → "Priya S. is answering · 0:12"  with Mark done (D) and No answer (A)
 *   → after 30 s without an answer: Reroll, with a reason the server logs
 *
 * Pressing Pick with someone still in the hot seat nudges ("Mark Priya S. done?") instead of drawing.
 * Every act carries the draw number this console saw, so a double press or a stale click is ignored
 * by the server. Keys K / D / A work like the console's other shortcuts (not while typing or with a
 * dialog open).
 */
import { useEffect, useRef, useState } from 'react';
import {
  SHOWDOWN_REROLL_INFO,
  SHOWDOWN_REROLL_REASONS,
  type ShowdownBoardView,
  type ShowdownLook,
  type ShowdownPublicState,
  type ShowdownRerollReason,
} from '@dascade/shared/games/showdown';
import { Button, Kbd, PixelIcon } from '@dascade/ui';
import { useRoomSelector } from '../../../net/hooks.ts';
import { useSessionStore } from '../../../net/session.ts';
import { sfx } from '../../../audio/audio.ts';
import { showdownApi } from '../api.ts';
import { useCan, usePicker } from '../state.ts';
import { formatElapsed, pickerPhase, poolWords } from './picker.ts';
import { shortcutBlocked, useServerNow } from './useTicker.ts';
import './panels.css';

/** How long a sent act keeps its button busy if the room doesn't answer (it re-enables after). */
const PENDING_MS = 2500;

export function PickerStrip({ look, board }: { look: ShowdownLook; board: ShowdownBoardView }) {
  const playerId = useSessionStore((s) => s.playerId);
  const presenterId = useRoomSelector<ShowdownPublicState, string>((s) => s.presenterId) ?? '';
  const presenter = Boolean(playerId && playerId === presenterId);
  const allowed = useCan('picker.run') || presenter;
  const picker = usePicker();
  const hot = picker.hotSeat !== '';
  const now = useServerNow(hot, 250);
  const phase = pickerPhase(
    {
      mode: board.mode,
      stage: board.stage,
      hotSeat: picker.hotSeat,
      hotName: picker.hotName,
      landAt: picker.landAt,
      poolSize: picker.poolSize,
    },
    now,
  );

  const [pending, setPending] = useState<{ kind: string; drawNo: number } | null>(null);
  const [nudge, setNudge] = useState('');
  const [rerolling, setRerolling] = useState(false);
  const [said, setSaid] = useState('');
  const doneRef = useRef<HTMLButtonElement>(null);

  // A new draw (or the hot seat emptying) settles whatever was pending and closes the reroll form.
  useEffect(() => {
    setPending(null);
    setNudge('');
    setRerolling(false);
  }, [picker.drawNo, picker.hotSeat]);
  // The nudge says its piece, then the hot seat's own line comes back.
  useEffect(() => {
    if (!nudge) return;
    const t = setTimeout(() => setNudge(''), 6000);
    return () => clearTimeout(t);
  }, [nudge]);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), PENDING_MS);
    return () => clearTimeout(t);
  }, [pending]);

  // Discrete announcements only (the ticking seconds stay out of the live region).
  const headsName = phase.kind === 'heads' || phase.kind === 'answering' ? phase.name : '';
  const onStage = phase.kind === 'answering';
  // The hot seat dropped out (their connection is gone): no need to wait out the 30 s to reroll.
  const hotAway =
    useRoomSelector<ShowdownPublicState, boolean>((s) =>
      Boolean(s.hotSeat && s.players?.[s.hotSeat] && !s.players[s.hotSeat]!.connected),
    ) ?? false;
  const rerollOpen = phase.kind === 'answering' && (phase.rerollInMs <= 0 || hotAway);
  useEffect(() => {
    if (!headsName) return setSaid('');
    setSaid(onStage ? `${headsName} is on stage.` : `${headsName} is up — on stage in 2 seconds.`);
  }, [headsName, onStage]);
  useEffect(() => {
    if (rerollOpen && headsName)
      setSaid(hotAway ? `${headsName} dropped out: Reroll is open.` : `No answer from ${headsName} for 30 seconds: Reroll is open.`);
  }, [rerollOpen, headsName, hotAway]);

  const live = useRef({ phase, picker, board, pending, allowed });
  live.current = { phase, picker, board, pending, allowed };

  const requestPick = () => {
    const cur = live.current;
    if (!cur.allowed || cur.pending) return;
    const p = cur.phase;
    if (p.kind === 'heads' || p.kind === 'answering') {
      const text = `Mark ${p.name} done?`;
      setNudge(text);
      setSaid(`${text} Press D for done or A for no answer.`);
      doneRef.current?.focus({ preventScroll: true });
      return;
    }
    if (p.kind === 'empty') {
      setSaid('Everyone’s had a turn this round. The pool refills next round.');
      return;
    }
    if (p.kind !== 'ready') return;
    sfx('select');
    setPending({ kind: 'pick', drawNo: cur.picker.drawNo });
    showdownApi.pick(cur.board.round, cur.picker.drawNo);
  };
  const markDone = () => {
    const cur = live.current;
    if (!cur.allowed || !cur.picker.hotSeat || cur.pending) return;
    sfx('select');
    setPending({ kind: 'done', drawNo: cur.picker.drawNo });
    showdownApi.done(cur.picker.drawNo);
  };
  const noAnswer = () => {
    const cur = live.current;
    if (!cur.allowed || !cur.picker.hotSeat || cur.pending) return;
    sfx('select');
    setPending({ kind: 'noAnswer', drawNo: cur.picker.drawNo });
    showdownApi.noAnswer(cur.picker.drawNo);
  };
  /** Choosing the reason is the reroll (the reason is required, and it goes in the log). */
  const reroll = (reason: ShowdownRerollReason) => {
    const cur = live.current;
    if (!cur.allowed || !cur.picker.hotSeat || cur.pending) return;
    sfx('select');
    setPending({ kind: 'reroll', drawNo: cur.picker.drawNo });
    showdownApi.reroll(cur.picker.drawNo, reason);
  };

  const rerollingRef = useRef(rerolling);
  rerollingRef.current = rerolling;
  const firstReason = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (rerolling) firstReason.current?.focus({ preventScroll: true });
  }, [rerolling]);

  const keys = useRef({ requestPick, markDone, noAnswer });
  keys.current = { requestPick, markDone, noAnswer };
  useEffect(() => {
    if (!allowed) return;
    const onKey = (e: KeyboardEvent) => {
      if (shortcutBlocked(e)) return;
      const k = e.key.toLowerCase();
      const hotNow = live.current.picker.hotSeat !== '';
      if (k === 'escape' && rerollingRef.current) {
        setRerolling(false);
        e.preventDefault();
        return;
      }
      if (k === 'k') keys.current.requestPick();
      else if (k === 'd' && hotNow) keys.current.markDone();
      else if (k === 'a' && hotNow) keys.current.noAnswer();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [allowed]);

  if (!allowed) return null;

  const off = phase.kind === 'off';
  const busy = pending !== null;
  const onSeat = phase.kind === 'heads' || phase.kind === 'answering';

  return (
    <section
      className="sdp-strip"
      data-look={look}
      data-phase={phase.kind}
      aria-labelledby="sdp-strip-title"
      data-part="showdown-picker-strip"
    >
      <header className="sdp-strip__head">
        <h3 className="sdp-strip__title" id="sdp-strip-title">
          <PixelIcon name="users" /> Picker
        </h3>
        {rerolling && onSeat ? (
          <Button size="sm" variant="ghost" onClick={() => setRerolling(false)}>
            Cancel
          </Button>
        ) : rerollOpen && !busy ? (
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => setRerolling(true)} data-part="showdown-pick-reroll">
            Reroll…
          </Button>
        ) : (
          <span className="sdp-strip__pool">
            <span className="dc-num">{picker.poolSize}</span> in the pool
          </span>
        )}
      </header>

      {onSeat ? (
        <p className="sdp-hot" data-state={phase.kind} data-nudge={nudge ? 'true' : undefined} data-part="showdown-pick-hot">
          {nudge && !rerolling ? (
            <>
              <PixelIcon name="warning" /> Mark <b className="sdp-hot__name">{phase.name}</b> <span className="sdp-hot__line">done?</span>
            </>
          ) : (
            <>
              <span className="visually-hidden">{phase.kind === 'heads' ? 'Next up: ' : 'In the hot seat: '}</span>
              <b className="sdp-hot__name">{phase.name}</b>{' '}
              <span className="sdp-hot__line">
                {rerolling ? (
                  'why reroll? It goes in the log.'
                ) : phase.kind === 'heads' ? (
                  <>
                    on stage in <span className="dc-num">{phase.seconds}</span> s
                  </>
                ) : (
                  <span title={phase.rerollInMs > 0 && !hotAway ? 'No answer? Reroll opens at 0:30.' : undefined}>
                    {hotAway ? 'dropped out' : 'is answering'}
                    {phase.elapsedMs !== null ? (
                      <>
                        {' · '}
                        <span className="dc-num">{formatElapsed(phase.elapsedMs)}</span>
                      </>
                    ) : null}
                  </span>
                )}
              </span>
            </>
          )}
        </p>
      ) : (
        <Button
          variant="primary"
          block
          className="sdp-strip__pick"
          disabled={off || phase.kind === 'empty' || busy}
          loading={pending?.kind === 'pick'}
          onClick={requestPick}
          aria-keyshortcuts="K"
          aria-label={phase.kind === 'ready' ? `Pick someone · ${poolWords(phase.pool)}` : undefined}
          data-part="showdown-pick"
        >
          {phase.kind === 'empty' ? 'Pool is empty' : 'Pick someone'} <Kbd>K</Kbd>
        </Button>
      )}

      {phase.kind === 'empty' ? <p className="sdp-strip__note">Everyone’s had a turn this round. The pool refills next round.</p> : null}
      {phase.kind === 'off' ? (
        <p className="sdp-strip__note">
          {phase.why === 'intro' ? 'Pick works once round 1 is up.' : 'The picker runs in Presenter Showcase.'}
        </p>
      ) : null}

      {onSeat && rerolling ? (
        <div className="sdp-strip__row sdp-strip__row--3" role="group" aria-label={`Why reroll ${phase.name}? The reason goes in the log.`}>
          {SHOWDOWN_REROLL_REASONS.map((r, i) => (
            <Button
              key={r}
              ref={i === 0 ? firstReason : undefined}
              variant="secondary"
              onClick={() => reroll(r)}
              disabled={busy}
              loading={pending?.kind === 'reroll'}
              aria-label={`Reroll: ${SHOWDOWN_REROLL_INFO[r]}`}
            >
              {SHOWDOWN_REROLL_INFO[r]}
            </Button>
          ))}
        </div>
      ) : onSeat ? (
        <div className="sdp-strip__row">
          <Button
            ref={doneRef}
            variant="success"
            icon="check"
            onClick={markDone}
            disabled={busy}
            loading={pending?.kind === 'done'}
            aria-keyshortcuts="D"
            data-part="showdown-pick-done"
          >
            Mark done <Kbd>D</Kbd>
          </Button>
          <Button
            variant="secondary"
            onClick={noAnswer}
            disabled={busy}
            loading={pending?.kind === 'noAnswer'}
            aria-keyshortcuts="A"
            data-part="showdown-pick-noanswer"
          >
            No answer <Kbd>A</Kbd>
          </Button>
        </div>
      ) : null}

      <p className="visually-hidden" role="status" aria-live="polite">
        {said}
      </p>
    </section>
  );
}
