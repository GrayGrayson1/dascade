/**
 * Drawer tab / crew screen "Picker": the mode in words, the pool and the hot seat, everyone who could
 * take the hot seat — their turns this show, Include / Exclude (presenter and crew, any time) and
 * Spotlight (the presenter and the producer, while a round is up) — this round's done list, the recent
 * draws (kept on this device from the room's pick / pickEnd events) and the rules in one paragraph.
 *
 * Never who chose Skip me: the server doesn't send it, so a skipper looks like anyone else here.
 */
import { useMemo, useState } from 'react';
import {
  SHOWDOWN_PICK_MODE_INFO,
  type ShowdownBoardView,
  type ShowdownLook,
  type ShowdownPublicState,
} from '@dascade/shared/games/showdown';
import { Badge, Button, PixelIcon, TextInput } from '@dascade/ui';
import { playersEqual, useRoomSelector } from '../../../net/hooks.ts';
import { useSessionStore } from '../../../net/session.ts';
import { sfx } from '../../../audio/audio.ts';
import { showdownApi } from '../api.ts';
import { useCan, usePicker, usePickerPrivate, useShowdownSettings } from '../state.ts';
import { useDrawHistory } from './feed.ts';
import { choosable, drawWords, emptyWhy, modeWords, pickPeople, pickerPhase, poolWords, searchPeople, type PickPerson } from './picker.ts';
import { auditTime } from './audit.ts';
import { useServerNow } from './useTicker.ts';
import './panels.css';

const NO_FLAGS: Record<string, boolean> = {};

