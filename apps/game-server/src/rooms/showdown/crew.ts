/**
 * Crew links for a Survey Showdown event room (ADM-03 B's smallest slice: the room keeps them in
 * memory, not a platform service).
 *
 * A link is `<id>.<secret>`: the id names the record, the secret (≥ 128 random bits) proves it. Only
 * a SHA-256 hash of the secret is kept, compared in constant time; links expire with the event (24 h)
 * and can be revoked. Claiming a link binds its role to that seat; a second device moves it. Nothing
 * here is ever logged or put in synchronized state.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { SHOWDOWN_CREW_LINK, type ShowdownCrewLinkView, type ShowdownCrewRole } from '@dascade/shared/games/showdown';
import { randomId, type Rng } from '@dascade/shared';

export const CREW_LINK_TTL_MS = 24 * 3600_000;
/** Links one event room may mint (a party crew is a handful of people). */
export const CREW_LINKS_MAX = 40;

export interface CrewLinkRecord {
  id: string;
  role: ShowdownCrewRole;
  name: string;
  secretHash: string;
  issuedAt: number;
  expiresAt: number;
  revoked: boolean;
  /** The seat holding it ('' = nobody yet). */
  holderId: string;
}

export type CrewVerify = { ok: true; link: CrewLinkRecord } | { ok: false; reason: 'malformed' | 'unknown' | 'revoked' | 'expired' };

function hashSecret(secret: string): string {
  return createHash('sha256').update(`dascade-crew:${secret}`).digest('base64url');
}

function sameHash(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export class CrewBook {
  private readonly links = new Map<string, CrewLinkRecord>();

  constructor(private readonly rng: Rng) {}

  get size(): number {
    return this.links.size;
  }

  /** Mint a link; the full `<id>.<secret>` is returned once and never stored. */
  issue(role: ShowdownCrewRole, name: string, now = Date.now()): { record: CrewLinkRecord; link: string } | null {
    if ([...this.links.values()].filter((l) => !l.revoked).length >= CREW_LINKS_MAX) return null;
    // Revoked links don't count, and the oldest revoked one makes room when the book is full.
    if (this.links.size >= CREW_LINKS_MAX * 2) {
      const oldest = [...this.links.values()].find((l) => l.revoked);
      if (oldest) this.links.delete(oldest.id);
    }
    let id = randomId(10, this.rng);
    while (this.links.has(id)) id = randomId(10, this.rng);
    // 32 URL-safe characters ≈ 190 bits.
    const secret = randomId(32, this.rng);
    const record: CrewLinkRecord = {
      id,
      role,
      name,
      secretHash: hashSecret(secret),
      issuedAt: now,
      expiresAt: now + CREW_LINK_TTL_MS,
      revoked: false,
      holderId: '',
    };
    this.links.set(id, record);
    return { record, link: `${id}.${secret}` };
  }

  verify(link: string, now = Date.now()): CrewVerify {
    const match = SHOWDOWN_CREW_LINK.exec(link);
    if (!match) return { ok: false, reason: 'malformed' };
    const record = this.links.get(match[1]!);
    // Unknown ids still cost a hash, so timing doesn't tell ids apart.
    const hash = hashSecret(match[2]!);
    if (!record || !sameHash(record.secretHash, hash)) return { ok: false, reason: 'unknown' };
    if (record.revoked) return { ok: false, reason: 'revoked' };
    if (now > record.expiresAt) return { ok: false, reason: 'expired' };
    return { ok: true, link: record };
  }

  revoke(id: string): CrewLinkRecord | null {
    const record = this.links.get(id);
    if (!record || record.revoked) return null;
    record.revoked = true;
    return record;
  }

  get(id: string): CrewLinkRecord | undefined {
    return this.links.get(id);
  }

  /** Crew roles a seat holds right now (live links only). */
  rolesOf(playerId: string, now = Date.now()): ShowdownCrewRole[] {
    if (!playerId) return [];
    const roles = new Set<ShowdownCrewRole>();
    for (const l of this.links.values()) if (l.holderId === playerId && !l.revoked && now <= l.expiresAt) roles.add(l.role);
    return [...roles];
  }

  /** Every live link held by this seat (e.g. to move them when the seat goes). */
  heldBy(playerId: string): CrewLinkRecord[] {
    return [...this.links.values()].filter((l) => l.holderId === playerId && !l.revoked);
  }

  all(): CrewLinkRecord[] {
    return [...this.links.values()];
  }

  view(nameOf: (id: string) => string, online: (id: string) => boolean): ShowdownCrewLinkView[] {
    return this.all().map((l) => ({
      id: l.id,
      role: l.role,
      name: l.name,
      holderId: l.holderId,
      holderName: l.holderId ? nameOf(l.holderId) : '',
      online: l.holderId ? online(l.holderId) : false,
      revoked: l.revoked,
      expiresAt: l.expiresAt,
    }));
  }

  /** For the black box (hashes only). */
  export(): CrewLinkRecord[] {
    return this.all().map((l) => ({ ...l }));
  }

  import(records: readonly CrewLinkRecord[]): void {
    this.links.clear();
    for (const r of records.slice(0, CREW_LINKS_MAX * 2)) this.links.set(r.id, { ...r });
  }
}
