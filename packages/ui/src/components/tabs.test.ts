import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tabs, tabId, tabPanelId, tabPanelProps } from './core.tsx';

const TABS = [
  { value: 'sound', label: 'Sound' },
  { value: 'display', label: 'Display' },
] as const;

const render = (props: { idBase?: string; allPanels?: boolean }) =>
  renderToStaticMarkup(createElement(Tabs<'sound' | 'display'>, { label: 'Sections', value: 'sound', onChange: () => undefined, tabs: TABS, ...props }));

/** Each tab button's attributes, in order. */
function tabsOf(html: string): Array<Record<string, string>> {
  return [...html.matchAll(/<button([^>]*)>/g)].map((m) => Object.fromEntries([...m[1]!.matchAll(/([a-z-]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!])));
}

describe('Tabs ids and aria-controls', () => {
  it('without idBase renders as before: no ids, no aria-controls', () => {
    for (const t of tabsOf(render({}))) {
      expect(t.id).toBeUndefined();
      expect(t['aria-controls']).toBeUndefined();
    }
  });

  it('with idBase every tab gets its id; only the selected one points at a panel by default', () => {
    const [sound, display] = tabsOf(render({ idBase: 'set' }));
    expect(sound).toMatchObject({ id: 'set-tab-sound', 'aria-controls': 'set-panel-sound', 'aria-selected': 'true' });
    expect(display).toMatchObject({ id: 'set-tab-display', 'aria-selected': 'false' });
    expect(display!['aria-controls']).toBeUndefined();
  });

  it('with allPanels every tab points at its own panel', () => {
    const [sound, display] = tabsOf(render({ idBase: 'lobby', allPanels: true }));
    expect(sound!['aria-controls']).toBe('lobby-panel-sound');
    expect(display!['aria-controls']).toBe('lobby-panel-display');
  });

  it('panel props pair with the tab ids', () => {
    expect(tabPanelProps('set', 'sound')).toEqual({ id: tabPanelId('set', 'sound'), role: 'tabpanel', 'aria-labelledby': tabId('set', 'sound') });
    expect(tabId('set', 'sound')).toBe('set-tab-sound');
    expect(tabPanelId('set', 'sound')).toBe('set-panel-sound');
  });
});