export function PickerPanel({ look, board }: { look: ShowdownLook; board: ShowdownBoardView | null }) {
  const code = useSessionStore((s) => s.code) ?? '';
  const myId = useSessionStore((s) => s.playerId);
  const picker = usePicker();
  const privatePicker = usePickerPrivate();
  const settings = useShowdownSettings();
  const presenterId = useRoomSelector<ShowdownPublicState, string>((s) => s.presenterId) ?? '';
  const presenter = Boolean(myId && myId === presenterId);
  const canChoose = useCan('picker.choose') || presenter;
  const canManage = useCan('picker.manage') || presenter;
  const players = useRoomSelector<ShowdownPublicState, ShowdownPublicState['players']>((s) => s.players, playersEqual);
  const screens = useRoomSelector<ShowdownPublicState, Record<string, boolean>>((s) => s.screens ?? NO_FLAGS) ?? NO_FLAGS;
  const history = useDrawHistory(code);
  const now = useServerNow(picker.hotSeat !== '', 1000);
  const [query, setQuery] = useState('');
  const [said, setSaid] = useState('');
  const phase = board
    ? pickerPhase(
        {
          mode: board.mode,
          stage: board.stage,
          hotSeat: picker.hotSeat,
          hotName: picker.hotName,
          landAt: picker.landAt,
          poolSize: picker.poolSize,
        },
        now,
      )
    : null;
  const people = useMemo(
    () => pickPeople({ players, presenterId, screens, done: picker.done, hotSeat: picker.hotSeat, myId, picker: privatePicker }),
    [players, presenterId, screens, picker.done, picker.hotSeat, myId, privatePicker],
  );
  const shown = useMemo(() => searchPeople(people, query), [people, query]);
  const doneNames = useMemo(
    () =>
      Object.keys(picker.done)
        .filter((id) => picker.done[id])
        .map((id) => players?.[id]?.name ?? 'Someone who left')
        .sort((a, b) => a.localeCompare(b)),
    [picker.done, players],
  );
  const mode = settings?.pickMode ?? 'fair';
  const crewDraw = settings?.crewDraw ?? false;
  const excluded = people.filter((p) => p.excluded).length;
  // Spotlight needs a round on the board and nobody in the hot seat (the server refuses otherwise).
  const spotlightOpen = canChoose && board !== null && board.mode === 'showcase' && board.stage !== 'intro' && !picker.hotSeat;
  const round = board ? (board.round >= 0 ? `Round ${board.round + 1}` : 'Before round 1') : 'Before the show';

  const toggle = (p: PickPerson) => {
    sfx('select');
    if (p.excluded) showdownApi.include(p.id);
    else showdownApi.exclude(p.id);
    setSaid(
      p.excluded ? `${p.name} is back in the random draw.` : `${p.name} is out of the random draw — they can still be chosen by name.`,
    );
  };
  const spotlight = (p: PickPerson) => {
    if (!board || !choosable(p)) return;
    sfx('select');
    showdownApi.choose(board.round, picker.drawNo, p.id);
    setSaid(`${p.name} is going in the hot seat.`);
  };

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
          <dt>Mode</dt>
          <dd data-part="showdown-picker-mode">{SHOWDOWN_PICK_MODE_INFO[mode].title}</dd>
        </div>
        <div>
          <dt>Pool</dt>
          <dd>
            <span className="dc-num">{picker.poolSize}</span> {picker.poolSize === 1 ? 'person' : 'people'} · {round}
          </dd>
        </div>
        <div>
          <dt>Hot seat</dt>
          <dd>
            {phase?.kind === 'heads'
              ? `${phase.name} — on stage in ${phase.seconds} s`
              : phase?.kind === 'answering'
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
      <p className="sdp-lead">{modeWords(mode, crewDraw)}</p>
      {phase?.kind === 'empty' ? (
        <p className="sdp-strip__note" role="status">
          {emptyWhy(people, crewDraw)}
        </p>
      ) : null}

      <div className="sdp-block__head">
        <h4 className="sdp-sub">
          Everyone <span className="dc-num">({people.length})</span>
        </h4>
        {canManage && excluded > 0 ? (
          <Button
            size="sm"
            variant="secondary"
            icon="users"
            onClick={() => {
              sfx('select');
              showdownApi.includeAll();
              setSaid('Everyone is back in the random draw.');
            }}
            data-part="showdown-include-all"
          >
            Include everyone (<span className="dc-num">{excluded}</span>)
          </Button>
        ) : null}
      </div>
      {people.length > 6 ? (
        <div className="sdp-filter">
          <label className="sdp-filter__label" htmlFor="sdp-picker-filter">
            Filter names
          </label>
          <TextInput
            id="sdp-picker-filter"
            type="search"
            value={query}
            placeholder="Type a name"
            autoComplete="off"
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
        </div>
      ) : null}
      {shown.length ? (
        <ul className="sdp-people" aria-label="Everyone who could be picked" data-part="showdown-picker-people">
          {shown.map((p) => (
            <li
              key={p.id}
              className="sdp-person"
              data-status={p.excluded ? 'hidden' : 'onstage'}
              data-away={p.away ? 'true' : undefined}
              data-part="showdown-picker-person"
              data-name={p.name}
            >
              <span className="sdp-person__who">
                <b className="sdp-person__name">{p.name}</b>
                <span className="sdp-person__tags">
                  <Badge>
                    <span className="dc-num">{p.turns}</span> {p.turns === 1 ? 'turn' : 'turns'}
                  </Badge>
                  {p.excluded ? <Badge icon="clock">Excluded</Badge> : <Badge icon="check">In the draw</Badge>}
                  {p.crew ? <Badge icon="crown">Crew</Badge> : null}
                  {p.hot ? <Badge icon="star">Up now</Badge> : p.done ? <Badge>Done this round</Badge> : null}
                  {p.hidden ? <Badge icon="eye">Hidden</Badge> : null}
                  {p.away ? <Badge icon="wifi-off">Away</Badge> : null}
                  {p.me ? <Badge>You</Badge> : null}
                </span>
              </span>
              <span className="sdp-person__actions">
                {spotlightOpen ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="star"
                    disabled={!choosable(p)}
                    aria-label={`Spotlight ${p.name}`}
                    onClick={() => spotlight(p)}
                    data-part="showdown-picker-spotlight"
                  >
                    Spotlight
                  </Button>
                ) : null}
                {canManage ? (
                  <Button
                    size="sm"
                    variant={p.excluded ? 'secondary' : 'ghost'}
                    aria-pressed={!p.excluded}
                    aria-label={p.excluded ? `Include ${p.name} in the random draw` : `Exclude ${p.name} from the random draw`}
                    onClick={() => toggle(p)}
                    data-part="showdown-picker-toggle"
                  >
                    {p.excluded ? 'Include' : 'Exclude'}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sdp-empty">{query ? `Nobody called “${query}”.` : 'Nobody here yet.'}</p>
      )}

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
        <p className="sdp-empty">No draws seen on this device yet · {poolWords(picker.poolSize)}.</p>
      )}

      <p className="sdp-rules">
        <b>How it picks:</b> the server draws from everyone in the audience who’s here.{' '}
        {mode === 'fair'
          ? 'Fair mode draws only from the people with the fewest turns this show, so everyone gets a turn before anyone gets a second; Mark done counts a turn, No answer and Reroll don’t.'
          : 'True random draws from everyone in the draw every time — a finished turn doesn’t take you out — but never the same person twice in a row.'}{' '}
        Away or disconnected people are skipped, and anyone can switch on <b>Skip me</b> on their phone — privately, so nobody can see who
        did. Skip me and Exclude only stop <i>random</i> draws: <b>Spotlight a name</b> can put anyone seated in the hot seat (the
        presenter, big screens and spectators never). {crewDraw ? 'Crew are in the random draw too.' : 'Crew are only picked by name.'} A
        reroll needs a reason, and every draw, spotlight, exclusion and reroll goes in the log.
      </p>
      <p className="sdp-notice" role="status" aria-live="polite">
        {said}
      </p>
    </section>
  );
}
