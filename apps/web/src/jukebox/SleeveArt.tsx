/**
 * A record's sleeve art: its cover, else a drawn sleeve — the "All records" mixtape, a moonlit Halloween night
 * for a record paired with the Halloween Night theme, or the record's initial on its accents. Decorative
 * (the carousel's buttons carry the names).
 */
import { memo, useState } from 'react';
import type { JukeboxRecord } from '@dascade/shared';
import { ALL_RECORDS } from '../audio/jukebox/index.ts';
import { Glyph } from './icons.tsx';

const BAT =
  'M20 6L18.6 2.6L17.6 5.8C15 4 11 3.6 7.5 4.8C9.2 6 9.8 7.8 9.3 9.6C6.4 8.6 3.2 9.2 0.5 11.2C5 11.4 8 13.2 9.4 16C11.5 13.6 14.6 12.8 17.4 13.8C18 12.4 19 11.8 20 11.8C21 11.8 22 12.4 22.6 13.8C25.4 12.8 28.5 13.6 30.6 16C32 13.2 35 11.4 39.5 11.2C36.8 9.2 33.6 8.6 30.7 9.6C30.2 7.8 30.8 6 32.5 4.8C29 3.6 25 4 22.4 5.8L21.4 2.6Z';

export const SleeveArt = memo(function SleeveArt({ record }: { record: JukeboxRecord }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (record.id !== ALL_RECORDS && record.cover && failed !== record.cover) {
    return (
      <span className="jb-sleeve-art" data-kind="cover">
        <img src={record.cover} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(record.cover ?? null)} />
      </span>
    );
  }
  if (record.id === ALL_RECORDS) {
    return (
      <span className="jb-sleeve-art" data-kind="mix">
        <span className="jb-sleeve-art__disc" data-n="1" />
        <span className="jb-sleeve-art__disc" data-n="2" />
        <span className="jb-sleeve-art__disc" data-n="3" />
        <span className="jb-sleeve-art__shuffle">
          <Glyph name="shuffle" size={12} />
        </span>
      </span>
    );
  }
  if (record.theme === 'halloween-night') {
    return (
      <span className="jb-sleeve-art" data-kind="night">
        <svg viewBox="0 0 100 100" focusable="false">
          <circle className="jb-sleeve-art__moon" cx="66" cy="34" r="16" />
          <path className="jb-sleeve-art__hill" d="M0 100V82Q18 72 36 80T70 76T100 79V100Z" />
          <path className="jb-sleeve-art__bat" d={BAT} transform="translate(14 30) scale(.7)" />
          <path className="jb-sleeve-art__bat" d={BAT} transform="translate(46 50) scale(.45)" />
          <ellipse className="jb-sleeve-art__pumpkin" cx="24" cy="86" rx="10" ry="8" />
        </svg>
      </span>
    );
  }
  return (
    <span className="jb-sleeve-art" data-kind="initial">
      <span className="jb-sleeve-art__initial">{record.title.trim().charAt(0).toUpperCase() || '♪'}</span>
    </span>
  );
});

