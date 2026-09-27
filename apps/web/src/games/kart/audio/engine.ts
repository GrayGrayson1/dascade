/**
 * Kart engine + tyre squeal, built on the shared mixer's context and SFX bus (never a new
 * AudioContext). Continuous, so it holds a gentle jukebox dip via `synth.hold()` while audible,
 * exactly like DASh Circuit's engine. A second, much quieter voice follows the nearest other kart.
 */
import { synth } from '../../../audio/audio.ts';

const HOLD_KEY = 'kart-engine';

class Voice {
  private osc: OscillatorNode | null = null;
  private sub: OscillatorNode | null = null;
  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;
  private am: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;

  constructor(
    private readonly ctx: AudioContext,
    bus: GainNode,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 600;
    this.filter.Q.value = 3;
    // A two-stroke buzz: saw + a square sub, chopped by a fast amplitude LFO (the "putt-putt").
    this.osc = ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.sub = ctx.createOscillator();
    this.sub.type = 'square';
    this.sub.detune.value = -1200;
    this.am = ctx.createGain();
    this.am.gain.value = 0.7;
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'square';
    this.lfo.frequency.value = 20;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 0.3;
    this.lfo.connect(this.lfoGain).connect(this.am.gain);
    this.osc.connect(this.am);
    this.sub.connect(this.am);
    this.am.connect(this.filter).connect(this.gain).connect(bus);
    this.osc.start();
    this.sub.start();
    this.lfo.start();
  }

  set(freq: number, bright: number, vol: number, smooth = 0.06): void {
    const t = this.ctx.currentTime;
    this.osc?.frequency.setTargetAtTime(freq, t, smooth);
    this.sub?.frequency.setTargetAtTime(freq, t, smooth);
    this.lfo?.frequency.setTargetAtTime(freq / 4, t, smooth);
    this.filter?.frequency.setTargetAtTime(bright, t, 0.08);
    this.gain?.gain.setTargetAtTime(vol, t, 0.1);
  }

  silence(): void {
    this.gain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
  }

  stop(): void {
    try {
      this.osc?.stop();
      this.sub?.stop();
      this.lfo?.stop();
    } catch {
      /* already stopped */
    }
    this.gain?.disconnect();
    this.osc = this.sub = this.lfo = null;
  }
}

export interface EngineFrame {
  /** 0..~1.3 of top speed. */
  speed01: number;
  throttle: number;
  boosting: boolean;
  /** 0..1 drift/slide intensity (squeal). */
  squeal: number;
  airborne: boolean;
  offroad: boolean;
  /** Nearest other kart: 0..1 proximity (0 = none / far) and its speed. */
  nearby: number;
  nearbySpeed01: number;
}

export class KartEngineSound {
  private ctx: AudioContext | null = null;
  private main: Voice | null = null;
  private other: Voice | null = null;
  private skidGain: GainNode | null = null;
  private skidFilter: BiquadFilterNode | null = null;
  private noise: AudioBufferSourceNode | null = null;
  private started = false;
  private holding = false;

  private ensure(): boolean {
    if (this.started) return true;
    const ctx = synth.context;
    const bus = synth.sfxBus;
    if (!ctx || !bus) return false;
    this.ctx = ctx;
    this.main = new Voice(ctx, bus);
    this.other = new Voice(ctx, bus);
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buf;
    this.noise.loop = true;
    this.skidFilter = ctx.createBiquadFilter();
    this.skidFilter.type = 'bandpass';
    this.skidFilter.frequency.value = 1500;
    this.skidFilter.Q.value = 4;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    this.noise.connect(this.skidFilter).connect(this.skidGain).connect(bus);
    this.noise.start();
    this.started = true;
    return true;
  }

  private hold(on: boolean): void {
    if (this.holding === on) return;
    this.holding = on;
    synth.hold(HOLD_KEY, on);
  }

  /** `active` false → fade out and release the jukebox dip. */
  update(f: EngineFrame | null): void {
    if (!f) {
      this.hold(false);
      if (this.started && this.ctx) {
        this.main?.silence();
        this.other?.silence();
        this.skidGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      }
      return;
    }
    if (!this.ensure() || !this.ctx || !this.main || !this.other || !this.skidGain) return;
    this.hold(true);
    const s = Math.max(0, Math.min(1.3, f.speed01));
    // Karts have one long gear with a CVT-like climb; a slight rev flare while airborne.
    const rpm = 0.2 + s * 0.7 + (f.boosting ? 0.18 : 0) + (f.airborne ? f.throttle * 0.15 : 0);
    const freq = 55 + rpm * 120;
    const bright = 380 + f.throttle * 900 + rpm * 700 + (f.boosting ? 900 : 0) - (f.offroad ? 250 : 0);
    this.main.set(freq, bright, 0.02 + f.throttle * 0.016 + Math.min(1, s) * 0.012);
    if (f.nearby > 0.02) {
      const ns = Math.max(0, Math.min(1.3, f.nearbySpeed01));
      this.other.set(58 + (0.2 + ns * 0.7) * 118, 700, 0.012 * Math.min(1, f.nearby), 0.1);
    } else this.other.silence();
    const t = this.ctx.currentTime;
    const squeal = f.airborne || f.offroad ? 0 : Math.min(1, f.squeal) * Math.min(1, s * 1.6);
    this.skidGain.gain.setTargetAtTime(squeal * 0.045, t, 0.05);
    this.skidFilter?.frequency.setTargetAtTime(1200 + squeal * 900, t, 0.1);
  }

  stop(): void {
    this.hold(false);
    if (!this.started) return;
    this.main?.stop();
    this.other?.stop();
    try {
      this.noise?.stop();
    } catch {
      /* already stopped */
    }
    this.skidGain?.disconnect();
    this.main = this.other = null;
    this.started = false;
  }
}
