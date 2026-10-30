import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import { isValidRoomCode, normalizeRoomCode } from '@dascade/shared';
import { Spinner } from '@dascade/ui';
import { ArcadeFloor } from '../arcade/ArcadeFloor.tsx';
import { Toasts } from '../shell/Toasts.tsx';
import { ThemeHost } from '../themes/ThemeHost.tsx';
import { LoadingFlavour } from '../themes/LoadingFlavour.tsx';
import { SeasonalHost } from '../themes/SeasonalHost.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { useApp } from './store.ts';
import { deviceHasSeat } from '../games/showdown/joinNames.ts';

// Everything beyond the arcade floor is code-split so the landing page stays light
// (the networking SDK loads when you pick a cabinet, game code when you enter a room).
const CabinetEntry = lazy(() => import('../shell/CabinetEntry.tsx').then((m) => ({ default: m.CabinetEntry })));
const RoomScreen = lazy(() => import('../shell/RoomScreen.tsx').then((m) => ({ default: m.RoomScreen })));
const NotFoundScreen = lazy(() => import('../shell/RoomScreen.tsx').then((m) => ({ default: m.NotFoundScreen })));
const CabinetPicker = lazy(() => import('../shell/CabinetPicker.tsx').then((m) => ({ default: m.CabinetPicker })));
const TournamentCenter = lazy(() => import('../tournament/TournamentCenter.tsx').then((m) => ({ default: m.TournamentCenter })));
// The event join screen behind /r/<code> (DAS Survey Showdown event rooms; it looks the room up first).
const EventJoinRoute = lazy(() => import('../games/showdown/EventJoin.tsx').then((m) => ({ default: m.EventJoinRoute })));
// The Presenter Tour for DAS Survey Showdown: a standalone page (no room, no connection).
const ShowdownTour = lazy(() => import('../games/showdown/tour/TourPage.tsx').then((m) => ({ default: m.TourPage })));
const GlobalModals = lazy(() => import('../shell/modals.tsx').then((m) => ({ default: m.GlobalModals })));
// The jukebox UI (dock + player) is global and outlives every route; its own chunk, and a failed load renders nothing.
const Jukebox = lazy(() =>
  import('../jukebox/Jukebox.tsx').then(
    (m): { default: () => React.ReactNode } => ({ default: m.Jukebox }),
    () => ({ default: () => null }),
  ),
);

/**
 * /r/<code>, the short join link. A device that already holds a seat there (a refresh, the link opened
 * again) goes straight back into the room; otherwise an event room shows its one-field join screen and
 * every other room opens as before (the screen looks the room up and redirects).
 */
function JoinRedirect() {
  const { code: raw } = useParams();
  const code = normalizeRoomCode(raw ?? '');
  if (!isValidRoomCode(code) || deviceHasSeat(code)) return <Navigate to={`/room/${code}`} replace />;
  return <EventJoinRoute code={code} />;
}

function RouteFallback() {
  return (
    <main className="center-screen" id="main" data-part="loading-screen">
      <div className="loading-card" data-part="loading-card">
        <LoadingFlavour />
        <Spinner label="Loading" />
      </div>
    </main>
  );
}

/** Screens: a crash (or a stale chunk) shows the recovery screen; navigating elsewhere clears it. */
function RouteBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>;
}

/** Global chrome (theme layer, toasts, jukebox): a failure renders nothing instead of blanking the page. */
function QuietBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname} fallback={null}>
      {children}
    </ErrorBoundary>
  );
}

function Modals() {
  const modal = useApp((s) => s.modal);
  if (!modal) return null;
  return (
    <Suspense fallback={null}>
      <GlobalModals />
    </Suspense>
  );
}

export function App() {
  return (
    <BrowserRouter>
      {/* Theme environment layer + transition overlay (+ quick picker). Outside <Routes>: never remounts screens. */}
      <QuietBoundary>
        <ThemeHost />
      </QuietBoundary>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <RouteBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<ArcadeFloor />} />
            <Route path="/cabinet/:cabinetId" element={<CabinetPicker />} />
            <Route path="/tournaments" element={<TournamentCenter />} />
            {/* Friendly aliases for games that live inside a multi-game cabinet. */}
            <Route path="/play/poker" element={<Navigate to="/play/holdem" replace />} />
            <Route path="/play/texas-holdem" element={<Navigate to="/play/holdem" replace />} />
            <Route path="/play/roulette" element={<Navigate to="/play/dasino?table=roulette" replace />} />
            <Route path="/play/fourinarow" element={<Navigate to="/play/tictactoe?table=gravity" replace />} />
            <Route path="/play/slots" element={<Navigate to="/play/dasino?table=slots" replace />} />
            <Route path="/play/highlow" element={<Navigate to="/play/dasino?table=dice" replace />} />
            <Route path="/play/dice" element={<Navigate to="/play/dasino?table=dice" replace />} />
            {/* The Tournament Center is a place, not a cabinet game: its entry is the landing + wizard. */}
            <Route path="/play/tournament" element={<Navigate to="/tournaments" replace />} />
            <Route path="/play/:gameId" element={<CabinetEntry />} />
            <Route path="/room/:code" element={<RoomScreen />} />
            <Route path="/r/:code" element={<JoinRedirect />} />
            <Route path="/tutorial/showdown" element={<ShowdownTour />} />
            <Route path="*" element={<NotFoundScreen />} />
          </Routes>
        </Suspense>
        <Modals />
      </RouteBoundary>
      {/* October's Halloween invite + the season's end (themes/seasonal.ts). After the routes in tab order. */}
      <QuietBoundary>
        <SeasonalHost />
      </QuietBoundary>
      <QuietBoundary>
        <Toasts />
      </QuietBoundary>
      <QuietBoundary>
        <Suspense fallback={null}>
          <Jukebox />
        </Suspense>
      </QuietBoundary>
    </BrowserRouter>
  );
}
