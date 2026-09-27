import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_THEMES, getTheme, listThemes } from '@dascade/ui';
import { DEFAULT_THEME_PREF, migrateSettings, peekStoredTheme, type AppSettings } from '../app/settings.ts';
import { TIMING, createThemeSwitcher, transitionStyleFor, type TransitionPhase } from './switcher.ts';
import {
  __resetSkinCacheForTests,
  loadThemeSkin,
  loadThemeSkinWithin,
  loadedSkin,
  registerSkinLoader,
  skinIds,
  skinKey,
} from './registry.ts';
import { placeFromPath, resolvePlace } from './place.ts';
import { fill, themeCopy, tickerItems } from './copy.ts';
import { PREVIEW_STYLE_ID, acquirePreviewStyles, allPreviewCss, previewCss, previewRefCount } from './preview.ts';

afterEach(() => {
  vi.useRealTimers();
  __resetSkinCacheForTests();
});

// ---------------------------------------------------------------------------
describe('persisted selection → rendered theme', () => {
  const DEFAULTS = {
    masterVolume: 0.8,
    sfxVolume: 0.7,
    musicVolume: 0.35,
    muted: false,
    musicEnabled: false,
    jukeboxVolume: 0.7,
    visualizer: 'auto',
    gameMusicWithJukebox: 'mute',
    reducedMotion: false,
    fx: 'high',
    theme: DEFAULT_THEME_PREF,
  } satisfies AppSettings;
  const storage = (raw: string | null) => ({ getItem: () => raw });

  it('a stored theme is read synchronously at boot and rendered', () => {
    for (const t of BUILT_IN_THEMES) {
      const id = peekStoredTheme(storage(JSON.stringify({ theme: t.id })));
      expect(getTheme(id).id).toBe(t.id);
    }
  });

  it('corrupt storage renders Delta Neon', () => {
    for (const raw of ['{', 'null', '[]', '"x"', JSON.stringify({ theme: 42 }), JSON.stringify({ theme: '<script>' })]) {
      expect(getTheme(peekStoredTheme(storage(raw))).id).toBe('delta-neon');
    }
  });

  it('an unknown-but-valid id survives migration yet renders Delta Neon', () => {
    const migrated = migrateSettings({ settingsVersion: 3, theme: 'windows-2000' }, DEFAULTS);
    expect(migrated.theme).toBe('windows-2000');
    expect(getTheme(migrated.theme).id).toBe('delta-neon');
    expect(skinKey(migrated.theme)).toBe('delta-neon');
  });
});

