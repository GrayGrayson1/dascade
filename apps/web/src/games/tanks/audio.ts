/**
 * DAS Tanks sound design — procedural WebAudio through the shared synth (respects the
 * master/SFX volume and mute; silent until the first user gesture). Every weapon family has
 * its own voice: shells thump, nukes rumble, napalm whooshes and sizzles, rollers grind,
 * railguns zap, the Sky Lance charges and strikes, warps shimmer, shields hum and shatter.
 */
import { synth } from '../../audio/audio.ts';
import type { BeamKind, BlastKind, WeaponId } from '@dascade/shared/games/tanks';

const last = new Map<string, number>();

function gate(name: string, gapMs: number): boolean {
  const now = performance.now();
  if (now - (last.get(name) ?? 0) < gapMs) return false;
  last.set(name, now);
  return true;
}

const NUKES = new Set<string>(['nuke', 'mininuke']);
const EARTH = new Set<string>(['dirtclod', 'dirtball', 'tonofdirt', 'mudslide', 'excavator']);

/** Short repeated noise bursts — a loop that never holds a node open (napalm crackle, roller grind). */
function crackle(durS: number, every: number, opts: { gain: number; freq: number; q: number }): void {
  const n = Math.max(1, Math.min(60, Math.round(durS / every)));
  for (let i = 0; i < n; i++) {
    const k = 1 - i / n;
    synth.noise({
      start: i * every + Math.random() * every * 0.4,
      dur: every * 0.9,
      gain: opts.gain * (0.4 + 0.6 * k),
      freq: opts.freq * (0.8 + Math.random() * 0.4),
      q: opts.q,
    });
  }
}

