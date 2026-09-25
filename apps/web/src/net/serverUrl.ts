/** Base URL of the game server (HTTP + WebSocket). */
export function serverUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (import.meta.env.DEV) {
    const port = import.meta.env.VITE_SERVER_PORT ?? '2567';
    return `${location.protocol}//${location.hostname}:${port}`;
  }
  return location.origin;
}
