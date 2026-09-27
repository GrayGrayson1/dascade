/**
 * DASphalt GP race HUD. Structure is React; fast values (timers, place, item slot, lamps, banners)
 * are written by the controller through HudBridge refs, so React re-renders only on low-rate
 * changes (spectating, the kill feed, announcements).
 *
 * Layout (landscape): item slot top-left · lap + times top-right · big place bottom-right ·
 * minimap bottom-left · banners top-centre · countdown centre · kill feed right.
 * Touch devices move the place/minimap to the top so nothing sits under the thumbs.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { KART_CUPS, KART_ITEM_IDS, KART_TRACKS, type KartItemId, type KartPublicState } from '@dascade/shared/games/kart';
import { IconButton, PixelIcon, cx } from '@dascade/ui';
import { useRoomSelector } from '../../../net/hooks.ts';
import { getStateSnapshot } from '../../../net/session.ts';
import type { KartController } from '../race/controller.ts';
import type { HudBridge } from './bridge.ts';
import { BIOME_LABEL, trackBiome } from '../trackInfo.ts';
import { Portrait } from '../lobby/Portrait.tsx';
import { itemIconUrl } from '../art/icons.ts';

/** The slot reel: every item once, then the first few again so the loop is seamless. */
const REEL: KartItemId[] = [...KART_ITEM_IDS.filter((i) => i !== 'puck3' && i !== 'turbo3'), 'turbo', 'puck', 'seeker'];

