import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, PixelIcon, Spinner } from '@dascade/ui';
import { ThemedText } from '../themes/ThemedText.tsx';
import { isChunkLoadError, isReloadingForUpdate, reloadForNewDeploy } from './chunkReload.ts';

interface Props {
  children: ReactNode;
  /** A change (e.g. the route's pathname) clears a caught error, so navigating away recovers. */
  resetKey?: unknown;
  /**
   * Rendered instead of the crash screen (e.g. `null` for global chrome — theme layer, toasts,
   * jukebox — whose failure must never blank the page). Such boundaries never reload the page.
   */
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
  reloading: boolean;
}

/** Catches render crashes so players see a recovery screen instead of a blank page or stack trace. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // A lazy chunk from an older deploy (its hash 404s now): reload once to pick up the new build.
    if (this.props.fallback === undefined && isChunkLoadError(error) && reloadForNewDeploy()) {
      this.setState({ reloading: true });
      return;
    }
    if (isReloadingForUpdate()) return; // follow-on errors while the page reloads
    console.error('[DASCADE] UI crash', error, info.componentStack);
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.error && !Object.is(prev.resetKey, this.props.resetKey)) this.setState({ error: null, reloading: false });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    if (this.state.reloading || isReloadingForUpdate()) {
      return (
        <main className="center-screen" id="main" data-part="loading-screen">
          <div className="loading-card" data-part="loading-card">
            <Spinner label="Updating DASCADE" />
            <p className="dc-display">Updating the arcade…</p>
          </div>
        </main>
      );
    }
    const stale = isChunkLoadError(this.state.error);
    // Same visual language as the shell's NoticeCard (kept import-light: this renders on the landing page).
    return (
      <main className="center-screen dc-game-backdrop" id="main" data-part="crash-screen">
        <section
          className="notice-card dc-panel dc-panel--brackets"
          data-tone={stale ? 'warning' : 'danger'}
          data-part="notice-card"
          role="alert"
          aria-labelledby="crash-title"
        >
          <div className="notice-card__icon" aria-hidden>
            <PixelIcon name={stale ? 'refresh' : 'warning'} />
          </div>
          <h1 id="crash-title" className="notice-card__title">
            {stale ? 'A new version is ready' : <ThemedText k="state.error" plain="This screen glitched out" />}
          </h1>
          <p className="notice-card__text">
            {stale
              ? 'DASCADE was updated while this tab was open, so part of this screen couldn’t load. Reload to get the latest version — your seat in any room is kept for a while.'
              : 'Something unexpected happened. Your seat in any room is kept for a while — reloading usually puts you right back.'}
          </p>
          <div className="notice-card__actions">
            <Button variant="primary" size="lg" icon="refresh" onClick={() => location.reload()}>
              Reload
            </Button>
            <Button variant="ghost" icon="arrow-left" onClick={() => location.assign('/')}>
              Back to arcade
            </Button>
          </div>
        </section>
      </main>
    );
  }
}
