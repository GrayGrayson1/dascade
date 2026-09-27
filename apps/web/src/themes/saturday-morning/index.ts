/**
 * Saturday Morning — structural skin. Loaded lazily with the theme (font included), cached.
 *   Environment  the studio: turning sunburst, coloured studio lights, drifting shapes & squiggles
 *   FloorDecor   the set: marquee-bulb header, APPLAUSE sign, checkerboard stage floor, risers
 *   JukeboxDecor the music-video booth: bouncing speakers and sparkles that follow the music
 */
import '@fontsource/lilita-one/latin-400.css';
import './skin.css';
import type { ThemeSkin } from '../types.ts';
import { SaturdayEnvironment } from './Environment.tsx';
import { SaturdayFloorDecor } from './FloorDecor.tsx';
import { SaturdayJukeboxDecor } from './JukeboxDecor.tsx';

const skin: ThemeSkin = {
  id: 'saturday-morning',
  Environment: SaturdayEnvironment,
  FloorDecor: SaturdayFloorDecor,
  JukeboxDecor: SaturdayJukeboxDecor,
  arcadeRoom: 'hide',
};
export default skin;
