/**
 * OPS-03 B — the preflight's go / no-go (pure, unit-tested). Each row is one thing that actually fails
 * on the night, with its state in words and an icon (never colour alone) and the fix next to it.
 * Live checks come from the server (crew only: uptime, commit, the loaded show, backup links, the
 * sound station, snapshots) and from this device (the stage window); what software can't see — what
 * Teams shows, the join link in the chat, the change freeze — is a manual confirmation.
 */
import { SHOWDOWN_STATION_TIMEOUT_MS, type ShowdownPreflightData } from '@dascade/shared/games/showdown';

export type CheckState = 'ok' | 'warn' | 'fail' | 'todo' | 'wait';
export type CheckId = 'stage' | 'share' | 'sound' | 'show' | 'backup' | 'server' | 'blackbox' | 'popups' | 'join' | 'freeze';
/** What the row's button does (the panel wires it). */
export type CheckAction = 'openStage' | 'confirm' | 'editRounds' | 'copyJoin' | 'crew';

export interface CheckRow {
  id: CheckId;
  label: string;
  state: CheckState;
  /** What we found, in words. */
  detail: string;
  /** How to fix it (shown when the row isn't ok). */
  fix?: string;
  /** A confirmation only a person can give. */
  manual: boolean;
  action?: CheckAction;
}

export const STATE_ICON: Record<CheckState, string> = { ok: '✓', warn: '!', fail: '✕', todo: '○', wait: '…' };
export const STATE_WORD: Record<CheckState, string> = { ok: 'OK', warn: 'Check', fail: 'Fix', todo: 'To confirm', wait: 'Checking' };

export type ManualId = 'share' | 'join' | 'freeze' | 'stage';
export type ManualConfirms = Partial<Record<ManualId, boolean>>;

export interface PreflightInput {
  /** The server's crew-only facts (null until the first answer). */
  data: ShowdownPreflightData | null;
  /** The room is an event room (the server's checks exist only there). */
  event: boolean;
  /** serverNow(). */
  now: number;
  /** This device runs the presenter console (it owns the stage window). */
  presenterDevice: boolean;
  stageOpen: boolean;
  /** The stage window opened at least once on this device (pop-ups are allowed). */
  stageOpened: boolean;
  /** Our last attempt to open it was blocked. */
  popupBlocked: boolean;
  /** The sound station as public state shows it. */
  station: { name: string; seenAt: number; ready: boolean | null };
  /** This device's own audio (outside event rooms the console is the sound). */
  local: { ready: boolean; muted: boolean; sounds: boolean };
  manual: ManualConfirms;
  /** Custom rounds the room holds (public), for rooms without server checks. */
  customRounds: number;
}

/** "3 h 12 min", "8 min", "45 s". */
export function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Ten minutes up = not recently deployed. */
export const SERVER_SETTLED_S = 600;

function soundRow(i: PreflightInput): CheckRow {
  const base = { id: 'sound' as const, label: 'Sound on the sharing device', manual: false };
  if (!i.event) {
    if (i.local.muted) return { ...base, state: 'fail', detail: 'Sound is muted on this console', fix: 'Unmute, then press Test sound' };
    if (!i.local.sounds)
      return { ...base, state: 'fail', detail: 'Show sounds are off on this console', fix: 'Turn show sounds on, then press Test sound' };
    if (!i.local.ready)
      return {
        ...base,
        state: 'fail',
        detail: 'The browser is waiting for a click before it plays sound',
        fix: 'Click anywhere on this page',
      };
    return { ...base, state: 'ok', detail: 'This console plays the show’s sound — share with “Include computer sound”' };
  }
  const name = i.station.name || 'The presenter’s console';
  const ago = i.station.seenAt > 0 ? i.now - i.station.seenAt : (i.data?.station.seenAgoMs ?? null);
  if (ago === null) {
    return i.data
      ? { ...base, state: 'fail', detail: `No heartbeat from ${name} yet`, fix: `Open ${name}’s page and click once on it` }
      : { ...base, state: 'wait', detail: 'Waiting for the sound station’s heartbeat…' };
  }
  const secs = Math.max(0, Math.round(ago / 1000));
  if (ago > SHOWDOWN_STATION_TIMEOUT_MS) {
    return {
      ...base,
      state: 'fail',
      detail: `${name}: last heard ${secs} s ago`,
      fix: `Check ${name} is online with the show open; the console takes over if it stays silent`,
    };
  }
  const ready = i.station.ready ?? i.data?.station.ready ?? false;
  if (!ready) {
    return {
      ...base,
      state: 'fail',
      detail: `${name} can’t play sound right now (muted, show sounds off, or waiting for a click)`,
      fix: `On ${name}: click the page, unmute, turn show sounds on, then press Test sound`,
    };
  }
  return { ...base, state: 'ok', detail: `Sound: ${name} ✓ heard ${secs} s ago` };
}

