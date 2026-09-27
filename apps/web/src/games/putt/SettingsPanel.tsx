/** Host settings: play mode, which holes, shot clock and the stroke limit. */
import { useEffect, useRef } from 'react';
import { PUTT_SHOT_CLOCKS, puttRoute, type PuttCourse, type PuttMode, type PuttSettings } from '@dascade/shared/games/putt';
import { COURSE_NAME, NEON_NINE, getHole } from '@dascade/game-core/putt';
import { Segmented, cx, handleRovingKeys, rovingTabIndex } from '@dascade/ui';
import type { SettingsPanelProps } from '../types.ts';
import { drawHoleThumb } from './game/thumb.ts';
import { usePuttArt } from './game/usePuttArt.ts';

function HoleThumb({ number, w = 92, h = 54 }: { number: number; w?: number; h?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const art = usePuttArt(ref);
  useEffect(() => {
    if (ref.current) drawHoleThumb(ref.current, getHole(number), w, h, art);
  }, [number, w, h, art]);
  return <canvas ref={ref} className="pt-thumb" aria-hidden style={{ width: w, height: h }} />;
}

const COURSES: Array<{ value: PuttCourse; label: string; hint: string }> = [
  { value: 'full', label: 'Full course', hint: 'All nine holes' },
  { value: 'front', label: 'Front three', hint: 'Holes 1–3 · gentle' },
  { value: 'back', label: 'Back three', hint: 'Holes 7–9 · wild' },
  { value: 'single', label: 'One hole', hint: 'Practice a hole' },
];

export function PuttSettingsPanel({ settings, canEdit, update }: SettingsPanelProps<PuttSettings>) {
  const route = puttRoute(settings);
  const par = route.reduce((s, n) => s + getHole(n).par, 0);
  return (
    <div className="pt-settings">
      <div className="dc-field">
        <span className="dc-field__label">Mode</span>
        <Segmented<PuttMode>
          label="Play mode"
          value={settings.mode}
          disabled={!canEdit}
          options={[
            { value: 'turns', label: 'Classic · take turns' },
            { value: 'ghost', label: 'Party · all at once' },
          ]}
          onChange={(mode) => update({ mode })}
        />
        <span className="dc-field__hint">
          {settings.mode === 'ghost' ? 'Everyone putts at the same time — balls pass through each other.' : 'Stroke play: one putt at a time, in order.'}
        </span>
      </div>

      <div className="dc-field">
        <span className="dc-field__label" id="pt-course-label">
          Holes · {COURSE_NAME}
        </span>
        <div className="pt-courses" role="radiogroup" aria-labelledby="pt-course-label" onKeyDown={(e) => handleRovingKeys(e, 'radio')}>
          {COURSES.map((c, i) => (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={settings.course === c.value}
              tabIndex={rovingTabIndex(settings.course === c.value, i, true)}
              disabled={!canEdit}
              className={cx('pt-course', settings.course === c.value && 'is-on')}
              onClick={() => update({ course: c.value })}
            >
              <span className="pt-course__label">{c.label}</span>
              <span className="pt-course__hint">{c.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {settings.course === 'single' ? (
        <div className="dc-field">
          <span className="dc-field__label" id="pt-hole-label">
            Practice hole
          </span>
          <div className="pt-holes" role="radiogroup" aria-labelledby="pt-hole-label" onKeyDown={(e) => handleRovingKeys(e, 'radio')}>
            {NEON_NINE.map((h, i) => (
              <button
                key={h.number}
                type="button"
                role="radio"
                aria-checked={settings.hole === h.number}
                aria-label={`Hole ${h.number}: ${h.name}, par ${h.par}`}
                tabIndex={rovingTabIndex(settings.hole === h.number, i, true)}
                disabled={!canEdit}
                className={cx('pt-hole', settings.hole === h.number && 'is-on')}
                onClick={() => update({ hole: h.number })}
              >
                <HoleThumb number={h.number} />
                <span className="pt-hole__name">
                  <b className="pt-num">{h.number}</b> {h.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="pt-route" aria-label="Holes in this round">
          {route.map((n) => (
            <figure key={n} className="pt-route__hole">
              <HoleThumb number={n} w={76} h={44} />
              <figcaption>
                <b className="pt-num">{n}</b> · par <span className="pt-num">{getHole(n).par}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      <p className="dc-field__hint">
        {route.length} {route.length === 1 ? 'hole' : 'holes'} · par <span className="pt-num">{par}</span>
      </p>

      <div className="dc-field">
        <span className="dc-field__label">Shot clock</span>
        <Segmented
          label="Shot clock"
          value={String(settings.shotClock)}
          disabled={!canEdit}
          options={PUTT_SHOT_CLOCKS.map((s) => ({ value: String(s), label: `${s}s` }))}
          onChange={(v) => update({ shotClock: Number(v) })}
        />
        <span className="dc-field__hint">A timeout costs a stroke; two in a row pick the ball up. Solo practice has no clock.</span>
      </div>

      <div className="dc-field">
        <span className="dc-field__label">Stroke limit</span>
        <Segmented
          label="Stroke limit per hole"
          value={String(settings.maxOverPar)}
          disabled={!canEdit}
          options={[3, 4, 5].map((n) => ({ value: String(n), label: `Par +${n}` }))}
          onChange={(v) => update({ maxOverPar: Number(v) })}
        />
      </div>
    </div>
  );
}
