/**
 * DAS Tanks sound design — procedural WebAudio through the shared synth (respects the
 * master/SFX volume and mute; silent until the first user gesture).
 */
import { synth } from '../../audio/audio.ts';
import type { BlastKind, WeaponId } from '@dascade/shared/games/tanks';

const last = new Map<string, number>();

function gate(name: string, gapMs: number): boolean {
  const now = performance.now();
  if (now - (last.get(name) ?? 0) < gapMs) return false;
  last.set(name, now);
  return true;
}

export const tankSfx = {
  fire(weapon: WeaponId): void {
    if (!gate('fire', 80)) return;
    const heavy = weapon === 'heavy';
    synth.noise({ dur: heavy ? 0.5 : 0.32, gain: heavy ? 0.5 : 0.36, freq: 1400, to: 90, type: 'lowpass', q: 0.8 });
    synth.tone({ type: 'square', freq: heavy ? 150 : 210, to: 45, dur: heavy ? 0.32 : 0.2, gain: 0.12 });
    if (weapon === 'dirt') synth.tone({ type: 'triangle', freq: 320, to: 120, dur: 0.18, gain: 0.08 });
  },
  whistle(durMs: number): void {
    if (!gate('whistle', 300)) return;
    const d = Math.min(4, Math.max(0.25, durMs / 1000));
    synth.tone({ type: 'sine', freq: 1500, to: 520, dur: d, gain: 0.035, attack: 0.08 });
  },
  boom(r: number, kind: BlastKind, terrain: 'crater' | 'dirt' | 'none'): void {
    if (!gate('boom', 70)) return;
    if (terrain === 'dirt') {
      synth.noise({ dur: 0.35, gain: 0.35, freq: 420, to: 80, type: 'lowpass' });
      synth.tone({ type: 'sine', freq: 90, to: 50, dur: 0.25, gain: 0.14 });
      return;
    }
    const big = Math.min(1, r / 70);
    const dur = 0.45 + big * 0.6;
    synth.noise({ dur, gain: 0.35 + big * 0.3, freq: kind === 'airburst' ? 2600 : 1600, to: 110, type: 'lowpass', q: 0.7 });
    synth.noise({ dur: 0.08, gain: 0.3, freq: 3500, q: 0.6 });
    synth.tone({ type: 'sine', freq: 70 + (1 - big) * 30, to: 32, dur: dur * 0.8, gain: 0.2 + big * 0.12 });
  },
  hit(): void {
    if (!gate('hit', 90)) return;
    synth.tone({ type: 'square', freq: 520, to: 180, dur: 0.12, gain: 0.07 });
    synth.noise({ dur: 0.1, gain: 0.18, freq: 5200, q: 2 });
  },
  drill(durMs: number): void {
    if (!gate('drill', 200)) return;
    synth.tone({ type: 'sawtooth', freq: 180, to: 260, dur: Math.max(0.2, durMs / 1000), gain: 0.05, detune: 12 });
    synth.noise({ dur: Math.max(0.2, durMs / 1000), gain: 0.12, freq: 900, q: 3 });
  },
  split(): void {
    if (!gate('split', 120)) return;
    synth.tone({ type: 'square', freq: 900, to: 1500, dur: 0.12, gain: 0.06 });
    synth.noise({ dur: 0.12, gain: 0.18, freq: 2400, q: 1.2 });
  },
  death(): void {
    if (!gate('death', 150)) return;
    synth.noise({ dur: 1.3, gain: 0.55, freq: 1200, to: 60, type: 'lowpass', q: 0.6 });
    synth.tone({ type: 'sine', freq: 55, to: 28, dur: 1.1, gain: 0.26 });
    [74, 67, 62].forEach((n, i) => synth.tone({ type: 'square', freq: synth.note(n), start: 0.12 + i * 0.1, dur: 0.14, gain: 0.04 }));
  },
  land(drop: number): void {
    if (!gate('land', 120)) return;
    synth.noise({ dur: 0.18, gain: Math.min(0.35, 0.12 + drop / 400), freq: 260, to: 70, type: 'lowpass' });
  },
  drive(): void {
    if (!gate('drive', 110)) return;
    synth.noise({ dur: 0.1, gain: 0.07, freq: 180, q: 1.5 });
    synth.tone({ type: 'sawtooth', freq: 58, dur: 0.08, gain: 0.025 });
  },
  aimTick(): void {
    if (!gate('aim', 45)) return;
    synth.tone({ type: 'square', freq: 1800, dur: 0.015, gain: 0.02 });
  },
  yourTurn(): void {
    if (!gate('turn', 400)) return;
    [76, 83, 88].forEach((n, i) => synth.tone({ type: 'square', freq: synth.note(n), start: i * 0.07, dur: 0.12, gain: 0.07 }));
  },
  lost(): void {
    if (!gate('lost', 300)) return;
    synth.tone({ type: 'sine', freq: 700, to: 300, dur: 0.3, gain: 0.03 });
  },
};
