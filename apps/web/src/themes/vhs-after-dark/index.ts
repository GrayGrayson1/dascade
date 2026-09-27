/** VHS After Dark skin: scoped CSS, the after-hours video store environment, floor props and the mixtape deck. */
import '@fontsource/kalam/latin-700.css';
import './skin.css';
import type { ThemeSkin } from '../types.ts';
import { VhsEnvironment } from './Environment.tsx';
import { VhsFloorDecor } from './FloorDecor.tsx';
import { VhsJukeboxDecor } from './JukeboxDecor.tsx';

const skin: ThemeSkin = {
  id: 'vhs-after-dark',
  Environment: VhsEnvironment,
  FloorDecor: VhsFloorDecor,
  JukeboxDecor: VhsJukeboxDecor,
  arcadeRoom: 'hide',
};
export default skin;
