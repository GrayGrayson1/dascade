/**
 * The Tournament Center kiosk on the arcade floor: a lit LED scoreboard (not a
 * cabinet) that links to /tournaments. `board` hangs in the HUD on wide
 * screens; `strip` sits under the plaque on phones and tablets.
 */
import { memo } from 'react';
import { Link } from 'react-router';
import { GAME_CATALOG, GAME_IDS } from '@dascade/shared';
import { PixelIcon, cx } from '@dascade/ui';
import { sfx } from '../audio/audio.ts';

const TOURNAMENT_TITLES = GAME_IDS.filter((id) => GAME_CATALOG[id].tournament).map((id) => GAME_CATALOG[id].title.replace(/^DAS\s+/, ''));
const TICKER = ['Brackets', 'Swiss', 'Round robin', ...TOURNAMENT_TITLES];

export const TournamentKiosk = memo(function TournamentKiosk({ variant, className }: { variant: 'board' | 'strip'; className?: string }) {
  return (
    <Link
      to="/tournaments"
      className={cx('af-kiosk', `af-kiosk--${variant}`, className)}
      aria-label="Tournament Center — brackets, Swiss and round robins"
      onClick={() => sfx('click')}
      data-kiosk
    >
      <span className="af-kiosk__trophy" aria-hidden>
        <PixelIcon name="trophy" size={variant === 'board' ? 22 : 20} />
      </span>
      <span className="af-kiosk__text" aria-hidden>
        <span className="af-kiosk__title">
          <span className="af-kiosk__long">Tournament Center</span>
          <span className="af-kiosk__short">Tournaments</span>
        </span>
        <span className="af-kiosk__ticker">
          <span className="af-kiosk__track">
            {[...TICKER, ...TICKER].map((t, i) => (
              <span key={i}>{t}</span>
            ))}
          </span>
        </span>
      </span>
      <span className="af-kiosk__go" aria-hidden>
        <PixelIcon name="arrow-right" size={14} />
      </span>
    </Link>
  );
});
