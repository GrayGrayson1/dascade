/**
 * The showcase console's drawer (PRS-01 A): one tabbed panel under the pinned stage preview, so the
 * side column never grows past the screen. A real tablist: arrow keys move between tabs (and pick
 * them), Home/End jump to the ends, the chosen tab is the only tab stop, and each panel is labelled
 * by its tab. Below 1180 px the tabs show their icon only (the name stays their accessible name).
 *
 * The last tab you picked is remembered for this browser tab (presentation only).
 */
import { useState, type ReactNode } from 'react';
import { PixelIcon, cx, handleRovingKeys, rovingTabIndex, type IconName } from '@dascade/ui';

export interface DrawerTab {
  id: string;
  label: string;
  icon: IconName;
  /** Something needs a look here (a dot on the tab, and these words for screen readers). */
  alert?: string;
  render: () => ReactNode;
}

const KEY = 'dascade:showdown:drawer';

function readTab(): string {
  try {
    return sessionStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

function writeTab(id: string): void {
  try {
    sessionStorage.setItem(KEY, id);
  } catch {
    /* storage unavailable: the choice lasts until the console re-mounts */
  }
}

export function ConsoleDrawer({ tabs, label = 'Console tools' }: { tabs: readonly DrawerTab[]; label?: string }) {
  const [picked, setPicked] = useState(readTab);
  const current = tabs.find((t) => t.id === picked) ?? tabs[0];
  if (!current) return null;
  const pick = (id: string) => {
    setPicked(id);
    writeTab(id);
  };
  return (
    <section className="sd-panel sdc-drawer" aria-label={label} data-part="showdown-drawer">
      <div className="sdc-drawer__tabs" role="tablist" aria-label={label} onKeyDown={(e) => handleRovingKeys(e, 'tab')}>
        {tabs.map((t, i) => {
          const on = t.id === current.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`sdc-tab-${t.id}`}
              aria-selected={on}
              aria-controls={`sdc-tabpanel-${t.id}`}
              tabIndex={rovingTabIndex(on, i, true)}
              className={cx('sdc-drawer__tab', on && 'is-on')}
              title={t.label}
              data-tab={t.id}
              onClick={() => pick(t.id)}
            >
              <PixelIcon name={t.icon} aria-hidden />
              <span className="sdc-drawer__label">{t.label}</span>
              {t.alert ? (
                <>
                  <i className="sdc-drawer__dot" aria-hidden />
                  <span className="visually-hidden">({t.alert})</span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
      <div
        className="sdc-drawer__body"
        role="tabpanel"
        id={`sdc-tabpanel-${current.id}`}
        aria-labelledby={`sdc-tab-${current.id}`}
        tabIndex={0}
        data-tab={current.id}
      >
        {current.render()}
      </div>
    </section>
  );
}
