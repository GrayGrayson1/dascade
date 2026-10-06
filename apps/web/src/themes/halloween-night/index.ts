/**
 * Halloween Night — structural skin: a cozy haunted hall (moon window, string lights, paper bats,
 * low fog, friendly ghosts), jack-o'-lantern floor props, costumed claw prizes, spooky-cute sounds,
 * Halloween confetti and a haunted-carnival Wheel of DAStiny (jack-o'-lantern hub, ghost pointer, rim
 * wisps, a reaction and sting per landing). Token/material data lives in
 * packages/ui/src/theme/themes/halloween-night.ts.
 */
import '@fontsource/creepster/latin-400.css';
import './skin.css';
import type { ThemeSkin } from '../types.ts';
import { HALLOWEEN_CELEBRATION } from './celebration.ts';
import { HALLOWEEN_CLAW } from './claw.ts';
import { HalloweenEnvironment } from './Environment.tsx';
import { HalloweenFloorDecor } from './FloorDecor.tsx';
import { HalloweenJukeboxDecor } from './JukeboxDecor.tsx';
import { HALLOWEEN_SOUNDS } from './sounds.ts';
import { HalloweenWheelDecor } from './WheelDecor.tsx';
import { HALLOWEEN_WHEEL_VOICES } from './wheelSounds.ts';

const skin: ThemeSkin = {
  id: 'halloween-night',
  Environment: HalloweenEnvironment,
  FloorDecor: HalloweenFloorDecor,
  JukeboxDecor: HalloweenJukeboxDecor,
  arcadeRoom: 'hide',
  claw: HALLOWEEN_CLAW,
  celebration: HALLOWEEN_CELEBRATION,
  sounds: HALLOWEEN_SOUNDS,
  wheel: { Decor: HalloweenWheelDecor, voices: HALLOWEEN_WHEEL_VOICES },
};

export default skin;
