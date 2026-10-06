/**
 * Halloween Night's Wheel of DAStiny sounds (ThemeSkin.wheel.voices): a creaky axle and a ghostly
 * "woo" on launch, bone knocks for the pegs (a jaw snap or a tiny sigh now and then as it slows), and
 * a sting per landing reaction — music box for candy, bubbles for a brew, a meow, a skeleton's
 * xylophone, thunder and a fanfare for the Pumpkin Jackpot. Built only from the kit, at about the
 * built-in sounds' loudness; noise layers stay ≤ 0.9 s (the shared noise buffer is 1 s and doesn't loop).
 */
import type { SfxKit } from '../../audio/voices.ts';
import type { WheelVoices } from '../wheelSkin.ts';
import { reactionFor, type WheelReaction } from './wheelReactions.ts';
import { HALLOWEEN_SOUNDS } from './sounds.ts';

/** The same kit, every sound shifted `dt` seconds later. */
const later = (kit: SfxKit, dt: number): SfxKit => ({
  tone: (o) => kit.tone({ ...o, start: (o.start ?? 0) + dt }),
  noise: (o) => kit.noise({ ...o, start: (o.start ?? 0) + dt }),
  note: kit.note,
});

/** No reaction: Halloween Night's chime and jingle with the wheel's own C-major arpeggio (as built in). */
function plainReveal(kit: SfxKit): void {
  HALLOWEEN_SOUNDS.ding?.(kit);
  HALLOWEEN_SOUNDS.win?.(kit);
  [67, 72, 76, 79].forEach((m, i) => kit.tone({ type: 'triangle', freq: kit.note(m), start: 0.55 + i * 0.05, dur: 0.6, gain: 0.05 }));
}

export const REACTION_STINGS: Readonly<Record<WheelReaction, (kit: SfxKit) => void>> = {
  // A music box runs up a C-major arpeggio over crinkling wrappers.
  candy: ({ tone, noise, note }) => {
    [84, 88, 91, 96, 100].forEach((m, i) => tone({ type: 'triangle', freq: note(m), start: i * 0.09, dur: 0.45, gain: 0.07 }));
    [0.02, 0.07, 0.11, 0.16, 0.2, 0.26].forEach((start, i) =>
      noise({ start, dur: 0.026, gain: 0.05 + (i % 2) * 0.03, freq: 3800 + ((i * 1300) % 2200), q: 5 }),
    );
    [84, 88, 91].forEach((m) => tone({ type: 'sine', freq: note(m), start: 0.5, dur: 0.6, gain: 0.03 }));
  },
  // Rising cauldron bubbles, then a sparkly glissando.
  brew: ({ tone, noise, note }) => {
    [0, 0.1, 0.18, 0.28, 0.34, 0.45].forEach((start, i) =>
      tone({ type: 'sine', freq: 180 + i * 40, to: 520 + i * 80, start, dur: 0.07, gain: 0.08 }),
    );
    noise({ dur: 0.5, gain: 0.05, freq: 500, q: 0.8, type: 'lowpass', attack: 0.05 });
    tone({ type: 'triangle', freq: note(96), to: note(103), start: 0.55, dur: 0.3, gain: 0.05 });
    [100, 103, 108].forEach((m, i) => tone({ type: 'triangle', freq: note(m), start: 0.62 + i * 0.09, dur: 0.12, gain: 0.04 }));
  },
  // "ooOOooo": a soft rise and fall with a wobbly twin.
  ghost: ({ tone, note }) => {
    for (const [detune, gain] of [
      [0, 0.09],
      [15, 0.045],
    ] as const) {
      tone({ type: 'sine', freq: note(67), to: note(74), dur: 0.36, gain, attack: 0.08, detune });
      tone({ type: 'sine', freq: note(74), to: note(69), start: 0.33, dur: 0.46, gain: gain * 0.9, attack: 0.02, detune });
    }
  },
  // A cartoon "mew", then three little scratches.
  cat: ({ tone, noise }) => {
    tone({ type: 'triangle', freq: 620, to: 980, dur: 0.14, gain: 0.08, attack: 0.02 });
    tone({ type: 'triangle', freq: 980, to: 560, start: 0.12, dur: 0.3, gain: 0.08 });
    tone({ type: 'sine', freq: 980, to: 560, start: 0.12, dur: 0.3, gain: 0.035, detune: 8 });
    [0.5, 0.58, 0.66].forEach((start) => noise({ start, dur: 0.06, gain: 0.08, freq: 3000, to: 1500, q: 2 }));
  },
  // A skeleton plays its ribs like a xylophone, then snaps its jaw twice.
  skeleton: ({ tone, noise, note }) => {
    [84, 88, 91, 96, 91, 88, 96].forEach((m, i) => {
      tone({ type: 'triangle', freq: note(m), start: i * 0.075, dur: 0.08, gain: 0.08 });
      noise({ start: i * 0.075, dur: 0.012, gain: 0.06, freq: 2500, q: 8 });
    });
    [0.62, 0.68].forEach((start) => noise({ start, dur: 0.014, gain: 0.1, freq: 1800, q: 6 }));
  },
  // A slide whistle up into a big friendly "BOO".
  boo: ({ tone, noise }) => {
    tone({ type: 'sine', freq: 520, to: 1400, dur: 0.22, gain: 0.07, attack: 0.02 });
    tone({ type: 'triangle', freq: 330, to: 196, start: 0.22, dur: 0.45, gain: 0.12, attack: 0.02 });
    tone({ type: 'sine', freq: 330, to: 196, start: 0.22, dur: 0.45, gain: 0.05, detune: 12 });
    noise({ start: 0.22, dur: 0.3, gain: 0.05, freq: 600, type: 'lowpass' });
  },
  // Fwoooop down, a tiny "pip pip" — and a boing when everyone springs back.
  shrink: ({ tone, note }) => {
    tone({ type: 'sine', freq: 1500, to: 380, dur: 0.55, gain: 0.08, attack: 0.02 });
    tone({ type: 'sine', freq: 1500, to: 380, dur: 0.55, gain: 0.03, detune: 10 });
    tone({ type: 'square', freq: note(96), start: 0.6, dur: 0.05, gain: 0.04 });
    tone({ type: 'square', freq: note(100), start: 0.68, dur: 0.05, gain: 0.04 });
    tone({ type: 'sine', freq: 180, to: 520, start: 2.55, dur: 0.18, gain: 0.06 });
  },
  // A low growl that turns into a cheerful "ta-da".
  monster: ({ tone, noise, note }) => {
    noise({ dur: 0.6, gain: 0.2, freq: 260, to: 120, q: 1, type: 'lowpass', attack: 0.05 });
    tone({ type: 'sawtooth', freq: 85, to: 62, dur: 0.55, gain: 0.04, attack: 0.05 });
    tone({ type: 'triangle', freq: note(72), start: 0.65, dur: 0.12, gain: 0.07 });
    tone({ type: 'triangle', freq: note(79), start: 0.75, dur: 0.3, gain: 0.07 });
  },
  // Wings fluttering past and three tiny squeaks.
  bats: ({ tone, noise }) => {
    for (let i = 0; i < 12; i++) noise({ start: i * 0.045, dur: 0.025, gain: i % 2 ? 0.06 : 0.09, freq: 900, q: 1.5 });
    [0.1, 0.3, 0.42].forEach((start) => tone({ type: 'sine', freq: 3200, to: 3900, start, dur: 0.035, gain: 0.035 }));
  },
  // Rolling thunder, then the big Halloween fanfare.
  jackpot: (kit) => {
    kit.noise({ dur: 0.85, gain: 0.32, freq: 420, to: 70, q: 0.7, type: 'lowpass', attack: 0.02 });
    kit.noise({ start: 0.3, dur: 0.85, gain: 0.24, freq: 300, to: 60, q: 0.7, type: 'lowpass', attack: 0.04 });
    kit.noise({ start: 0.65, dur: 0.7, gain: 0.16, freq: 220, to: 55, q: 0.7, type: 'lowpass', attack: 0.05 });
    HALLOWEEN_SOUNDS.bigwin?.(later(kit, 0.9));
  },
};

