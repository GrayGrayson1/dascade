import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/tiny5';
import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import '@dascade/ui/styles.css';
import './styles/app.css';
import { activeThemeId, listThemes, readThemeTokens, registerTheme, type ThemeDefinition, type ThemeTokens } from '@dascade/ui';
import { App } from './app/App.tsx';
import { applyDocumentSettings, useApp } from './app/store.ts';
import { initPersistence } from './persistence/index.ts';
import { installAudio } from './audio/audio.ts';
import { loadThemeSkinWithin, loadedSkin } from './themes/registry.ts';
import { switchTheme } from './themes/controller.ts';

// Theme + fx + reduced motion on <html> before the first render (the stored theme id is read
// synchronously, so a non-default theme never flashes Delta Neon first).
applyDocumentSettings(useApp.getState().settings);
installAudio();

// Theme hook for QA / E2E (e2e/theme.spec.ts): register a throwaway theme and switch to it.
// Themes are purely cosmetic and local to this browser.
declare global {
  interface Window {
    __DASCADE_THEME__?: {
      registerTheme: (theme: ThemeDefinition) => ThemeDefinition;
      listThemes: () => ThemeDefinition[];
      activeThemeId: () => string;
      setTheme: (id: string) => void;
      /** Switch with the themed transition (what the picker does). */
      switchTheme: (id: string) => Promise<void>;
      /** true once the theme's structural skin (CSS + environment) has loaded. */
      skinLoaded: (id: string) => boolean;
      readThemeTokens: (el?: Element | null) => ThemeTokens;
    };
  }
}
window.__DASCADE_THEME__ = {
  registerTheme,
  listThemes,
  activeThemeId,
  setTheme: (id) => useApp.getState().updateSettings({ theme: id }),
  switchTheme: (id) => switchTheme(id),
  skinLoaded: (id) => loadedSkin(id) !== null,
  readThemeTokens,
};

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
  // Boot preload: the stored theme's structural skin (lazy chunk: CSS + environment) loads before the
  // first render so the shell never flashes unskinned — but never holds the first paint > 800 ms.
  void loadThemeSkinWithin(useApp.getState().settings.theme, 800).then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
}
