/**
 * Themed heading/flavour text that keeps the PLAIN text as what assistive tech (and tests) read:
 *   <h2><ThemedText k="results.title" plain="Results" /></h2>
 * Under a theme with its own copy the themed words are visible (aria-hidden) and the plain words are
 * visually hidden; without themed copy it renders just the plain text (no extra DOM).
 */
import { useThemeCopy } from './copy.ts';
import type { ThemeCopyKey } from '@dascade/ui';

export function ThemedText({ k, plain }: { k: ThemeCopyKey; plain: string }) {
  const t = useThemeCopy();
  const themed = t(k, plain);
  if (themed === plain) return <>{plain}</>;
  return (
    <>
      <span aria-hidden="true" data-themed-copy={k}>
        {themed}
      </span>
      <span className="visually-hidden">{plain}</span>
    </>
  );
}
