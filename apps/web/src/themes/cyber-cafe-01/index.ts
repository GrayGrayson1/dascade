import '@fontsource/audiowide/400.css';
import './skin.css';
import type { ThemeSkin } from '../types.ts';
import Environment from './Environment.tsx';
import JukeboxDecor from './JukeboxDecor.tsx';

const skin: ThemeSkin = { id: 'cyber-cafe-01', Environment, JukeboxDecor, arcadeRoom: 'hide' };
export default skin;
