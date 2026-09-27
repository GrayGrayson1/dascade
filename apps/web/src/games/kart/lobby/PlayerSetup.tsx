/**
 * Lobby: pick a racer (portrait, archetype, stat bars), a kart body and a paint. Sent to the
 * server as `kart:look` (validated there), debounced, and saved locally (`KART_LOOK_DOC`).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  KART_BODIES,
  KART_BODY_IDS,
  KART_MSG,
  KART_PAINTS,
  KART_RACERS,
  KART_RACER_IDS,
  KartLookSchema,
  defaultKartLook,
  type KartLook,
  type KartPublicState,
  type KartRacerStats,
} from '@dascade/shared/games/kart';
import { Button, ColorSwatches, cx, handleRovingKeys, rovingTabIndex } from '@dascade/ui';
import { useRoomSelector } from '../../../net/hooks.ts';
import { session, useSessionStore } from '../../../net/session.ts';
import { sfx } from '../../../audio/audio.ts';
import { loadLook, saveLook } from '../docs.ts';
import { Portrait } from './Portrait.tsx';
import { Showroom } from './Showroom.tsx';
import { prewarmRace } from '../prewarm.ts';
import { kartSfx } from '../audio/sounds.ts';

const STAT_LABELS: Array<[keyof KartRacerStats, string, string]> = [
  ['speed', 'Speed', 'SPD'],
  ['accel', 'Acceleration', 'ACC'],
  ['handling', 'Handling', 'HDL'],
  ['grip', 'Grip', 'GRP'],
  ['weight', 'Weight', 'WGT'],
];

export function StatBars({ stats, compact = false }: { stats: KartRacerStats; compact?: boolean }) {
  return (
    <dl className={cx('kp-stats', compact && 'kp-stats--compact')}>
      {STAT_LABELS.map(([key, name, short]) => (
        <div key={key} className="kp-stats__row">
          <dt title={name}>{compact ? short : name}</dt>
          <dd aria-label={`${name} ${stats[key]} of 5`}>
            {Array.from({ length: 5 }, (_, i) => (
              <i key={i} data-on={i < stats[key] ? 'true' : undefined} />
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function phaseAcceptsLook(): boolean {
  const phase = (session.room?.state as { phase?: string } | undefined)?.phase;
  return phase === 'LOBBY' || phase === 'RESULTS';
}

export function PlayerSetup() {
  const me = useSessionStore((s) => s.playerId);
  const serverLook = useRoomSelector((s: KartPublicState) => (me ? s.looks?.[me] : undefined));
  const previewTrack = useRoomSelector((s: KartPublicState) => s.race?.trackId);
  const [look, setLook] = useState<KartLook | null>(null);
  const loaded = useRef(false);
  const pending = useRef<KartLook | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial: the saved look (sent to the server), else whatever the server assigned.
  useEffect(() => {
    if (loaded.current || !me) return;
    let alive = true;
    void loadLook().then((saved) => {
      if (!alive || loaded.current) return;
      if (saved) {
        loaded.current = true;
        setLook(saved);
        session.send(KART_MSG.look, saved);
      } else if (serverLook) {
        const parsed = KartLookSchema.safeParse(serverLook);
        if (parsed.success) {
          loaded.current = true;
          setLook(parsed.data);
        }
      }
    });
    return () => {
      alive = false;
    };
  }, [me, serverLook]);

  // Fetch three.js + the renderer and build the upcoming track while everyone is choosing.
  useEffect(() => {
    prewarmRace(previewTrack);
  }, [previewTrack]);

  // Unmount (race starting): flush a debounced edit instead of dropping it.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      const last = pending.current;
      pending.current = null;
      if (!last) return;
      if (phaseAcceptsLook()) session.send(KART_MSG.look, last);
      saveLook(last);
    },
    [],
  );

  const fallback = useMemo(() => defaultKartLook(me ? me.charCodeAt(0) : 1), [me]);
  const cur: KartLook = look ?? (serverLook ? (KartLookSchema.safeParse(serverLook).data ?? fallback) : fallback);

  const commit = (next: KartLook) => {
    setLook(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      pending.current = null;
      session.send(KART_MSG.look, next);
      saveLook(next);
    }, 250);
  };

  const info = KART_RACERS[cur.racer];
  // Choosing a racer brings their signature paint along, unless the player picked a custom paint.
  const pickRacer = (id: KartLook['racer']) => {
    if (id === cur.racer) return;
    kartSfx.select(KART_RACER_IDS.indexOf(id));
    const keepPaint = cur.paint.toLowerCase() !== KART_RACERS[cur.racer].colors.main.toLowerCase();
    commit({ ...cur, racer: id, paint: keepPaint ? cur.paint : KART_RACERS[id].colors.main });
  };

  return (
    <div className="kp-setup" data-part="kart-setup" style={{ '--kp-main': info.colors.main } as CSSProperties}>
      <section className="kp-setup__hero" aria-label="Your racer">
        <Showroom racer={cur.racer} body={cur.body} paint={cur.paint} label={`${info.name} in the ${KART_BODIES[cur.body].name} kart`} />
        <div className="kp-setup__who" key={cur.racer}>
          <span className="kp-setup__arch">{info.archetype}</span>
          <h3 className="kp-setup__name">{info.name}</h3>
          <p className="kp-setup__blurb">{info.blurb}</p>
          <StatBars stats={info.stats} />
        </div>
      </section>

      <div className="dc-field">
        <span className="dc-field__label" id="kp-racer-label">
          Racer
        </span>
        <div className="kp-racers" role="radiogroup" aria-labelledby="kp-racer-label" onKeyDown={(e) => handleRovingKeys(e, 'radio')}>
          {KART_RACER_IDS.map((id, i) => {
            const r = KART_RACERS[id];
            const on = cur.racer === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={rovingTabIndex(on, i, true)}
                aria-label={`${r.name}, ${r.archetype}`}
                className={cx('kp-racer', on && 'is-on')}
                style={{ '--kp-main': r.colors.main } as CSSProperties}
                onClick={() => pickRacer(id)}
              >
                <Portrait racer={id} size={64} view="face" />
                <span className="kp-racer__name">{r.name}</span>
                <span className="kp-racer__arch">{r.archetype}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="kp-setup__row">
        <div className="dc-field">
          <span className="dc-field__label" id="kp-body-label">
            Kart body
          </span>
          <div className="kp-bodies" role="radiogroup" aria-labelledby="kp-body-label" onKeyDown={(e) => handleRovingKeys(e, 'radio')}>
            {KART_BODY_IDS.map((b, i) => {
              const on = cur.body === b;
              return (
                <button
                  key={b}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={rovingTabIndex(on, i, true)}
                  className={cx('kp-body', on && 'is-on')}
                  onClick={() => {
                    if (on) return;
                    sfx('click');
                    commit({ ...cur, body: b });
                  }}
                >
                  <Portrait racer={cur.racer} body={b} paint={cur.paint} size={64} />
                  <span>{KART_BODIES[b].name}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="dc-field">
          <span className="dc-field__label">Paint</span>
          <div className="kp-paint">
            <ColorSwatches
              colors={KART_PAINTS}
              value={cur.paint}
              onChange={(paint) => (sfx('click'), commit({ ...cur, paint }))}
              label="Kart paint"
            />
            <label className="kp-paint__custom" title="Custom paint">
              <input
                type="color"
                value={cur.paint}
                aria-label="Custom paint colour"
                onChange={(e) => commit({ ...cur, paint: e.currentTarget.value })}
              />
            </label>
            <Button size="sm" variant="ghost" icon="refresh" onClick={() => commit({ ...cur, paint: info.colors.main })}>
              Racer colours
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
