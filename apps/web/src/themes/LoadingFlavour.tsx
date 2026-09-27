/** Theme flavour line on loading / connecting screens ("DIALING…", "REWINDING TAPE…"); nothing under Delta Neon. */
import { useThemeFlavour } from './copy.ts';

export function LoadingFlavour({ kind = 'loading' }: { kind?: 'loading' | 'connecting' }) {
  const text = useThemeFlavour(kind === 'connecting' ? 'state.connecting' : 'state.loading');
  if (!text) return null;
  return (
    <p className="loading-flavour" data-part="loading-flavour" aria-hidden>
      {text}
    </p>
  );
}
