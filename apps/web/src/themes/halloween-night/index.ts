/**
 * Halloween Night — structural skin: a cozy haunted hall (moon window, string lights, paper bats,
 * low fog, friendly ghosts), jack-o'-lantern floor props, costumed claw prizes, spooky-cute sounds and
 * Halloween confetti. Token/material data lives in packages/ui/src/theme/themes/halloween-night.ts.
 */
import './skin.css';
import type { ThemeSkin } from '../types.ts';
import { HALLOWEEN_CELEBRATION } from './celebration.ts';
import { HALLOWEEN_CLAW } from './claw.ts';
import { HalloweenEnvironment } from './Environment.tsx';
import { HalloweenFloorDecor } from './FloorDecor.tsx';
import { HalloweenJukeboxDecor } from './JukeboxDecor.tsx';
import { HALLOWEEN_SOUNDS } from './sounds.ts';

const skin: ThemeSkin = {
  id: 'halloween-night',
  Environment: HalloweenEnvironment,
  FloorDecor: HalloweenFloorDecor,
  JukeboxDecor: HalloweenJukeboxDecor,
  arcadeRoom: 'hide',
  claw: HALLOWEEN_CLAW,
  celebration: HALLOWEEN_CELEBRATION,
  sounds: HALLOWEEN_SOUNDS,
};

export default skin;
