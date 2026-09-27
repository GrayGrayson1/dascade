/**
 * Procedural engine hum + tyre squeal for the local car (WebAudio, via the shared
 * synth bus so master/SFX volume and mute apply). Quiet by design.
 */
import { synth } from '../../../audio/audio.ts';

const HOLD_KEY = 'circuit-engine';

export class EngineSound {
  private ctx: AudioContext | null = null;
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;
  private skidGain: GainNode | null = null;
  private skidFilter: BiquadFilterNode | null = null;
  private noise: AudioBufferSourceNode | null = null;
  private started = false;

  private ensure(): boolean {
    if (this.started) return true;
    const ctx = synth.context;
    const bus = synth.sfxBus;
    if (!ctx || !bus) return false;
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 500;
    this.filter.Q.value = 4;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    this.osc2.detune.value = -1180;
    this.osc1.connect(this.filter);
    this.osc2.connect(this.filter);
    this.filter.connect(this.gain).connect(bus);
    // Tyre squeal: band-passed noise.
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buf;
    this.noise.loop = true;
    this.skidFilter = ctx.createBiquadFilter();
    this.skidFilter.type = 'bandpass';
    this.skidFilter.frequency.value = 1400;
    this.skidFilter.Q.value = 3;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    this.noise.connect(this.skidFilter).connect(this.skidGain).connect(bus);
    this.osc1.start();
    this.osc2.start();
    this.noise.start();
    this.started = true;
    return true;
  }

  /** speed01: 0..1.3, throttle 0..1, slip 0..1. */
  update(speed01: number, throttle: number, boosting: boolean, slip: number, offroad: boolean, active: boolean): void {
    if (!active) {
      synth.hold(HOLD_KEY, false);
      if (this.started && this.gain && this.ctx) {
        this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
        this.skidGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      }
      return;
    }
    if (!this.ensure() || !this.ctx || !this.osc1 || !this.osc2 || !this.filter || !this.gain || !this.skidGain) return;
    // The hum is continuous: it holds a gentle jukebox dip instead of pumping transient ducks.
    synth.hold(HOLD_KEY, true);
    const t = this.ctx.currentTime;
    const gears = 5;
    const g = Math.min(gears - 1, Math.floor(Math.min(0.999, speed01 / 1.05) * gears));
    const inGear = Math.min(1, Math.max(0, (speed01 / 1.05) * gears - g));
    const rpm = 0.25 + inGear * 0.75 + (boosting ? 0.15 : 0);
    const freq = 42 + rpm * (70 + g * 9);
    this.osc1.frequency.setTargetAtTime(freq, t, 0.05);
    this.osc2.frequency.setTargetAtTime(freq, t, 0.05);
    this.filter.frequency.setTargetAtTime(260 + throttle * 900 + rpm * 500 + (boosting ? 700 : 0), t, 0.08);
    this.gain.gain.setTargetAtTime(0.018 + throttle * 0.018 + Math.min(1, speed01) * 0.012, t, 0.1);
    const squeal = offroad ? 0 : Math.min(1, slip) * Math.min(1, speed01 * 1.5);
    this.skidGain.gain.setTargetAtTime(squeal * 0.05, t, 0.06);
    this.skidFilter?.frequency.setTargetAtTime(1100 + squeal * 700, t, 0.1);
  }

  stop(): void {
    synth.hold(HOLD_KEY, false);
    if (!this.started) return;
    try {
      this.osc1?.stop();
      this.osc2?.stop();
      this.noise?.stop();
    } catch {
      /* already stopped */
    }
    this.gain?.disconnect();
    this.skidGain?.disconnect();
    this.started = false;
  }
}
