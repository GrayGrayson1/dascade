import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/tiny5';
import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import '@dascade/ui/styles.css';
import './styles/app.css';
import { App } from './app/App.tsx';
import { applyDocumentSettings, useApp } from './app/store.ts';
import { initPersistence } from './persistence/index.ts';
import { installAudio } from './audio/audio.ts';

applyDocumentSettings(useApp.getState().settings);
installAudio();

void initPersistence()
  .then(() => useApp.getState().hydrate())
  .catch(() => undefined);

function missingFeatures(): string[] {
  const missing: string[] = [];
  if (typeof WebSocket === 'undefined') missing.push('WebSockets');
  if (!globalThis.crypto?.getRandomValues) missing.push('Web Crypto');
  if (typeof document.createElement('canvas').getContext !== 'function') missing.push('Canvas');
  if (typeof CSS === 'undefined' || !CSS.supports('display', 'grid')) missing.push('CSS Grid');
  return missing;
}

const missing = missingFeatures();
const root = createRoot(document.getElementById('root')!);
if (missing.length) {
  root.render(
    <main className="unsupported" id="main">
      <h1 className="dc-title">DASCADE</h1>
      <p style={{ marginTop: 16 }}>
        This browser is missing features the arcade needs ({missing.join(', ')}). Please open DASCADE in a current version of Chrome, Edge,
        Firefox or Safari.
      </p>
    </main>,
  );
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
