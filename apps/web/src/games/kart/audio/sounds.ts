/**
 * DASphalt GP sound design — every sound is our own synthesized design, played through the one
 * audio pipeline (`synth.tone` / `synth.noise` on the shared SFX bus, so master/SFX volume, mute
 * and jukebox ducking all apply). No samples, no extra AudioContext, no <audio>.
 */
import type { KartItemId } from '@dascade/shared/games/kart';
import { synth } from '../../../audio/audio.ts';

const N = synth.note;

/** Per-sound minimum gaps so bursts (e.g. many bumps in one frame) never stack into noise. */
const lastAt = new Map<string, number>();
function gate(key: string, gapMs: number): boolean {
  const now = performance.now();
  if (now - (lastAt.get(key) ?? -1e9) < gapMs) return false;
  lastAt.set(key, now);
  return true;
}

function arp(notes: number[], step: number, dur: number, gain: number, type: OscillatorType = 'square', start = 0): void {
  notes.forEach((n, i) => synth.tone({ type, freq: N(n), start: start + i * step, dur, gain }));
}

export const kartSfx = {
  /** Racer picked in the lobby: an engine blip + a chime pitched per racer. */
  select(index: number): void {
    synth.tone({ type: 'sawtooth', freq: 90, to: 240, dur: 0.22, gain: 0.05 });
    synth.tone({ type: 'square', freq: N(76 + (index % 8)), start: 0.05, dur: 0.1, gain: 0.07 });
    synth.tone({ type: 'triangle', freq: N(83 + (index % 8)), start: 0.11, dur: 0.18, gain: 0.07 });
  },
  /** Start-light beep (3, 2, 1). */
  countBeep(): void {
    synth.tone({ type: 'square', freq: N(72), dur: 0.16, gain: 0.11 });
    synth.tone({ type: 'triangle', freq: N(60), dur: 0.16, gain: 0.08 });
  },
  /** GO! — a higher, longer two-voice stab. */
  go(): void {
    synth.tone({ type: 'square', freq: N(84), dur: 0.5, gain: 0.12 });
    synth.tone({ type: 'square', freq: N(91), dur: 0.5, gain: 0.06, detune: 7 });
    synth.tone({ type: 'triangle', freq: N(60), dur: 0.5, gain: 0.1 });
  },
  /** Start boost nailed. */
  startBoost(): void {
    synth.noise({ dur: 0.45, gain: 0.16, freq: 500, to: 4200, q: 0.8, type: 'lowpass' });
    synth.tone({ type: 'sawtooth', freq: 180, to: 520, dur: 0.35, gain: 0.05 });
  },
  /** Too early on the throttle: wheelspin sputter. */
  wheelspin(): void {
    for (let i = 0; i < 4; i++) synth.noise({ start: i * 0.07, dur: 0.06, gain: 0.12, freq: 1800 + i * 200, q: 5 });
  },
  /** Hop at the start of a drift. */
  hop(): void {
    if (!gate('hop', 120)) return;
    synth.tone({ type: 'sine', freq: 330, to: 620, dur: 0.08, gain: 0.07 });
  },
  /** Drift charge reached stage 1/2/3 (cyan → gold → magenta): rising chimes. */
  driftStage(stage: number): void {
    const base = stage >= 3 ? 88 : stage === 2 ? 84 : 79;
    synth.tone({ type: 'triangle', freq: N(base), dur: 0.12, gain: 0.08 });
    synth.tone({ type: 'sine', freq: N(base + 7), start: 0.05, dur: 0.16, gain: 0.06 });
  },
  /** Mini-turbo released (stronger for higher stages). */
  miniTurbo(stage: number): void {
    const g = 0.1 + stage * 0.03;
    synth.noise({ dur: 0.3 + stage * 0.08, gain: g, freq: 380, to: 3600, q: 0.7, type: 'lowpass' });
    synth.tone({ type: 'sawtooth', freq: 140, to: 300 + stage * 90, dur: 0.28, gain: 0.04 });
  },
  /** Boost pad: a bright zip. */
  boostPad(): void {
    if (!gate('pad', 150)) return;
    synth.tone({ type: 'square', freq: 520, to: 2200, dur: 0.16, gain: 0.06 });
    synth.noise({ dur: 0.22, gain: 0.1, freq: 1200, to: 5000, q: 1.5 });
  },
  /** Turbo cell used. */
  turbo(): void {
    synth.noise({ dur: 0.55, gain: 0.16, freq: 260, to: 3000, q: 0.6, type: 'lowpass' });
    synth.tone({ type: 'sawtooth', freq: 110, to: 360, dur: 0.5, gain: 0.05 });
  },
  jump(): void {
    if (!gate('jump', 200)) return;
    synth.tone({ type: 'triangle', freq: 220, to: 520, dur: 0.18, gain: 0.07 });
  },
  /** Ramp trick performed. */
  trick(): void {
    arp([79, 83, 86, 91], 0.045, 0.1, 0.07, 'square');
  },
  land(hard: number): void {
    if (!gate('land', 180)) return;
    synth.noise({ dur: 0.12, gain: 0.08 + 0.12 * Math.min(1, hard), freq: 260, to: 90, q: 0.7, type: 'lowpass' });
  },
  wall(hard: number): void {
    if (!gate('wall', 140)) return;
    const h = Math.min(1, Math.max(0.2, hard));
    synth.noise({ dur: 0.18, gain: 0.12 + 0.2 * h, freq: 700, to: 140, q: 0.6, type: 'lowpass' });
    synth.tone({ type: 'square', freq: 90, to: 55, dur: 0.12, gain: 0.05 * h });
  },
  bump(): void {
    if (!gate('bump', 120)) return;
    synth.tone({ type: 'square', freq: 180, to: 120, dur: 0.07, gain: 0.07 });
    synth.noise({ dur: 0.08, gain: 0.1, freq: 900, q: 1.2 });
  },
  /** Drove through a prism cube. */
  cube(): void {
    if (!gate('cube', 80)) return;
    synth.tone({ type: 'sine', freq: N(88), dur: 0.1, gain: 0.07 });
    synth.tone({ type: 'sine', freq: N(95), start: 0.03, dur: 0.12, gain: 0.05 });
    synth.noise({ dur: 0.1, gain: 0.06, freq: 6000, q: 2 });
  },
  /** Roulette tick (quiet; pitch climbs as it slows). */
  roulette(step: number): void {
    synth.tone({ type: 'square', freq: 1100 + (step % 6) * 90, dur: 0.025, gain: 0.035 });
  },
  /** Roulette landed. */
  itemGet(): void {
    arp([84, 88, 91], 0.05, 0.1, 0.07, 'square');
  },
  /** Item used (per item). */
  use(item: KartItemId): void {
    switch (item) {
      case 'turbo':
      case 'turbo3':
        kartSfx.turbo();
        break;
      case 'puck':
      case 'puck3':
        synth.tone({ type: 'square', freq: 700, to: 260, dur: 0.12, gain: 0.08 });
        synth.noise({ dur: 0.08, gain: 0.08, freq: 2400, q: 2 });
        break;
      case 'seeker':
        synth.tone({ type: 'sawtooth', freq: 300, to: 900, dur: 0.35, gain: 0.05 });
        synth.tone({ type: 'sine', freq: 1200, start: 0.12, dur: 0.1, gain: 0.05 });
        synth.tone({ type: 'sine', freq: 1200, start: 0.26, dur: 0.1, gain: 0.05 });
        break;
      case 'mine':
        synth.tone({ type: 'triangle', freq: 260, to: 140, dur: 0.14, gain: 0.08 });
        synth.tone({ type: 'square', freq: 1500, start: 0.12, dur: 0.03, gain: 0.03 });
        break;
      case 'fizz':
        for (let i = 0; i < 6; i++) synth.tone({ type: 'sine', freq: 600 + ((i * 373) % 900), start: i * 0.035, dur: 0.05, gain: 0.04 });
        synth.noise({ dur: 0.3, gain: 0.07, freq: 5000, q: 0.8 });
        break;
      case 'shield':
        synth.tone({ type: 'sine', freq: N(72), to: N(84), dur: 0.35, gain: 0.08 });
        synth.tone({ type: 'triangle', freq: N(79), start: 0.05, dur: 0.35, gain: 0.05 });
        break;
      case 'magnet':
        synth.tone({ type: 'sawtooth', freq: 90, to: 260, dur: 0.5, gain: 0.05 });
        synth.tone({ type: 'sine', freq: 440, to: 880, dur: 0.5, gain: 0.04 });
        break;
      case 'warp':
        arp([72, 79, 84, 91, 96], 0.04, 0.14, 0.06, 'triangle');
        synth.noise({ dur: 0.6, gain: 0.12, freq: 200, to: 6000, q: 0.5, type: 'lowpass' });
        break;
      case 'pulse':
        synth.tone({ type: 'sine', freq: 70, to: 35, dur: 0.6, gain: 0.16 });
        synth.noise({ dur: 0.5, gain: 0.14, freq: 1500, to: 120, q: 0.6, type: 'lowpass' });
        break;
    }
  },
  /** Something hit a kart (projectile, mine, hazard). */
  impact(cause: string): void {
    if (!gate('impact', 90)) return;
    if (cause === 'pulse') {
      synth.noise({ dur: 0.3, gain: 0.15, freq: 900, to: 150, q: 0.5, type: 'lowpass' });
      return;
    }
    if (cause === 'fizz') {
      synth.noise({ dur: 0.35, gain: 0.1, freq: 3000, to: 800, q: 1.2 });
      return;
    }
    synth.noise({ dur: 0.26, gain: 0.24, freq: 1400, to: 160, q: 0.5, type: 'lowpass' });
    synth.tone({ type: 'square', freq: 240, to: 70, dur: 0.2, gain: 0.06 });
  },
  /** We spun out. */
  spinOut(): void {
    if (!gate('spin', 400)) return;
    synth.tone({ type: 'triangle', freq: 880, to: 180, dur: 0.6, gain: 0.07 });
    synth.tone({ type: 'square', freq: 660, to: 150, dur: 0.6, gain: 0.03, detune: 20 });
  },
  /** A shield / trailing item blocked a hit. */
  shieldPop(): void {
    synth.tone({ type: 'sine', freq: 900, to: 1800, dur: 0.08, gain: 0.08 });
    synth.noise({ dur: 0.14, gain: 0.1, freq: 4000, q: 1.5 });
  },
  /** Fell off the track. */
  fall(): void {
    synth.tone({ type: 'sine', freq: 700, to: 120, dur: 0.7, gain: 0.07 });
  },
  lap(): void {
    arp([79, 84], 0.08, 0.16, 0.09, 'square');
  },
  /** Personal best / fastest lap. */
  lapBest(): void {
    arp([79, 84, 88, 91], 0.07, 0.16, 0.09, 'square');
  },
  /** FINAL LAP sting. */
  finalLap(): void {
    arp([72, 76, 79, 84], 0.06, 0.12, 0.08, 'square');
    synth.tone({ type: 'sawtooth', freq: N(60), start: 0.24, dur: 0.6, gain: 0.05, detune: 6 });
    synth.tone({ type: 'square', freq: N(84), start: 0.24, dur: 0.5, gain: 0.07 });
  },
  /** We crossed the line (fanfare scales with the place). */
  finish(place: number): void {
    if (place === 1) {
      arp([72, 76, 79, 84, 79, 84, 88], 0.08, 0.16, 0.09, 'square');
      [60, 67, 72, 76].forEach((n) => synth.tone({ type: 'triangle', freq: N(n), start: 0.56, dur: 1, gain: 0.07 }));
    } else if (place <= 3) {
      arp([72, 76, 79, 84], 0.09, 0.18, 0.09, 'square');
      [60, 67].forEach((n) => synth.tone({ type: 'triangle', freq: N(n), start: 0.36, dur: 0.8, gain: 0.07 }));
    } else {
      arp([67, 72, 76], 0.1, 0.2, 0.08, 'triangle');
    }
  },
  /** Results screen jingle. */
  results(win: boolean): void {
    if (win) arp([76, 79, 84, 88, 91, 96], 0.07, 0.18, 0.07, 'triangle');
    else arp([72, 76, 79, 76], 0.1, 0.2, 0.06, 'triangle');
  },
  /** Grand Prix points tick. */
  points(): void {
    synth.tone({ type: 'square', freq: N(91), dur: 0.03, gain: 0.03 });
  },
};
