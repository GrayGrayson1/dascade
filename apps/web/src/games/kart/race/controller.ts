/**
 * KartController — the glue between the room session, netcode, input, HUD, audio and the 3D
 * renderer. It owns no rendering: the stage pulls a `KartView` from `frame()` every animation
 * frame and hands it to the renderer. High-frequency data never touches React state; the HUD is
 * written through `HudBridge` refs (~15 Hz) and React only sees a small, low-rate UI store.
 */
import {
  KART_ITEMS,
  KART_ITEM_IDS,
  KART_MSG,
  KART_RACERS,
  KART_SIM,
  KART_TRACKS,
  type KartBodyId,
  type KartEvent,
  type KartItemId,
  type KartPublicState,
  type KartRaceMetaView,
  type KartRacerId,
  type KartRacerView,
  type KartTrackId,
} from '@dascade/shared/games/kart';
import { formatRaceTime, ordinal } from '@dascade/shared';
import {
  GHOST_EVERY,
  GhostRecorder,
  KartFlag,
  decodeGhost,
  encodeGhost,
  getKartTrack,
  ghostPoseAt,
  racerSpec,
  type KartGhost,
  type KartState,
  type KartTrack,
} from '@dascade/game-core/kart';
import {
  getLastMessage,
  getStateSnapshot,
  serverNow,
  session,
  subscribeMessage,
  subscribeState,
  useSessionStore,
} from '../../../net/session.ts';
import { KartNet, resampleTrace, type NetStats, type RenderEntity } from '../net/netClient.ts';
import { NetSim, netDebugFromUrl, type NetSimConfig } from '../net/netSim.ts';
import type { Pose } from '../net/interp.ts';
import { KartInputSampler, type InputDevice } from '../input/input.ts';
import { HudBridge } from '../hud/bridge.ts';
import { buildMapBase, drawMap, type MapBase, type MapDot, type MapMark } from '../hud/minimap.ts';
import { KartEngineSound } from '../audio/engine.ts';
import { kartSfx } from '../audio/sounds.ts';
import { displayFlags, driftStage, forwardSpeed, itemIdOf, renderFlags, trackPolylines } from '../core.ts';
import { loadBest, loadGhost, mergeBest, saveBest, saveGhost, type KartBestDoc, type KartGhostDoc } from '../docs.ts';
import { itemIconUrl } from '../art/icons.ts';
import {
  KF,
  type KartBoxState,
  type KartCameraMode,
  type KartEntityKind,
  type KartEntityPose,
  type KartFxAt,
  type KartFxKind,
  type KartPose,
  type KartRosterEntry,
  type KartView,
} from '../render/types.ts';

export interface FeedEntry {
  id: number;
  text: string;
  tone: 'hit' | 'block' | 'mine' | 'info';
  at: number;
}

export interface ControllerUi {
  trackId: KartTrackId;
  spectating: boolean;
  /** Local kart finished (camera may follow others). */
  finished: boolean;
  followSlot: number | null;
  followName: string;
  netDebug: boolean;
  touch: boolean;
  device: InputDevice;
  items: boolean;
  /** Track intro card visible (start of the countdown). */
  intro: boolean;
  /** Polite screen-reader announcement (changes trigger aria-live). */
  announce: string;
  feed: FeedEntry[];
  rosterKey: string;
  /** Waiting for the green light (touch shows a GAS button for the rocket start). */
  locked: boolean;
  /** The in-race menu (Esc / Start / pause button) is open. */
  menuOpen: boolean;
  /** Solo race is paused on the server (`race.paused`). */
  paused: boolean;
  /** This race can be paused (solo, not decided yet). */
  canPause: boolean;
  /** Key of the loaded time-trial ghost ('' = none), so the stage can hand its look to the renderer. */
  ghostKey: string;
}

export interface FxRequest {
  kind: KartFxKind;
  at: KartFxAt;
}

interface Meta {
  phase: string;
  me: string | null;
  race: KartRaceMetaView | null;
  bySlot: Map<number, { id: string; racer: KartRacerView }>;
  mine: KartRacerView | null;
  mineId: string | null;
}

const ENTITY_KIND: Record<string, KartEntityKind> = { puck: 'puck', seeker: 'seeker', mine: 'mine', puddle: 'fizz' };
const newPose = (): Pose => ({ x: 0, y: 0, z: 0, yaw: 0, vx: 0, vy: 0, vz: 0 });

function blankKartPose(slot: number): KartPose {
  return {
    slot,
    active: false,
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 0,
    steer: 0,
    flags: 0,
    driftStage: 0,
    item: null,
    itemCount: 0,
    position: 0,
  };
}

function itemName(cause: string): string {
  return (
    (KART_ITEMS as Record<string, { name: string } | undefined>)[cause]?.name ??
    (cause === 'hazard' ? 'a hazard' : cause === 'bump' ? 'a bump' : cause)
  );
}

export class KartController {
  readonly sampler = new KartInputSampler();
  readonly hud = new HudBridge();
  readonly net: KartNet;
  readonly netSim: NetSim;
  track: KartTrack;
  trackId: KartTrackId;

  private meta: Meta = { phase: 'LOBBY', me: null, race: null, bySlot: new Map(), mine: null, mineId: null };
  private readonly unsubs: Array<() => void> = [];
  private readonly engine = new KartEngineSound();
  private fx: FxRequest[] = [];
  private uiState: ControllerUi;
  private readonly uiListeners = new Set<() => void>();
  private disposed = false;

  // Camera / follow.
  private followSlot: number | null = null;
  private userFollow = false;
  private finishedAt = 0;

  // Render view (reused every frame — no per-frame allocation in the hot path).
  private readonly poses: KartPose[] = [];
  private readonly scratch = newPose();
  private readonly ents: RenderEntity[] = [];
  private readonly entPoses: KartEntityPose[] = [];
  private readonly boxStates: KartBoxState[] = [];
  private readonly view: KartView = {
    karts: this.poses,
    entities: this.entPoses,
    boxes: this.boxStates,
    tick: 0,
    targetSlot: 0,
    camera: 'intro',
    introT: 0,
    lights: -1,
    dt: 0,
  };
  private lastFrameAt = 0;

