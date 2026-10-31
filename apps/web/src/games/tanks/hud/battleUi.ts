/**
 * The presenter's low-frequency UI snapshot (hit points, shields and the last script as the
 * battlefield shows them — they drop when the shell lands, not when the server resolved it),
 * read through one normalizing hook so the HUD never depends on playback internals.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { useTanks } from '../context.ts';

export interface LastScript {
  seq: number;
  kind: 'shot' | 'volley' | 'hazard';
  shooters: string[];
  damage: Record<string, number>;
  kills: Array<{ by: string; id: string }>;
}

export interface BattleUi {
  version: number;
  hp: Record<string, number>;
  alive: Record<string, boolean>;
  shield: Record<string, number>;
  playing: boolean;
  lastShot: LastScript | null;
}

const EMPTY: Record<string, never> = {};

function record<T>(v: unknown): Record<string, T> {
  return v && typeof v === 'object' ? (v as Record<string, T>) : (EMPTY as Record<string, T>);
}

/** Normalize whatever the presenter publishes into the BattleUi shape (pure; unit tested). */
export function normalizeUi(raw: unknown): BattleUi {
  const u = record<unknown>(raw);
  const shot = u.lastShot && typeof u.lastShot === 'object' ? (u.lastShot as Record<string, unknown>) : null;
  let lastShot: LastScript | null = null;
  if (shot) {
    const shooters = Array.isArray(shot.shooters)
      ? (shot.shooters as string[])
      : typeof shot.shooterId === 'string'
        ? [shot.shooterId]
        : [];
    const dmg = shot.damage;
    const damage: Record<string, number> = typeof dmg === 'number' ? (shooters[0] ? { [shooters[0]]: dmg } : {}) : record<number>(dmg);
    const kills = Array.isArray(shot.kills)
      ? (shot.kills as unknown[]).map((k) => (typeof k === 'string' ? { by: shooters[0] ?? '', id: k } : (k as { by: string; id: string })))
      : [];
    const kind = shot.kind === 'volley' || shot.kind === 'hazard' ? shot.kind : 'shot';
    lastShot = { seq: Number(shot.seq) || 0, kind, shooters, damage, kills };
  }
  return {
    version: Number(u.version) || 0,
    hp: record<number>(u.hp),
    alive: record<boolean>(u.alive),
    shield: record<number>(u.shield),
    playing: Boolean(u.playing),
    lastShot,
  };
}

export function useBattleUi(): BattleUi {
  const { presenter } = useTanks();
  const raw = useSyncExternalStore(presenter.subscribeUi, presenter.getUi, presenter.getUi);
  return useMemo(() => normalizeUi(raw), [raw]);
}

/** One line for the shot callout ("Ada dealt 45 damage", "Volley: 120 damage, 2 KOs", "Meteor strike!"). */
export function describeScript(shot: LastScript, nameOf: (id: string) => string): { text: string; tone: 'hit' | 'miss' | 'ko' } {
  const total = Object.values(shot.damage).reduce((a, b) => a + (b > 0 ? b : 0), 0);
  const kos = shot.kills.map((k) => nameOf(k.id)).filter(Boolean);
  const tone: 'hit' | 'miss' | 'ko' = kos.length ? 'ko' : total > 0 ? 'hit' : 'miss';
  if (shot.kind === 'hazard') {
    if (kos.length) return { text: `The sky took out ${kos.join(' & ')}!`, tone };
    return { text: total > 0 ? 'Hazard strike — everyone duck!' : 'Hazard strike — nobody hurt', tone };
  }
  if (shot.kind === 'volley') {
    if (shot.shooters.length === 0) return { text: 'Nobody locked in — no shots this volley', tone: 'miss' };
    const parts = [`Volley: ${shot.shooters.length} shot${shot.shooters.length === 1 ? '' : 's'}`];
    parts.push(total > 0 ? `${total} damage` : 'no hits');
    if (kos.length) parts.push(`${kos.join(' & ')} destroyed`);
    return { text: parts.join(' · '), tone };
  }
  const name = nameOf(shot.shooters[0] ?? '') || 'Someone';
  if (kos.length) return { text: `${name} destroyed ${kos.join(' & ')}!`, tone };
  return { text: total > 0 ? `${name} dealt ${total} damage` : `${name} missed`, tone };
}