export function Hud({ ctrl, hidden = false }: { ctrl: KartController; hidden?: boolean }) {
  const b = ctrl.hud;
  const ui = useSyncExternalStore(ctrl.subscribeUi, ctrl.getUi, ctrl.getUi);
  // Alone on the track (time trial, or a race with nobody else): no place / neighbours.
  const solo = useRoomSelector((s: KartPublicState) => s.race?.mode === 'timetrial' || (s.race?.entrants ?? 2) <= 1) ?? false;
  const tt = useRoomSelector((s: KartPublicState) => s.race?.mode === 'timetrial') ?? false;
  return (
    <div
      className="kh"
      data-part="hud"
      ref={b.ref('root')}
      inert={hidden || undefined}
      aria-hidden={hidden || undefined}
      data-touch={ui.touch ? 'true' : undefined}
      data-spectating={ui.spectating ? 'true' : undefined}
      data-finished={ui.finished ? 'true' : undefined}
    >
      {ui.items ? (
        <section className="kh-item" data-part="item-slot" ref={b.ref('itemSlot')} data-state="empty" aria-label="Item">
          <div className="kh-item__frame">
            <div className="kh-item__reel">
              <img className="kh-item__ghost" src={itemIconUrl('prism')} alt="" draggable={false} />
              <span className="kh-item__strip" aria-hidden>
                {REEL.map((id, i) => (
                  <img key={i} src={itemIconUrl(id)} alt="" draggable={false} />
                ))}
              </span>
              <img className="kh-item__icon" ref={b.ref('itemIcon')} alt="" draggable={false} />
            </div>
            <span className="kh-item__count" ref={b.ref('itemCount')} />
          </div>
          <span className="kh-item__name" ref={b.ref('itemName')} />
        </section>
      ) : null}

      <section className="kh-lap kh-panel" data-part="scoreboard" aria-label="Lap and times">
        <div className="kh-lap__main">
          <span className="kh-label">LAP</span>
          <b className="kh-num kh-lap__n" ref={b.ref('lap')}>
            1
          </b>
          <span className="kh-num kh-lap__of" ref={b.ref('lapOf')} />
        </div>
        <div className="kh-clock" data-part="timer">
          <PixelIcon name="clock" />
          <span className="kh-num" ref={b.ref('clock')}>
            0:00.000
          </span>
        </div>
        <dl className="kh-times">
          <div>
            <dt>LAST</dt>
            <dd className="kh-num" ref={b.ref('last')}>
              --:--.---
            </dd>
          </div>
          <div>
            <dt>BEST</dt>
            <dd className="kh-num" ref={b.ref('best')}>
              --:--.---
            </dd>
          </div>
          {tt ? (
            <div className="kh-times__pb">
              <dt>PB</dt>
              <dd className="kh-num" ref={b.ref('pb')}>
                --:--.---
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      {solo ? null : (
        <section className="kh-pos" data-part="position" ref={b.ref('pos')} aria-label="Race position">
          <PosNumber bridge={b} />
        </section>
      )}

      {solo ? null : <Neighbours followSlot={ui.followSlot} />}

      <div className="kh-map" data-part="minimap-wrap">
        <canvas
          className="kh-map__canvas"
          data-part="minimap"
          ref={b.ref('minimap')}
          width={220}
          height={220}
          role="img"
          aria-label="Track map with racer positions"
        />
      </div>

      <div className="kh-drift" ref={b.ref('drift')} aria-hidden>
        <i />
        <i />
        <i />
      </div>

      <div className="kh-top">
        <div className="kh-banner" ref={b.ref('banner')} role="status" aria-live="off" />
        <div className="kh-wrongway" ref={b.ref('wrongWay')} aria-hidden>
          <PixelIcon name="warning" /> WRONG WAY
        </div>
        <div className="kh-window" ref={b.ref('windowWrap')}>
          <span>Finish in</span> <b className="kh-num" ref={b.ref('window')} />
        </div>
        <div className="kh-toast" ref={b.ref('toast')} aria-live="off" />
      </div>

      <Countdown bridge={b} />
      {ui.intro ? <IntroCard /> : null}

      {ui.feed.length ? (
        <ol className="kh-feed" aria-label="Race feed">
          {ui.feed.map((f) => (
            <li key={f.id} className="kh-feed__row" data-tone={f.tone}>
              {f.text}
            </li>
          ))}
        </ol>
      ) : null}

      {ui.spectating || ui.finished ? (
        <SpectatorBar ctrl={ctrl} spectating={ui.spectating} />
      ) : !ui.touch ? (
        <ControlsHint items={ui.items} device={ui.device} />
      ) : null}

      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {ui.announce}
      </p>
    </div>
  );
}

/**
 * The racers around you (two ahead, two behind): who to chase and who's coming. Reads the
 * low-rate schema through a compact key so it re-renders only when places change.
 */
function Neighbours({ followSlot }: { followSlot: number | null }) {
  const key = useRoomSelector((s: KartPublicState) =>
    Object.values(s.racers ?? {})
      .map((r) => `${r.slot}:${r.position}:${r.finished ? 1 : 0}:${r.active ? 1 : 0}`)
      .join('|'),
  );
  const rows = useMemo(() => {
    const s = getStateSnapshot<KartPublicState>();
    if (!s || !key) return [];
    return Object.values(s.racers ?? {}).sort((a, b) => a.position - b.position);
  }, [key]);
  if (rows.length < 2) return null;
  const idx = Math.max(
    0,
    rows.findIndex((r) => r.slot === followSlot),
  );
  const from = Math.max(0, Math.min(rows.length - 5, idx - 2));
  const view = rows.slice(from, from + 5);
  return (
    <ol className="kh-near" aria-label="Racers around you">
      {view.map((r) => (
        <li key={r.slot} className={cx('kh-near__row', r.slot === followSlot && 'is-me', !r.active && !r.finished && 'is-out')}>
          <span className="kh-near__pos kh-num">{r.position}</span>
          <span className="kh-near__chip" style={{ background: r.paint }} aria-hidden />
          <span className="kh-near__name">{r.name}</span>
          {r.finished ? <PixelIcon name="flag" /> : null}
        </li>
      ))}
    </ol>
  );
}

/** Big "3rd" with "/8"; pops when the place changes (CSS keyed off data-bump). */
function PosNumber({ bridge }: { bridge: HudBridge }) {
  return (
    <span className="kh-pos__wrap" aria-hidden>
      <b className="kh-pos__big kh-num" ref={bridge.ref('posBig')} />
      <span className="kh-pos__sfx" ref={bridge.ref('posSuffix')} />
      <span className="kh-pos__of kh-num" ref={bridge.ref('posOf')} />
    </span>
  );
}

function ControlsHint({ items, device }: { items: boolean; device: string }) {
  if (device === 'gamepad') {
    return (
      <div className="kh-hint" aria-hidden>
        <span>
          <kbd>LS</kbd> steer
        </span>
        <span>
          <kbd>A</kbd>/<kbd>RT</kbd> gas · <kbd>B</kbd>/<kbd>LT</kbd> brake
        </span>
        <span>
          <kbd>RB</kbd> drift
        </span>
        {items ? (
          <span>
            <kbd>LB</kbd> item <small>(stick ↑ ahead · ↓ back)</small>
          </span>
        ) : null}
        <span>
          <kbd>Start</kbd> menu
        </span>
      </div>
    );
  }
  return (
    <div className="kh-hint" aria-hidden>
      <span>
        <kbd>W</kbd>
        <kbd>A</kbd>
        <kbd>S</kbd>
        <kbd>D</kbd> drive
      </span>
      <span>
        <kbd>Space</kbd> hop / drift
      </span>
      {items ? (
        <span>
          <kbd>E</kbd> item <small>(</small>
          <kbd>S</kbd>
          <small>+</small>
          <kbd>E</kbd> <small>back ·</small> <kbd>Q</kbd> <small>ahead)</small>
        </span>
      ) : null}
      <span>
        <kbd>Esc</kbd> menu
      </span>
    </div>
  );
}

function Countdown({ bridge }: { bridge: HudBridge }) {
  // The 3D gantry over the grid shows the lamps; this is the big readable count on top.
  return (
    <div className="kh-count" data-part="start-lights" ref={bridge.ref('countdown')} data-phase="hidden" aria-hidden>
      <div className="kh-count__num" ref={bridge.ref('countNum')} />
      <div className="kh-count__hint">Hold the gas now for a rocket start</div>
    </div>
  );
}

function IntroCard() {
  const info = useRoomSelector((s: KartPublicState) => {
    const r = s.race;
    if (!r) return null;
    return { trackId: r.trackId, laps: r.laps, mode: r.mode, round: r.round, rounds: r.rounds, cup: r.cup };
  });
  if (!info) return null;
  const t = KART_TRACKS[info.trackId];
  if (!t) return null;
  return (
    <div className="kh-intro" data-part="intro-card" data-biome={trackBiome(info.trackId)}>
      <span className="kh-intro__kicker">
        {info.mode === 'gp'
          ? `${KART_CUPS[info.cup].name} · Race ${info.round}/${info.rounds}`
          : info.mode === 'timetrial'
            ? 'Time Trial'
            : KART_CUPS[t.cup].name}
      </span>
      <h2 className="kh-intro__name">{t.name}</h2>
      <span className="kh-intro__meta">
        {BIOME_LABEL[trackBiome(info.trackId)]} · <span className="kh-num">{info.laps}</span> {info.laps === 1 ? 'lap' : 'laps'}
      </span>
    </div>
  );
}

function SpectatorBar({ ctrl, spectating }: { ctrl: KartController; spectating: boolean }) {
  const ui = useSyncExternalStore(ctrl.subscribeUi, ctrl.getUi, ctrl.getUi);
  const look = ui.followSlot !== null ? ctrl.lookOf(ui.followSlot) : null;
  return (
    <div className={cx('kh-spec kh-panel')} role="group" aria-label="Camera">
      <IconButton icon="arrow-left" label="Previous racer" size="sm" onClick={() => ctrl.cycleFollow(-1)} />
      <span className="kh-spec__who">
        {look ? <Portrait racer={look.racer} body={look.body} paint={look.paint} size={28} view="face" /> : <PixelIcon name="eye" />}
        <span>
          <small>{spectating ? 'Watching' : 'Finished · watching'}</small>
          <b>{ui.followName || '…'}</b>
        </span>
      </span>
      <IconButton icon="arrow-right" label="Next racer" size="sm" onClick={() => ctrl.cycleFollow(1)} />
      {!spectating ? <IconButton icon="user" label="Back to my kart" size="sm" onClick={() => ctrl.followMe()} /> : null}
    </div>
  );
}
