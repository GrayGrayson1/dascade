/**
 * Drawer tab / crew screen "Crew & log" (ADM-04 B + the audit trail):
 *
 * - Producer (`crew.issue`): their producer link — minted once when they made the event room, kept on
 *   this device — with Copy; named Backup presenter / Moderator links (Copy as soon as the secret comes
 *   back); every link with its holder, online state, expiry and a two-step Revoke.
 * - `presenter.assign`: Make <name> presenter…, with a reason and a confirmation in words (the pass
 *   rotates: the old presenter link stops working, nobody has to reload).
 * - `audit.read`: the log, newest first, in plain words; `audit.export`: Download log (JSON).
 *
 * Secrets are never shown in full on screen (the console may be shared) and never put in a toast.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SHOWDOWN_ISSUABLE_ROLES,
  SHOWDOWN_MSG,
  SHOWDOWN_ROLE_INFO,
  type ShowdownAuditFile,
  type ShowdownCrewLinkView,
  type ShowdownIssuableRole,
  type ShowdownPublicState,
} from '@dascade/shared/games/showdown';
import { Badge, Button, PixelIcon, Select, TextInput, cx } from '@dascade/ui';
import { playersEqual, serverNow, useRoomMessage, useRoomSelector } from '../../../net/hooks.ts';
import { useSessionStore } from '../../../net/session.ts';
import { sfx } from '../../../audio/audio.ts';
import { showdownApi } from '../api.ts';
import { crewLink } from '../access.ts';
import { copyLink } from '../consoleParts.tsx';
import { useAudit, useCan, useCrew } from '../state.ts';
import { auditActor, auditFileName, auditReason, auditRole, auditTime, auditWords, newestFirst, untilWords } from './audit.ts';
import { downloadJson } from './download.ts';
import { useLastFreshLink, useStoredCrewLinks } from './feed.ts';
import './panels.css';

const NO_SCREENS: Record<string, boolean> = {};
const ASSIGN_REASONS = ['Presenter offline', 'Planned hand-over', 'Other'] as const;
type AssignReason = (typeof ASSIGN_REASONS)[number];

/** `…/room/ABCDE#crew=•••••` — enough to recognise, never the secret (the console may be shared). */
const masked = (code: string) => `…/room/${code}#crew=••••••••`;

export function CrewPanel({ code }: { code: string }) {
  const crew = useCrew();
  const canIssue = useCan('crew.issue');
  const canAssign = useCan('presenter.assign');
  const canRead = useCan('audit.read');

  if (!crew?.event) {
    return (
      <section className="sdp-panel" aria-labelledby="sdp-crew-title" data-part="showdown-crew-panel">
        <h3 className="sd-panel__title" id="sdp-crew-title">
          <PixelIcon name="crown" /> Crew & log
        </h3>
        <p className="sdp-empty">Crew links and the log exist in event rooms: load a DAS-O-Ween preset in the lobby.</p>
      </section>
    );
  }

  return (
    <section className="sdp-panel sdp-crewpanel" aria-labelledby="sdp-crew-title" data-part="showdown-crew-panel">
      <h3 className="sd-panel__title" id="sdp-crew-title">
        <PixelIcon name="crown" /> Crew & log
      </h3>
      {canIssue ? <ProducerLink code={code} /> : null}
      {canIssue ? <IssueLinks code={code} links={crew.links} /> : null}
      {canAssign ? <AssignPresenter /> : null}
      {canRead ? <AuditLog code={code} /> : null}
      {!canIssue && !canAssign && !canRead ? <p className="sdp-empty">Your role has no crew controls here.</p> : null}
    </section>
  );
}

function ProducerLink({ code }: { code: string }) {
  const stored = useStoredCrewLinks(code);
  const crew = useCrew();
  const mine = stored.filter((l) => l.role === 'producer').at(-1);
  const revoked = mine ? crew?.links.find((l) => l.id === mine.id)?.revoked : false;
  return (
    <div className="sdp-block" data-part="showdown-producer-link">
      <h4 className="sdp-sub">Your producer link</h4>
      {mine && !revoked ? (
        <>
          <div className="sdp-linkrow">
            <code className="sdp-linkrow__url" aria-label="Producer link (hidden)">
              {masked(code)}
            </code>
            <Button
              size="sm"
              variant="primary"
              icon="copy"
              onClick={() => void copyLink(crewLink(code, mine.link), 'Producer link copied — keep it private', true)}
              data-part="showdown-copy-producer"
            >
              Copy producer link
            </Button>
          </div>
          <p className="sdp-note">
            Open it on another device or give it to a co-organizer. Whoever opens it gets the producer controls — keep it private.
          </p>
        </>
      ) : (
        <p className="sdp-empty">
          {revoked
            ? 'Your producer link was revoked.'
            : 'This device doesn’t have your producer link: it’s shown once, on the device that loaded the event preset.'}
        </p>
      )}
    </div>
  );
}