export const tankSfx = {
  fire(weapon: WeaponId): void {
    if (!gate('fire', 80)) return;
    if (weapon === 'railgun') {
      synth.tone({ type: 'sawtooth', freq: 220, to: 1800, dur: 0.12, gain: 0.06 });
      return;
    }
    if (weapon === 'warp') {
      synth.tone({ type: 'sine', freq: 400, to: 1200, dur: 0.25, gain: 0.07 });
      synth.tone({ type: 'triangle', freq: 600, to: 1800, dur: 0.22, gain: 0.04, detune: 14 });
      return;
    }
    if (weapon === 'tracer') {
      synth.noise({ dur: 0.12, gain: 0.14, freq: 2400, q: 1.2 });
      synth.tone({ type: 'square', freq: 1200, to: 900, dur: 0.06, gain: 0.03 });
      return;
    }
    const heavy = weapon === 'heavy' || weapon === 'heavyroller' || NUKES.has(weapon);
    synth.noise({ dur: heavy ? 0.55 : 0.32, gain: heavy ? 0.52 : 0.36, freq: 1400, to: 80, type: 'lowpass', q: 0.8 });
    synth.tone({ type: 'square', freq: heavy ? 140 : 210, to: 42, dur: heavy ? 0.36 : 0.2, gain: 0.12 });
    if (EARTH.has(weapon)) synth.tone({ type: 'triangle', freq: 320, to: 120, dur: 0.18, gain: 0.08 });
    if (weapon === 'napalm' || weapon === 'hotnapalm') synth.noise({ start: 0.05, dur: 0.3, gain: 0.12, freq: 800, to: 2400, q: 0.7 });
    if (weapon === 'seeker') synth.noise({ start: 0.05, dur: 0.5, gain: 0.1, freq: 3000, to: 1500, q: 0.9 });
  },
  whistle(durMs: number, weapon?: WeaponId | string): void {
    if (!gate('whistle', 300)) return;
    const d = Math.min(4, Math.max(0.25, durMs / 1000));
    const low = weapon === 'nuke' || weapon === 'mininuke' || weapon === 'heavy';
    synth.tone({ type: 'sine', freq: low ? 1000 : 1500, to: low ? 300 : 520, dur: d, gain: 0.035, attack: 0.08 });
  },
  boom(r: number, kind: BlastKind, terrain: 'crater' | 'dirt' | 'none'): void {
    if (r <= 0) return;
    if (NUKES.has(kind)) {
      if (!gate('nuke', 200)) return;
      const full = kind === 'nuke';
      // A sharp crack, then a long rolling rumble that sinks out of hearing.
      synth.noise({ dur: 0.18, gain: 0.5, freq: 4000, q: 0.5 });
      synth.noise({ dur: full ? 3.6 : 2.6, gain: 0.6, freq: 900, to: 40, type: 'lowpass', q: 0.6 });
      synth.tone({ type: 'sine', freq: 60, to: 22, dur: full ? 3.2 : 2.4, gain: 0.32 });
      synth.tone({ type: 'sine', freq: 45, to: 20, dur: full ? 3.8 : 2.8, gain: 0.2, start: 0.1 });
      crackle(full ? 2.2 : 1.5, 0.09, { gain: 0.08, freq: 600, q: 1.4 });
      return;
    }
    if (!gate('boom', 70)) return;
    if (terrain === 'dirt' || kind === 'mudslide') {
      synth.noise({ dur: 0.35, gain: 0.35, freq: 420, to: 80, type: 'lowpass' });
      synth.tone({ type: 'sine', freq: 90, to: 50, dur: 0.25, gain: 0.14 });
      return;
    }
    if (kind === 'excavator') {
      synth.noise({ dur: 0.5, gain: 0.3, freq: 600, to: 120, type: 'lowpass', q: 0.6 });
      synth.tone({ type: 'triangle', freq: 120, to: 60, dur: 0.3, gain: 0.08 });
      return;
    }
    if (kind === 'confetti' || kind === 'popper') {
      synth.noise({ dur: 0.16, gain: 0.24, freq: 2600, q: 1.1 });
      synth.tone({ type: 'square', freq: 700 + Math.random() * 500, to: 1600, dur: 0.08, gain: 0.04 });
      return;
    }
    if (kind === 'lightning') {
      synth.noise({ dur: 0.9, gain: 0.5, freq: 3200, to: 200, type: 'lowpass', q: 0.5 });
      return;
    }
    const big = Math.min(1, r / 70);
    const dur = 0.45 + big * 0.6;
    synth.noise({ dur, gain: 0.35 + big * 0.3, freq: kind === 'airburst' ? 2600 : 1600, to: 110, type: 'lowpass', q: 0.7 });
    synth.noise({ dur: 0.08, gain: 0.3, freq: 3500, q: 0.6 });
    synth.tone({ type: 'sine', freq: 70 + (1 - big) * 30, to: 32, dur: dur * 0.8, gain: 0.2 + big * 0.12 });
    if (kind === 'meteor') synth.noise({ dur: 0.6, gain: 0.2, freq: 300, to: 60, type: 'lowpass' });
  },
  hit(): void {
    if (!gate('hit', 90)) return;
    synth.tone({ type: 'square', freq: 520, to: 180, dur: 0.12, gain: 0.07 });
    synth.noise({ dur: 0.1, gain: 0.18, freq: 5200, q: 2 });
  },
  burn(): void {
    if (!gate('burn', 160)) return;
    synth.noise({ dur: 0.22, gain: 0.14, freq: 1800, q: 1.6 });
    synth.tone({ type: 'sawtooth', freq: 300, to: 200, dur: 0.12, gain: 0.03 });
  },
  napalm(durMs: number, hot: boolean): void {
    if (!gate('napalm', 250)) return;
    // Whoosh of ignition, then a crackling burn for the fire's life.
    synth.noise({ dur: 0.7, gain: hot ? 0.34 : 0.28, freq: 400, to: hot ? 3600 : 2600, q: 0.6, attack: 0.08 });
    synth.tone({ type: 'sine', freq: 90, to: 55, dur: 0.6, gain: 0.1 });
    crackle(Math.min(5, durMs / 1000), hot ? 0.07 : 0.09, { gain: hot ? 0.08 : 0.07, freq: hot ? 3000 : 2200, q: 2.2 });
  },
  roll(): void {
    if (!gate('roll', 140)) return;
    synth.noise({ dur: 0.16, gain: 0.08, freq: 220, q: 2 });
    synth.tone({ type: 'triangle', freq: 70 + Math.random() * 20, dur: 0.12, gain: 0.03 });
  },
  drill(durMs: number): void {
    if (!gate('drill', 200)) return;
    synth.tone({ type: 'sawtooth', freq: 180, to: 260, dur: Math.max(0.2, durMs / 1000), gain: 0.05, detune: 12 });
    synth.noise({ dur: Math.max(0.2, durMs / 1000), gain: 0.12, freq: 900, q: 3 });
  },
  split(w?: WeaponId): void {
    if (!gate('split', 120)) return;
    const mirv = w === 'mirv';
    synth.tone({ type: 'square', freq: mirv ? 600 : 900, to: mirv ? 1100 : 1500, dur: 0.12, gain: 0.06 });
    synth.noise({ dur: 0.12, gain: 0.18, freq: 2400, q: 1.2 });
    if (w === 'popper')
      [84, 88, 91].forEach((n, i) => synth.tone({ type: 'square', freq: synth.note(n), start: i * 0.04, dur: 0.06, gain: 0.04 }));
  },
  beam(w: BeamKind): void {
    if (!gate(`beam-${w}`, 120)) return;
    if (w === 'railgun') {
      // A rising whine snapped off by a crack.
      synth.tone({ type: 'sawtooth', freq: 1800, to: 120, dur: 0.35, gain: 0.08 });
      synth.noise({ dur: 0.2, gain: 0.3, freq: 5000, q: 0.8 });
      synth.tone({ type: 'square', freq: 2400, to: 2200, dur: 0.05, gain: 0.04 });
    } else if (w === 'skylance') {
      synth.noise({ dur: 1.2, gain: 0.45, freq: 2000, to: 90, type: 'lowpass', q: 0.6 });
      synth.tone({ type: 'sawtooth', freq: 110, to: 40, dur: 0.9, gain: 0.12 });
      synth.tone({ type: 'sine', freq: 880, to: 220, dur: 0.6, gain: 0.05 });
    } else {
      // Lightning: a tearing crack, then thunder.
      synth.noise({ dur: 0.12, gain: 0.5, freq: 6000, q: 0.4 });
      synth.noise({ start: 0.05, dur: 1.6, gain: 0.4, freq: 600, to: 50, type: 'lowpass', q: 0.5 });
    }
  },
  lanceMark(): void {
    if (!gate('mark', 200)) return;
    // Charging hum while the orbital strike lines up.
    synth.tone({ type: 'sine', freq: 220, to: 880, dur: 0.85, gain: 0.05, attack: 0.1 });
    synth.tone({ type: 'square', freq: 1320, start: 0.1, dur: 0.05, gain: 0.03 });
    synth.tone({ type: 'square', freq: 1320, start: 0.4, dur: 0.05, gain: 0.03 });
    synth.tone({ type: 'square', freq: 1320, start: 0.7, dur: 0.05, gain: 0.03 });
  },
  shieldUp(): void {
    if (!gate('shield-up', 200)) return;
    synth.tone({ type: 'sine', freq: 300, to: 900, dur: 0.35, gain: 0.07 });
    synth.tone({ type: 'triangle', freq: 450, to: 1350, dur: 0.35, gain: 0.04, detune: 10 });
  },
  shieldHit(): void {
    if (!gate('shield-hit', 90)) return;
    synth.tone({ type: 'sine', freq: 1200, to: 600, dur: 0.18, gain: 0.07 });
    synth.noise({ dur: 0.1, gain: 0.12, freq: 4000, q: 3 });
  },
  shieldBreak(): void {
    if (!gate('shield-break', 150)) return;
    synth.noise({ dur: 0.5, gain: 0.3, freq: 5000, to: 900, q: 1.4 });
    [88, 84, 79, 76].forEach((n, i) => synth.tone({ type: 'triangle', freq: synth.note(n), start: i * 0.04, dur: 0.12, gain: 0.04 }));
  },
  deflect(): void {
    if (!gate('deflect', 120)) return;
    synth.tone({ type: 'square', freq: 1600, to: 2400, dur: 0.08, gain: 0.06 });
    synth.tone({ type: 'sine', freq: 2400, to: 900, dur: 0.25, gain: 0.05 });
  },
  chute(): void {
    if (!gate('chute', 200)) return;
    synth.noise({ dur: 0.18, gain: 0.22, freq: 900, q: 0.8 });
    synth.tone({ type: 'triangle', freq: 500, to: 700, dur: 0.1, gain: 0.05 });
  },
  warp(): void {
    if (!gate('warp', 200)) return;
    synth.tone({ type: 'sine', freq: 1600, to: 200, dur: 0.4, gain: 0.08 });
    synth.tone({ type: 'sine', freq: 200, to: 1600, dur: 0.4, gain: 0.06, start: 0.15 });
    synth.noise({ dur: 0.5, gain: 0.08, freq: 3000, q: 4 });
  },
  portal(): void {
    if (!gate('portal', 150)) return;
    synth.tone({ type: 'sine', freq: 900, to: 1500, dur: 0.15, gain: 0.05 });
  },
  mud(): void {
    if (!gate('mud', 300)) return;
    synth.noise({ dur: 0.9, gain: 0.22, freq: 260, to: 90, type: 'lowpass', q: 1.2 });
    crackle(0.8, 0.12, { gain: 0.05, freq: 400, q: 3 });
  },
  quip(): void {
    if (!gate('quip', 180)) return;
    synth.tone({ type: 'square', freq: 980, to: 1180, dur: 0.05, gain: 0.025 });
    synth.tone({ type: 'square', freq: 1180, to: 900, dur: 0.05, gain: 0.02, start: 0.06 });
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
  /** Volley: everyone's aim window opens. */
  volley(): void {
    if (!gate('volley', 400)) return;
    [72, 79, 84, 91].forEach((n, i) => synth.tone({ type: 'square', freq: synth.note(n), start: i * 0.05, dur: 0.1, gain: 0.06 }));
  },
  lockIn(): void {
    if (!gate('lock', 150)) return;
    synth.tone({ type: 'square', freq: 660, dur: 0.05, gain: 0.06 });
    synth.tone({ type: 'square', freq: 990, start: 0.05, dur: 0.08, gain: 0.06 });
  },
  battery(): void {
    if (!gate('battery', 200)) return;
    [60, 64, 67, 72].forEach((n, i) => synth.tone({ type: 'triangle', freq: synth.note(n + 12), start: i * 0.05, dur: 0.1, gain: 0.05 }));
  },
  fuel(): void {
    if (!gate('fuel', 200)) return;
    synth.noise({ dur: 0.4, gain: 0.12, freq: 700, to: 300, q: 2 });
    synth.tone({ type: 'sine', freq: 300, to: 500, dur: 0.3, gain: 0.04 });
  },
  hazardWarn(): void {
    if (!gate('hazard', 600)) return;
    // Two-tone siren.
    for (let i = 0; i < 3; i++) {
      synth.tone({ type: 'square', freq: 880, start: i * 0.3, dur: 0.15, gain: 0.05 });
      synth.tone({ type: 'square', freq: 660, start: i * 0.3 + 0.15, dur: 0.15, gain: 0.05 });
    }
  },
  meteor(): void {
    if (!gate('meteor', 250)) return;
    synth.noise({ dur: 1.2, gain: 0.16, freq: 1600, to: 300, q: 1, attack: 0.3 });
  },
  buy(): void {
    if (!gate('buy', 60)) return;
    synth.tone({ type: 'square', freq: synth.note(84), dur: 0.05, gain: 0.05 });
    synth.tone({ type: 'square', freq: synth.note(91), start: 0.05, dur: 0.09, gain: 0.05 });
  },
  sell(): void {
    if (!gate('sell', 60)) return;
    synth.tone({ type: 'square', freq: synth.note(88), dur: 0.05, gain: 0.04 });
    synth.tone({ type: 'square', freq: synth.note(81), start: 0.05, dur: 0.08, gain: 0.04 });
  },
  /** A purchase that costs nothing (or the shop opening). */
  shopOpen(): void {
    if (!gate('shop', 500)) return;
    [72, 76, 79, 84].forEach((n, i) => synth.tone({ type: 'triangle', freq: synth.note(n), start: i * 0.06, dur: 0.12, gain: 0.05 }));
  },
  battleStart(): void {
    if (!gate('battle', 800)) return;
    [55, 62, 67, 74].forEach((n, i) => synth.tone({ type: 'square', freq: synth.note(n), start: i * 0.12, dur: 0.22, gain: 0.06 }));
    synth.noise({ start: 0.48, dur: 0.5, gain: 0.15, freq: 900, to: 120, type: 'lowpass' });
  },
  battleWon(): void {
    if (!gate('won', 800)) return;
    [72, 76, 79, 84, 79, 84, 88].forEach((n, i) =>
      synth.tone({ type: 'square', freq: synth.note(n), start: i * 0.08, dur: 0.14, gain: 0.06 }),
    );
  },
  lost(): void {
    if (!gate('lost', 300)) return;
    synth.tone({ type: 'sine', freq: 700, to: 300, dur: 0.3, gain: 0.03 });
  },
};
