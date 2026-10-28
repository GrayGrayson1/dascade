/**
 * The audit log in plain words (pure, unit-tested): "Ravi P. (Moderator) renamed “xXghostXx” to
 * “Zoe H.”". Entries come from the server (ShowdownAuditEntry); names were cleaned there and are
 * rendered as React text. Nothing here ever holds a secret (the server never logs one).
 */
import {
  SHOWDOWN_REROLL_INFO,
  SHOWDOWN_ROLE_INFO,
  type ShowdownAuditAction,
  type ShowdownAuditEntry,
  type ShowdownRerollReason,
} from '@dascade/shared/games/showdown';

const ROLE_WORDS: Record<string, string> = {
  presenter: SHOWDOWN_ROLE_INFO.presenter.title,
  producer: SHOWDOWN_ROLE_INFO.producer.title,
  backup: SHOWDOWN_ROLE_INFO.backup.title,
  moderator: SHOWDOWN_ROLE_INFO.moderator.title,
  guest: 'Guest',
  server: 'Server',
};

/** A role as a word ("Backup presenter"); unknown roles read as they are. */
export function roleWord(role: string): string {
  return ROLE_WORDS[role] ?? (role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Guest');
}

/** Who acted: their name, or "The server" for automatic entries. */
export function auditActor(e: Pick<ShowdownAuditEntry, 'actorId' | 'actorName' | 'role'>): string {
  if (e.role === 'server') return 'The server';
  return e.actorName || 'Someone';
}

/** The actor's role as a word, or '' for the server itself. */
export function auditRole(e: Pick<ShowdownAuditEntry, 'role'>): string {
  return e.role === 'server' ? '' : roleWord(e.role);
}

/** The target as a name ("Priya S."), or '' (raw ids are never shown). */
export function auditTarget(e: Pick<ShowdownAuditEntry, 'target' | 'targetName'>): string {
  return e.targetName || '';
}

const roleOf = (value: string | undefined) => (value ? roleWord(value).toLowerCase() : '');
const quote = (s: string) => `“${s}”`;

/** A reroll's reason in words ("No answer"); free text as it is. */
export function auditReason(e: Pick<ShowdownAuditEntry, 'reason'>): string {
  const r = e.reason ?? '';
  return (SHOWDOWN_REROLL_INFO as Record<string, string | undefined>)[r as ShowdownRerollReason] ?? r;
}

/** What happened, in plain words, without the actor ("renamed “Ghost” to “Zoe H.”"). */
export function auditWords(e: ShowdownAuditEntry): string {
  const who = auditTarget(e);
  const them = who || 'someone';
  const action: ShowdownAuditAction = e.action;
  switch (action) {
    case 'event.start':
      return `made this an event room${e.after ? ` (${e.after})` : ''}`;
    case 'preset.load':
      return `loaded the preset${e.after ? ` ${quote(e.after)}` : who ? ` ${quote(who)}` : ''}`;
    case 'crew.issue': {
      const role = roleOf(e.after) || 'crew';
      return `issued a ${role} link${who ? ` for ${who}` : ''}`;
    }
    case 'crew.revoke': {
      const role = roleOf(e.before) || roleOf(e.after);
      return `revoked ${who ? `${who}’s ` : 'a '}${role ? `${role} ` : 'crew '}link`;
    }
    case 'crew.claim': {
      const role = roleOf(e.after);
      return `opened ${role ? `a ${role}` : 'a crew'} link${who ? ` (${who})` : ''}`;
    }
    case 'crew.refused':
      return 'tried a crew link — refused';
    case 'presenter.claim':
      return 'took the presenter seat with the presenter link';
    case 'presenter.refused':
      return 'tried to take the presenter seat — refused';
    case 'presenter.assign':
      return `made ${them} the presenter${e.before ? ` (was ${e.before})` : ''}`;
    case 'presenter.handover':
      return `handed the show to ${them}`;
    case 'presenter.takeover':
      return 'took over as presenter';
    case 'people.rename':
      return e.before || e.after ? `renamed ${quote(e.before || them)} to ${quote(e.after || '?')}` : `renamed ${them}`;
    case 'people.hide':
      return `hid ${them} from the stage and the picker`;
    case 'people.unhide':
      return `put ${them} back on the stage`;
    case 'picker.draw':
      return `drew ${them}${drawDetail(e)}`;
    case 'picker.done':
      return `marked ${who ? `${who}’s` : 'the'} turn done`;
    case 'picker.noAnswer':
      return `no answer from ${them} — back in the pool`;
    case 'picker.reroll':
      // The entry names the redraw's winner (the person rerolled went back in the pool).
      return `rerolled and drew ${them}${drawDetail(e)}`;
    case 'picker.choose':
      return `spotlighted ${them} by name${e.before ? ` (${e.before})` : ''}`;
    case 'picker.exclude':
      return `took ${them} out of the random draw`;
    case 'picker.include':
      return who === 'Everyone' ? 'put everyone back in the random draw' : `put ${them} back in the random draw`;
    case 'scores.export':
      return `downloaded the scores${e.after ? ` (${e.after})` : ''}`;
    case 'credit.remove':
      return `took ${who ? `${who}’s` : 'a'} hot-seat credit off ${e.before || 'a tile'}`;
    case 'audio.station':
      return `moved the sound station to ${e.after || who || 'the presenter’s console'}`;
    case 'audio.failover':
      return `lost the sound station${e.before ? ` (${e.before})` : ''} — the presenter’s console plays the sound`;
    case 'show.end':
      return 'ended the show';
    case 'show.restored':
      return 'restored the show after a server restart';
    default:
      return String(action);
  }
}

/** " (draw 3, 12 in the pool)" from a draw entry's before/after. */
function drawDetail(e: Pick<ShowdownAuditEntry, 'before' | 'after'>): string {
  const parts = [e.after, e.before].filter(Boolean);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

/** The whole entry as one sentence (for screen readers and the live region). */
export function auditSentence(e: ShowdownAuditEntry): string {
  const actor = auditActor(e);
  const role = auditRole(e) ? ` (${auditRole(e)})` : '';
  const reason = auditReason(e);
  return `${actor}${role} ${auditWords(e)}${reason ? `. Reason: ${reason}` : ''}`;
}

/** "21:04:09" in the viewer's local time. */
export function auditTime(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Newest first, the order the panel lists them in. */
export function newestFirst(entries: readonly ShowdownAuditEntry[]): ShowdownAuditEntry[] {
  return [...entries].sort((a, b) => b.seq - a.seq);
}

/** The audit download's file name: `dasoween-audit-<code>.json`. */
export function auditFileName(code: string): string {
  return `dasoween-audit-${code.replace(/[^A-Za-z0-9]/g, '') || 'room'}.json`;
}

/** "in 23 h", "in 40 min", "now" — how long until a server epoch time. */
export function untilWords(at: number, now: number): string {
  const ms = at - now;
  if (ms <= 60_000) return ms <= 0 ? 'now' : 'in under a minute';
  const min = Math.round(ms / 60_000);
  return min < 60 ? `in ${min} min` : `in ${Math.round(min / 60)} h`;
}