function IssueLinks({ code, links }: { code: string; links: ShowdownCrewLinkView[] }) {
  const canRevoke = useCan('crew.revoke');
  const stored = useStoredCrewLinks(code);
  const fresh = useLastFreshLink();
  const [name, setName] = useState('');
  const [role, setRole] = useState<ShowdownIssuableRole>('moderator');
  const [asked, setAsked] = useState<{ role: ShowdownIssuableRole; name: string; at: number } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const copyRefs = useRef(new Map<string, HTMLButtonElement | null>());

  // The link we asked for came back: say so and put the focus on its Copy button.
  useEffect(() => {
    if (!asked || !fresh || fresh.at < asked.at || fresh.role !== asked.role) return;
    setAsked(null);
    setSaid(
      `${SHOWDOWN_ROLE_INFO[fresh.role as ShowdownIssuableRole]?.title ?? 'Crew'} link for ${fresh.name || 'them'} is ready. Copy it below.`,
    );
    requestAnimationFrame(() => copyRefs.current.get(fresh.id)?.focus({ preventScroll: true }));
  }, [asked, fresh]);

  const issue = () => {
    const who = name.trim();
    if (!who) return;
    sfx('select');
    showdownApi.issueCrew(role, who);
    setAsked({ role, name: who, at: Date.now() });
    setSaid(`Creating a ${SHOWDOWN_ROLE_INFO[role].title.toLowerCase()} link for ${who}…`);
    setName('');
  };

  const sorted = useMemo(() => [...links].sort((a, b) => Number(a.revoked) - Number(b.revoked)), [links]);

  return (
    <div className="sdp-block">
      <h4 className="sdp-sub">Crew links</h4>
      <form
        className="sdp-issue"
        onSubmit={(e) => {
          e.preventDefault();
          issue();
        }}
      >
        <label className="sdp-field">
          <span className="sdp-field__label">Name</span>
          <TextInput
            value={name}
            maxLength={40}
            placeholder="Dana K."
            autoComplete="off"
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </label>
        <label className="sdp-field">
          <span className="sdp-field__label">Role</span>
          <Select value={role} onChange={(e) => setRole(e.currentTarget.value as ShowdownIssuableRole)}>
            {SHOWDOWN_ISSUABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {SHOWDOWN_ROLE_INFO[r].title}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" variant="secondary" icon="plus" disabled={!name.trim()} data-part="showdown-issue-crew">
          Create link
        </Button>
      </form>
      <p className="sdp-note">{SHOWDOWN_ROLE_INFO[role].blurb}</p>

      {sorted.length ? (
        <ul className="sdp-links" aria-label="Crew links">
          {sorted.map((l) => {
            const local = stored.find((s) => s.id === l.id);
            return (
              <li key={l.id} className="sdp-link" data-revoked={l.revoked ? 'true' : undefined}>
                <span className="sdp-link__who">
                  <b>{l.name || 'Unnamed'}</b>
                  <span className="sdp-link__tags">
                    <Badge>{SHOWDOWN_ROLE_INFO[l.role]?.title ?? l.role}</Badge>
                    {l.revoked ? (
                      <Badge icon="close">Revoked</Badge>
                    ) : l.online ? (
                      <Badge icon="wifi">Online</Badge>
                    ) : (
                      <Badge icon="wifi-off">{l.holderId ? 'Offline' : 'Not opened'}</Badge>
                    )}
                  </span>
                  <small>
                    {l.holderName ? `Held by ${l.holderName}` : 'Nobody has opened it yet'}
                    {l.revoked ? '' : ` · expires ${untilWords(l.expiresAt, serverNow())}`}
                  </small>
                </span>
                {confirm === l.id ? (
                  <span className="sdp-confirm" role="group" aria-label={`Revoke ${l.name}’s link?`}>
                    <span className="sdp-confirm__q">Revoke {l.name ? `${l.name}’s` : 'this'} link? They lose the role at once.</span>
                    <Button
                      size="sm"
                      variant="danger"
                      autoFocus
                      onClick={() => {
                        sfx('select');
                        showdownApi.revokeCrew(l.id);
                        setConfirm(null);
                        setSaid(
                          `Revoked ${l.name ? `${l.name}’s` : 'the'} ${SHOWDOWN_ROLE_INFO[l.role]?.title.toLowerCase() ?? 'crew'} link.`,
                        );
                      }}
                    >
                      Yes, revoke
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                      Keep it
                    </Button>
                  </span>
                ) : (
                  <span className="sdp-link__actions">
                    {local && !l.revoked ? (
                      <Button
                        ref={(el) => {
                          copyRefs.current.set(l.id, el);
                        }}
                        size="sm"
                        variant={fresh?.id === l.id ? 'primary' : 'ghost'}
                        icon="copy"
                        aria-label={`Copy ${l.name || 'the'} ${SHOWDOWN_ROLE_INFO[l.role]?.title.toLowerCase() ?? 'crew'} link`}
                        onClick={() =>
                          void copyLink(crewLink(code, local.link), `${l.name || 'Crew'} link copied — send it privately`, true)
                        }
                      >
                        Copy
                      </Button>
                    ) : null}
                    {canRevoke && !l.revoked && l.role !== 'producer' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="close"
                        aria-label={`Revoke ${l.name || 'this'} link`}
                        onClick={() => setConfirm(l.id)}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="sdp-empty">No crew links yet. A backup presenter can take the show if you drop; a moderator fixes names.</p>
      )}
      <p className="sdp-notice" role="status" aria-live="polite">
        {said}
      </p>
    </div>
  );
}

function AssignPresenter() {
  const players = useRoomSelector<ShowdownPublicState, ShowdownPublicState['players']>((s) => s.players, playersEqual);
  const presenterId = useRoomSelector<ShowdownPublicState, string>((s) => s.presenterId) ?? '';
  const screens = useRoomSelector<ShowdownPublicState, Record<string, boolean>>((s) => s.screens ?? NO_SCREENS) ?? NO_SCREENS;
  const myId = useSessionStore((s) => s.playerId);
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState<AssignReason | null>(null);
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [said, setSaid] = useState('');
  const [waitingFor, setWaitingFor] = useState('');

  // Big screens and spectators never present (the server refuses): the answers would go up on the stage.
  const candidates = Object.values(players ?? {})
    .filter((p) => p.id !== presenterId && p.connected && !screens[p.id] && !p.spectator)
    .sort((a, b) => a.name.localeCompare(b.name));
  const chosen = candidates.find((p) => p.id === target) ?? null;
  const presenterName = presenterId ? (players?.[presenterId]?.name ?? 'the presenter') : '';
  const iPresent = presenterId === myId;

  useEffect(() => {
    if (!waitingFor || presenterId !== waitingFor) return;
    setSaid(`${players?.[waitingFor]?.name ?? 'They'} ${waitingFor === myId ? '(you) are' : 'is'} the presenter now.`);
    setWaitingFor('');
  }, [presenterId, waitingFor, players, myId]);
  useEffect(() => {
    if (target && !chosen) {
      setTarget('');
      setConfirming(false);
    }
  }, [target, chosen]);

  const consequence = chosen
    ? `${chosen.name} will get the presenter console; ${iPresent ? 'your' : presenterName ? `${presenterName}’s` : 'the old'} presenter link stops working.`
    : '';

  return (
    <div className="sdp-block" data-part="showdown-assign">
      <h4 className="sdp-sub">Change the presenter</h4>
      <p className="sdp-note">
        Presenting now: <b>{presenterName || 'nobody'}</b>
        {presenterId && players?.[presenterId] && !players[presenterId]!.connected ? ' (offline)' : ''}. Only a producer can move the role;
        it’s logged with your reason.
      </p>
      {candidates.length ? (
        <>
          <label className="sdp-field">
            <span className="sdp-field__label">New presenter</span>
            <Select
              value={target}
              onChange={(e) => {
                setTarget(e.currentTarget.value);
                setConfirming(false);
              }}
            >
              <option value="">Choose someone who’s here…</option>
              {candidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.id === myId ? ' (you)' : ''}
                </option>
              ))}
            </Select>
          </label>
          <fieldset className="sdp-reroll__set">
            <legend className="sdp-field__label">Reason</legend>
            <div className="sdp-reroll__opts">
              {ASSIGN_REASONS.map((r) => (
                <label key={r} className={cx('sdp-chip', reason === r && 'is-on')}>
                  <input type="radio" name="sdp-assign-reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
                  {r}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="sdp-field">
            <span className="sdp-field__label">Note (optional)</span>
            <TextInput value={note} maxLength={120} autoComplete="off" onChange={(e) => setNote(e.currentTarget.value)} />
          </label>
          {confirming && chosen && reason ? (
            <div className="sdp-confirm sdp-confirm--block" role="group" aria-label={`Make ${chosen.name} presenter?`}>
              <p className="sdp-confirm__q">{consequence}</p>
              <div className="sdp-strip__row">
                <Button
                  variant="danger"
                  icon="crown"
                  autoFocus
                  onClick={() => {
                    sfx('select');
                    showdownApi.assign(chosen.id, note.trim() ? `${reason}: ${note.trim()}` : reason);
                    setWaitingFor(chosen.id);
                    setSaid(`Making ${chosen.name} the presenter…`);
                    setConfirming(false);
                    setNote('');
                    setReason(null);
                  }}
                >
                  Yes, make {chosen.name} presenter
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" icon="crown" disabled={!chosen || !reason} onClick={() => setConfirming(true)}>
              {chosen ? `Make ${chosen.name} presenter…` : 'Make … presenter…'}
            </Button>
          )}
        </>
      ) : (
        <p className="sdp-empty">Nobody else who could present is connected right now.</p>
      )}
      <p className="sdp-notice" role="status" aria-live="polite">
        {said}
      </p>
    </div>
  );
}

function AuditLog({ code }: { code: string }) {
  const view = useAudit();
  const canExport = useCan('audit.export');
  const [asked, setAsked] = useState(0);
  const [said, setSaid] = useState('');
  const entries = useMemo(() => newestFirst(view?.entries ?? []), [view]);

  useRoomMessage<ShowdownAuditFile>(SHOWDOWN_MSG.auditExport, (file) => {
    if (!asked || !file) return;
    setAsked(0);
    const ok = downloadJson(auditFileName(code), file);
    setSaid(
      ok
        ? `Log downloaded: ${file.entries.length} entr${file.entries.length === 1 ? 'y' : 'ies'} (${auditFileName(code)}).`
        : 'This browser couldn’t save the file.',
    );
  });
  useEffect(() => {
    if (!asked) return;
    const t = setTimeout(() => {
      setAsked(0);
      setSaid('The log didn’t arrive. Try Download log again.');
    }, 6000);
    return () => clearTimeout(t);
  }, [asked]);

  return (
    <div className="sdp-block" data-part="showdown-audit">
      <div className="sdp-block__head">
        <h4 className="sdp-sub" id="sdp-audit-title">
          Log
        </h4>
        {canExport ? (
          <Button
            size="sm"
            variant="ghost"
            icon="share"
            loading={asked > 0}
            onClick={() => {
              sfx('select');
              setAsked(Date.now());
              showdownApi.exportAudit();
            }}
            data-part="showdown-audit-export"
          >
            Download log (JSON)
          </Button>
        ) : null}
      </div>
      <p className="sdp-note">
        Who did what, newest first.{' '}
        {view && view.total > entries.length
          ? `Showing the latest ${entries.length} of ${view.total}${canExport ? ' — the download has them all' : ''}.`
          : ''}{' '}
        It leaves with the room.
      </p>
      {entries.length ? (
        <div className="sdp-logwrap" role="region" aria-labelledby="sdp-audit-title" tabIndex={0}>
          <ol className="sdp-log" aria-label="Log entries, newest first">
            {entries.map((e) => {
              const reason = auditReason(e);
              const words = auditWords(e);
              return (
                <li key={e.seq} className="sdp-log__item" data-action={e.action}>
                  <span className="sdp-log__meta">
                    <time className="dc-num" dateTime={new Date(e.at).toISOString()}>
                      {auditTime(e.at)}
                    </time>
                    <b>{auditActor(e)}</b>
                    {auditRole(e) ? <span className="sdp-log__role">{auditRole(e)}</span> : null}
                  </span>
                  <span className="sdp-log__what">{words.charAt(0).toUpperCase() + words.slice(1)}</span>
                  {reason ? <span className="sdp-log__why">Reason: {reason}</span> : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        <p className="sdp-empty">Nothing logged yet.</p>
      )}
      <p className="sdp-notice" role="status" aria-live="polite">
        {said}
      </p>
    </div>
  );
}
