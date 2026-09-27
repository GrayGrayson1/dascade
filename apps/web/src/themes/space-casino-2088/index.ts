/**
 * Space Casino 2088 — structural skin. Loaded lazily with the theme (fonts included), cached.
 *   Environment  starfield + nebula + orbital window with a slowly turning ringed planet
 *   FloorDecor   the observation deck: chrome window struts, LED sill, orbit-pattern carpet
 *   JukeboxDecor holographic projector over the orbital entertainment console
 */
import '@fontsource-variable/orbitron/wght.css';
import './skin.css';
import type { ThemeSkin } from '../types.ts';
import { SpaceEnvironment } from './Environment.tsx';
import { SpaceFloorDecor } from './FloorDecor.tsx';
import { SpaceJukeboxDecor } from './JukeboxDecor.tsx';

const skin: ThemeSkin = {
  id: 'space-casino-2088',
  Environment: SpaceEnvironment,
  FloorDecor: SpaceFloorDecor,
  JukeboxDecor: SpaceJukeboxDecor,
  arcadeRoom: 'hide',
};
export default skin;
