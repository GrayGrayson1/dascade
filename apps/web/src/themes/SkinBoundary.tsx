import { Component, type ReactNode } from 'react';

/**
 * Isolates decorative skin components (Environment, FloorDecor, JukeboxDecor): a crash in a theme's
 * ambience renders nothing instead of taking the app down. Resets when the skin changes.
 */
export class SkinBoundary extends Component<{ skinId: string; children: ReactNode }, { failed: string | null }> {
  override state: { failed: string | null } = { failed: null };

  static getDerivedStateFromError(): { failed: string } {
    return { failed: '__pending__' };
  }

  override componentDidCatch(error: Error): void {
    this.setState({ failed: this.props.skinId });
    console.warn(`[DASCADE] theme decor "${this.props.skinId}" failed; continuing without it`, error);
  }

  override render() {
    const { failed } = this.state;
    if (failed && (failed === '__pending__' || failed === this.props.skinId)) return null;
    return this.props.children;
  }
}
