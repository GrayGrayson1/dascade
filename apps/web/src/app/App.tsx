import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router';
import { normalizeRoomCode } from '@dascade/shared';
import { Spinner } from '@dascade/ui';
import { ArcadeFloor } from '../arcade/ArcadeFloor.tsx';
import { Toasts } from '../shell/Toasts.tsx';
import { ThemeHost } from '../themes/ThemeHost.tsx';
import { LoadingFlavour } from '../themes/LoadingFlavour.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { useApp } from './store.ts';

// Everything beyond the arcade floor is code-split so the landing page stays light
// (the networking SDK loads when you pick a cabinet, game code when you enter a room).
const CabinetEntry = lazy(() => import('../shell/CabinetEntry.tsx').then((m) => ({ default: m.CabinetEntry })));
const RoomScreen = lazy(() => import('../shell/RoomScreen.tsx').then((m) => ({ default: m.RoomScreen })));
const NotFoundScreen = lazy(() => import('../shell/RoomScreen.tsx').then((m) => ({ default: m.NotFoundScreen })));
const CabinetPicker = lazy(() => import('../shell/CabinetPicker.tsx').then((m) => ({ default: m.CabinetPicker })));
const TournamentCenter = lazy(() => import('../tournament/TournamentCenter.tsx').then((m) => ({ default: m.TournamentCenter })));
const GlobalModals = lazy(() => import('../shell/modals.tsx').then((m) => ({ default: m.GlobalModals })));
// The jukebox UI (dock + player) is global and outlives every route; its own chunk, and a failed load renders nothing.
const Jukebox = lazy(() =>
  import('../jukebox/Jukebox.tsx').then(
    (m): { default: () => React.ReactNode } => ({ default: m.Jukebox }),
    () => ({ default: () => null }),
  ),
);

function JoinRedirect() {
  const { code } = useParams();
  return <Navigate to={`/room/${normalizeRoomCode(code ?? '')}`} replace />;
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
      <ThemeHost />
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<ArcadeFloor />} />
            <Route path="/cabinet/:cabinetId" element={<CabinetPicker />} />
            <Route path="/tournaments" element={<TournamentCenter />} />
            {/* Friendly aliases for games that live inside a multi-game cabinet. */}
            <Route path="/play/poker" element={<Navigate to="/play/holdem" replace />} />
            <Route path="/play/texas-holdem" element={<Navigate to="/play/holdem" replace />} />
            <Route path="/play/roulette" element={<Navigate to="/play/dasino?table=roulette" replace />} />
            <Route path="/play/slots" element={<Navigate to="/play/dasino?table=slots" replace />} />
            <Route path="/play/highlow" element={<Navigate to="/play/dasino?table=dice" replace />} />
            <Route path="/play/dice" element={<Navigate to="/play/dasino?table=dice" replace />} />
            {/* The Tournament Center is a place, not a cabinet game: its entry is the landing + wizard. */}
            <Route path="/play/tournament" element={<Navigate to="/tournaments" replace />} />
            <Route path="/play/:gameId" element={<CabinetEntry />} />
            <Route path="/room/:code" element={<RoomScreen />} />
            <Route path="/r/:code" element={<JoinRedirect />} />
            <Route path="*" element={<NotFoundScreen />} />
          </Routes>
        </Suspense>
        <Modals />
      </ErrorBoundary>
      <Toasts />
      <Suspense fallback={null}>
        <Jukebox />
      </Suspense>
    </BrowserRouter>
  );
}