// ---------------------------------------------------------------------------
describe('theme switcher (transition layer)', () => {
  function harness(opts: { calm?: boolean; load?: (id: string) => Promise<unknown> } = {}) {
    let current = 'delta-neon';
    const applied: string[] = [];
    const phases: TransitionPhase[] = [];
    const sw = createThemeSwitcher({
      current: () => current,
      apply: (id) => {
        current = id;
        applied.push(id);
      },
      load: opts.load ?? (() => Promise.resolve()),
      calm: () => opts.calm ?? false,
      settle: () => Promise.resolve(),
    });
    sw.subscribe(() => {
      const p = sw.getState().phase;
      if (phases[phases.length - 1] !== p) phases.push(p);
    });
    return { sw, applied, phases, current: () => current };
  }

  it('covers, applies the theme while covered, then reveals (target theme transition style, ≤ ~700ms)', async () => {
    vi.useFakeTimers();
    const h = harness();
    const done = h.sw.switchTo('vhs-after-dark');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sw.getState().phase).toBe('cover');
    expect(h.sw.getState().style).toBe(transitionStyleFor('vhs-after-dark'));
    expect(h.applied).toEqual([]); // nothing changes until the screen is covered
    await vi.advanceTimersByTimeAsync(TIMING.coverMs);
    expect(h.applied).toEqual(['vhs-after-dark']);
    await vi.advanceTimersByTimeAsync(TIMING.revealMs);
    await done;
    expect(h.phases).toEqual(['cover', 'covered', 'reveal', 'idle']);
    expect(h.sw.busy()).toBe(false);
    expect(TIMING.coverMs + TIMING.revealMs).toBeLessThanOrEqual(700);
  });

  it('rapid repeated switching never stacks: one transition, newest choice wins', async () => {
    vi.useFakeTimers();
    const h = harness();
    const runs = new Set<number>();
    h.sw.subscribe(() => runs.add(h.sw.getState().run));
    const p1 = h.sw.switchTo('shareware-97');
    const p2 = h.sw.switchTo('corporate-98');
    await vi.advanceTimersByTimeAsync(50);
    const p3 = h.sw.switchTo('neon-noir');
    expect(p1).toBe(p2); // same running transition
    expect(p2).toBe(p3);
    await vi.advanceTimersByTimeAsync(2000);
    await p3;
    expect(h.applied).toEqual(['neon-noir']);
    expect(h.current()).toBe('neon-noir');
    expect(runs.size).toBe(1);
    expect(h.sw.getState().phase).toBe('idle');
  });

  it('retargeting while covered applies the newest theme without re-covering', async () => {
    vi.useFakeTimers();
    let release: () => void = () => undefined;
    const h = harness({
      load: (id) => (id === 'lan-party' ? new Promise<void>((r) => (release = r)) : Promise.resolve()),
    });
    const done = h.sw.switchTo('executive');
    await vi.advanceTimersByTimeAsync(TIMING.coverMs + 1);
    expect(h.applied).toEqual(['executive']);
    h.sw.switchTo('lan-party'); // during reveal → one more pass
    await vi.advanceTimersByTimeAsync(TIMING.revealMs);
    release();
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    expect(h.applied).toEqual(['executive', 'lan-party']);
    expect(h.sw.getState().phase).toBe('idle');
  });

  it('switching back to the current theme while covered just reveals it', async () => {
    vi.useFakeTimers();
    const h = harness();
    const done = h.sw.switchTo('saturday-morning');
    await vi.advanceTimersByTimeAsync(10);
    h.sw.switchTo('delta-neon');
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    expect(h.current()).toBe('delta-neon');
    expect(h.sw.getState().phase).toBe('idle');
  });

  it('reduced motion / minimal fx use a short fade (≤150ms total)', async () => {
    vi.useFakeTimers();
    const h = harness({ calm: true });
    const done = h.sw.switchTo('space-casino-2088');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sw.getState().style).toBe('fade');
    expect(TIMING.calmCoverMs + TIMING.calmRevealMs).toBeLessThanOrEqual(150);
    await vi.advanceTimersByTimeAsync(TIMING.calmCoverMs + TIMING.calmRevealMs + 5);
    await done;
    expect(h.applied).toEqual(['space-casino-2088']);
  });

  it('a slow skin never blocks the switch for more than the load timeout', async () => {
    vi.useFakeTimers();
    const h = harness({ load: () => new Promise(() => undefined) });
    const done = h.sw.switchTo('mall-arcade-92');
    await vi.advanceTimersByTimeAsync(TIMING.loadTimeoutMs + TIMING.coverMs + TIMING.revealMs + 10);
    await done;
    expect(h.applied).toEqual(['mall-arcade-92']);
  });

  it('animate:false applies instantly; selecting the current theme is a no-op', async () => {
    const h = harness();
    await h.sw.switchTo('delta-neon');
    expect(h.applied).toEqual([]);
    expect(h.phases).toEqual([]);
    await h.sw.switchTo('neon-noir', { animate: false });
    expect(h.applied).toEqual(['neon-noir']);
    expect(h.phases).toEqual([]);
  });

  it('every built-in theme maps to an implemented transition style', () => {
    const styles = ['power', 'boot', 'shutter', 'fluorescent', 'tracking', 'warp', 'crt-off', 'wipe', 'fade'];
    for (const t of BUILT_IN_THEMES) expect(styles).toContain(transitionStyleFor(t.id));
    expect(transitionStyleFor('not-a-theme')).toBe(transitionStyleFor('delta-neon'));
  });
});

// ---------------------------------------------------------------------------
describe('skin loader', () => {
  it('has a lazy skin for every built-in theme and loads each one', async () => {
    for (const t of BUILT_IN_THEMES) expect(skinIds()).toContain(t.id);
    for (const t of BUILT_IN_THEMES) {
      const skin = await loadThemeSkin(t.id);
      expect(skin.id).toBe(t.id);
      expect(loadedSkin(t.id)).toBe(skin);
    }
  });

  it('unknown ids resolve to the Delta Neon skin', async () => {
    expect((await loadThemeSkin('no-such-theme')).id).toBe('delta-neon');
    expect(skinKey(null)).toBe('delta-neon');
  });

  it('never rejects: a failing chunk degrades to a token-only skin', async () => {
    const { registerTheme, unregisterTheme } = await import('@dascade/ui');
    registerTheme({ ...getTheme('neon-noir'), id: 'broken-skin', name: 'Broken' });
    try {
      registerSkinLoader('broken-skin', () => Promise.reject(new Error('chunk failed')));
      await expect(loadThemeSkin('broken-skin')).resolves.toEqual({ id: 'broken-skin' });
    } finally {
      unregisterTheme('broken-skin');
    }
  });

  it('caches: concurrent and repeated loads call the loader once', async () => {
    const { registerTheme, unregisterTheme } = await import('@dascade/ui');
    registerTheme({ ...getTheme('neon-noir'), id: 'counted-skin', name: 'Counted' });
    try {
      const loader = vi.fn(() => Promise.resolve({ default: { id: 'counted-skin' } }));
      registerSkinLoader('counted-skin', loader);
      const [a, b] = await Promise.all([loadThemeSkin('counted-skin'), loadThemeSkin('counted-skin')]);
      await loadThemeSkin('counted-skin');
      expect(a).toBe(b);
      expect(loader).toHaveBeenCalledTimes(1);
    } finally {
      unregisterTheme('counted-skin');
    }
  });

  it('loadThemeSkinWithin gives up after the deadline (boot never waits longer)', async () => {
    vi.useFakeTimers();
    const { registerTheme, unregisterTheme } = await import('@dascade/ui');
    registerTheme({ ...getTheme('neon-noir'), id: 'slow-skin', name: 'Slow' });
    try {
      registerSkinLoader('slow-skin', () => new Promise(() => undefined));
      const p = loadThemeSkinWithin('slow-skin', 800);
      await vi.advanceTimersByTimeAsync(800);
      await expect(p).resolves.toBeNull();
    } finally {
      unregisterTheme('slow-skin');
    }
  });

  it('built-in skins cannot be replaced', () => {
    expect(() => registerSkinLoader('delta-neon', () => Promise.resolve({ default: { id: 'delta-neon' } }))).toThrow();
  });
});

