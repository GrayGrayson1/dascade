/**
 * Organizer console: the lifecycle stepper with the next action, seeding (random / rating / manual
 * order), check-in management, settings edits before the start, live-match supervision (no-shows,
 * forfeits, manual results, relaunch) and end/cancel. Every destructive action is confirmed; manual
 * overrides and removals need a typed reason that lands in the public audit log.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  GAME_CATALOG,
  SEEDING_LABELS,
  TOURNAMENT_LIMITS,
  TOURNAMENT_STATUS_LABELS,
  type SeedingMethod,
  type TournamentAdminAction,
  type TournamentConfig,
  type TournamentMatchView,
  type TournamentParticipantView,
  type TournamentView,
} from '@dascade/shared';
import { Badge, Button, Field, IconButton, NumberInput, PixelIcon, Segmented, TextInput, Toggle, cx } from '@dascade/ui';
import { useCountdown } from '../../net/hooks.ts';
import { useApp } from '../../app/store.ts';
import { sfx } from '../../audio/audio.ts';
import type { ConfirmSpec } from './ConfirmDialog.tsx';
import { PARTICIPANT_STATUS_TEXT, PARTICIPANT_STATUS_TONE, STEP_SHORT, lifecycle, mmss } from './text.ts';
import { adminRequest } from './useKiosk.ts';

const PRE_START = new Set(['DRAFT', 'REGISTRATION', 'CHECK_IN', 'READY']);

async function run(action: TournamentAdminAction, success?: string): Promise<boolean> {
  const ack = await adminRequest(action);
  if (ack.ok) {
    if (success) useApp.getState().toast('success', success);
  } else useApp.getState().toast('error', ack.message || 'That didn’t work.');
  return ack.ok;
}

function entrants(view: TournamentView): TournamentParticipantView[] {
  return view.participants.filter((p) => p.status !== 'withdrawn' && p.status !== 'disqualified' && p.status !== 'no_show');
}

// ---------------------------------------------------------------------------
/** The one thing the organizer should do next (shown above the tabs and atop the console). */
export function NextStep({
  view,
  onConfirm,
  onOpenConsole,
}: {
  view: TournamentView;
  onConfirm: (s: ConfirmSpec) => void;
  onOpenConsole?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const checkInLeft = useCountdown(view.status === 'CHECK_IN' ? view.checkInEndsAt : 0);
  const field = entrants(view);
  const checked = field.filter((p) => p.checkedIn).length;
  const eligible = view.config.checkIn && (view.status === 'CHECK_IN' || view.status === 'READY') ? checked : field.length;
  const live = view.matches.filter((m) => m.status === 'IN_PROGRESS').length;
  const ready = view.matches.filter((m) => m.status === 'READY').length;

  const act = async (key: string, action: TournamentAdminAction, success?: string) => {
    setBusy(key);
    sfx('click');
    await run(action, success);
    setBusy(null);
  };

  const begin = () =>
    onConfirm({
      title: 'Start the tournament?',
      body: (
        <div className="dc-stack-sm">
          <p>
            <b className="dc-num">{eligible}</b> {eligible === 1 ? 'player' : 'players'} will be drawn into a{' '}
            {GAME_CATALOG[view.config.gameId].title} {view.config.format.replace('_', ' ')} (
            {view.config.bestOf === 1 ? 'single game' : `best of ${view.config.bestOf}`}).
          </p>
          <p className="dc-muted">
            Seeding:{' '}
            {view.seedingMethod
              ? `${SEEDING_LABELS[view.seedingMethod]} (already applied)`
              : `${SEEDING_LABELS[view.config.seeding]} (applied now)`}
            . Registration closes and first-round match rooms open straight away.
          </p>
          {view.config.checkIn && view.status !== 'READY' ? <p className="dc-muted">Players who haven’t checked in are left out.</p> : null}
        </div>
      ),
      confirmLabel: 'Start tournament',
      run: () => adminRequest({ action: 'begin' }),
    });

  let text: React.ReactNode;
  let primary: React.ReactNode = null;
  let secondary: React.ReactNode = null;
  switch (view.status) {
    case 'DRAFT':
      text = 'Open registration so players can join from this kiosk (share the code or link).';
      primary = (
        <Button
          variant="gold"
          icon="play"
          loading={busy === 'open'}
          onClick={() => act('open', { action: 'openRegistration' }, 'Registration is open.')}
        >
          Open registration
        </Button>
      );
      break;
    case 'REGISTRATION':
      text = (
        <>
          <b className="dc-num">{field.length}</b>/<span className="dc-num">{view.config.maxField}</span> registered.{' '}
          {view.config.checkIn ? 'Open check-in when everyone is in.' : 'Start when everyone is in.'}
        </>
      );
      primary = view.config.checkIn ? (
        <Button
          variant="gold"
          icon="check"
          loading={busy === 'checkin'}
          onClick={() => act('checkin', { action: 'openCheckIn' }, 'Check-in is open.')}
        >
          Open check-in
        </Button>
      ) : (
        <Button
          variant="gold"
          icon="play"
          disabled={field.length < 2}
          onClick={begin}
          title={field.length < 2 ? 'Needs at least 2 players' : undefined}
        >
          Start tournament
        </Button>
      );
      secondary = (
        <Button variant="ghost" size="sm" loading={busy === 'close'} onClick={() => act('close', { action: 'closeRegistration' })}>
          Close registration
        </Button>
      );
      break;
    case 'CHECK_IN':
      text = (
        <>
          <b className="dc-num">{checked}</b> of <span className="dc-num">{field.length}</span> checked in.
          {view.checkInEndsAt ? (
            <>
              {' '}
              Check-in closes in <b className="dc-num">{mmss(checkInLeft)}</b>.
            </>
          ) : null}
        </>
      );
      primary = (
        <Button
          variant="gold"
          icon="play"
          disabled={checked < 2}
          onClick={begin}
          title={checked < 2 ? 'Needs at least 2 checked-in players' : undefined}
        >
          Start tournament
        </Button>
      );
      secondary = (
        <Button variant="ghost" size="sm" loading={busy === 'closeci'} onClick={() => act('closeci', { action: 'closeCheckIn' })}>
          Close check-in
        </Button>
      );
      break;
    case 'READY':
      text = (
        <>
          <b className="dc-num">{eligible}</b> {eligible === 1 ? 'player is' : 'players are'} ready. Start whenever you like.
        </>
      );
      primary = (
        <Button variant="gold" icon="play" disabled={eligible < 2} onClick={begin}>
          Start tournament
        </Button>
      );
      secondary = (
        <Button variant="ghost" size="sm" loading={busy === 'reopen'} onClick={() => act('reopen', { action: 'openRegistration' })}>
          Reopen registration
        </Button>
      );
      break;
    case 'IN_PROGRESS':
      text = view.paused ? (
        'Paused — live matches finish, but no new matches or rounds start.'
      ) : (
        <>
          {view.totalRounds > 0 ? (
            <>
              Round <b className="dc-num">{view.currentRound}</b> of <span className="dc-num">{view.totalRounds}</span> ·{' '}
            </>
          ) : null}
          <b className="dc-num">{live}</b> live, <b className="dc-num">{ready}</b> waiting to start. Results advance on their own.
        </>
      );
      primary = view.paused ? (
        <Button variant="gold" icon="play" loading={busy === 'resume'} onClick={() => act('resume', { action: 'resume' }, 'Resumed.')}>
          Resume
        </Button>
      ) : (
        <Button
          variant="secondary"
          icon="pause"
          loading={busy === 'pause'}
          onClick={() => act('pause', { action: 'pause' }, 'Paused new matches.')}
        >
          Pause new matches
        </Button>
      );
      break;
    case 'COMPLETE':
      text = 'The tournament is complete. The bracket and standings stay up for everyone.';
      break;
    case 'CANCELLED':
      text = 'This tournament was cancelled.';
      break;
  }

  return (
    <section className="tk-next" aria-label="Organizer: next step">
      <span className="tk-next__tag">
        <PixelIcon name="crown" /> Organizer
      </span>
      <p className="tk-next__text">{text}</p>
      <div className="tk-next__actions">
        {secondary}
        {primary}
        {onOpenConsole ? (
          <Button variant="ghost" size="sm" icon="gear" onClick={onOpenConsole}>
            Console
          </Button>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
export function OrganizerConsole({
  view,
  onConfirm,
  onSelectMatch,
}: {
  view: TournamentView;
  onConfirm: (s: ConfirmSpec) => void;
  onSelectMatch: (id: string) => void;
}) {
  const steps = lifecycle(view.config.checkIn);
  const current = steps.indexOf(view.status);
  const pre = PRE_START.has(view.status);
  const finished = view.status === 'COMPLETE' || view.status === 'CANCELLED';
  return (
    <div className="tk-console">
      <ol className="tk-stepper" aria-label="Tournament lifecycle">
        {steps.map((s, i) => (
          <li
            key={s}
            data-state={view.status === 'CANCELLED' ? 'off' : i < current ? 'done' : i === current ? 'now' : 'todo'}
            aria-current={i === current ? 'step' : undefined}
          >
            <span className="tk-stepper__dot" aria-hidden>
              {i < current ? <PixelIcon name="check" size={10} /> : <span className="dc-num">{i + 1}</span>}
            </span>
            <span className="tk-stepper__label">{STEP_SHORT[s]}</span>
          </li>
        ))}
        {view.status === 'CANCELLED' ? (
          <li data-state="now" aria-current="step">
            <span className="tk-stepper__dot" aria-hidden>
              <PixelIcon name="close" size={10} />
            </span>
            <span className="tk-stepper__label">Cancelled</span>
          </li>
        ) : null}
      </ol>

      <NextStep view={view} onConfirm={onConfirm} />

      {pre ? <SeedingCard view={view} onConfirm={onConfirm} /> : null}
      {view.status === 'IN_PROGRESS' ? <MatchesCard view={view} onSelectMatch={onSelectMatch} /> : null}
      {!finished ? <ParticipantsCard view={view} onConfirm={onConfirm} /> : null}
      {pre ? <SettingsCard view={view} /> : null}

      {!finished ? (
        <section className="tk-card tk-card--danger" aria-labelledby="tk-danger">
          <h3 id="tk-danger" className="tk-card__title">
            Finish early
          </h3>
          <p className="dc-muted">
            {view.status === 'IN_PROGRESS'
              ? 'End now: finished results stand, unfinished matches are voided. Cancel: the tournament is called off.'
              : 'Cancel: the tournament is called off and removed from the board.'}
          </p>
          <div className="dc-row dc-row--wrap">
            {view.status === 'IN_PROGRESS' ? (
              <Button
                variant="secondary"
                icon="flag"
                onClick={() =>
                  onConfirm({
                    title: 'End the tournament now?',
                    body: <p>Completed results stand; matches still being played are voided. Standings become final.</p>,
                    confirmLabel: 'End tournament',
                    danger: true,
                    reason: { label: 'Reason', placeholder: 'e.g. Out of time — office closing' },
                    run: (reason) => adminRequest({ action: 'end', reason, confirm: true }),
                  })
                }
              >
                End now…
              </Button>
            ) : null}
            <Button
              variant="danger"
              icon="close"
              onClick={() =>
                onConfirm({
                  title: 'Cancel this tournament?',
                  body: <p>Everyone sees it as cancelled. This can’t be undone.</p>,
                  confirmLabel: 'Cancel tournament',
                  danger: true,
                  reason: { label: 'Reason', placeholder: 'e.g. Not enough players today' },
                  run: (reason) => adminRequest({ action: 'cancel', reason, confirm: true }),
                })
              }
            >
              Cancel tournament…
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
function SeedingCard({ view, onConfirm }: { view: TournamentView; onConfirm: (s: ConfirmSpec) => void }) {
  const field = entrants(view);
  const [method, setMethod] = useState<SeedingMethod>(view.seedingMethod || view.config.seeding);
  const [order, setOrder] = useState<string[]>(() => field.map((p) => p.id));
  const [busy, setBusy] = useState(false);
  const people = useMemo(() => new Map(view.participants.map((p) => [p.id, p])), [view.participants]);
  const fieldKey = field.map((p) => p.id).join(',');
  // Keep the manual order in sync with registrations (new players go to the bottom, leavers drop out).
  useEffect(() => {
    setOrder((prev) => {
      const ids = fieldKey ? fieldKey.split(',') : [];
      const kept = prev.filter((id) => ids.includes(id));
      return [...kept, ...ids.filter((id) => !kept.includes(id))];
    });
  }, [fieldKey]);
  const move = (i: number, d: -1 | 1) => {
    setOrder((o) => {
      const j = i + d;
      if (j < 0 || j >= o.length) return o;
      const next = [...o];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  };
  const apply = async () => {
    setBusy(true);
    await run(method === 'manual' ? { action: 'seed', method, order } : { action: 'seed', method }, 'Seeding applied.');
    setBusy(false);
  };
  return (
    <section className="tk-card" aria-labelledby="tk-seed">
      <h3 id="tk-seed" className="tk-card__title">
        Seeding
        {view.seedingMethod ? (
          <Badge color="var(--green)">{SEEDING_LABELS[view.seedingMethod]} applied</Badge>
        ) : (
          <Badge>Not seeded yet</Badge>
        )}
      </h3>
      <p className="dc-muted">
        Seeds decide the bracket (1 plays the lowest seed) or the first Swiss pairings. If you don’t seed, “
        {SEEDING_LABELS[view.config.seeding]}” is applied when you start.
      </p>
      <Segmented<SeedingMethod>
        label="Seeding method"
        value={method}
        onChange={setMethod}
        options={(['random', 'rating', 'manual'] as const).map((m) => ({ value: m, label: SEEDING_LABELS[m] }))}
      />
      {method === 'manual' ? (
        <ol className="tk-order" aria-label="Seed order (best first)">
          {order.map((id, i) => (
            <li key={id}>
              <span className="tc-seed">{i + 1}</span>
              <span className="tk-order__name">{people.get(id)?.name ?? 'Unknown'}</span>
              <span className="tk-order__rating dc-num" title="Internal DASCADE rating">
                {people.get(id)?.rating}
              </span>
              <IconButton
                icon="chevron-up"
                label={`Move ${people.get(id)?.name} up`}
                size="sm"
                disabled={i === 0}
                onClick={() => move(i, -1)}
              />
              <IconButton
                icon="chevron-down"
                label={`Move ${people.get(id)?.name} down`}
                size="sm"
                disabled={i === order.length - 1}
                onClick={() => move(i, 1)}
              />
            </li>
          ))}
        </ol>
      ) : null}
      <div className="dc-row">
        <Button
          variant="primary"
          icon="dice"
          loading={busy}
          disabled={field.length < 2}
          onClick={() =>
            view.seedingMethod
              ? onConfirm({
                  title: 'Re-seed?',
                  body: <p>The current seeds are replaced. The method is recorded in the log.</p>,
                  confirmLabel: 'Apply seeding',
                  run: () => adminRequest(method === 'manual' ? { action: 'seed', method, order } : { action: 'seed', method }),
                })
              : void apply()
          }
        >
          {method === 'random' ? 'Draw seeds' : 'Apply seeding'}
        </Button>
        {field.length < 2 ? <span className="dc-field__hint">Needs at least 2 players.</span> : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
function ParticipantsCard({ view, onConfirm }: { view: TournamentView; onConfirm: (s: ConfirmSpec) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const checkInOpen = view.status === 'CHECK_IN';
  const list = view.participants.filter((p) => p.status !== 'no_show' || checkInOpen);
  return (
    <section className="tk-card" aria-labelledby="tk-people">
      <h3 id="tk-people" className="tk-card__title">
        Players <span className="dc-num tk-card__count">{entrants(view).length}</span>
      </h3>
      {list.length === 0 ? <p className="dc-muted">Nobody has registered yet. Share the code: players register from this kiosk.</p> : null}
      <ul className="tk-admin-list">
        {list.map((p) => {
          const gone = p.status === 'withdrawn' || p.status === 'disqualified';
          return (
            <li key={p.id} data-gone={gone || undefined}>
              <span className="tk-admin-list__name">
                {p.seed > 0 ? <span className="tc-seed">{p.seed}</span> : null}
                {p.name}
                <i
                  className="tk-online"
                  data-on={p.online || undefined}
                  title={p.online ? 'At the kiosk' : 'Not at the kiosk'}
                  aria-label={p.online ? 'online' : 'offline'}
                />
              </span>
              <span className="tk-status" style={{ '--tone': PARTICIPANT_STATUS_TONE[p.status] } as React.CSSProperties}>
                {PARTICIPANT_STATUS_TEXT[p.status]}
              </span>
              <span className="tk-admin-list__actions">
                {checkInOpen && !gone ? (
                  <Button
                    size="sm"
                    variant={p.checkedIn ? 'ghost' : 'secondary'}
                    icon={p.checkedIn ? 'close' : 'check'}
                    loading={busy === p.id}
                    onClick={async () => {
                      setBusy(p.id);
                      await run({ action: 'checkInParticipant', participantId: p.id, checkedIn: !p.checkedIn });
                      setBusy(null);
                    }}
                  >
                    {p.checkedIn ? 'Undo check-in' : 'Check in'}
                  </Button>
                ) : null}
                {!gone ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash"
                    aria-label={`Remove ${p.name}`}
                    onClick={() =>
                      onConfirm({
                        title: `Remove ${p.name}?`,
                        body:
                          view.status === 'IN_PROGRESS' ? (
                            <p>{p.name} is disqualified: their remaining matches are forfeited and their opponents advance.</p>
                          ) : (
                            <p>{p.name} is removed from the field before the start.</p>
                          ),
                        confirmLabel: view.status === 'IN_PROGRESS' ? 'Disqualify' : 'Remove',
                        danger: true,
                        reason: {
                          label: 'Reason',
                          placeholder: view.status === 'IN_PROGRESS' ? 'e.g. Left the office' : 'e.g. Registered twice',
                        },
                        run: (reason) => adminRequest({ action: 'disqualify', participantId: p.id, reason, confirm: true }),
                      })
                    }
                  >
                    <span className="dc-collapse-label">{view.status === 'IN_PROGRESS' ? 'DQ' : 'Remove'}</span>
                  </Button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
function MatchRow({ m, view, onSelectMatch }: { m: TournamentMatchView; view: TournamentView; onSelectMatch: (id: string) => void }) {
  const left = useCountdown(m.noShowAt || 0);
  const name = (id: string) => view.participants.find((p) => p.id === id)?.name ?? '—';
  return (
    <li>
      <button type="button" className="tk-live-row" onClick={() => onSelectMatch(m.id)} data-status={m.status}>
        <span className="tk-live-row__code dc-num">{m.id}</span>
        <span className="tk-live-row__players">
          <span data-present={m.aPresent || undefined}>{name(m.aId)}</span>
          <span className="dc-muted"> vs </span>
          <span data-present={m.bPresent || undefined}>{name(m.bId)}</span>
        </span>
        <span className="tk-live-row__state">
          {m.status === 'IN_PROGRESS' ? (
            <Badge color="var(--green)">Live · G{Math.max(1, m.gameNumber)}</Badge>
          ) : (
            <Badge color="var(--accent)">{!m.aPresent || !m.bPresent ? 'Waiting' : 'Starting'}</Badge>
          )}
          {m.noShowAt > 0 ? (
            <span className="tk-live-row__clock dc-num" title="No-show forfeit in">
              {mmss(left)}
            </span>
          ) : null}
        </span>
        <PixelIcon name="arrow-right" className="tk-live-row__go" />
      </button>
    </li>
  );
}

function MatchesCard({ view, onSelectMatch }: { view: TournamentView; onSelectMatch: (id: string) => void }) {
  const active = view.matches.filter((m) => m.status === 'READY' || m.status === 'IN_PROGRESS');
  return (
    <section className="tk-card" aria-labelledby="tk-live">
      <h3 id="tk-live" className="tk-card__title">
        Matches in play <span className="dc-num tk-card__count">{active.length}</span>
      </h3>
      {active.length === 0 ? (
        <p className="dc-muted">No match is open right now{view.paused ? ' (paused)' : ''}.</p>
      ) : (
        <>
          <p className="dc-muted">
            Open a match to forfeit a no-show, decide it by hand or relaunch a stuck room. Green names are in their match room.
          </p>
          <ul className="tk-live-list">
            {active.map((m) => (
              <MatchRow key={m.id} m={m} view={view} onSelectMatch={onSelectMatch} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
function SettingsCard({ view }: { view: TournamentView }) {
  const cap = GAME_CATALOG[view.config.gameId].tournament!;
  const [draft, setDraft] = useState<TournamentConfig>(view.config);
  const [busy, setBusy] = useState(false);
  const configKey = JSON.stringify(view.config);
  useEffect(() => setDraft(JSON.parse(configKey) as TournamentConfig), [configKey]);
  const dirty = JSON.stringify(draft) !== configKey;
  const minField = Math.max(TOURNAMENT_LIMITS.minField, entrants(view).length);
  const save = async () => {
    setBusy(true);
    const patch: Partial<TournamentConfig> = {};
    for (const k of [
      'name',
      'maxField',
      'bestOf',
      'checkIn',
      'checkInMinutes',
      'noShowMinutes',
      'visibility',
      'swissRounds',
      'grandFinalReset',
    ] as const) {
      if (JSON.stringify(draft[k]) !== JSON.stringify(view.config[k])) (patch as Record<string, unknown>)[k] = draft[k];
    }
    await run({ action: 'updateConfig', config: { ...patch, name: patch.name?.trim() } }, 'Settings saved.');
    setBusy(false);
  };
  return (
    <section className="tk-card" aria-labelledby="tk-settings">
      <h3 id="tk-settings" className="tk-card__title">
        Settings <span className="dc-muted tk-card__sub">until the start</span>
      </h3>
      <div className="tk-settings">
        <Field label="Name">
          {({ id }) => (
            <TextInput
              id={id}
              value={draft.name}
              maxLength={TOURNAMENT_LIMITS.name}
              onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
            />
          )}
        </Field>
        <Field label="Maximum players" hint={`${minField}–${cap.maxField}`}>
          {({ id }) => (
            <NumberInput
              id={id}
              min={minField}
              max={cap.maxField}
              value={draft.maxField}
              onChange={(maxField) => setDraft({ ...draft, maxField })}
            />
          )}
        </Field>
        <div className="dc-field">
          <span className="dc-field__label">Games per match</span>
          <Segmented<string>
            label="Games per match"
            value={String(draft.bestOf)}
            onChange={(v) => setDraft({ ...draft, bestOf: Number(v) })}
            options={cap.bestOf.map((n) => ({ value: String(n), label: n === 1 ? 'Single' : `Bo${n}` }))}
          />
        </div>
        <Toggle label="Require check-in" checked={draft.checkIn} onChange={(checkIn) => setDraft({ ...draft, checkIn })} />
        {draft.checkIn ? (
          <Field label="Check-in window (min, 0 = until closed)">
            {({ id }) => (
              <NumberInput
                id={id}
                min={0}
                max={TOURNAMENT_LIMITS.checkInMinutesMax}
                value={draft.checkInMinutes}
                onChange={(checkInMinutes) => setDraft({ ...draft, checkInMinutes })}
              />
            )}
          </Field>
        ) : null}
        <Field label="No-show forfeit (min, 0 = never)">
          {({ id }) => (
            <NumberInput
              id={id}
              min={0}
              max={TOURNAMENT_LIMITS.noShowMinutesMax}
              value={draft.noShowMinutes}
              onChange={(noShowMinutes) => setDraft({ ...draft, noShowMinutes })}
            />
          )}
        </Field>
        <div className="dc-field">
          <span className="dc-field__label">Listing</span>
          <Segmented<'public' | 'unlisted'>
            label="Listing"
            value={draft.visibility}
            onChange={(visibility) => setDraft({ ...draft, visibility })}
            options={[
              { value: 'public', label: 'Listed' },
              { value: 'unlisted', label: 'Code only' },
            ]}
          />
        </div>
      </div>
      <div className="dc-row">
        <Button variant="primary" icon="check" disabled={!dirty || !draft.name.trim()} loading={busy} onClick={save}>
          Save settings
        </Button>
        {dirty ? (
          <Button variant="ghost" onClick={() => setDraft(view.config)}>
            Discard
          </Button>
        ) : null}
        <span className={cx('dc-field__hint')}>Status: {TOURNAMENT_STATUS_LABELS[view.status]}</span>
      </div>
    </section>
  );
}