  // HUD.
  private lastHud = 0;
  private lastMap = 0;
  private mapBase: MapBase | null = null;
  private banner: { text: string; tone: string; until: number } | null = null;
  private toast: { text: string; tone: string; until: number } | null = null;
  private feedSeq = 0;
  private lastLightStep = -2;
  private goPlayed = false;
  private countdownStartedAt = 0;
  private lastPosition = 0;
  private bumpSeq = 0;
  private pauseRequested = false;
  private resumeSentAt = -1e9;
  /** Server time when the current solo pause began (0 = running). */
  private pausedAtServer = 0;
  private wasWrong = false;

  // Local-kart edge detection (sounds / fx).
  private prevStage = 0;
  private prevDriftDir = 0;
  private prevTrick = false;
  private prevRoulette = 0;
  private rouletteStep = 0;
  private rouletteNextAt = 0;
  private rouletteIcon: KartItemId = 'turbo';
  private prevBoxes: boolean[] = [];
  private prevShield = false;

  // Time trial.
  private best: KartBestDoc | null = null;
  private ghostDoc: KartGhostDoc | null = null;
  private ghost: KartGhost | null = null;
  private ghostPose: KartPose = blankKartPose(-1);
  lastPb: { racePb: boolean; lapPb: boolean; ghostSaved: boolean } | null = null;

  constructor() {
    const snap = getStateSnapshot<KartPublicState>();
    this.trackId = (snap?.race?.trackId as KartTrackId) ?? 'pixel-plaza';
    this.track = getKartTrack(this.trackId);
    const debug = netDebugFromUrl();
    this.net = new KartNet(this.track, (packet) => this.netSim.send(packet));
    this.netSim = new NetSim(
      (payload) => session.send(KART_MSG.input, payload),
      (kind, bytes, at) => (kind === 'own' ? this.onOwn(bytes, at) : this.onSnapshot(bytes, at)),
      debug.config,
    );
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.sampler.touch.autoGas = touch;
    if (touch) {
      this.sampler.lastDevice = 'touch';
      this.sampler.touch.active = true;
    }
    this.uiState = {
      trackId: this.trackId,
      spectating: false,
      finished: false,
      followSlot: null,
      followName: '',
      netDebug: debug.show,
      touch,
      device: touch ? 'touch' : 'keyboard',
      // Time trial has no cubes but starts with a Turbo Trio, so the item slot still shows.
      items: (snap?.race?.items ?? true) || snap?.race?.mode === 'timetrial',
      intro: false,
      announce: '',
      feed: [],
      rosterKey: '',
      ghostKey: '',
      locked: true,
      menuOpen: false,
      paused: false,
      canPause: false,
    };
    // A key press or a gamepad hides the touch controls; touching the screen brings them back.
    this.sampler.onDevice = (device) => this.setUi(device === 'touch' ? { device, touch: true } : { device, touch: false });
    this.sampler.onMenu = () => this.openMenu();
  }

