/**
 * RaceController — the glue between the room session, netcode, input, HUD and
 * audio. It owns no rendering: the Phaser scene pulls a `RaceFrame` from it every
 * display frame. High-frequency data never touches React state.
 */
import {
  CIRCUIT_MSG,
  CIRCUIT_SIM,
  circuitBestKey,
  type CarLookView,
  type CircuitBestDoc,
  type CircuitEvent,
  type CircuitPublicState,
  type CircuitTrackId,
  type RaceMetaView,
  type RacerView,
} from '@dascade/shared/games/circuit';
import { formatRaceTime } from '@dascade/shared';
import { CHASSIS, CarFlag, RaceStatusCode, displaySpeed, generateDecor, getTrack, projectOnTrack, type Decor, type Track } from '@dascade/game-core/circuit';
import { getLastMessage, getStateSnapshot, serverNow, session, subscribeMessage, subscribeState, useSessionStore } from '../../../net/session.ts';
import { persistence } from '../../../persistence/index.ts';
import { sfx, synth } from '../../../audio/audio.ts';
import { CircuitNet, type NetCar, type NetStats } from '../net/netClient.ts';
import { InputSampler } from '../net/input.ts';
import { NetSim, netDebugFromUrl, type NetSimConfig } from '../net/netSim.ts';
import { HudBridge } from '../hud/bridge.ts';
import { EngineSound } from '../audio/engine.ts';
import { minimapCanvas } from '../art/worldArt.ts';

export interface RaceCar extends NetCar {
  playerId: string;
  name: string;
  look: CarLookView;
  lookKey: string;
  position: number;
  finished: boolean;
  dnf: boolean;
  /** 0 on the ground … 1 at the top of the flyover. */
  elevated: number;
  throttle: number;
  brake: number;
  steer: number;
  s: number;
}

export type SceneEvent =
  | { kind: 'go' }
  | { kind: 'finish'; place: number }
  | { kind: 'impact'; slot: number; impact: number }
  | { kind: 'gate'; gate: number }
  | { kind: 'lap' };

export interface RaceFrame {
  now: number;
  cars: RaceCar[];
  localSlot: number | null;
  followSlot: number | null;
  status: 'grid' | 'racing' | 'done';
  /** Start lights: 0..5 lit, `out` once the lights go out. */
  lights: { on: number; out: boolean; sinceGo: number };
  events: SceneEvent[];
}

export interface ControllerUi {
  trackId: CircuitTrackId | null;
  spectating: boolean;
  followName: string;
  netDebug: boolean;
  touch: boolean;
  finished: boolean;
}

interface Meta {
  phase: string;
  me: string | null;
  race: RaceMetaView | null;
  bySlot: Map<number, { playerId: string; racer: RacerView }>;
  mine: RacerView | null;
  looks: Record<string, CarLookView>;
}

const DEFAULT_LOOK: CarLookView = { chassis: 'volt', primary: '#22d3ee', secondary: '#f97316', decal: 'stripes', wheels: 'spoke', number: 0, nameplate: 'RACER' };

function lookKey(l: CarLookView): string {
  return `${l.chassis}|${l.primary}|${l.secondary}|${l.decal}|${l.wheels}|${l.number}|${l.nameplate}`;
}

export class RaceController {
  readonly sampler = new InputSampler();
  readonly hud: HudBridge;
  readonly net: CircuitNet;
  readonly netSim: NetSim;
  track: Track;
  decor: Decor;
  trackId: CircuitTrackId;

  private meta: Meta = { phase: 'LOBBY', me: null, race: null, bySlot: new Map(), mine: null, looks: {} };
  private readonly unsubs: Array<() => void> = [];
  private followSlot: number | null = null;
  private readonly engine = new EngineSound();
  private events: SceneEvent[] = [];
  private lastHud = 0;
  private lastMinimap = 0;
  private readonly prevSpeed = new Map<number, number>();
  private readonly segHint = new Map<number, number>();
  private banner: { text: string; tone: string; until: number } | null = null;
  private deltaText: { text: string; good: boolean; until: number } | null = null;
  private best: CircuitBestDoc | null = null;
  private lapSplits: number[] = [];
  private lastLightsOn = -1;
  private goPlayed = false;
  private finishedPlace = 0;
  private lastBoostOn = false;
  private minimap: { canvas: HTMLCanvasElement; project: (x: number, y: number) => [number, number] } | null = null;
  private uiState: ControllerUi;
  private readonly uiListeners = new Set<() => void>();
  private disposed = false;

