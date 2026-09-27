/** Mall Arcade '92 skin: scoped CSS, the fluorescent arcade environment, floor props and jukebox decor. */
import '@fontsource-variable/pixelify-sans/wght.css';
import './skin.css';
import type { ThemeSkin } from '../types.ts';
import { MallEnvironment } from './Environment.tsx';
import { MallFloorDecor } from './FloorDecor.tsx';
import { MallJukeboxDecor } from './JukeboxDecor.tsx';

const skin: ThemeSkin = {
  id: 'mall-arcade-92',
  Environment: MallEnvironment,
  FloorDecor: MallFloorDecor,
  JukeboxDecor: MallJukeboxDecor,
  arcadeRoom: 'hide',
};
export default skin;
