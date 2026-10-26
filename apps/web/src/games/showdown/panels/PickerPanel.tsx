/**
 * Drawer tab "Picker": the pool, the hot seat, this round's done list, the recent draws (kept on this
 * device from the room's pick / pickEnd events) and the rules in one paragraph.
 */
import { useMemo } from 'react';
import { type ShowdownBoardView, type ShowdownLook, type ShowdownPublicState } from '@dascade/shared/games/showdown';
import { PixelIcon } from '@dascade/ui';
import { playersEqual, useRoomSelector } from '../../../net/hooks.ts';
import { useSessionStore } from '../../../net/session.ts';
import { usePicker } from '../state.ts';
import { useDrawHistory } from './feed.ts';
import { drawWords, pickerPhase, poolWords } from './picker.ts';
import { auditTime } from './audit.ts';
import { useServerNow } from './useTicker.ts';
import './panels.css';

export function PickerPanel({ look, board }: { look: ShowdownLook; board: ShowdownBoardView }) {
  const code = useSessionStore((s) => s.code) ?? '';
  const picker = usePicker();
  const players = useRoomSelector<ShowdownPublicState, ShowdownPublicState['players']>((s) => s.players, playersEqual);
  const history = useDrawHistory(code);
  const now = useServerNow(picker.hotSeat !== '', 1000);
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
  const doneNames = useMemo(
    () =>
      Object.keys(picker.done)
        .filter((id) => picker.done[id])
        .map((id) => players?.[id]?.name ?? 'Someone who left')
        .sort((a, b) => a.localeCompare(b)),
    [picker.done, players],
  );
  const round = board.round >= 0 ? `Round ${board.round + 1}` : 'Before round 1';

  return (
    <section
      className="sdp-panel sdp-pickerpanel"
      data-look={look}
      aria-labelledby="sdp-pickerpanel-title"
      data-part="showdown-picker-panel"
    >
      <h3 className="sd-panel__title" id="sdp-pickerpanel-title">
        <PixelIcon name="users" /> Picker
      </h3>
      <dl className="sdp-facts">
        <div>
          <dt>Pool</dt>
          <dd>
            <span className="dc-num">{picker.poolSize}</span> {picker.poolSize === 1 ? 'person' : 'people'} · {round}
          </dd>
        </div>
        <div>
          <dt>Hot seat</dt>
          <dd>
            {phase.kind === 'heads'
              ? `${phase.name} — on stage in ${phase.seconds} s`
              : phase.kind === 'answering'
                ? `${phase.name} is answering`
                : 'Nobody'}
          </dd>
        </div>
        <div>
          <dt>Draws</dt>
          <dd>
            <span className="dc-num">{picker.drawNo}</span> this show
          </dd>
        </div>
      </dl>

      <h4 className="sdp-sub">
        Done this round <span className="dc-num">({doneNames.length})</span>
      </h4>
      {doneNames.length ? (
        <ul className="sdp-names" aria-label="Done this round">
          {doneNames.map((n, i) => (
            <li key={`${n}-${i}`}>
              <PixelIcon name="check" /> {n}
            </li>
          ))}
        </ul>
      ) : (
        <p className="sdp-empty">Nobody yet this round.</p>
      )}

      <h4 className="sdp-sub">Recent draws</h4>
      {history.length ? (
        <ol className="sdp-draws" aria-label="Recent draws, newest first">
          {history.slice(0, 12).map((d) => (
            <li key={d.drawNo} data-how={d.how}>
              <time className="dc-num">{auditTime(d.at)}</time> <span>{drawWords(d)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="sdp-empty">
          {phase.kind === 'empty'
            ? 'Everyone’s had a turn this round.'
            : `No draws seen on this device yet · ${poolWords(picker.poolSize)}.`}
        </p>
      )}

      <p className="sdp-rules">
        <b>How it picks:</b> the server draws fairly from everyone in the audience who’s here. Away or disconnected people are skipped, and
        anyone can switch on <b>Skip me</b> on their phone — privately, so nobody can see who did. Crew, big screens and spectators are
        never in the pool. Mark done keeps someone out until the next round; No answer puts them back. The pool refills every round. A
        reroll needs a reason, and every draw and reroll goes in the log.
      </p>
    </section>
  );
}