  constructor(hud: HudBridge) {
    this.hud = hud;
    const snap = getStateSnapshot<CircuitPublicState>();
    this.trackId = (snap?.race?.trackId as CircuitTrackId) ?? 'neon-loop';
    this.track = getTrack(this.trackId);
    this.decor = generateDecor(this.track);
    const debug = netDebugFromUrl();
    this.net = new CircuitNet(this.track, (packet) => this.netSim.send(packet));
    this.netSim = new NetSim(
      (payload) => session.send(CIRCUIT_MSG.input, payload),
      (bytes, at) => this.onSnapshot(bytes, at),
      debug.config,
    );
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.sampler.touch.autoGas = touch;
    if (touch) {
      // Touch-first device: honour "Auto-gas on" from the green light, before the first tap
      // (a key press or gamepad still takes over, see InputSampler).
      this.sampler.lastDevice = 'touch';
      this.sampler.touch.active = true;
    }
    this.uiState = { trackId: this.trackId, spectating: false, followName: '', netDebug: debug.show, touch, finished: false };
  }

  start(): void {
    this.disposed = false;
    this.sampler.attach();
    this.unsubs.push(subscribeMessage(CIRCUIT_MSG.snap, (payload) => this.netSim.receive(payload as Uint8Array)));
    this.unsubs.push(subscribeMessage(CIRCUIT_MSG.event, (payload) => this.onEvent(payload as CircuitEvent)));
    this.unsubs.push(subscribeState(() => this.refreshMeta()));
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.setUi({ netDebug: !this.uiState.netDebug });
      }
    };
    window.addEventListener('keydown', onKey);
    this.unsubs.push(() => window.removeEventListener('keydown', onKey));
    this.refreshMeta();
    const last = getLastMessage<Uint8Array>(CIRCUIT_MSG.snap);
    if (last) this.onSnapshot(last, performance.now());
    void this.loadBest();
  }

  destroy(): void {
    this.disposed = true;
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    this.sampler.detach();
    this.netSim.dispose();
    this.engine.stop();
  }

  // -------------------------------------------------------------------------
  // UI store (low-frequency, for React)
  // -------------------------------------------------------------------------

  subscribeUi = (fn: () => void): (() => void) => {
    this.uiListeners.add(fn);
    return () => this.uiListeners.delete(fn);
  };

  getUi = (): ControllerUi => this.uiState;

  private setUi(patch: Partial<ControllerUi>): void {
    let changed = false;
    for (const [k, v] of Object.entries(patch)) if ((this.uiState as unknown as Record<string, unknown>)[k] !== v) changed = true;
    if (!changed) return;
    this.uiState = { ...this.uiState, ...patch };
    for (const l of [...this.uiListeners]) l();
  }

  setNetSim(config: NetSimConfig): void {
    this.netSim.config = config;
  }

  netStats(): NetStats {
    return this.net.stats();
  }

  cycleFollow(dir: 1 | -1): void {
    const slots = [...this.meta.bySlot.entries()]
      .filter(([, v]) => v.racer.active)
      .sort((a, b) => a[1].racer.position - b[1].racer.position)
      .map(([slot]) => slot);
    if (!slots.length) return;
    const idx = this.followSlot === null ? -1 : slots.indexOf(this.followSlot);
    this.followSlot = slots[(idx + dir + slots.length) % slots.length]!;
    this.updateFollowName();
  }

  // -------------------------------------------------------------------------
  // Room data
  // -------------------------------------------------------------------------

  private refreshMeta(): void {
    const s = getStateSnapshot<CircuitPublicState>();
    if (!s) return;
    const me = useSessionStore.getState().playerId;
    const bySlot = new Map<number, { playerId: string; racer: RacerView }>();
    for (const [playerId, racer] of Object.entries(s.racers ?? {})) bySlot.set(racer.slot, { playerId, racer });
    const mine = me ? (s.racers?.[me] ?? null) : null;
    this.meta = { phase: s.phase, me, race: s.race, bySlot, mine, looks: s.cars ?? {} };
    const trackId = s.race?.trackId as CircuitTrackId | undefined;
    if (trackId && trackId !== this.trackId) {
      this.trackId = trackId;
      this.track = getTrack(trackId);
      this.decor = generateDecor(this.track);
      this.net.setTrack(this.track);
      this.minimap = null;
      this.setUi({ trackId });
      void this.loadBest();
    }
    this.net.boostEnabled = this.boostEnabled();
    const spec = mine && mine.active ? (CHASSIS[this.lookFor(me!).chassis] ?? CHASSIS.volt) : null;
    this.net.setLocal(mine && mine.active ? mine.slot : null, spec);
    const spectating = !mine;
    if (spectating && (this.followSlot === null || !bySlot.has(this.followSlot))) {
      const leader = [...bySlot.entries()].sort((a, b) => a[1].racer.position - b[1].racer.position)[0];
      this.followSlot = leader ? leader[0] : null;
    }
    this.setUi({ spectating, finished: Boolean(mine?.finished) });
    this.updateFollowName();
  }

  private updateFollowName(): void {
    const f = this.followSlot !== null ? this.meta.bySlot.get(this.followSlot) : undefined;
    this.setUi({ followName: f ? this.lookFor(f.playerId).nameplate || f.racer.name : '' });
  }

  private boostEnabled(): boolean {
    const s = getStateSnapshot<CircuitPublicState>();
    try {
      return (JSON.parse(s?.settingsJson ?? '{}') as { boost?: boolean }).boost !== false;
    } catch {
      return true;
    }
  }

  lookFor(playerId: string): CarLookView {
    return this.meta.looks[playerId] ?? DEFAULT_LOOK;
  }

  get localSlot(): number | null {
    return this.net.local;
  }

  private onSnapshot(bytes: Uint8Array, arrival: number): void {
    if (this.disposed) return;
    this.net.ingest(bytes, arrival);
  }

  private async loadBest(): Promise<void> {
    const key = circuitBestKey(this.trackId);
    try {
      this.best = await persistence().loadDoc<CircuitBestDoc>(key);
    } catch {
      this.best = null;
    }
  }

  private saveBest(lapMs: number): void {
    const doc: CircuitBestDoc = { trackId: this.trackId, lapMs, splits: [...this.lapSplits], savedAt: Date.now() };
    const prevRace = this.best?.raceMs;
    if (prevRace) doc.raceMs = prevRace;
    this.best = doc;
    void persistence()
      .saveDoc(circuitBestKey(this.trackId), doc)
      .catch(() => undefined);
  }

  private onEvent(ev: CircuitEvent): void {
    if (this.disposed) return;
    // Scene events are drained once per rendered frame; with the tab hidden (no rAF) keep the backlog small.
    if (this.events.length > 32) this.events.splice(0, this.events.length - 32);
    const me = this.meta.me;
    const now = performance.now();
    const solo = Boolean(this.meta.race?.solo);
    switch (ev.kind) {
      case 'go':
        this.events.push({ kind: 'go' });
        this.lapSplits = [];
        break;
      case 'split':
        if (ev.playerId !== me) break;
        this.lapSplits[ev.gate] = ev.splitMs;
        this.events.push({ kind: 'gate', gate: ev.gate });
        if (this.best && this.best.splits[ev.gate]) {
          const d = ev.splitMs - this.best.splits[ev.gate]!;
          this.deltaText = { text: `${d <= 0 ? '−' : '+'}${(Math.abs(d) / 1000).toFixed(3)}`, good: d <= 0, until: now + 3000 };
        }
        break;
      case 'lap': {
        if (ev.playerId !== me) {
          if (ev.fastest && !solo) this.flash(`${this.nameOf(ev.playerId)} · FASTEST LAP ${formatRaceTime(ev.lapMs)}`, 'purple', 2200);
          break;
        }
        this.events.push({ kind: 'lap' });
        const pb = !this.best || ev.lapMs < this.best.lapMs;
        if (this.best && (solo || pb)) {
          const d = ev.lapMs - this.best.lapMs;
          this.deltaText = { text: `${d <= 0 ? '−' : '+'}${(Math.abs(d) / 1000).toFixed(3)}`, good: d <= 0, until: now + 3500 };
        }
        if (pb) this.saveBest(ev.lapMs);
        this.lapSplits = [];
        sfx(ev.best ? 'correct' : 'ding');
        const laps = this.meta.race?.laps ?? 0;
        if (ev.lap < laps) this.flash(pb ? `PERSONAL BEST ${formatRaceTime(ev.lapMs)}` : ev.fastest && !solo ? `FASTEST LAP ${formatRaceTime(ev.lapMs)}` : `LAP ${ev.lap + 1}/${laps}`, pb || ev.fastest ? 'purple' : 'cyan', 2200);
        break;
      }
      case 'final-lap':
        if (ev.playerId === me) {
          this.flash('FINAL LAP', 'orange', 2400);
          sfx('whoosh');
        }
        break;
      case 'finish':
        if (ev.playerId === me) {
          this.finishedPlace = ev.place;
          this.events.push({ kind: 'finish', place: ev.place });
          this.flash(solo ? `FINISH · ${formatRaceTime(ev.timeMs)}` : ev.place === 1 ? 'WINNER!' : `FINISHED P${ev.place}`, 'gold', 5000);
          sfx(ev.place === 1 ? 'bigwin' : 'win');
          if (solo && (!this.best?.raceMs || ev.timeMs < this.best.raceMs) && this.best) {
            this.best = { ...this.best, raceMs: ev.timeMs, laps: this.meta.race?.laps ?? 0 };
            void persistence().saveDoc(circuitBestKey(this.trackId), this.best).catch(() => undefined);
          }
        } else if (ev.place === 1) {
          this.flash(`${this.nameOf(ev.playerId)} WINS`, 'gold', 2500);
        }
        break;
      case 'dnf':
        break;
    }
  }

  private nameOf(playerId: string): string {
    const look = this.meta.looks[playerId];
    for (const v of this.meta.bySlot.values()) if (v.playerId === playerId) return look?.nameplate || v.racer.name;
    return look?.nameplate ?? 'RACER';
  }

  private flash(text: string, tone: string, ms: number): void {
    this.banner = { text, tone, until: performance.now() + ms };
  }

  // -------------------------------------------------------------------------
  // Per-frame
  // -------------------------------------------------------------------------

  private elevation(s: number): number {
    let best = 0;
    for (const b of this.track.bridges) {
      const span = b.to >= b.from ? b.to - b.from : this.track.length - b.from + b.to;
      let rel = s - b.from;
      if (rel < 0) rel += this.track.length;
      if (rel > span) continue;
      const t = rel / span;
      const edge = Math.min(t, 1 - t) / 0.28;
      const e = Math.min(1, edge);
      best = Math.max(best, e * e * (3 - 2 * e));
    }
    return best;
  }

  frame(now: number): RaceFrame {
    const race = this.meta.race;
    const goAt = race?.goAt ?? 0;
    const sNow = serverNow();
    const phase = this.meta.phase;
    const status = this.net.status === RaceStatusCode.racing ? 'racing' : this.net.status === RaceStatusCode.done || phase === 'RESULTS' ? 'done' : 'grid';
    const locked = this.net.status !== RaceStatusCode.racing && (!goAt || sNow < goAt);
    // Cars keep driving through the post-race cool-down; only the results screen freezes them.
    const frozen = phase === 'RESULTS';
    this.sampler.enabled = !frozen;
    this.net.update(now, () => this.sampler.sample(now), locked, frozen);

    const cars: RaceCar[] = [];
    const localSlot = this.net.local;
    for (const [slot, entry] of this.meta.bySlot) {
      const isLocal = slot === localSlot && this.net.predicting;
      const nc = isLocal ? this.net.localRender() : this.net.remoteRender(slot, now);
      if (!nc) continue;
      const look = this.lookFor(entry.playerId);
      const hint = this.segHint.get(slot) ?? this.net.latest(slot)?.seg ?? -1;
      const proj = projectOnTrack(this.track, nc.x, nc.y, hint);
      this.segHint.set(slot, proj.seg);
      const prev = this.prevSpeed.get(slot) ?? nc.speed;
      this.prevSpeed.set(slot, nc.speed);
      const accel = (nc.speed - prev) * 60;
      const input = isLocal ? this.net.lastInput : null;
      cars.push({
        ...nc,
        playerId: entry.playerId,
        name: look.nameplate || entry.racer.name,
        look,
        lookKey: lookKey(look),
        position: entry.racer.position,
        finished: entry.racer.finished,
        dnf: entry.racer.dnf,
        elevated: this.elevation(proj.s),
        throttle: input ? input.throttle : accel > 40 ? 1 : 0,
        brake: input ? input.brake : accel < -350 ? 1 : 0,
        steer: input ? input.steer : Math.max(-1, Math.min(1, nc.angVel / 2.5)),
        s: proj.s,
      });
    }
    for (const imp of this.net.takeImpacts()) {
      if (imp.slot === localSlot && imp.impact > 260) sfx('crash', 180);
      this.events.push({ kind: 'impact', slot: imp.slot, impact: imp.impact });
    }

    // Start lights.
    const lightsStart = goAt - 3600;
    let on = 0;
    if (goAt && sNow < goAt) on = Math.max(0, Math.min(CIRCUIT_SIM.lights, Math.floor((sNow - lightsStart) / 600) + 1));
    const out = Boolean(goAt) && (sNow >= goAt || this.net.status === RaceStatusCode.racing);
    if (on !== this.lastLightsOn && !out && on > 0) sfx('countdown');
    this.lastLightsOn = on;
    if (out && !this.goPlayed && goAt && sNow - goAt < 2000 && phase !== 'RESULTS') {
      this.goPlayed = true;
      sfx('go');
    }

    const follow = localSlot !== null ? localSlot : this.followSlot;
    const frame: RaceFrame = {
      now,
      cars,
      localSlot,
      followSlot: follow,
      status,
      lights: { on, out, sinceGo: goAt ? sNow - goAt : 0 },
      events: this.events,
    };
    this.events = [];

    const focus = cars.find((c) => c.slot === follow) ?? null;
    this.audio(focus, localSlot, frozen);
    if (now - this.lastHud > 60) {
      this.lastHud = now;
      this.updateHud(focus, sNow, goAt, status, frame.lights);
    }
    if (now - this.lastMinimap > 66) {
      this.lastMinimap = now;
      this.drawMinimap(cars, follow);
    }
    return frame;
  }

  private audio(focus: RaceCar | null, localSlot: number | null, frozen: boolean): void {
    const mine = focus && focus.slot === localSlot && !frozen;
    if (!mine || !focus) {
      this.engine.update(0, 0, false, 0, false, false);
      return;
    }
    const spec = CHASSIS[focus.look.chassis] ?? CHASSIS.volt;
    const info = this.net.predInfo;
    const boosting = (focus.flags & CarFlag.boosting) !== 0;
    if (boosting && !this.lastBoostOn) sfx('boost', 400);
    this.lastBoostOn = boosting;
    const slip = info ? Math.min(1, Math.max(0, (Math.abs(info.slip) - 0.08) * 2.2)) : 0;
    this.engine.update(focus.speed / spec.maxSpeed, focus.throttle, boosting, slip, (focus.flags & CarFlag.offroad) !== 0, synth.context !== null);
  }

  private updateHud(focus: RaceCar | null, sNow: number, goAt: number, status: RaceFrame['status'], lights: RaceFrame['lights']): void {
    const hud = this.hud;
    const race = this.meta.race;
    const follow = this.followSlot !== null ? this.meta.bySlot.get(this.followSlot)?.racer : undefined;
    const r = this.meta.mine ?? follow ?? null;
    const laps = race?.laps ?? 0;
    const entrants = race?.entrants ?? 0;
    const raceNow = status === 'racing' && goAt ? Math.max(0, sNow - goAt) : 0;

    hud.text('pos', r ? String(r.position || '-') : '-');
    hud.text('posOf', `/${entrants}`);
    hud.text('lap', r ? `${Math.min(laps, Math.max(1, r.lap))}` : '1');
    hud.text('lapOf', `/${laps}`);
    const lapTime = r?.finished ? 0 : r && r.lap > 0 && status === 'racing' ? raceNow - r.lapStartMs : raceNow;
    hud.text('lapTime', r?.finished ? formatRaceTime(r.finishMs) : status === 'grid' ? '0:00.000' : formatRaceTime(Math.max(1, lapTime)));
    hud.text('best', r?.bestLapMs ? formatRaceTime(r.bestLapMs) : '--:--.---');
    hud.text('last', r?.lastLapMs ? formatRaceTime(r.lastLapMs) : '--:--.---');
    hud.text('pb', this.best ? formatRaceTime(this.best.lapMs) : '--:--.---');
    hud.text('clock', status === 'grid' ? '0:00.000' : formatRaceTime(r?.finished ? r.finishMs : Math.max(1, raceNow)));
    hud.data('lapTimeLabel', 'finished', r?.finished ? 'true' : null);

    // Speed + boost of the focused car.
    const spec = focus ? (CHASSIS[focus.look.chassis] ?? CHASSIS.volt) : CHASSIS.volt;
    const kmh = focus ? displaySpeed(focus.speed) : 0;
    hud.text('speed', String(kmh).padStart(3, '0'));
    const frac = focus ? Math.min(1.35, focus.speed / spec.maxSpeed) / 1.35 : 0;
    hud.style('needle', 'transform', `rotate(${-120 + frac * 240}deg)`);
    hud.style('speedArc', 'stroke-dashoffset', String(100 - frac * 100));
    const boost = focus ? focus.boost : 0;
    hud.style('boostFill', 'transform', `scaleX(${boost.toFixed(3)})`);
    hud.text('boostPct', `${Math.round(boost * 100)}%`);
    const drifting = focus ? (focus.flags & CarFlag.drifting) !== 0 : false;
    const boosting = focus ? (focus.flags & CarFlag.boosting) !== 0 : false;
    hud.data('boost', 'state', boosting ? 'boost' : drifting ? 'charge' : boost >= 0.06 ? 'ready' : 'empty');
    hud.data('speedo', 'boost', boosting ? 'true' : null);

    // Wrong way (local only).
    const wrong = Boolean(this.meta.mine?.wrongWay) && status === 'racing' && !this.meta.mine?.finished;
    hud.data('wrongWay', 'show', wrong ? 'true' : null);

    // Banner.
    const now = performance.now();
    if (this.banner && this.banner.until < now) this.banner = null;
    hud.text('banner', this.banner?.text ?? '');
    hud.data('banner', 'tone', this.banner ? this.banner.tone : null);
    hud.data('banner', 'show', this.banner ? 'true' : null);
    if (this.deltaText && this.deltaText.until < now) this.deltaText = null;
    hud.text('delta', this.deltaText?.text ?? '');
    hud.data('delta', 'good', this.deltaText ? String(this.deltaText.good) : null);

    // Finish-window countdown.
    const deadline = race?.finishDeadline ?? 0;
    const left = deadline ? Math.max(0, deadline - sNow) : 0;
    hud.text('window', left > 0 && status === 'racing' ? `${Math.ceil(left / 1000)}s` : '');
    hud.data('windowWrap', 'show', left > 0 && status === 'racing' && !this.meta.mine?.finished ? 'true' : null);

    // Start lights (DOM gantry).
    for (let i = 0; i < CIRCUIT_SIM.lights; i++) hud.data(`light${i}`, 'on', !lights.out && i < lights.on ? 'true' : null);
    hud.data('lights', 'phase', lights.out ? (lights.sinceGo < 1400 ? 'go' : 'hidden') : lights.on > 0 || status === 'grid' ? 'count' : 'hidden');
    hud.data('root', 'status', status);
    hud.data('root', 'finished', this.finishedPlace ? 'true' : null);
  }

  private drawMinimap(cars: RaceCar[], follow: number | null): void {
    const canvas = this.hud.el<HTMLCanvasElement>('minimap');
    if (!canvas) return;
    const size = canvas.width;
    if (!this.minimap || this.minimap.canvas.width !== size) this.minimap = minimapCanvas(this.track, size, size, Math.round(size * 0.08));
    const g = canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, size, size);
    g.drawImage(this.minimap.canvas, 0, 0);
    const dot = Math.max(3, size / 42);
    const ordered = [...cars].sort((a, b) => (a.slot === follow ? 1 : 0) - (b.slot === follow ? 1 : 0));
    for (const c of ordered) {
      const [x, y] = this.minimap.project(c.x, c.y);
      const mine = c.slot === follow;
      g.beginPath();
      g.arc(x, y, mine ? dot * 1.6 : dot, 0, Math.PI * 2);
      g.fillStyle = c.look.primary;
      g.fill();
      g.lineWidth = mine ? 2.5 : 1.2;
      g.strokeStyle = mine ? '#f8f6ff' : 'rgba(7,5,15,0.9)';
      g.stroke();
    }
  }
}
