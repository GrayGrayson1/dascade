import './skin.css';
import type { ThemeSkin } from '../types.ts';
import Environment from './Environment.tsx';
import FloorDecor from './FloorDecor.tsx';
import JukeboxDecor from './JukeboxDecor.tsx';

const skin: ThemeSkin = { id: 'lan-party', Environment, FloorDecor, JukeboxDecor, arcadeRoom: 'hide' };
export default skin;
