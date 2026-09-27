/**
 * Neon Noir skin: structural CSS for the whole platform (skin.css) + the rain-soaked district
 * environment (Environment.tsx / scene.ts). Delta Neon's pixel-art room is hidden on the floor so
 * the cabinets stand on the wet street instead.
 */
import './skin.css';
import type { ThemeSkin } from '../types.ts';
import NoirEnvironment from './Environment.tsx';
import NoirJukeboxDecor from './JukeboxDecor.tsx';

const skin: ThemeSkin = { id: 'neon-noir', Environment: NoirEnvironment, JukeboxDecor: NoirJukeboxDecor, arcadeRoom: 'hide' };
export default skin;
