import { useEffect, useState, type RefObject } from 'react';
import { readThemeTokens, subscribeThemeTokens } from '@dascade/ui';
import { PUTT_DEFAULT_ART, puttArt, puttMaterialsSignature, type PuttArt } from './themeAdapter.ts';

/** Course art for DOM-hosted thumbnails; a new object only when the course materials change. */
export function usePuttArt(ref: RefObject<Element | null>): PuttArt {
  const [art, setArt] = useState<PuttArt>(PUTT_DEFAULT_ART);
  useEffect(() => {
    let sig: string | null = null;
    const read = () => {
      const m = readThemeTokens(ref.current).materials;
      const next = puttMaterialsSignature(m);
      if (next === sig) return;
      sig = next;
      setArt(puttArt(m));
    };
    read();
    return subscribeThemeTokens(read);
  }, [ref]);
  return art;
}