function showRow(i: PreflightInput): CheckRow {
  const base = { id: 'show' as const, label: 'Show loaded', manual: false, action: 'editRounds' as const };
  const rounds = i.data ? i.data.rounds : i.event ? null : i.customRounds;
  if (rounds === null) return { ...base, state: 'wait', detail: 'Asking the server…' };
  if (rounds === 0)
    return { ...base, state: 'fail', detail: 'No boards loaded', fix: 'Load your show file: Edit your rounds → Load show file' };
  const plural = `${rounds} round${rounds === 1 ? '' : 's'}`;
  if (i.data?.rehearsal)
    return { ...base, state: 'warn', detail: `The rehearsal’s practice boards (${plural})`, fix: 'For the real show, load your show file' };
  if (i.data && i.data.specials < rounds) {
    return {
      ...base,
      state: 'warn',
      detail: `${plural}, ${i.data.specials} with a special answer`,
      fix: 'Set each round’s special answer in Edit your rounds',
    };
  }
  return { ...base, state: 'ok', detail: `${plural}${i.data ? ' · special answer set' : ''} · not the rehearsal` };
}

function backupRow(i: PreflightInput): CheckRow {
  const base = { id: 'backup' as const, label: 'Backup presenter ready', manual: false, action: 'crew' as const };
  if (!i.data) return { ...base, state: 'wait', detail: 'Asking the server…' };
  const { issued, online } = i.data.backups;
  if (issued === 0)
    return {
      ...base,
      state: 'warn',
      detail: 'No backup presenter link yet',
      fix: 'Crew & log → create a Backup presenter link for your co-host',
    };
  if (online === 0)
    return {
      ...base,
      state: 'warn',
      detail: `${issued} backup link${issued === 1 ? '' : 's'}, nobody holding one is here`,
      fix: 'Ask your backup to open their link now',
    };
  return { ...base, state: 'ok', detail: `${online} backup presenter${online === 1 ? '' : 's'} here` };
}

function serverRow(i: PreflightInput): CheckRow {
  const base = { id: 'server' as const, label: 'Server healthy', manual: false };
  if (!i.data) return { ...base, state: 'wait', detail: 'Asking the server…' };
  const commit = i.data.commit ? `commit ${i.data.commit.slice(0, 7)}` : 'commit unknown';
  if (i.data.uptimeSeconds >= SERVER_SETTLED_S) {
    return { ...base, state: 'ok', detail: `Up ${formatUptime(i.data.uptimeSeconds)} · not recently deployed · ${commit}` };
  }
  return {
    ...base,
    state: 'warn',
    detail: `Restarted ${formatUptime(i.data.uptimeSeconds)} ago (a deploy or a restart) · ${commit}`,
    fix: 'Make sure nothing else deploys before the show: turn the change freeze on',
  };
}

function blackboxRow(i: PreflightInput): CheckRow {
  const base = { id: 'blackbox' as const, label: 'Black box available', manual: false };
  if (!i.data) return { ...base, state: 'wait', detail: 'Asking the server…' };
  return i.data.blackbox
    ? { ...base, state: 'ok', detail: 'Snapshots on: after a server restart the console brings the show back' }
    : {
        ...base,
        state: 'warn',
        detail: 'Snapshots are off (the server has no key): a restart would end the show',
        fix: 'Tell the site owner the server needs DASCADE_SAVE_SECRET',
      };
}

