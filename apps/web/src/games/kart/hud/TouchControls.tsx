/**
 * Touch controls, designed for thumbs:
 *  - Left: a floating steering pad — put your thumb down anywhere in the left zone and slide
 *    sideways (analog; the knob shows where you are). Nothing to find by feel.
 *  - Right: a big DRIFT (hold) under the resting thumb, ITEM above it (tap = use, hold = trail,
 *    swipe down and release = throw it backwards), a smaller BRAKE, and the auto-accelerate toggle.
 * Everything writes straight into the input sampler — no React state per frame.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { PixelIcon, cx } from '@dascade/ui';
import type { KartInputSampler } from '../input/input.ts';
import type { HudBridge } from './bridge.ts';
import { itemIconUrl } from '../art/icons.ts';

/** Horizontal travel (CSS px) for full lock. */
const STEER_RANGE = 58;
/** Keep receiving a thumb's moves after it slides off the control (never throws: the pointer may be gone). */
function capture(el: Element | null, pointerId: number): void {
  try {
    el?.setPointerCapture(pointerId);
  } catch {
    /* pointer already released */
  }
}

/** Vertical travel on ITEM that aims it (down = back, up = ahead). */
const SWIPE_AIM = 26;

export function TouchControls({
  sampler,
  bridge,
  itemsOn,
  locked,
}: {
  sampler: KartInputSampler;
  bridge: HudBridge;
  itemsOn: boolean;
  locked: boolean;
}) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLSpanElement>(null);
  const knobRef = useRef<HTMLSpanElement>(null);
  const steerPtr = useRef<{ id: number; x: number; y: number } | null>(null);
  const itemPtr = useRef<{ id: number; y: number } | null>(null);
  const [autoGas, setAutoGas] = useState(sampler.touch.autoGas);
  const [down, setDown] = useState({ drift: false, brake: false, gas: false, item: false, back: false, ahead: false });

  useEffect(() => {
    sampler.touch.autoGas = autoGas;
  }, [autoGas, sampler]);

  // Never leave a button "held" when the controls unmount (results, spectating).
  useEffect(
    () => () => {
      Object.assign(sampler.touch, { steer: 0, gas: false, brake: false, drift: false, item: false, back: false, ahead: false });
    },
    [sampler],
  );

  const showSteer = (v: number, origin: { x: number; y: number } | null) => {
    const zone = zoneRef.current;
    const base = baseRef.current;
    const knob = knobRef.current;
    if (!zone || !base || !knob) return;
    if (origin) {
      const r = zone.getBoundingClientRect();
      base.style.transform = `translate(${origin.x - r.left}px, ${origin.y - r.top}px)`;
      zone.dataset.active = 'true';
    } else {
      base.style.transform = '';
      delete zone.dataset.active;
    }
    // v is + = left; the knob moves the way the thumb moved.
    knob.style.transform = `translateX(${-v * STEER_RANGE}px)`;
  };

  const setSteer = (v: number) => {
    sampler.touch.steer = v;
    sampler.touched();
  };

  const onZoneDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (steerPtr.current) return;
    e.preventDefault();
    capture(zoneRef.current, e.pointerId);
    steerPtr.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    setSteer(0);
    showSteer(0, { x: e.clientX, y: e.clientY });
  };
  const onZoneMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const o = steerPtr.current;
    if (!o || o.id !== e.pointerId) return;
    let dx = e.clientX - o.x;
    // Let the origin trail a thumb that overshoots, so reversing never needs a long slide back.
    if (Math.abs(dx) > STEER_RANGE) {
      o.x += dx - Math.sign(dx) * STEER_RANGE;
      dx = Math.sign(dx) * STEER_RANGE;
    }
    const raw = dx / STEER_RANGE;
    const dead = 0.06;
    const a = Math.max(0, (Math.abs(raw) - dead) / (1 - dead));
    const v = -Math.sign(raw) * Math.min(1, a * (0.55 + 0.45 * a));
    setSteer(v);
    showSteer(v, { x: o.x, y: o.y });
  };
  const onZoneUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (steerPtr.current?.id !== e.pointerId) return;
    steerPtr.current = null;
    setSteer(0);
    showSteer(0, null);
  };

  const hold = (key: 'drift' | 'brake' | 'gas') => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      capture(e.currentTarget, e.pointerId);
      sampler.touch[key] = true;
      sampler.touched();
      setDown((d) => ({ ...d, [key]: true }));
    },
    onPointerUp: () => {
      sampler.touch[key] = false;
      setDown((d) => ({ ...d, [key]: false }));
    },
    onPointerCancel: () => {
      sampler.touch[key] = false;
      setDown((d) => ({ ...d, [key]: false }));
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const setAim = (aim: 'none' | 'back' | 'ahead') => {
    const back = aim === 'back';
    const ahead = aim === 'ahead';
    if (back === sampler.touch.back && ahead === sampler.touch.ahead) return;
    sampler.touch.back = back;
    sampler.touch.ahead = ahead;
    setDown((d) => ({ ...d, back, ahead }));
  };
  const itemDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    capture(e.currentTarget, e.pointerId);
    itemPtr.current = { id: e.pointerId, y: e.clientY };
    sampler.touch.item = true;
    sampler.touched();
    setAim('none');
    setDown((d) => ({ ...d, item: true }));
  };
  // Swipe while holding: down = throw it back, up = lob it ahead (a trailed item fires on release).
  const itemMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = itemPtr.current;
    if (!p || p.id !== e.pointerId) return;
    const dy = e.clientY - p.y;
    setAim(dy > SWIPE_AIM ? 'back' : dy < -SWIPE_AIM ? 'ahead' : 'none');
  };
  const itemUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (itemPtr.current?.id !== e.pointerId) return;
    itemPtr.current = null;
    if (sampler.touch.back) sampler.latchAim(performance.now(), 'back');
    if (sampler.touch.ahead) sampler.latchAim(performance.now(), 'ahead');
    sampler.touch.item = false;
    setAim('none');
    setDown((d) => ({ ...d, item: false }));
  };

  return (
    <div className="kt-touch" data-part="controls" aria-label="Touch driving controls">
      <div
        className="kt-touch__zone"
        ref={zoneRef}
        role="slider"
        aria-label="Steering: slide your thumb left or right"
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={0}
        tabIndex={-1}
        onPointerDown={onZoneDown}
        onPointerMove={onZoneMove}
        onPointerUp={onZoneUp}
        onPointerCancel={onZoneUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span className="kt-touch__base" ref={baseRef} aria-hidden>
          <span className="kt-touch__rail">
            <PixelIcon name="arrow-left" />
            <PixelIcon name="arrow-right" />
          </span>
          <span className="kt-touch__knob" ref={knobRef} />
        </span>
      </div>

      <div className="kt-touch__right">
        <button
          type="button"
          className={cx('kt-touch__auto', autoGas && 'is-on')}
          aria-pressed={autoGas}
          onClick={() => setAutoGas((v) => !v)}
        >
          <PixelIcon name="bolt" /> Auto-gas {autoGas ? 'on' : 'off'}
        </button>
        {itemsOn ? (
          <button
            type="button"
            className={cx('kt-touch__btn kt-touch__btn--item', down.item && 'is-down', down.back && 'is-back', down.ahead && 'is-ahead')}
            aria-label="Use item (hold to trail it; swipe down to throw it back, up to lob it ahead)"
            onPointerDown={itemDown}
            onPointerMove={itemMove}
            onPointerUp={itemUp}
            onPointerCancel={itemUp}
            onContextMenu={(e) => e.preventDefault()}
            ref={bridge.ref('touchItem')}
          >
            <img className="kt-touch__ghost" src={itemIconUrl('prism')} alt="" draggable={false} />
            <img className="kt-touch__itemicon" ref={bridge.ref('touchItemIcon')} alt="" draggable={false} />
            <span className="kt-touch__count" ref={bridge.ref('touchItemCount')} />
            <span className="kt-touch__label">{down.back ? 'Back' : down.ahead ? 'Ahead' : 'Item'}</span>
          </button>
        ) : null}
        <button
          type="button"
          className={cx('kt-touch__btn kt-touch__btn--drift', down.drift && 'is-down')}
          aria-label="Drift (hold)"
          {...hold('drift')}
        >
          <PixelIcon name="sparkle" />
          <span className="kt-touch__label">Drift</span>
        </button>
        <button
          type="button"
          className={cx('kt-touch__btn kt-touch__btn--brake', down.brake && 'is-down')}
          aria-label="Brake / reverse"
          {...hold('brake')}
        >
          <PixelIcon name="chevron-down" />
          <span className="kt-touch__label">Brake</span>
        </button>
        {autoGas && !locked ? null : (
          <button
            type="button"
            className={cx('kt-touch__btn kt-touch__btn--gas', down.gas && 'is-down', locked && 'is-start')}
            aria-label={locked ? 'Rev for a rocket start (hold as the last light comes on)' : 'Accelerate'}
            {...hold('gas')}
          >
            <PixelIcon name="chevron-up" />
            <span className="kt-touch__label">Gas</span>
          </button>
        )}
      </div>
    </div>
  );
}
