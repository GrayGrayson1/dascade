/**
 * The rail's picker controls (PCK-01…05), always on screen while a Presenter Showcase runs:
 *
 *   Pick someone (K) · 37 in the pool
 *   → "Priya S. — on stage in 2 s"  (the server already drew her: the presenter reads the name first)
 *   → "Priya S. is answering · 0:12"  with Mark done (D) and No answer (A)
 *   → after 30 s without an answer: Reroll, with a reason the server logs
 *
 * Pressing Pick with someone still in the hot seat nudges ("Mark Priya S. done?") instead of drawing.
 * **Spotlight a name… (F)** puts anyone seated in the hot seat by name, whether or not they've had a
 * turn (the presenter and the producer). When nobody is in the random draw the strip says why and
 * offers Include everyone and Spotlight a name — it never dead-ends.
 * Every act carries the draw number this console saw, so a double press or a stale click is ignored
 * by the server. Keys K / D / A / F work like the console's other shortcuts (not while typing or with
 * a dialog open).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SHOWDOWN_REROLL_INFO,
  SHOWDOWN_REROLL_REASONS,
  type ShowdownBoardView,
  type ShowdownLook,
  type ShowdownPublicState,
  type ShowdownRerollReason,
} from '@dascade/shared/games/showdown';
import { Button, Kbd, Modal, PixelIcon } from '@dascade/ui';
import { playersEqual, useRoomSelector } from '../../../net/hooks.ts';
import { useSessionStore } from '../../../net/session.ts';
import { sfx } from '../../../audio/audio.ts';
import { showdownApi } from '../api.ts';
import { useCan, usePicker, usePickerPrivate, useShowdownSettings } from '../state.ts';
import { emptyWhy, formatElapsed, pickPeople, pickerPhase, poolWords } from './picker.ts';
import { SpotlightChooser } from './SpotlightChooser.tsx';
import { shortcutBlocked, useServerNow } from './useTicker.ts';
import './panels.css';

const NO_FLAGS: Record<string, boolean> = {};

/** How long a sent act keeps its button busy if the room doesn't answer (it re-enables after). */
const PENDING_MS = 2500;

export function PickerStrip({ look, board }: { look: ShowdownLook; board: ShowdownBoardView }) {
  const playerId = useSessionStore((s) => s.playerId);
  const presenterId = useRoomSelector<ShowdownPublicState, string>((s) => s.presenterId) ?? '';
  const presenter = Boolean(playerId && playerId === presenterId);
  const allowed = useCan('picker.run') || presenter;
  const canChoose = useCan('picker.choose') || presenter;
  const canManage = useCan('picker.manage') || presenter;
  const picker = usePicker();
  const privatePicker = usePickerPrivate();
  const crewDraw = useShowdownSettings()?.crewDraw ?? false;
  const players = useRoomSelector<ShowdownPublicState, ShowdownPublicState['players']>((s) => s.players, playersEqual);
  const screens = useRoomSelector<ShowdownPublicState, Record<string, boolean>>((s) => s.screens ?? NO_FLAGS) ?? NO_FLAGS;
  const people = useMemo(
    () => pickPeople({ players, presenterId, screens, done: picker.done, hotSeat: picker.hotSeat, myId: playerId, picker: privatePicker }),
    [players, presenterId, screens, picker.done, picker.hotSeat, playerId, privatePicker],
  );
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
  const [choosing, setChoosing] = useState(false);
  const [said, setSaid] = useState('');
  const doneRef = useRef<HTMLButtonElement>(null);
  const spotlightRef = useRef<HTMLButtonElement>(null);

  // A new draw (or the hot seat emptying) settles whatever was pending and closes the reroll form.
  useEffect(() => {
    setPending(null);
    setNudge('');
    setRerolling(false);
    setChoosing(false);
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

  const live = useRef({ phase, picker, board, pending, allowed, canChoose });
  live.current = { phase, picker, board, pending, allowed, canChoose };

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
      setSaid('Nobody is in the random draw right now. Include people, or spotlight a name with F.');
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

  /** F: open Spotlight a name (a dialog, so it never runs off a 720 px screen) — not while someone is in the hot seat. */
  const openChoose = () => {
    const cur = live.current;
    if (!cur.canChoose || cur.phase.kind === 'off' || cur.picker.hotSeat) return;
    setChoosing(true);
  };
  // The dialog gives focus back to whatever opened it (the button, or the page for F).
  const closeChoose = () => setChoosing(false);

  const keys = useRef({ requestPick, markDone, noAnswer, openChoose });
  keys.current = { requestPick, markDone, noAnswer, openChoose };
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
      else if (k === 'f' && !hotNow) keys.current.openChoose();
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
  const anyExcluded = people.some((p) => p.excluded);

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
        // Pick and Spotlight side by side: the rail keeps its height at 1280×720.
        <div className={canChoose && !off ? 'sdp-strip__row sdp-strip__row--pick' : undefined}>
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
            {phase.kind === 'empty' ? 'Nobody in the draw' : 'Pick someone'} <Kbd>K</Kbd>
          </Button>
          {canChoose && !off ? (
            <Button
              ref={spotlightRef}
              variant="secondary"
              block
              icon="star"
              disabled={busy}
              onClick={() => setChoosing(true)}
              aria-keyshortcuts="F"
              aria-haspopup="dialog"
              aria-label="Spotlight a name…"
              title="Put anyone in the hot seat by name (F)"
              data-part="showdown-spotlight-open"
            >
              Spotlight… <Kbd>F</Kbd>
            </Button>
          ) : null}
        </div>
      )}

      {phase.kind === 'empty' ? (
        <div className="sdp-strip__empty" data-part="showdown-pick-empty">
          <p className="sdp-strip__note">{emptyWhy(people, crewDraw)}</p>
          {canManage && anyExcluded ? (
            <Button size="sm" variant="secondary" icon="users" onClick={() => showdownApi.includeAll()} data-part="showdown-include-all">
              Include everyone
            </Button>
          ) : null}
        </div>
      ) : null}
      <Modal open={choosing && canChoose && !onSeat && !off} onClose={closeChoose} title="Spotlight a name" className="sdp-choosedialog">
        <p className="sdp-lead">
          Put anyone in the hot seat by name — whether or not they’ve had a turn, crew included. Skip me and Exclude only keep people out of
          random draws.
        </p>
        <SpotlightChooser people={people} round={board.round} drawNo={picker.drawNo} onClose={closeChoose} />
      </Modal>
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
