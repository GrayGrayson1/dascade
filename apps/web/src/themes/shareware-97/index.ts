/**
 * Shareware Casino '97 skin — "DASCADE FUN PACK v3.7 · REGISTERED VERSION".
 * Token data: packages/ui/src/theme/themes/shareware-97.ts. This folder is the structural half:
 * window chrome, bevels, glossy buttons, casino carpet, signage and the CD player decor.
 */
import './skin.css';
import type { ThemeSkin } from '../types.ts';
import { Environment } from './Environment.tsx';
import { FloorDecor } from './FloorDecor.tsx';
import { JukeboxDecor } from './JukeboxDecor.tsx';

const skin: ThemeSkin = { id: 'shareware-97', Environment, FloorDecor, JukeboxDecor, arcadeRoom: 'hide' };
export default skin;