// ---------------------------------------------------------------------------
describe('place detection', () => {
  it('maps routes to places', () => {
    expect(placeFromPath('/')).toBe('floor');
    expect(placeFromPath('/cabinet/boardroom')).toBe('cabinet');
    expect(placeFromPath('/play/chess')).toBe('entry');
    expect(placeFromPath('/tournaments')).toBe('tournament');
    expect(placeFromPath('/play/tournament')).toBe('tournament');
    expect(placeFromPath('/room/ABCD')).toBe('lobby');
    expect(placeFromPath('/nope')).toBe('other');
  });

  it('rooms report lobby vs game', () => {
    expect(resolvePlace('/room/ABCD', 'game')).toBe('game');
    expect(resolvePlace('/room/ABCD', null)).toBe('lobby');
    expect(resolvePlace('/', 'game')).toBe('floor'); // stale report never leaks outside a room
  });
});

// ---------------------------------------------------------------------------
describe('themed copy', () => {
  it('falls back to the plain text when a theme has no copy for a key', () => {
    expect(themeCopy('delta-neon', 'results.title', 'Results')).toBe('Results');
    expect(themeCopy('no-such-theme', 'lobby.title', 'Lobby')).toBe('Lobby');
    for (const t of BUILT_IN_THEMES) {
      const v = themeCopy(t.id, 'settings.title', 'Settings');
      expect(v.length).toBeGreaterThan(0);
      expect(v).toBe(t.copy?.['settings.title'] ?? 'Settings');
    }
  });

  it('fills placeholders and splits ticker items', () => {
    expect(fill('{cabinets} CABINETS ONLINE · {rooms} rooms · {nope}', { cabinets: 11, rooms: 2 })).toBe(
      '11 CABINETS ONLINE · 2 rooms · {nope}',
    );
    expect(tickerItems(' MODEM READY | | NETWORK OK|')).toEqual(['MODEM READY', 'NETWORK OK']);
    expect(tickerItems(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('picker previews', () => {
  class FakeStyle {
    id = '';
    textContent: string | null = null;
    constructor(private readonly doc: FakeDoc) {}
    remove() {
      this.doc.nodes = this.doc.nodes.filter((n) => n !== this);
    }
  }
  class FakeDoc {
    nodes: FakeStyle[] = [];
    head = { appendChild: (n: FakeStyle) => this.nodes.push(n) };
    getElementById(id: string) {
      return this.nodes.find((n) => n.id === id) ?? null;
    }
    createElement() {
      return new FakeStyle(this);
    }
  }

  it('scopes each theme’s tokens to [data-theme-preview] (and never to :root)', () => {
    const css = previewCss(getTheme('corporate-98'));
    expect(css.startsWith("[data-theme-preview='corporate-98'] {")).toBe(true);
    expect(css).toContain('--mat-felt:');
    expect(css).toContain('--glow-sm: var(--glow-sm-full);');
    expect(css).not.toContain(':root');
    const all = allPreviewCss();
    for (const t of listThemes()) expect(all).toContain(`[data-theme-preview='${t.id}']`);
  });

  it('injects one <style> while any picker is open and removes it when the last closes', () => {
    const doc = new FakeDoc();
    const d = doc as unknown as Document;
    const r1 = acquirePreviewStyles(d);
    const r2 = acquirePreviewStyles(d);
    expect(doc.nodes.filter((n) => n.id === PREVIEW_STYLE_ID)).toHaveLength(1);
    r1();
    r1(); // double release is harmless
    expect(doc.getElementById(PREVIEW_STYLE_ID)).not.toBeNull();
    r2();
    expect(doc.getElementById(PREVIEW_STYLE_ID)).toBeNull();
    expect(previewRefCount()).toBe(0);
    for (let i = 0; i < 50; i++) acquirePreviewStyles(d)();
    expect(doc.nodes).toHaveLength(0);
  });
});
