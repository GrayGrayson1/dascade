import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, PixelIcon } from '@dascade/ui';
import { ThemedText } from '../themes/ThemedText.tsx';

interface State {
  error: Error | null;
}

/** Catches render crashes so players see a recovery screen instead of a blank page or stack trace. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[DASCADE] UI crash', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    // Same visual language as the shell's NoticeCard (kept import-light: this renders on the landing page).
    return (
      <main className="center-screen dc-game-backdrop" id="main" data-part="crash-screen">
        <section
          className="notice-card dc-panel dc-panel--brackets"
          data-tone="danger"
          data-part="notice-card"
          role="alert"
          aria-labelledby="crash-title"
        >
          <div className="notice-card__icon" aria-hidden>
            <PixelIcon name="warning" />
          </div>
          <h1 id="crash-title" className="notice-card__title">
            <ThemedText k="state.error" plain="This screen glitched out" />
          </h1>
          <p className="notice-card__text">
            Something unexpected happened. Your seat in any room is kept for a while — reloading usually puts you right back.
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