let knock = 0;

export const HALLOWEEN_WHEEL_VOICES: WheelVoices = {
  // A creaky axle (stick-slip clicks over a groan), a whoosh and a little ghostly "woo" (~0.6 s).
  launch: ({ tone, noise, note }) => {
    [0, 0.05, 0.09, 0.12, 0.145, 0.165, 0.185, 0.2, 0.215, 0.23].forEach((start, i) =>
      noise({ start, dur: 0.012, gain: 0.12, freq: 700 + i * 40, q: 9 }),
    );
    tone({ type: 'sawtooth', freq: 70, to: 95, dur: 0.28, gain: 0.03 });
    noise({ start: 0.18, dur: 0.4, gain: 0.16, freq: 300, to: 2600, q: 0.6, type: 'lowpass', attack: 0.08 });
    tone({ type: 'sine', freq: note(72), to: note(79), start: 0.3, dur: 0.3, gain: 0.05, attack: 0.06 });
    tone({ type: 'sine', freq: note(72), to: note(79), start: 0.3, dur: 0.3, gain: 0.025, attack: 0.06, detune: 14 });
  },
  // Two bones knocking in turn; as it slows, now and then a jaw snap or a tiny ghostly sigh.
  tick: ({ tone, noise }, speed) => {
    knock = (knock + 1) % 6;
    if (speed < 0.18 && knock === 2) {
      tone({ type: 'sine', freq: 980, to: 760, dur: 0.045, gain: 0.05, attack: 0.01 });
      return;
    }
    if (speed < 0.18 && knock === 5) {
      noise({ dur: 0.012, gain: 0.1, freq: 2000, q: 6 });
      noise({ start: 0.022, dur: 0.012, gain: 0.08, freq: 2300, q: 6 });
      return;
    }
    const hi = knock % 2 === 0;
    noise({ dur: 0.014, gain: 0.08 + 0.04 * (1 - speed), freq: (hi ? 2300 : 1700) + 900 * speed, q: 6 });
    tone({ type: 'triangle', freq: (hi ? 1500 : 1150) + 400 * speed, to: hi ? 900 : 700, dur: 0.03, gain: 0.07 });
  },
  reveal: (kit, slice) => {
    const kind = reactionFor(slice);
    if (kind) REACTION_STINGS[kind](kit);
    else plainReveal(kit);
  },
};
