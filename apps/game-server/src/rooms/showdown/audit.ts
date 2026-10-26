/**
 * The event room's audit trail (NN-06): append-only, in memory, capped, never synchronized. Crew with
 * `audit.read` see the latest entries; the producer can export the whole log. It leaves with the room.
 * The server log gets one line per entry with ids only — never names, secrets or answers.
 */
import type { ShowdownAuditAction, ShowdownAuditEntry } from '@dascade/shared/games/showdown';
import { log } from '../../lib/log.ts';

export const AUDIT_MAX = 1000;
/** Entries pushed to crew consoles on each change. */
export const AUDIT_VIEW = 60;

export type AuditInput = Omit<ShowdownAuditEntry, 'seq' | 'at'>;

export class AuditLog {
  private entries: ShowdownAuditEntry[] = [];
  private seq = 0;
  /** Changed since the last push to crew consoles. */
  dirty = false;

  constructor(private readonly room: () => string) {}

  add(entry: AuditInput, now = Date.now()): ShowdownAuditEntry {
    const full: ShowdownAuditEntry = { seq: ++this.seq, at: now, ...entry };
    this.entries.push(full);
    if (this.entries.length > AUDIT_MAX) this.entries.splice(0, this.entries.length - AUDIT_MAX);
    this.dirty = true;
    log.info('showdown audit', {
      room: this.room(),
      seq: full.seq,
      action: full.action,
      actor: full.actorId || 'server',
      target: full.target ?? '',
    });
    return full;
  }

  latest(n = AUDIT_VIEW): ShowdownAuditEntry[] {
    return this.entries.slice(-n);
  }

  all(): ShowdownAuditEntry[] {
    return [...this.entries];
  }

  get total(): number {
    return this.seq;
  }

  count(action: ShowdownAuditAction): number {
    return this.entries.filter((e) => e.action === action).length;
  }

  /** For the black box. */
  export(n: number): { seq: number; entries: ShowdownAuditEntry[] } {
    return { seq: this.seq, entries: this.entries.slice(-n) };
  }

  import(data: { seq: number; entries: ShowdownAuditEntry[] }): void {
    this.entries = data.entries.slice(-AUDIT_MAX);
    this.seq = Math.max(data.seq, this.entries.at(-1)?.seq ?? 0);
    this.dirty = true;
  }
}