/** Every row, in the order the crew works through them. */
export function evaluatePreflight(i: PreflightInput): CheckRow[] {
  const rows: CheckRow[] = [];
  if (i.presenterDevice) {
    rows.push(
      i.stageOpen
        ? { id: 'stage', label: 'Share window', state: 'ok', detail: 'The stage window is open — share it in Teams', manual: false }
        : {
            id: 'stage',
            label: 'Share window',
            state: 'fail',
            detail: 'The stage window isn’t open',
            fix: 'Open stage window',
            manual: false,
            action: 'openStage',
          },
    );
  } else {
    rows.push({
      id: 'stage',
      label: 'Share window',
      state: i.manual.stage ? 'ok' : 'todo',
      detail: i.manual.stage ? 'The presenter confirmed the stage window is open' : 'Ask the presenter: is the stage window open?',
      manual: true,
      action: 'confirm',
    });
  }
  rows.push({
    id: 'share',
    label: 'Teams shows the stage',
    state: i.manual.share ? 'ok' : 'todo',
    detail: i.manual.share
      ? 'Confirmed: Teams shows the STAGE window'
      : 'A colleague confirms Teams shows the STAGE window, not this console',
    manual: true,
    action: 'confirm',
  });
  rows.push(soundRow(i), showRow(i));
  if (i.event) rows.push(backupRow(i), serverRow(i), blackboxRow(i));
  if (i.presenterDevice) {
    rows.push(
      i.stageOpen || i.stageOpened
        ? { id: 'popups', label: 'Pop-ups allowed', state: 'ok', detail: 'The stage window opened', manual: false }
        : i.popupBlocked
          ? {
              id: 'popups',
              label: 'Pop-ups allowed',
              state: 'fail',
              detail: 'The browser blocked the stage window',
              fix: 'Allow pop-ups for this site (the icon at the end of the address bar), then Open stage window again',
              manual: false,
              action: 'openStage',
            }
          : {
              id: 'popups',
              label: 'Pop-ups allowed',
              state: 'wait',
              detail: 'Checked when the stage window opens',
              manual: false,
              action: 'openStage',
            },
    );
  }
  rows.push(
    {
      id: 'join',
      label: 'Join link posted',
      state: i.manual.join ? 'ok' : 'todo',
      detail: i.manual.join ? 'Posted in the meeting chat' : 'Post the join link in the meeting chat',
      manual: true,
      action: 'confirm',
    },
    {
      id: 'freeze',
      label: 'Change freeze on',
      state: i.manual.freeze ? 'ok' : 'todo',
      detail: i.manual.freeze ? 'No deploys until the show is over' : 'Run the freeze so nothing deploys during the show',
      manual: true,
      action: 'confirm',
    },
  );
  return rows;
}

export type Verdict = 'go' | 'go-warn' | 'nogo' | 'notready';

export interface PreflightSummary {
  verdict: Verdict;
  /** "GO", "NO-GO", "NOT READY". */
  headline: string;
  sub: string;
}

export function preflightSummary(rows: readonly CheckRow[]): PreflightSummary {
  const count = (s: CheckState) => rows.filter((r) => r.state === s).length;
  const fails = count('fail');
  if (fails)
    return {
      verdict: 'nogo',
      headline: 'NO-GO',
      sub: `Fix ${fails === 1 ? 'the item' : `the ${fails} items`} marked ✕, then check again.`,
    };
  const open = count('todo') + count('wait');
  if (open) return { verdict: 'notready', headline: 'NOT READY', sub: `${rows.length - open} of ${rows.length} confirmed.` };
  const warns = count('warn');
  if (warns)
    return { verdict: 'go-warn', headline: 'GO', sub: `Ready, with ${warns} thing${warns === 1 ? '' : 's'} to keep an eye on (marked !).` };
  return { verdict: 'go', headline: 'GO', sub: 'Everything checks out. Open the doors.' };
}

// ---------------------------------------------------------------------------
// Manual confirmations: remembered per room on this device for a day
// ---------------------------------------------------------------------------

const KEY = (code: string) => `dascade:showdown:preflight:${code}`;
const TTL_MS = 24 * 3600_000;

export function loadManual(code: string): ManualConfirms {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(code)) ?? 'null') as { savedAt?: unknown; confirms?: unknown } | null;
    if (!raw || typeof raw.savedAt !== 'number' || Date.now() - raw.savedAt > TTL_MS || !raw.confirms || typeof raw.confirms !== 'object')
      return {};
    const out: ManualConfirms = {};
    for (const id of ['share', 'join', 'freeze', 'stage'] as const)
      if ((raw.confirms as Record<string, unknown>)[id] === true) out[id] = true;
    return out;
  } catch {
    return {};
  }
}

export function saveManual(code: string, confirms: ManualConfirms): void {
  try {
    localStorage.setItem(KEY(code), JSON.stringify({ savedAt: Date.now(), confirms }));
  } catch {
    /* storage unavailable: the confirmations last until reload */
  }
}
