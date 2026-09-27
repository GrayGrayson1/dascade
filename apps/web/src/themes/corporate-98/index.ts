/**
 * Corporate Desktop '98 skin — "someone installed an unauthorised arcade suite on every computer
 * in the office in 1998". Token data: packages/ui/src/theme/themes/corporate-98.ts. This folder is
 * the structural half: bevels, navy title bars, taskbar chrome, the teal wallpaper and desktop
 * shortcuts. Original interpretation — no vendor names, assets or logos.
 */
import './skin.css';
import type { ThemeSkin } from '../types.ts';
import { Environment } from './Environment.tsx';
import { FloorDecor } from './FloorDecor.tsx';
import { JukeboxDecor } from './JukeboxDecor.tsx';

const skin: ThemeSkin = { id: 'corporate-98', Environment, FloorDecor, JukeboxDecor, arcadeRoom: 'hide' };
export default skin;
