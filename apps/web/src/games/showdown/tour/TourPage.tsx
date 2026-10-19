/**
 * /tutorial/showdown — the Presenter Tour on its own page: no room, no nickname, no connection, so
 * the link can go round before the event ("watch this before Thursday").
 *
 *   ?look=showtime     start in DAS Showtime (default: Halloween Night)
 *   ?chapter=3         start at a chapter (1-based)
 *   ?film=1            the film cut, "Boo's Backstage Tour" (1920×1080, made to be recorded)
 */
import '@fontsource/creepster/latin-400.css';
import '@fontsource/audiowide/latin-400.css';
import '@fontsource-variable/orbitron/wght.css';
import '../showdown.css';
import '../chrome.css';
import '../chrome-showcase.css';
import { lazy, Suspense, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { ShowdownLook } from '@dascade/shared/games/showdown';
import { TourPlayer } from './TourPlayer.tsx';
import { TOUR_CHAPTERS } from './script.ts';

const TourFilm = lazy(() => import('./TourFilm.tsx').then((m) => ({ default: m.TourFilm })));

export function TourPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const look: ShowdownLook = params.get('look') === 'showtime' ? 'showtime' : 'halloween';
  const chapter = Math.max(0, Math.min(TOUR_CHAPTERS.length - 1, (Number(params.get('chapter')) || 1) - 1));
  const film = params.get('film') === '1';
  useEffect(() => {
    document.title = film ? 'Boo’s Backstage Tour · DASCADE' : 'Presenter tour · DAS-O-Ween Trivia · DASCADE';
    return () => {
      document.title = 'DASCADE';
    };
  }, [film]);
  if (film) {
    return (
      <Suspense fallback={null}>
        <TourFilm look={look} startChapter={chapter} narration={params.get('voice') === '1'} />
      </Suspense>
    );
  }
  return (
    <main className="tour-page" id="main" data-part="showdown-tour-page">
      <h1 className="visually-hidden">DAS-O-Ween Trivia presenter tour</h1>
      <TourPlayer look={look} startChapter={chapter} music jukeboxSlot onClose={() => navigate('/play/showdown')} closeLabel="Skip tour" />
    </main>
  );
}
