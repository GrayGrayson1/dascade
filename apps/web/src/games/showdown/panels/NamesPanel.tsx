/**
 * Drawer tab / crew screen "Names" (JOI-02 C): everyone in the room (big screens left out), a filter,
 * inline Rename ("Rename Priya", Enter saves — the server cleans the name and tells the guest) and
 * Hide from stage / Show on stage (off the stage grid and out of the picker; the guest stays in the
 * room). States are words. A live region confirms each action once the room shows it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { LIMITS } from '@dascade/shared';
import { type ShowdownPublicState } from '@dascade/shared/games/showdown';
import { Badge, Button, PixelIcon, TextInput } from '@dascade/ui';
import { playersEqual, useRoomSelector } from '../../../net/hooks.ts';
import { useSessionStore } from '../../../net/session.ts';
import { sfx } from '../../../audio/audio.ts';
import { showdownApi } from '../api.ts';
import { useCan, useCrew } from '../state.ts';
import { STATUS_WORDS, buildPeople, filterPeople, peopleSummary, type PersonRow } from './people.ts';
import './panels.css';

const EMPTY: Record<string, boolean> = {};
const CONFIRM_MS = 4000;

interface Pending {
  id: string;
  kind: 'rename' | 'hide' | 'show';
  from: string;
  at: number;
}

export function NamesPanel() {
  const myId = useSessionStore((s) => s.playerId);
  const players = useRoomSelector<ShowdownPublicState, ShowdownPublicState['players']>((s) => s.players, playersEqual);
  const presenterId = useRoomSelector<ShowdownPublicState, string>((s) => s.presenterId) ?? '';
  const screens = useRoomSelector<ShowdownPublicState, Record<string, boolean>>((s) => s.screens ?? EMPTY) ?? EMPTY;
  const seats = useRoomSelector<ShowdownPublicState, Record<string, boolean>>((s) => s.seats ?? EMPTY) ?? EMPTY;
  const crew = useCrew();
  const canRename = useCan('people.rename');
  const canHide = useCan('people.hide');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [said, setSaid] = useState('');
  const rowRefs = useRef(new Map<string, HTMLButtonElement | null>());

  const crewIds = useMemo<string[] | null>(() => {
    // The server lists who is crew for anyone who moderates (older servers: the producer's links).
    if (crew?.crewIds) return crew.crewIds;
    if (crew?.perms.includes('crew.issue')) return crew.links.filter((l) => !l.revoked && l.holderId).map((l) => l.holderId);
    return null;
  }, [crew]);

  const rows = useMemo(
    () =>
      buildPeople({
        players,
        presenterId,
        screens,
        seats,
        myId,
        meCrew: Boolean(crew?.roles.length),
        crewIds,
        hiddenIds: crew?.hidden ?? null,
      }),
    [players, presenterId, screens, seats, myId, crew, crewIds],
  );
  const shown = useMemo(() => filterPeople(rows, query), [rows, query]);

  // Confirm each action once the room shows it (the server cleans names, so say what it became).
  useEffect(() => {
    if (!pending.length) return;
    const left: Pending[] = [];
    for (const p of pending) {
      const row = rows.find((r) => r.id === p.id);
      if (!row) continue;
      if (p.kind === 'rename' && row.name !== p.from) setSaid(`Renamed “${p.from}” to “${row.name}”.`);
      else if (p.kind === 'hide' && row.status !== 'onstage') setSaid(`${row.name} is hidden from the stage and the picker.`);
      else if (p.kind === 'show' && row.status === 'onstage') setSaid(`${row.name} is back on the stage.`);
      else left.push(p);
    }
    if (left.length !== pending.length) setPending(left);
  }, [rows, pending]);
  useEffect(() => {
    if (!pending.length) return;
    const t = setTimeout(() => {
      const now = Date.now();
      setPending((list) => {
        const stale = list.filter((p) => now - p.at >= CONFIRM_MS);
        if (stale.length) setSaid('No change showed up yet — the room may have refused it. Try again.');
        return list.filter((p) => now - p.at < CONFIRM_MS);
      });
    }, CONFIRM_MS);
    return () => clearTimeout(t);
  }, [pending]);

  if (!canRename && !canHide) {
    return (
      <section className="sdp-panel" aria-labelledby="sdp-names-title" data-part="showdown-names-panel">
        <h3 className="sd-panel__title" id="sdp-names-title">
          <PixelIcon name="pencil" /> Names
        </h3>
        <p className="sdp-empty">Renaming and hiding guests is for crew in event rooms (the producer, the presenter and moderators).</p>
      </section>
    );
  }

  const startRename = (row: PersonRow) => {
    setEditing(row.id);
    setDraft(row.name);
  };
  const stopEditing = (id: string) => {
    setEditing(null);
    requestAnimationFrame(() => rowRefs.current.get(id)?.focus({ preventScroll: true }));
  };
  const saveRename = (row: PersonRow) => {
    const name = draft.trim();
    if (!name || name === row.name) return stopEditing(row.id);
    sfx('select');
    showdownApi.rename(row.id, name);
    setPending((list) => [
      ...list.filter((p) => p.id !== row.id || p.kind !== 'rename'),
      { id: row.id, kind: 'rename', from: row.name, at: Date.now() },
    ]);
    setSaid(`Renaming ${row.name}…`);
    stopEditing(row.id);
  };
  const toggleHide = (row: PersonRow) => {
    // "Not on stage" (we can't tell a hidden guest from crew yet) offers Show, like Hidden.
    const hide = row.status === 'onstage';
    sfx('select');
    showdownApi.hide(row.id, hide);
    setPending((list) => [
      ...list.filter((p) => p.id !== row.id || p.kind === 'rename'),
      { id: row.id, kind: hide ? 'hide' : 'show', from: row.name, at: Date.now() },
    ]);
    setSaid(hide ? `Hiding ${row.name}…` : `Putting ${row.name} back on the stage…`);
  };

  return (
    <section className="sdp-panel sdp-namespanel" aria-labelledby="sdp-names-title" data-part="showdown-names-panel">
      <h3 className="sd-panel__title" id="sdp-names-title">
        <PixelIcon name="pencil" /> Names
      </h3>
      <p className="sdp-lead">
        Fix a name nobody recognises, or hide someone from the stage and the picker — they stay in the room. Each change is logged.
      </p>
      <div className="sdp-filter">
        <label className="sdp-filter__label" htmlFor="sdp-names-filter">
          Filter names
        </label>
        <TextInput
          id="sdp-names-filter"
          type="search"
          value={query}
          placeholder="Type a name"
          autoComplete="off"
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
      </div>
      <p className="sdp-count" aria-live="off">
        {peopleSummary(rows)}
        {query ? ` · ${shown.length} match${shown.length === 1 ? '' : 'es'}` : ''}
      </p>
      {shown.length ? (
        <ul className="sdp-people" aria-label="People in the room">
          {shown.map((row) => (
            <li key={row.id} className="sdp-person" data-status={row.status} data-away={row.away ? 'true' : undefined}>
              {editing === row.id ? (
                <form
                  className="sdp-person__edit"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveRename(row);
                  }}
                >
                  <TextInput
                    autoFocus
                    value={draft}
                    maxLength={LIMITS.nickname}
                    aria-label={`Rename ${row.name}`}
                    autoComplete="off"
                    onChange={(e) => setDraft(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        stopEditing(row.id);
                      }
                    }}
                  />
                  <Button type="submit" size="sm" variant="primary" disabled={!draft.trim()}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => stopEditing(row.id)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <>
                  <span className="sdp-person__who">
                    <b className="sdp-person__name">{row.name}</b>
                    <span className="sdp-person__tags">
                      <Badge>{STATUS_WORDS[row.status]}</Badge>
                      {row.away ? <Badge icon="wifi-off">Away</Badge> : null}
                      {row.me ? <Badge>You</Badge> : null}
                    </span>
                  </span>
                  <span className="sdp-person__actions">
                    {canRename ? (
                      <Button
                        ref={(el) => {
                          rowRefs.current.set(row.id, el);
                        }}
                        size="sm"
                        variant="ghost"
                        icon="pencil"
                        aria-label={`Rename ${row.name}`}
                        onClick={() => startRename(row)}
                      >
                        Rename
                      </Button>
                    ) : null}
                    {canHide && row.guest ? (
                      <Button
                        size="sm"
                        variant={row.status === 'onstage' ? 'ghost' : 'secondary'}
                        icon="eye"
                        aria-label={row.status === 'onstage' ? `Hide ${row.name} from stage` : `Show ${row.name} on stage`}
                        onClick={() => toggleHide(row)}
                      >
                        {row.status === 'onstage' ? 'Hide from stage' : 'Show on stage'}
                      </Button>
                    ) : null}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="sdp-empty">{query ? `Nobody called “${query}”.` : 'Nobody here yet.'}</p>
      )}
      <p className="sdp-notice" role="status" aria-live="polite">
        {said}
      </p>
    </section>
  );
}