  start(): void {
    this.disposed = false;
    this.sampler.attach();
    this.unsubs.push(subscribeMessage(KART_MSG.snap, (payload) => this.netSim.receive(payload as Uint8Array, 'snap')));
    this.unsubs.push(subscribeMessage(KART_MSG.own, (payload) => this.netSim.receive(payload as Uint8Array, 'own')));
    this.unsubs.push(subscribeMessage(KART_MSG.event, (payload) => this.onEvent(payload as KartEvent)));
    this.unsubs.push(subscribeState(() => this.refreshMeta()));
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.setUi({ netDebug: !this.uiState.netDebug });
      }
      // Spectator / finished camera: [ and ] (or Q / Tab-free keys) cycle the followed racer.
      if (
        (this.uiState.spectating || this.uiState.finished) &&
        (e.code === 'BracketLeft' || e.code === 'BracketRight' || e.code === 'KeyQ' || e.code === 'KeyR')
      ) {
        this.cycleFollow(e.code === 'BracketLeft' || e.code === 'KeyQ' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey);
    this.unsubs.push(() => window.removeEventListener('keydown', onKey));
    // No frames run while the tab is hidden: silence the engine instead of holding its last note.
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') this.engine.update(null);
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.unsubs.push(() => document.removeEventListener('visibilitychange', onVisibility));
    this.refreshMeta();
    const last = getLastMessage<Uint8Array>(KART_MSG.snap);
    if (last) this.onSnapshot(last, performance.now());
    void this.loadTimeTrial();
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
  // UI store (low frequency, for React)
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

  setTouch(on: boolean): void {
    this.setUi({ touch: on });
    if (on) this.sampler.touched();
  }

  /** Esc / gamepad Start / the pause button: open the in-race menu (pausing a solo race), or close it. */
  openMenu(): void {
    if (this.uiState.menuOpen) {
      this.closeMenu();
      return;
    }
    const phase = this.meta.phase;
    if (phase !== 'COUNTDOWN' && phase !== 'PLAYING') return;
    this.setUi({ menuOpen: true });
    if (this.uiState.canPause && !this.meta.race?.paused) {
      this.pauseRequested = true;
      session.send(KART_MSG.pause, { paused: true });
    }
  }

  /** Close the in-race menu and resume a paused solo race. */
  closeMenu(): void {
    if (!this.uiState.menuOpen) return;
    this.setUi({ menuOpen: false });
    // Also when the pause we asked for hasn't arrived yet (messages stay in order: pause, resume).
    if (this.meta.race?.paused || this.pauseRequested) {
      this.pauseRequested = false;
      this.resumeSentAt = performance.now();
      session.send(KART_MSG.pause, { paused: false });
    }
  }

  cycleFollow(dir: 1 | -1): void {
    const slots = [...this.meta.bySlot.entries()]
      .filter(([, v]) => v.racer.active)
      .sort((a, b) => a[1].racer.position - b[1].racer.position)
      .map(([slot]) => slot);
    if (!slots.length) return;
    const idx = this.followSlot === null ? -1 : slots.indexOf(this.followSlot);
    this.followSlot = slots[(idx + dir + slots.length) % slots.length]!;
    this.userFollow = true;
    this.updateFollow();
  }

  /** Back to my own kart (after finishing). */
  followMe(): void {
    this.userFollow = false;
    this.followSlot = this.net.local;
    this.updateFollow();
  }

  /**
   * Test hook (E2E): asks the server for a test action (`autopilot` drives our kart with the game's
   * own bot, `finish` jumps to the line). The server only registers `kart:test` on non-production
   * servers with relaxed limits, so in production this does nothing. Only sent when the page opted
   * in (`?kartTest=1` or the `kart-test` session flag), so a stray console call is a no-op.
   */
  test(action: { action: 'autopilot'; on: boolean } | { action: 'finish' }): boolean {
    let enabled: boolean;
    try {
      enabled = new URLSearchParams(location.search).get('kartTest') === '1' || sessionStorage.getItem('kart-test') === '1';
    } catch {
      enabled = false;
    }
    if (!enabled) return false;
    // While the server's bot drives our kart we must not send inputs (they'd interleave).
    if (action.action === 'autopilot') this.net.autopilot = action.on;
    session.send('kart:test', action);
    return true;
  }

  // -------------------------------------------------------------------------
  // Room data
  // -------------------------------------------------------------------------

  private refreshMeta(): void {
    const s = getStateSnapshot<KartPublicState>();
    if (!s) return;
    const me = useSessionStore.getState().playerId;
    const bySlot = new Map<number, { id: string; racer: KartRacerView }>();
    for (const [id, racer] of Object.entries(s.racers ?? {})) bySlot.set(racer.slot, { id, racer });
    const mine = me ? (s.racers?.[me] ?? null) : null;
    const prevPhase = this.meta.phase;
    this.meta = { phase: s.phase, me, race: s.race, bySlot, mine, mineId: mine ? me : null };
    const trackId = s.race?.trackId as KartTrackId | undefined;
    if (trackId && trackId !== this.trackId && KART_TRACKS[trackId]) {
      this.trackId = trackId;
      this.track = getKartTrack(trackId);
      this.net.setTrack(this.track);
      this.mapBase = null;
      this.setUi({ trackId });
      void this.loadTimeTrial();
    }
    // Solo pause: freeze the HUD clocks at the moment it began; on resume the server has moved goAt
    // and the finish window on, and snapshots continue from the same tick (reset the clock filter).
    const paused = Boolean(s.race?.paused);
    if (paused && !this.pausedAtServer) this.pausedAtServer = serverNow();
    if (!paused && this.pausedAtServer) {
      this.pausedAtServer = 0;
      this.net.onResume();
    }
    const live = s.phase === 'COUNTDOWN' || s.phase === 'PLAYING';
    const canPause = Boolean(s.race?.solo) && live && s.race?.status !== 'done';
    if (!live && this.uiState.menuOpen) this.setUi({ menuOpen: false });
    if (paused) this.pauseRequested = false;
    // Paused without the menu (e.g. we reconnected into a paused race): show it, so Resume is there.
    if (paused && live && !this.uiState.menuOpen && performance.now() - this.resumeSentAt > 2000) this.setUi({ menuOpen: true });
    this.setUi({ paused, canPause });
    if (s.phase === 'COUNTDOWN' && prevPhase !== 'COUNTDOWN') {
      this.countdownStartedAt = serverNow();
      this.goPlayed = false;
      this.lastLightStep = -2;
      this.finishedAt = 0;
      this.userFollow = false;
      this.lastPosition = 0;
      this.lastPb = null;
    }
    const spec = mine && mine.active ? racerSpec(mine.racer) : null;
    this.net.setLocal(mine && mine.active ? mine.slot : null, spec);
    const spectating = !mine;
    if (!this.userFollow) {
      if (mine) this.followSlot = mine.slot;
      else if (this.followSlot === null || !bySlot.has(this.followSlot)) {
        const leader = [...bySlot.entries()].sort((a, b) => a[1].racer.position - b[1].racer.position)[0];
        this.followSlot = leader ? leader[0] : null;
      }
    }
    const finished = Boolean(mine?.finished || mine?.dnf);
    if (finished && !this.finishedAt) this.finishedAt = performance.now();
    const rosterKey = [...bySlot.entries()]
      .map(([slot, v]) => `${slot}:${v.racer.racer}:${v.racer.body}:${v.racer.paint}:${v.racer.name}:${v.id === me ? 1 : 0}`)
      .join('|');
    this.setUi({ spectating, finished, items: (s.race?.items ?? true) || s.race?.mode === 'timetrial', rosterKey });
    this.updateFollow();
  }

  private updateFollow(): void {
    const f = this.followSlot !== null ? this.meta.bySlot.get(this.followSlot) : undefined;
    this.setUi({ followSlot: this.followSlot, followName: f ? f.racer.name : '' });
  }

  /** Roster for the renderer (models are cached per racer/body/paint on its side). */
  roster(): KartRosterEntry[] {
    const me = this.meta.me;
    return [...this.meta.bySlot.entries()].map(([slot, v]) => ({
      slot,
      racer: v.racer.racer,
      body: v.racer.body,
      paint: v.racer.paint,
      name: v.racer.name,
      local: v.id === me,
    }));
  }

  get race(): KartRaceMetaView | null {
    return this.meta.race;
  }

  get phase(): string {
    return this.meta.phase;
  }

  private onSnapshot(bytes: Uint8Array, arrival: number): void {
    if (this.disposed) return;
    this.net.ingest(bytes, arrival);
  }

  private onOwn(bytes: Uint8Array, arrival: number): void {
    if (this.disposed) return;
    this.net.ingestOwn(bytes, arrival);
  }

  // -------------------------------------------------------------------------
  // Time trial: personal best + ghost
  // -------------------------------------------------------------------------

  private async loadTimeTrial(): Promise<void> {
    const id = this.trackId;
    const [best, ghostDoc] = await Promise.all([loadBest(id), loadGhost(id)]);
    if (this.disposed || id !== this.trackId) return;
    this.best = best;
    this.ghostDoc = ghostDoc;
    this.ghost = ghostDoc ? decodeGhost(ghostDoc.data) : null;
    if (this.ghost && this.ghost.track !== id) this.ghost = null;
    this.setUi({ ghostKey: this.ghost ? `${id}|${this.ghost.timeMs}` : '' });
  }

  /** Look of the time-trial ghost kart (the renderer draws it translucent). */
  ghostLook(): { racer: KartRacerId; body: KartBodyId; paint: string } | null {
    const g = this.ghost;
    return g ? { racer: g.racer, body: g.body, paint: g.paint } : null;
  }

  get personalBest(): KartBestDoc | null {
    return this.best;
  }

  get hasGhost(): boolean {
    return this.ghost !== null;
  }

  private async finishTimeTrial(timeMs: number): Promise<void> {
    const race = this.meta.race;
    const mine = this.meta.mine;
    if (!race || race.mode !== 'timetrial' || !mine) return;
    const trackId = this.trackId;
    const { doc, racePb, lapPb } = mergeBest(this.best, trackId, race.laps, timeMs, mine.bestLapMs || 0);
    this.best = doc;
    if (racePb || lapPb) await saveBest(doc);
    let ghostSaved = false;
    // Build the ghost from the authoritative trace, resampled onto the ghost's grid from GO.
    let rec: GhostRecorder | null = null;
    const points = resampleTrace(this.net.trace, this.net.goTick, GHOST_EVERY);
    if (points.length > 10) {
      rec = new GhostRecorder();
      for (const p of points) rec.push(p, p.tick);
    }
    const oldGhost = this.ghostDoc;
    const beatsGhost = !oldGhost || (oldGhost.laps === race.laps ? timeMs < oldGhost.raceMs : racePb);
    if (rec && beatsGhost) {
      try {
        const ghost = rec.finish({ track: trackId, racer: mine.racer, body: mine.body, paint: mine.paint, timeMs });
        const data = encodeGhost(ghost);
        const gdoc: KartGhostDoc = {
          v: 1,
          trackId,
          laps: race.laps,
          raceMs: timeMs,
          racer: mine.racer,
          body: mine.body,
          paint: mine.paint,
          data,
        };
        ghostSaved = await saveGhost(gdoc);
        if (ghostSaved) {
          this.ghostDoc = gdoc;
          this.ghost = ghost;
          this.setUi({ ghostKey: `${trackId}|${ghost.timeMs}` });
        }
      } catch {
        ghostSaved = false;
      }
    }
    this.lastPb = { racePb, lapPb, ghostSaved };
    this.setUi({ announce: racePb ? `New personal best: ${formatRaceTime(timeMs)}` : `Finished in ${formatRaceTime(timeMs)}` });
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  private nameOf(id: string | null): string {
    if (!id) return '';
    for (const v of this.meta.bySlot.values()) if (v.id === id) return v.racer.name;
    const s = getStateSnapshot<KartPublicState>();
    return s?.players?.[id]?.name ?? 'Someone';
  }

  private slotOf(id: string): number | null {
    for (const [slot, v] of this.meta.bySlot) if (v.id === id) return slot;
    return null;
  }

  private flash(text: string, tone: string, ms: number): void {
    this.banner = { text, tone, until: performance.now() + ms };
  }

  private pushFeed(text: string, tone: FeedEntry['tone']): void {
    const now = performance.now();
    const feed = [...this.uiState.feed.filter((f) => now - f.at < 4500), { id: ++this.feedSeq, text, tone, at: now }].slice(-4);
    this.setUi({ feed });
  }

  private fxAtSlot(kind: KartFxKind, slot: number | null, stage?: number): void {
    if (slot === null) return;
    const p = this.poses[slot];
    if (!p || !p.active) return;
    this.fx.push({ kind, at: { x: p.x, y: p.y, z: p.z, slot, stage } });
    if (this.fx.length > 32) this.fx.splice(0, this.fx.length - 32);
  }

  private onEvent(ev: KartEvent): void {
    if (this.disposed) return;
    const me = this.meta.me;
    const race = this.meta.race;
    const laps = race?.laps ?? 3;
    // "Alone on the track" = time trial (a solo room can still race computer karts).
    const solo = race?.mode === 'timetrial' || (race?.entrants ?? 2) <= 1;
    switch (ev.kind) {
      case 'go':
        if (!this.goPlayed) {
          this.goPlayed = true;
          kartSfx.go();
          this.setUi({ announce: 'Go!' });
        }
        break;
      case 'lap': {
        if (ev.playerId !== me) {
          if (ev.fastest && !solo) this.pushFeed(`${this.nameOf(ev.playerId)} · fastest lap ${formatRaceTime(ev.lapMs)}`, 'info');
          break;
        }
        const pb = Boolean(this.best?.lapMs) && ev.lapMs < (this.best?.lapMs ?? Infinity);
        if (ev.best || ev.fastest || pb) kartSfx.lapBest();
        else kartSfx.lap();
        if (ev.lap < laps) {
          const next = ev.lap + 1;
          const text =
            pb && solo
              ? `PERSONAL BEST LAP ${formatRaceTime(ev.lapMs)}`
              : ev.fastest && !solo
                ? `FASTEST LAP ${formatRaceTime(ev.lapMs)}`
                : `LAP ${next}/${laps}`;
          if (next < laps) this.flash(text, pb || ev.fastest ? 'purple' : 'cyan', 2000);
          const pos = this.meta.mine?.position ?? 0;
          this.setUi({
            announce: `Lap ${next} of ${laps}. ${pos && !solo ? `${ordinal(pos)} place.` : ''} Last lap ${formatRaceTime(ev.lapMs)}.`,
          });
        }
        break;
      }
      case 'final-lap':
        if (ev.playerId === me) {
          this.flash('FINAL LAP', 'orange', 2600);
          kartSfx.finalLap();
          const pos = this.meta.mine?.position ?? 0;
          this.setUi({ announce: `Final lap${pos && !solo ? `, ${ordinal(pos)} place` : ''}.` });
        }
        break;
      case 'finish':
        if (ev.playerId === me) {
          this.finishedAt = performance.now();
          this.flash(
            solo ? `FINISH · ${formatRaceTime(ev.timeMs)}` : ev.place === 1 ? 'YOU WIN!' : `${ordinal(ev.place).toUpperCase()} PLACE`,
            'gold',
            5000,
          );
          kartSfx.finish(solo ? 1 : ev.place);
          this.fxAtSlot('confetti', this.net.local);
          this.setUi({
            announce: solo
              ? `Finished in ${formatRaceTime(ev.timeMs)}.`
              : `You finished ${ordinal(ev.place)} in ${formatRaceTime(ev.timeMs)}.`,
          });
          // Let the last authoritative states of the run arrive before building the ghost.
          if (race?.mode === 'timetrial') setTimeout(() => void this.finishTimeTrial(ev.timeMs), 300);
        } else if (ev.place === 1 && !solo) {
          this.pushFeed(`${this.nameOf(ev.playerId)} wins!`, 'info');
          this.setUi({ announce: `${this.nameOf(ev.playerId)} won the race.` });
        }
        break;
      case 'dnf':
        if (ev.playerId === me) this.flash('DID NOT FINISH', 'red', 3000);
        break;
      case 'hit': {
        const victimSlot = this.slotOf(ev.victim);
        const mineVictim = ev.victim === me;
        const mineBy = ev.by !== null && ev.by === me;
        const what = itemName(ev.cause);
        if (ev.blocked) {
          this.fxAtSlot('blocked', victimSlot);
          if (mineVictim || mineBy || this.near(victimSlot)) kartSfx.shieldPop();
          if (mineVictim) this.showToast(ev.by ? `Blocked ${this.nameOf(ev.by)}'s ${what}!` : 'Blocked!', 'block');
          else if (mineBy) this.showToast(`${this.nameOf(ev.victim)} blocked it`, 'block');
        } else {
          if (ev.cause === 'pulse') this.fxAtSlot('pulse', victimSlot);
          if (ev.cause === 'fall') this.fxAtSlot('splash', victimSlot);
          else this.fxAtSlot('hit', victimSlot);
          if (mineVictim) {
            if (ev.cause === 'fall') kartSfx.fall();
            else {
              kartSfx.impact(ev.cause);
              kartSfx.spinOut();
            }
            this.showToast(
              ev.cause === 'fall' ? 'Off the edge!' : ev.by ? `Hit by ${this.nameOf(ev.by)}'s ${what}` : `Hit by ${what}`,
              'hit',
            );
          } else if (mineBy) {
            kartSfx.impact(ev.cause);
            this.showToast(`You hit ${this.nameOf(ev.victim)}!`, 'mine');
          } else if (this.near(victimSlot)) kartSfx.impact(ev.cause);
        }
        if (!solo && ev.by && ev.cause !== 'fall' && ev.cause !== 'hazard' && ev.cause !== 'bump') {
          this.pushFeed(
            ev.blocked
              ? `${this.nameOf(ev.victim)} blocked ${this.nameOf(ev.by)}'s ${what}`
              : `${this.nameOf(ev.by)} → ${this.nameOf(ev.victim)} · ${what}`,
            ev.blocked ? 'block' : mineBy ? 'mine' : 'hit',
          );
        }
        break;
      }
      case 'item':
        if (ev.playerId === me) {
          kartSfx.itemGet();
          this.rouletteIcon = ev.item;
        }
        break;
    }
  }

  private showToast(text: string, tone: string): void {
    this.toast = { text, tone, until: performance.now() + 2200 };
  }

  private near(slot: number | null): boolean {
    if (slot === null) return false;
    const f = this.followSlot !== null ? this.poses[this.followSlot] : undefined;
    const p = this.poses[slot];
    if (!f || !p) return false;
    const dx = f.x - p.x;
    const dy = f.y - p.y;
    return dx * dx + dy * dy < 45 * 45;
  }

  /** One-shot effects queued since the last frame (the stage forwards them to the renderer). */
  takeFx(): FxRequest[] {
    const out = this.fx;
    this.fx = [];
    return out;
  }

  // -------------------------------------------------------------------------
  // Per-frame
  // -------------------------------------------------------------------------

  /** Countdown timing: seconds to green (≥ 0) or -1 once racing / unscheduled. */
  private countdown(sNow: number): { toGo: number; since: number } {
    const goAt = this.meta.race?.goAt ?? 0;
    if (!goAt) return { toGo: -1, since: 0 };
    // Time the lights by our own input frames (input delay included), so GO shows exactly when the
    // server starts applying them unlocked — the start boost the player sees is the one it gets.
    const byFrames = this.net.startToGoMs();
    if (byFrames !== null) return { toGo: byFrames, since: -byFrames };
    return { toGo: goAt - sNow, since: sNow - goAt };
  }

  frame(now: number): KartView {
    const dt = this.lastFrameAt ? Math.min(0.1, (now - this.lastFrameAt) / 1000) : 1 / 60;
    this.lastFrameAt = now;
    const race = this.meta.race;
    const phase = this.meta.phase;
    // While paused every race clock stands still at the moment the pause began.
    const sNow = this.pausedAtServer || serverNow();
    const { toGo } = this.countdown(sNow);
    const racing = this.net.status === 'racing';
    const locked = !racing && (toGo > 0 || toGo === -1);
    const frozen = phase === 'RESULTS' || phase === 'INTERMISSION' || phase === 'LOBBY' || this.pausedAtServer > 0;
    this.sampler.enabled = !frozen && !this.uiState.spectating && !this.uiState.menuOpen;
    this.sampler.pollMenu();
    this.net.update(now, () => this.sampler.sample(now, locked), locked, frozen);
    this.setUi({ locked: locked && !frozen });

    // --- Karts ---------------------------------------------------------------
    const local = this.net.local;
    const poses = this.poses;
    for (const p of poses) if (p) p.active = false;
    let localState: KartState | null = null;
    for (const [slot, entry] of this.meta.bySlot) {
      let p = poses[slot];
      if (!p) {
        for (let i = poses.length; i <= slot; i++) poses[i] = blankKartPose(i);
        p = poses[slot]!;
      }
      const isLocal = slot === local && this.net.predicting;
      const s = this.scratch;
      if (isLocal) {
        const state = this.net.localPose(s);
        if (!state) continue;
        localState = state;
        p.steer = this.net.lastInput.steer;
        p.flags = renderFlags(state, this.net.localFlags);
        if (this.net.lastInput.back && state.item) p.flags |= KF.aimBack;
        p.driftStage = driftStage(state);
        p.item = state.rouletteTicks > 0 ? null : itemIdOf(state);
        p.itemCount = state.itemUses;
      } else {
        const k = this.net.remotePose(slot, now, s);
        if (!k) continue;
        p.steer = Math.max(-1, Math.min(1, k.yawRate / 2.2));
        p.flags = displayFlags(k);
        p.driftStage = k.driftStage;
        p.item = k.roulette ? null : k.item;
        p.itemCount = k.itemUses;
      }
      p.active = entry.racer.active || entry.racer.finished;
      p.x = s.x;
      p.y = s.y;
      p.z = s.z;
      p.heading = s.yaw;
      p.speed = s.vx * Math.cos(s.yaw) + s.vy * Math.sin(s.yaw);
      p.position = entry.racer.position;
    }

    // --- Entities + boxes --------------------------------------------------------
    this.net.renderEntities(now, this.ents);
    const ents = this.entPoses;
    ents.length = this.ents.length;
    for (let i = 0; i < this.ents.length; i++) {
      const e = this.ents[i]!;
      let o = ents[i];
      if (!o) ents[i] = o = { id: 0, kind: 'puck', x: 0, y: 0, z: 0, heading: 0, age: 0 };
      o.id = e.id;
      o.kind = ENTITY_KIND[e.kind] ?? 'puck';
      o.x = e.x;
      o.y = e.y;
      o.z = e.z;
      o.heading = e.heading;
      o.age = e.ageSec;
    }
    const boxes = this.net.latest?.boxes;
    const bs = this.boxStates;
    if (boxes) {
      bs.length = boxes.length;
      for (let i = 0; i < boxes.length; i++) {
        let b = bs[i];
        if (!b) bs[i] = b = { index: i, visible: true };
        b.index = i;
        b.visible = boxes[i]!;
        // A cube popped: shatter it (sound only when it's ours / close).
        if (this.prevBoxes[i] && !boxes[i]) {
          const box = this.track.itemBoxes[i];
          if (box) {
            this.fx.push({ kind: 'pickup', at: { x: box.x, y: box.y, z: box.z } });
            const f = this.followSlot !== null ? poses[this.followSlot] : undefined;
            if (f && (f.x - box.x) ** 2 + (f.y - box.y) ** 2 < 8 * 8) kartSfx.cube();
          }
        }
      }
      this.prevBoxes = boxes.slice();
    }

    // --- Camera ------------------------------------------------------------------
    const follow = this.followSlot ?? local ?? 0;
    let camera: KartCameraMode = 'chase';
    let introT = 1;
    const countdownMs = Math.max(KART_SIM.countdownMs, race?.goAt && this.countdownStartedAt ? race.goAt - this.countdownStartedAt : 0);
    if (!racing && toGo > 0 && phase === 'COUNTDOWN') {
      // The flyover sweeps over the grid while the lamps count, landing behind the kart for the
      // last second (the rocket-start window) so the player sees their own kart when it matters.
      const introMs = Math.max(1500, countdownMs - 1000);
      const elapsed = countdownMs - toGo;
      introT = Math.max(0, Math.min(1, elapsed / introMs));
      if (introT < 1) camera = 'intro';
    }
    if (this.uiState.spectating || (this.userFollow && follow !== local)) camera = camera === 'intro' ? 'intro' : 'spectate';
    else if (this.uiState.finished || phase === 'RESULTS' || phase === 'INTERMISSION') camera = 'orbit';
    this.setUi({ intro: phase === 'COUNTDOWN' && toGo > countdownMs - 2600 && toGo > 0 });

    // --- Lights + countdown sounds -----------------------------------------------
    let lights = -1;
    if (phase === 'COUNTDOWN' || (racing && toGo > -1500)) {
      if (toGo > 3000) lights = 0;
      else if (toGo > 0) lights = 3 - Math.floor(toGo / 1000);
      else lights = 4;
      if (toGo > 3000 && camera === 'intro') lights = -1;
      const step = toGo > 0 ? Math.ceil(toGo / 1000) : 0;
      if (step !== this.lastLightStep && step <= 3 && step >= 1 && toGo > 0) kartSfx.countBeep();
      if (step === 0 && this.lastLightStep > 0 && !this.goPlayed) {
        this.goPlayed = true;
        kartSfx.go();
        this.setUi({ announce: 'Go!' });
      }
      this.lastLightStep = step;
    }

    const view = this.view;
    view.tick = local !== null && this.net.predicting ? this.net.predictedTick(now) : this.net.renderTick(now);
    view.targetSlot = follow;
    view.camera = camera;
    view.introT = introT;
    view.lights = lights;
    view.dt = dt;
    view.ghost = this.ghostFrame(sNow, race);

    // --- Local feedback: sounds + fx from prediction -------------------------------
    // Paused / results: nothing moves, so no roulette ticks, squeals or chimes either.
    this.localFeedback(frozen ? null : localState, local, now);
    this.audio(localState, local, frozen, follow);

    if (now - this.lastHud > 66) {
      this.lastHud = now;
      this.updateHud(localState, sNow, toGo, racing);
    }
    if (now - this.lastMap > 80) {
      this.lastMap = now;
      this.drawMinimap(follow);
    }
    return view;
  }

  private ghostFrame(sNow: number, race: KartRaceMetaView | null): KartPose | null {
    if (!this.ghost || !race || race.mode !== 'timetrial' || !race.goAt || sNow < race.goAt) return null;
    const p = ghostPoseAt(this.ghost, sNow - race.goAt);
    if (!p) return null;
    const g = this.ghostPose;
    g.active = true;
    g.x = p.x;
    g.y = p.y;
    g.z = p.z;
    g.heading = p.heading;
    g.flags = KF.ghost;
    return g;
  }

  private localFeedback(state: KartState | null, local: number | null, now: number): void {
    const infos = this.net.takeInfos();
    if (!state || local === null) {
      this.prevStage = 0;
      return;
    }
    for (const info of infos) {
      if (info.launched) kartSfx.jump();
      if (info.landed) {
        kartSfx.land(0.6);
        this.fxAtSlot('land', local);
      }
      if (info.boostPad) {
        kartSfx.boostPad();
        this.fxAtSlot('boost', local);
      }
      if (info.miniTurbo > 0) {
        kartSfx.miniTurbo(info.miniTurbo);
        this.fxAtSlot('boost', local, info.miniTurbo);
      }
      if (info.wallImpact > 3) {
        kartSfx.wall(Math.min(1, info.wallImpact / 14));
        this.fxAtSlot('wall', local);
      }
      if (info.startBoost === 'boost') {
        kartSfx.startBoost();
        this.fxAtSlot('boost', local, 2);
        this.flash('ROCKET START!', 'cyan', 1400);
      } else if (info.startBoost === 'stall') {
        kartSfx.wheelspin();
        this.flash('TOO EARLY', 'red', 1200);
      }
      if (info.used) kartSfx.use(info.used.item);
    }
    const stage = driftStage(state);
    if (stage > this.prevStage && stage > 0) kartSfx.driftStage(stage);
    this.prevStage = stage;
    if (state.driftDir !== 0 && this.prevDriftDir === 0) kartSfx.hop();
    this.prevDriftDir = state.driftDir;
    if (state.trick && !this.prevTrick) {
      kartSfx.trick();
      this.fxAtSlot('trick', local);
    }
    this.prevTrick = state.trick;
    const shield = state.shieldTicks > 0;
    if (this.prevShield && !shield) kartSfx.shieldPop();
    this.prevShield = shield;
    // Roulette ticks: fast, then slowing toward the stop.
    if (state.rouletteTicks > 0) {
      if (this.prevRoulette === 0) {
        this.rouletteStep = 0;
        this.rouletteNextAt = now;
      }
      if (now >= this.rouletteNextAt) {
        const left = state.rouletteTicks / 66;
        kartSfx.roulette(this.rouletteStep++);
        this.rouletteNextAt = now + 55 + (1 - Math.min(1, left)) * 90;
        this.rouletteIcon = KART_ITEM_IDS[this.rouletteStep % KART_ITEM_IDS.length] ?? 'turbo';
      }
    }
    this.prevRoulette = state.rouletteTicks;
  }

  private audio(state: KartState | null, local: number | null, frozen: boolean, follow: number): void {
    if (!state || local === null || frozen) {
      this.engine.update(null);
      return;
    }
    const mine = this.meta.mine;
    const spec = racerSpec(mine?.racer ?? 'nova');
    const speed = forwardSpeed(state);
    const me = this.poses[local];
    let nearest = Infinity;
    let nearSpeed = 0;
    if (me) {
      for (const p of this.poses) {
        if (!p || !p.active || p.slot === local) continue;
        const d = (p.x - me.x) ** 2 + (p.y - me.y) ** 2;
        if (d < nearest) {
          nearest = d;
          nearSpeed = p.speed;
        }
      }
    }
    const nearby = Number.isFinite(nearest) ? Math.max(0, 1 - Math.sqrt(nearest) / 28) : 0;
    const slide = state.driftDir !== 0 ? 0.55 + driftStage(state) * 0.12 : 0;
    this.engine.update({
      speed01: Math.abs(speed) / spec.topSpeed,
      throttle: this.net.lastInput.throttle,
      boosting: state.boostTicks > 0,
      squeal: follow === local ? slide : 0,
      airborne: !state.grounded,
      offroad: ((me?.flags ?? 0) & KF.offroad) !== 0,
      nearby,
      nearbySpeed01: Math.abs(nearSpeed) / spec.topSpeed,
    });
  }

  // -------------------------------------------------------------------------
  // HUD
  // -------------------------------------------------------------------------

  private updateHud(state: KartState | null, sNow: number, toGo: number, racing: boolean): void {
    const hud = this.hud;
    const race = this.meta.race;
    const follow = this.followSlot !== null ? this.meta.bySlot.get(this.followSlot)?.racer : undefined;
    const r = this.meta.mine ?? follow ?? null;
    const laps = race?.laps ?? 3;
    const entrants = race?.entrants || this.meta.bySlot.size;
    const goAt = race?.goAt ?? 0;
    const raceNow = racing && goAt ? Math.max(0, sNow - goAt) : 0;

    const pos = r?.position ?? 0;
    hud.text('posBig', pos ? String(pos) : '-');
    hud.text('posSuffix', pos ? ordinal(pos).replace(String(pos), '') : '');
    hud.text('posOf', `/${entrants}`);
    hud.data('pos', 'place', pos ? String(Math.min(pos, 4)) : null);
    // Place changes pop (alternating names restart the CSS animation); gains flash green, losses red.
    if (racing && pos && this.lastPosition && pos !== this.lastPosition)
      hud.data('pos', 'bump', `${pos < this.lastPosition ? 'up' : 'down'}-${++this.bumpSeq % 2 ? 'a' : 'b'}`);
    this.lastPosition = pos;
    hud.text('lap', r ? String(Math.min(laps, Math.max(1, r.lap))) : '1');
    hud.text('lapOf', `/${laps}`);
    hud.text('clock', r?.finished ? formatRaceTime(r.finishMs) : raceNow > 0 ? formatRaceTime(raceNow) : '0:00.000');
    hud.text('last', r?.lastLapMs ? formatRaceTime(r.lastLapMs) : '--:--.---');
    hud.text('best', r?.bestLapMs ? formatRaceTime(r.bestLapMs) : '--:--.---');
    const pbMs = race ? this.best?.race[String(race.laps)] : undefined;
    hud.text('pb', pbMs ? formatRaceTime(pbMs) : '--:--.---');

    // Item slot (the local kart, or the followed kart when spectating).
    let item: KartItemId | null = null;
    let uses = 0;
    let rolling = false;
    let trailing = false;
    if (state) {
      rolling = state.rouletteTicks > 0;
      item = rolling ? null : itemIdOf(state);
      uses = state.itemUses;
      trailing = state.trailing;
    } else if (this.followSlot !== null) {
      const k = this.net.latestOf(this.followSlot);
      if (k) {
        rolling = k.roulette;
        item = rolling ? null : k.item;
        uses = k.itemUses;
        trailing = k.trailing;
      }
    }
    const icon = rolling ? itemIconUrl(this.rouletteIcon) : item ? itemIconUrl(item) : '';
    for (const key of ['itemIcon', 'touchItemIcon']) {
      const el = hud.el<HTMLImageElement>(key);
      if (el && el.getAttribute('src') !== (icon || null)) {
        if (icon) el.setAttribute('src', icon);
        else el.removeAttribute('src');
      }
    }
    const itemState = rolling ? 'roll' : item ? (trailing ? 'trail' : 'ready') : 'empty';
    hud.data('itemSlot', 'state', itemState);
    hud.data('touchItem', 'state', itemState);
    const countText = item && uses > 1 ? `×${uses}` : '';
    hud.text('itemCount', countText);
    hud.text('touchItemCount', countText);
    hud.text('itemName', rolling ? '…' : item ? KART_ITEMS[item].name : '');

    // Drift charge pips (secondary to the sparks; only while drifting).
    hud.data('drift', 'stage', state && state.driftDir !== 0 ? String(driftStage(state)) : null);

    // Wrong way.
    const flags = this.net.local !== null ? this.net.localFlags : 0;
    const wrong = racing && Boolean(flags & KartFlag.wrongWay) && !this.meta.mine?.finished;
    hud.data('wrongWay', 'show', wrong ? 'true' : null);
    if (wrong && !this.wasWrong) this.setUi({ announce: 'Wrong way! Turn around.' });
    this.wasWrong = wrong;

    // Banner + toast.
    const now = performance.now();
    if (this.banner && this.banner.until < now) this.banner = null;
    hud.text('banner', this.banner?.text ?? '');
    hud.data('banner', 'tone', this.banner?.tone ?? null);
    hud.data('banner', 'show', this.banner ? 'true' : null);
    if (this.toast && this.toast.until < now) this.toast = null;
    hud.text('toast', this.toast?.text ?? '');
    hud.data('toast', 'tone', this.toast?.tone ?? null);
    hud.data('toast', 'show', this.toast ? 'true' : null);
    if (this.uiState.feed.length && now - this.uiState.feed[0]!.at > 4500)
      this.setUi({ feed: this.uiState.feed.filter((f) => now - f.at < 4500) });

    // Finish window.
    const deadline = race?.finishDeadline ?? 0;
    const left = deadline ? Math.max(0, deadline - sNow) : 0;
    hud.text('window', left > 0 ? `${Math.ceil(left / 1000)}s` : '');
    hud.data('windowWrap', 'show', left > 0 && racing && !this.meta.mine?.finished ? 'true' : null);

    // Countdown lamps (DOM overlay mirrors the 3D gantry, for readability on small screens).
    const cd = toGo > 0 ? Math.ceil(toGo / 1000) : 0;
    hud.data('countdown', 'phase', toGo > 0 && toGo <= 3000 ? 'count' : toGo <= 0 && toGo > -1200 && goAt ? 'go' : 'hidden');
    hud.text('countNum', toGo > 0 && toGo <= 3000 ? String(cd) : 'GO!');
    hud.data('countdown', 'beat', toGo > 0 ? (cd % 2 ? 'a' : 'b') : 'go');
    // The start-boost window cue: a subtle glow on the last lamp while it's the right moment.
    hud.data('countdown', 'boost', toGo > 60 && toGo < 1000 ? 'true' : null);
    hud.data('root', 'status', racing ? 'racing' : toGo > 0 ? 'grid' : 'done');
  }

  private drawMinimap(follow: number): void {
    const canvas = this.hud.el<HTMLCanvasElement>('minimap');
    if (!canvas) return;
    // Keep the backing store crisp at the displayed size (it changes with layout / rotation).
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const want = Math.max(64, Math.round((canvas.clientWidth || 160) * dpr));
    if (canvas.width !== want) {
      canvas.width = want;
      canvas.height = want;
    }
    const w = canvas.width;
    const h = canvas.height;
    if (!this.mapBase || this.mapBase.canvas.width !== w || this.mapBase.canvas.height !== h) {
      const lines = trackPolylines(this.trackId);
      if (!lines) return;
      this.mapBase = buildMapBase(lines.main, lines.branches, w, h, Math.round(Math.min(w, h) * 0.07));
    }
    const g = canvas.getContext('2d');
    if (!g) return;
    const dots: MapDot[] = [];
    for (const [slot, entry] of this.meta.bySlot) {
      const p = this.poses[slot];
      if (!p || !p.active) continue;
      dots.push({
        x: p.x,
        y: p.y,
        color: entry.racer.paint,
        me: slot === follow,
        label: slot === follow && entry.racer.position ? String(entry.racer.position) : undefined,
      });
    }
    const marks: MapMark[] = [];
    // Hazards (bumpers, stompers, lasers…) as faint static marks; traps and seekers live.
    for (const hz of this.track.hazards) marks.push({ x: hz.x, y: hz.y, kind: 'hazard' });
    for (const e of this.entPoses)
      if (e.kind === 'mine' || e.kind === 'seeker' || e.kind === 'fizz')
        marks.push({ x: e.x, y: e.y, kind: e.kind === 'seeker' ? 'item' : 'trap' });
    if (this.view.ghost) marks.push({ x: this.view.ghost.x, y: this.view.ghost.y, kind: 'ghost' });
    drawMap(g, this.mapBase, dots, marks, { w, h }, '#f8f6ff', `700 ${Math.round(w / 16)}px "Space Grotesk", system-ui, sans-serif`);
  }

  /** Racer look for a slot (portraits in the HUD / spectator bar). */
  lookOf(slot: number): { racer: KartRacerId; body: KartBodyId; paint: string } | null {
    const e = this.meta.bySlot.get(slot);
    return e ? { racer: e.racer.racer, body: e.racer.body, paint: e.racer.paint } : null;
  }

  racerName(id: KartRacerId): string {
    return KART_RACERS[id]?.name ?? id;
  }
}
