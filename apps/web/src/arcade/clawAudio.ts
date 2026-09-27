/**
 * The claw machine's sounds — only through the shared pipeline (sfx()/synth in audio/audio.ts): the
 * gantry motor's hum and the cable winch are one continuous voice on the sfx bus that holds a gentle
 * jukebox dip (synth.hold) while it runs, and always releases it (stop()). Everything else is a short
 * synth blip. Restraint: quiet, mechanical, a little toy-like.
 */
import { sfx, synth } from '../audio/audio.ts';

const HOLD_KEY = 'claw-motor';

export class ClawMotor {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private sub: OscillatorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;
  private held = false;

  private ensure(): boolean {
    if (this.osc) return true;
    const ctx = synth.context;
    const bus = synth.sfxBus;
    if (!ctx || !bus) return false;
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 420;
    this.filter.Q.value = 3;
    this.osc = ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc.frequency.value = 60;
    this.sub = ctx.createOscillator();
    this.sub.type = 'square';
    this.sub.frequency.value = 30;
    this.osc.connect(this.filter);
    this.sub.connect(this.filter);
    this.filter.connect(this.gain).connect(bus);
    this.osc.start();
    this.sub.start();
    return true;
  }

  /**
   * `gantry` 0‥1 how fast the trolley runs; `winch` −1‥1 the cable (down −, up +). Silence releases
   * the jukebox dip.
   */
  update(gantry: number, winch: number): void {
    const level = Math.max(Math.min(1, gantry), Math.min(1, Math.abs(winch)));
    const on = level > 0.03;
    if (!on) {
      this.silence();
      return;
    }
    if (!this.ensure() || !this.ctx || !this.osc || !this.sub || !this.filter || !this.gain) return;
    if (!this.held) {
      synth.hold(HOLD_KEY, true);
      this.held = true;
    }
    const t = this.ctx.currentTime;
    // The winch whirrs higher than the gantry's low hum; lifting strains a little.
    const freq = winch !== 0 ? (winch > 0 ? 96 + level * 30 : 118 - level * 20) : 52 + gantry * 22;
    this.osc.frequency.setTargetAtTime(freq, t, 0.05);
    this.sub.frequency.setTargetAtTime(freq / 2, t, 0.05);
    this.filter.frequency.setTargetAtTime(winch !== 0 ? 900 : 380 + gantry * 260, t, 0.08);
    this.gain.gain.setTargetAtTime(0.012 + level * 0.02, t, 0.06);
  }

  silence(): void {
    if (this.held) {
      synth.hold(HOLD_KEY, false);
      this.held = false;
    }
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }

  stop(): void {
    this.silence();
    try {
      this.osc?.stop();
      this.sub?.stop();
    } catch {
      /* already stopped */
    }
    this.gain?.disconnect();
    this.osc = this.sub = null;
    this.filter = this.gain = null;
    this.ctx = null;
  }
}

/** Short mechanism and toy noises. */
export const clawSound = {
  token: () => {
    sfx('coin');
    synth.tone({ type: 'triangle', freq: 1850, to: 1700, start: 0.14, dur: 0.05, gain: 0.04 });
  },
  tick: () => synth.tone({ type: 'square', freq: 880, dur: 0.04, gain: 0.03 }),
  /** The joystick's microswitch. */
  click: () => synth.tone({ type: 'square', freq: 2400, to: 1800, dur: 0.012, gain: 0.025 }),
  /** The big button bottoming out. */
  press: () => {
    synth.tone({ type: 'square', freq: 320, to: 180, dur: 0.03, gain: 0.05 });
    synth.noise({ dur: 0.03, gain: 0.04, freq: 3000, q: 2 });
  },
  /** The winch's ratchet (a little higher going up). */
  ratchet: (up: boolean) => synth.tone({ type: 'square', freq: up ? 1500 : 1200, to: up ? 1300 : 1000, dur: 0.012, gain: 0.018 }),
  bump: () => synth.noise({ dur: 0.07, gain: 0.08, freq: 260, q: 1.2, type: 'lowpass' }),
  clack: () => {
    synth.tone({ type: 'square', freq: 260, to: 110, dur: 0.07, gain: 0.07 });
    synth.noise({ dur: 0.04, gain: 0.05, freq: 2400, q: 3 });
  },
  /** The claw settling onto plush (soft) or the floor (a tap). */
  touch: (onToy: boolean) =>
    onToy
      ? synth.noise({ dur: 0.09, gain: 0.05, freq: 500, q: 0.8, type: 'lowpass' })
      : synth.tone({ type: 'triangle', freq: 190, to: 120, dur: 0.06, gain: 0.06 }),
  top: () => {
    synth.tone({ type: 'square', freq: 140, to: 90, dur: 0.06, gain: 0.06 });
    synth.noise({ dur: 0.05, gain: 0.05, freq: 900, q: 1.5 });
  },
  whoops: () => {
    synth.tone({ type: 'triangle', freq: 620, to: 180, dur: 0.38, gain: 0.08 });
    synth.tone({ type: 'sine', freq: 300, to: 120, start: 0.05, dur: 0.3, gain: 0.04 });
  },
  thud: (hard: boolean) => {
    synth.noise({ dur: hard ? 0.12 : 0.08, gain: hard ? 0.09 : 0.05, freq: hard ? 320 : 480, q: 0.9, type: 'lowpass' });
    synth.tone({ type: 'sine', freq: hard ? 120 : 170, to: 70, dur: 0.1, gain: hard ? 0.07 : 0.04 });
  },
  tumble: () => {
    for (let i = 0; i < 4; i++)
      synth.noise({ start: i * 0.08, dur: 0.05, gain: 0.05 - i * 0.008, freq: 700 - i * 90, q: 1.2, type: 'lowpass' });
  },
  door: () => {
    sfx('pop');
    synth.tone({ type: 'square', freq: 520, to: 700, start: 0.02, dur: 0.05, gain: 0.03 });
  },
  win: () => sfx('win'),
  buzz: () => {
    synth.tone({ type: 'triangle', freq: 330, to: 300, dur: 0.18, gain: 0.07 });
    synth.tone({ type: 'triangle', freq: 250, to: 185, start: 0.2, dur: 0.32, gain: 0.07 });
  },
  sad: () => {
    synth.tone({ type: 'triangle', freq: 392, dur: 0.16, gain: 0.06 });
    synth.tone({ type: 'triangle', freq: 370, start: 0.18, dur: 0.16, gain: 0.06 });
    synth.tone({ type: 'triangle', freq: 349, start: 0.36, dur: 0.16, gain: 0.06 });
    synth.tone({ type: 'triangle', freq: 330, to: 300, start: 0.54, dur: 0.5, gain: 0.06 });
  },
  restock: () => {
    for (let i = 0; i < 6; i++)
      synth.noise({ start: 0.1 + i * 0.09, dur: 0.05, gain: 0.04, freq: 600 + (i % 3) * 120, q: 1, type: 'lowpass' });
  },
};
