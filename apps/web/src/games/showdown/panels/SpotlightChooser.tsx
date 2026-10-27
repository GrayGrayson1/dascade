/**
 * Spotlight a name: the presenter (or the producer) puts one person in the hot seat, whether or not
 * they've had a turn — crew included, never the presenter, a big screen or a spectator. A search box
 * and the matching names; Enter takes the first one that can be chosen, Escape closes. The server
 * checks the permission, the draw number and the person again.
 *
 * Nothing here shows who chose Skip me: by name, a skipper is chosen like anyone else.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Badge, Button, TextInput } from '@dascade/ui';
import { sfx } from '../../../audio/audio.ts';
import { showdownApi } from '../api.ts';
import { choosable, searchPeople, type PickPerson } from './picker.ts';

/** Matches shown at once (keep typing to narrow a big room down). */
const SHOWN = 8;

export function SpotlightChooser({
  people,
  round,
  drawNo,
  onClose,
  autoFocus = true,
}: {
  people: readonly PickPerson[];
  round: number;
  drawNo: number;
  /** Close the chooser (after a choice, or Escape). Absent: it stays open (the Picker tab). */
  onClose?: () => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [sent, setSent] = useState('');
  const inputId = useId();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => searchPeople(people, query), [people, query]);
  const shown = hits.slice(0, onClose ? SHOWN : hits.length);
  useEffect(() => {
    if (!autoFocus) return;
    // In a dialog the box can take focus only once the dialog has opened (the parent's effect runs after this one).
    const raf = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(raf);
  }, [autoFocus]);
  // A new draw landed (ours or anyone's): the choice went through.
  useEffect(() => setSent(''), [drawNo]);

  const choose = (p: PickPerson) => {
    if (!choosable(p) || sent) return;
    sfx('select');
    setSent(p.id);
    showdownApi.choose(round, drawNo, p.id);
    onClose?.();
  };

  return (
    <div className="sdp-choose" role="group" aria-label="Spotlight a name" data-part="showdown-spotlight-chooser">
      <label className="sdp-filter__label" htmlFor={inputId}>
        Search names
      </label>
      <TextInput
        id={inputId}
        ref={input}
        type="search"
        value={query}
        placeholder="Type a name"
        autoComplete="off"
        aria-controls={listId}
        aria-describedby={`${listId}-hint`}
        onChange={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && onClose) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const first = hits.find(choosable);
            if (first) choose(first);
          }
        }}
        data-part="showdown-spotlight-search"
      />
      <p className="visually-hidden" id={`${listId}-hint`}>
        Enter puts the first match in the hot seat. Anyone can be chosen by name, even if they’ve had a turn.
      </p>
      {shown.length ? (
        <ul className="sdp-choose__list" id={listId} aria-label="Matching names">
          {shown.map((p) => {
            const why = p.hot ? 'Up now' : p.away ? 'Away' : p.hidden ? 'Hidden' : '';
            return (
              <li key={p.id}>
                <Button
                  size="sm"
                  variant="ghost"
                  block
                  className="sdp-choose__pick"
                  disabled={!choosable(p) || Boolean(sent)}
                  loading={sent === p.id}
                  onClick={() => choose(p)}
                  aria-label={`Spotlight ${p.name}${why ? ` (${why.toLowerCase()})` : ''}`}
                  data-part="showdown-spotlight-pick"
                >
                  <span className="sdp-choose__name">{p.name}</span>
                  <span className="sdp-choose__tags">
                    {p.crew ? <Badge>Crew</Badge> : null}
                    {why ? <Badge>{why}</Badge> : null}
                    <span className="sdp-choose__turns">
                      <span className="dc-num">{p.turns}</span> {p.turns === 1 ? 'turn' : 'turns'}
                    </span>
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="sdp-empty">{query ? `Nobody called “${query}”.` : 'Nobody to choose yet.'}</p>
      )}
      {hits.length > shown.length ? (
        <p className="sdp-strip__note">
          <span className="dc-num">{hits.length - shown.length}</span> more — keep typing.
        </p>
      ) : null}
    </div>
  );
}
