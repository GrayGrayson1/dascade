/**
 * Delta Neon — the house style. Its look lives in tokens.css (:root) + the components; the skin adds
 * a quiet environment behind page-level screens and small consistency polish (skin.css).
 */
import './skin.css';
import type { ThemeSkin } from '../types.ts';
import DeltaEnvironment from './Environment.tsx';

const skin: ThemeSkin = { id: 'delta-neon', Environment: DeltaEnvironment };
export default skin;
