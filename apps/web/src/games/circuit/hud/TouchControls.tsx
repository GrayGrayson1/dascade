/**
 * Touch controls: a left-thumb steering pad (drag from wherever you touch) and
 * right-thumb pedal buttons (gas, brake, drift, boost) with an auto-gas toggle.
 * Writes straight into the InputSampler — no React state per frame.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { PixelIcon, cx } from '@dascade/ui';
import type { InputSampler } from '../net/input.ts';

type Pedal = 'gas' | 'brake' | 'drift' | 'boost';

export function TouchControls({ sampler, boost }: { sampler: InputSampler; boost: boolean }) {
  const padRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLSpanElement>(null);
  const origin = useRef<{ id: number; x: number } | null>(null);
  const [autoGas, setAutoGas] = useState(sampler.touch.autoGas);
  const [pressed, setPressed] = useState<Record<Pedal, boolean>>({ gas: false, brake: false, drift: false, boost: false });

  useEffect(() => {
    sampler.touch.autoGas = autoGas;
  }, [autoGas, sampler]);

  const setSteer = (v: number) => {
    sampler.touch.steer = v;
    sampler.touched();
    if (knobRef.current) knobRef.current.style.transform = `translateX(${v * 44}px)`;
  };

  const onPadDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    padRef.current?.setPointerCapture(e.pointerId);
    origin.current = { id: e.pointerId, x: e.clientX };
    setSteer(0);
  };
  const onPadMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const o = origin.current;
    if (!o || o.id !== e.pointerId) return;
    const dx = e.clientX - o.x;
    const v = Math.max(-1, Math.min(1, dx / 56));
    setSteer(Math.sign(v) * Math.pow(Math.abs(v), 1.15));
  };
  const onPadUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (origin.current?.id !== e.pointerId) return;
    origin.current = null;
    setSteer(0);
  };

  const press = (pedal: Pedal, down: boolean) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (down) e.currentTarget.setPointerCapture?.(e.pointerId);
    sampler.touch[pedal] = down;
    sampler.touched();
    setPressed((p) => (p[pedal] === down ? p : { ...p, [pedal]: down }));
  };

  const pedal = (id: Pedal, label: string, icon: Parameters<typeof PixelIcon>[0]['name'], className: string) => (
    <button
      type="button"
      className={cx('ci-touch__btn', className, pressed[id] && 'is-down')}
      aria-label={label}
      aria-pressed={pressed[id]}
      onPointerDown={press(id, true)}
      onPointerUp={press(id, false)}
      onPointerCancel={press(id, false)}
      onPointerLeave={(e) => pressed[id] && press(id, false)(e)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <PixelIcon name={icon} />
      <span>{label}</span>
    </button>
  );

  return (
    <div className="ci-touch" data-part="controls" aria-label="Touch driving controls">
      <div
        className="ci-touch__pad"
        ref={padRef}
        role="slider"
        aria-label="Steering"
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={0}
        tabIndex={-1}
        onPointerDown={onPadDown}
        onPointerMove={onPadMove}
        onPointerUp={onPadUp}
        onPointerCancel={onPadUp}
      >
        <span className="ci-touch__rail" aria-hidden>
          <PixelIcon name="arrow-left" />
          <PixelIcon name="arrow-right" />
        </span>
        <span className="ci-touch__knob" ref={knobRef} aria-hidden />
      </div>
      <div className="ci-touch__pedals">
        <button type="button" className={cx('ci-touch__auto', autoGas && 'is-on')} aria-pressed={autoGas} onClick={() => setAutoGas((v) => !v)}>
          Auto-gas {autoGas ? 'on' : 'off'}
        </button>
        {pedal('drift', 'Drift', 'sparkle', 'ci-touch__btn--drift')}
        {boost ? pedal('boost', 'Boost', 'bolt', 'ci-touch__btn--boost') : null}
        {pedal('brake', 'Brake', 'chevron-down', 'ci-touch__btn--brake')}
        {autoGas ? null : pedal('gas', 'Gas', 'chevron-up', 'ci-touch__btn--gas')}
      </div>
    </div>
  );
}
