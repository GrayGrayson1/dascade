/**
 * HudBridge: lets the race controller write high-frequency HUD values (speed,
 * timers, boost, banners) straight into DOM nodes at ~10–30 Hz without React
 * re-renders. React components register elements via `bridge.ref(key)`.
 */
export class HudBridge {
  private readonly els = new Map<string, HTMLElement>();
  private readonly lastText = new Map<string, string>();
  private readonly lastStyle = new Map<string, string>();
  private readonly refs = new Map<string, (el: HTMLElement | null) => void>();

  /** Stable callback ref for an element key. */
  ref<T extends HTMLElement = HTMLElement>(key: string): (el: T | null) => void {
    let fn = this.refs.get(key);
    if (!fn) {
      fn = (el: HTMLElement | null) => {
        if (el) this.els.set(key, el);
        else this.els.delete(key);
        this.lastText.delete(key);
      };
      this.refs.set(key, fn);
    }
    return fn as (el: T | null) => void;
  }

  el<T extends HTMLElement = HTMLElement>(key: string): T | null {
    return (this.els.get(key) as T | undefined) ?? null;
  }

  text(key: string, value: string): void {
    if (this.lastText.get(key) === value) return;
    const el = this.els.get(key);
    if (!el) return;
    el.textContent = value;
    this.lastText.set(key, value);
  }

  style(key: string, prop: string, value: string): void {
    const id = `${key}|${prop}`;
    if (this.lastStyle.get(id) === value) return;
    const el = this.els.get(key);
    if (!el) return;
    el.style.setProperty(prop, value);
    this.lastStyle.set(id, value);
  }

  data(key: string, name: string, value: string | null): void {
    const el = this.els.get(key);
    if (!el) return;
    if (value === null) el.removeAttribute(`data-${name}`);
    else if (el.getAttribute(`data-${name}`) !== value) el.setAttribute(`data-${name}`, value);
  }
}
