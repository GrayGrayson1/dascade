import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, EmptyState, Panel } from '@dascade/ui';

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
    return (
      <main className="center-screen" id="main">
        <Panel brackets className="error-card" role="alert">
          <EmptyState icon="warning" title="This screen glitched out">
            Something unexpected happened. Your seat in any room is kept for a while — reloading usually puts you right back.
          </EmptyState>
          <div className="dc-row" style={{ justifyContent: 'center' }}>
            <Button variant="ghost" onClick={() => location.assign('/')}>
              Back to arcade
            </Button>
            <Button variant="primary" icon="refresh" onClick={() => location.reload()}>
              Reload
            </Button>
          </div>
        </Panel>
      </main>
    );
  }
}
