/**
 * PlayerSetup: the car customizer shown in the lobby. Live animated preview,
 * chassis / paint / decal / wheels / number / nameplate. Sent to the server
 * (validated there) and saved locally via persistence.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  CAR_PAINTS,
  CHASSIS_IDS,
  CIRCUIT_CAR_DOC,
  CIRCUIT_MSG,
  CarConfigSchema,
  DECAL_IDS,
  NAMEPLATE_MAX,
  WHEEL_IDS,
  defaultCarConfig,
  nameplateFrom,
  type CarConfig,
  type ChassisId,
  type CircuitPublicState,
  type DecalId,
  type WheelId,
} from '@dascade/shared/games/circuit';
import { CHASSIS } from '@dascade/game-core/circuit';
import { Button, ColorSwatches, Field, NumberInput, TextInput, cx } from '@dascade/ui';
import { useApp } from '../../app/store.ts';
import { useRoomSelector } from '../../net/hooks.ts';
import { session, useSessionStore } from '../../net/session.ts';
import { persistence } from '../../persistence/index.ts';
import { sfx } from '../../audio/audio.ts';
import { carDims, drawCar } from './art/carArt.ts';
import { rgba } from './art/palette.ts';
import { CarThumb } from './CarThumb.tsx';

const DECAL_LABEL: Record<DecalId, string> = {
  none: 'Clean',
  stripes: 'Racing stripes',
  flames: 'Flames',
  checker: 'Checker',
  bolt: 'Bolt',
  panel: 'Number panel',
};
const WHEEL_LABEL: Record<WheelId, string> = { spoke: 'Spoke', disc: 'Disc', turbo: 'Turbo glow' };

function CarPreview({ config }: { config: CarConfig }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cfgRef = useRef(config);
  cfgRef.current = config;
  const reduced = useApp((s) => s.settings.reducedMotion);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let raf = 0;
    let visible = true;
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
    });
    io.observe(canvas);
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (!visible) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth || 320;
      const h = canvas.clientHeight || 190;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const g = canvas.getContext('2d');
      if (!g) return;
      const look = cfgRef.current;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Garage floor.
      g.fillStyle = '#0a0c18';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(120,140,220,0.08)';
      g.lineWidth = 1;
      for (let x = (t / 60) % 24; x < w; x += 24) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, h);
        g.stroke();
      }
      for (let y = 0; y < h; y += 24) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
      const spot = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, Math.max(w, h) * 0.6);
      spot.addColorStop(0, 'rgba(34,211,238,0.14)');
      spot.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = spot;
      g.fillRect(0, 0, w, h);
      const { L } = carDims(look.chassis);
      const scale = Math.min(w * 0.5, h * 0.74) / L;
      const angle = reduced ? -0.35 : -Math.PI / 2 + Math.sin(t / 2400) * 0.9 + t / 9000;
      // Neon underglow.
      g.save();
      g.translate(w / 2, h / 2);
      g.globalCompositeOperation = 'lighter';
      const glow = g.createRadialGradient(0, 0, 4, 0, 0, L * scale * 0.75);
      glow.addColorStop(0, rgba(look.primary, 0.55));
      glow.addColorStop(1, rgba(look.primary, 0));
      g.fillStyle = glow;
      g.beginPath();
      g.ellipse(0, 0, L * scale * 0.75, L * scale * 0.55, angle, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.save();
      g.translate(w / 2, h / 2);
      g.rotate(angle);
      g.scale(scale, scale);
      drawCar(g, look, { shadow: true, steer: reduced ? 0 : Math.sin(t / 700) * 0.35 });
      g.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [reduced]);
  return <canvas ref={ref} className="ci-preview" role="img" aria-label={`${CHASSIS[config.chassis].label} car preview, number ${config.number}`} />;
}

function Pips({ value, label }: { value: number; label: string }) {
  return (
    <span className="ci-pips" aria-label={`${label} ${value} of 5`}>
      <span className="ci-pips__label">{label}</span>
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} data-on={i < value ? 'true' : undefined} />
      ))}
    </span>
  );
}

function randomConfig(nameplate: string): CarConfig {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]!;
  let secondary = pick(CAR_PAINTS);
  const primary = pick(CAR_PAINTS);
  if (secondary === primary) secondary = CAR_PAINTS[(CAR_PAINTS.indexOf(primary) + 3) % CAR_PAINTS.length]!;
  return {
    chassis: pick(CHASSIS_IDS),
    primary,
    secondary,
    decal: pick(DECAL_IDS),
    wheels: pick(WHEEL_IDS),
    number: Math.floor(Math.random() * 100),
    nameplate,
  };
}

export function Customizer() {
  const me = useSessionStore((s) => s.playerId);
  const serverLook = useRoomSelector((s: CircuitPublicState) => (me ? s.cars?.[me] : undefined));
  const myName = useRoomSelector((s: CircuitPublicState) => (me ? (s.players?.[me]?.name ?? '') : ''));
  const [config, setConfig] = useState<CarConfig | null>(null);
  const [plateDraft, setPlateDraft] = useState('');
  const loaded = useRef(false);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial: saved design from persistence, else what the server assigned.
  useEffect(() => {
    if (loaded.current || !me) return;
    let alive = true;
    void (async () => {
      const saved = await persistence()
        .loadDoc<CarConfig>(CIRCUIT_CAR_DOC)
        .catch(() => null);
      if (!alive || loaded.current) return;
      const parsed = CarConfigSchema.safeParse(saved);
      if (parsed.success) {
        loaded.current = true;
        setConfig(parsed.data);
        setPlateDraft(parsed.data.nameplate);
        session.send(CIRCUIT_MSG.car, parsed.data);
      } else if (serverLook) {
        loaded.current = true;
        const cfg: CarConfig = { ...serverLook, nameplate: serverLook.nameplate };
        setConfig(cfg);
        setPlateDraft(cfg.nameplate);
      }
    })();
    return () => {
      alive = false;
    };
  }, [me, serverLook]);

  useEffect(
    () => () => {
      if (sendTimer.current) clearTimeout(sendTimer.current);
    },
    [],
  );

  const commit = (next: CarConfig) => {
    setConfig(next);
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = setTimeout(() => {
      session.send(CIRCUIT_MSG.car, next);
      void persistence()
        .saveDoc(CIRCUIT_CAR_DOC, next)
        .catch(() => undefined);
    }, 320);
  };

  const fallback = useMemo(() => defaultCarConfig('#22d3ee', myName || 'Racer', 1), [myName]);
  const cfg = config ?? (serverLook ? { ...serverLook } : fallback);
  const set = <K extends keyof CarConfig>(key: K, value: CarConfig[K]) => {
    sfx('click');
    commit({ ...cfg, [key]: value });
  };

  return (
    <div className="ci-custom">
      <div className="ci-custom__stage">
        <CarPreview config={cfg} />
        <div className="ci-custom__plate" aria-hidden>
          <span style={{ background: cfg.primary } as CSSProperties}>{String(cfg.number).padStart(2, '0')}</span>
          <b>{cfg.nameplate || 'RACER'}</b>
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon="dice"
          className="ci-custom__random"
          onClick={() => {
            sfx('dice');
            commit(randomConfig(cfg.nameplate));
          }}
        >
          Randomize
        </Button>
      </div>

      <div className="dc-field">
        <span className="dc-field__label" id="ci-chassis-label">
          Chassis
        </span>
        <div className="ci-chassis" role="radiogroup" aria-labelledby="ci-chassis-label">
          {CHASSIS_IDS.map((id: ChassisId) => {
            const spec = CHASSIS[id];
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={cfg.chassis === id}
                aria-label={`${spec.label} chassis`}
                className={cx('ci-chassis__card', cfg.chassis === id && 'is-on')}
                onClick={() => set('chassis', id)}
              >
                <CarThumb look={{ ...cfg, chassis: id }} size={52} rotate={0} label={`${spec.label} silhouette`} />
                <span className="ci-chassis__name">{spec.label}</span>
                <span className="ci-chassis__blurb">{spec.blurb}</span>
                <span className="ci-chassis__stats">
                  <Pips value={spec.stats.speed} label="SPD" />
                  <Pips value={spec.stats.accel} label="ACC" />
                  <Pips value={spec.stats.handling} label="HDL" />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="ci-custom__paints">
        <div className="dc-field">
          <span className="dc-field__label">Body paint</span>
          <div className="ci-paint">
            <ColorSwatches colors={CAR_PAINTS} value={cfg.primary} onChange={(c) => set('primary', c)} label="Body paint" />
            <label className="ci-paint__custom" title="Custom body colour">
              <input type="color" value={cfg.primary} aria-label="Custom body colour" onChange={(e) => commit({ ...cfg, primary: e.currentTarget.value })} />
            </label>
          </div>
        </div>
        <div className="dc-field">
          <span className="dc-field__label">Accent paint</span>
          <div className="ci-paint">
            <ColorSwatches colors={CAR_PAINTS} value={cfg.secondary} onChange={(c) => set('secondary', c)} label="Accent paint" />
            <label className="ci-paint__custom" title="Custom accent colour">
              <input type="color" value={cfg.secondary} aria-label="Custom accent colour" onChange={(e) => commit({ ...cfg, secondary: e.currentTarget.value })} />
            </label>
          </div>
        </div>
      </div>

      <div className="dc-field">
        <span className="dc-field__label" id="ci-decal-label">
          Livery
        </span>
        <div className="ci-options" role="radiogroup" aria-labelledby="ci-decal-label">
          {DECAL_IDS.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={cfg.decal === d} className={cx('ci-option', cfg.decal === d && 'is-on')} onClick={() => set('decal', d)}>
              {DECAL_LABEL[d]}
            </button>
          ))}
        </div>
      </div>

      <div className="dc-field">
        <span className="dc-field__label" id="ci-wheel-label">
          Wheels
        </span>
        <div className="ci-options" role="radiogroup" aria-labelledby="ci-wheel-label">
          {WHEEL_IDS.map((w) => (
            <button key={w} type="button" role="radio" aria-checked={cfg.wheels === w} className={cx('ci-option', cfg.wheels === w && 'is-on')} onClick={() => set('wheels', w)}>
              {WHEEL_LABEL[w]}
            </button>
          ))}
        </div>
      </div>

      <div className="ci-custom__ids">
        <Field label="Number" hint="0–99">
          {({ id, describedBy }) => (
            <NumberInput id={id} aria-describedby={describedBy} value={cfg.number} min={0} max={99} onChange={(n) => commit({ ...cfg, number: Math.max(0, Math.min(99, Math.round(n))) })} />
          )}
        </Field>
        <Field label="Nameplate" hint={`Up to ${NAMEPLATE_MAX} characters`}>
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              value={plateDraft}
              maxLength={NAMEPLATE_MAX}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                const v = e.currentTarget.value.toUpperCase().slice(0, NAMEPLATE_MAX);
                setPlateDraft(v);
                if (v.trim()) commit({ ...cfg, nameplate: nameplateFrom(v) });
              }}
              onBlur={() => setPlateDraft(nameplateFrom(plateDraft || myName || ''))}
            />
          )}
        </Field>
      </div>
    </div>
  );
}
