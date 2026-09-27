/**
 * Executive Edition skin — a ridiculous 1990s corner office. Token data:
 * packages/ui/src/theme/themes/executive.ts. This folder is the structural half: mahogany panels,
 * engraved brass nameplates, leather, a wood-panelled office with banker-lamp light, and the
 * executive stereo's VU meter.
 */
import './skin.css';
import type { ThemeSkin } from '../types.ts';
import { Environment } from './Environment.tsx';
import { FloorDecor } from './FloorDecor.tsx';
import { JukeboxDecor } from './JukeboxDecor.tsx';

const skin: ThemeSkin = { id: 'executive', Environment, FloorDecor, JukeboxDecor, arcadeRoom: 'hide' };
export default skin;
