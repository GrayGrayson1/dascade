/**
 * Offline dev harness: a full local race (core KartSim + bots) rendered by the real renderer, no
 * network. Used for screenshots/perf and by the client lane behind a dev-only flag.
 *
 *   startKartHarness(hostEl, { track: 'pixel-plaza', bots: 11 })
 *
 * Keys: ←/→ or A/D steer · ↑/W throttle · ↓/S brake · Space drift/hop · X/Shift item · Z aim back.
 * `window.__KH__` exposes stats(), camera(mode), skip(seconds), fx(kind), renderer for automation.
 */
import { KART_ITEM_IDS, KART_RACER_IDS, KART_BODY_IDS, KART_RACERS, KART_SIM, packKartInput, type KartBodyId, type KartInput, type KartRacerId, type KartTrackId } from '@dascade/shared/games/kart';
import { createSeededRng } from '@dascade/shared/random';
import { KartSim, getKartTrack, type KartSimEvent } from '@dascade/game-core/kart';
import { createKartRenderer, type KartRenderer } from './renderer.ts';
import { emptyPose, poseFromState } from './pose.ts';
import type { KartBoxState, KartCameraMode, KartEntityPose, KartFxLevel, KartPose, KartQuality } from './types.ts';

export interface HarnessOptions {
  track?: KartTrackId;
  bots?: number;
  quality?: KartQuality;
  fx?: KartFxLevel;
  reducedMotion?: boolean;
  /** The local kart drives itself (screenshots). */
  autopilot?: boolean;
  camera?: KartCameraMode;
  /** Skip the countdown intro. */
  noIntro?: boolean;
  /** Theme materials to apply (e.g. from getTheme(id).materials). */
  materials?: Partial<Record<string, string>> | null;
  racer?: KartRacerId;
  body?: KartBodyId;
  paint?: string;
  /** Give the local kart this item at the start (visual testing). */
  item?: string;
}

export interface HarnessHandle {
  stop(): void;
  renderer: KartRenderer;
  sim: KartSim;
}

export function startKartHarness(host: HTMLElement, o: HarnessOptions = {}): HarnessHandle {
  const trackId = o.track ?? 'pixel-plaza';
  const track = getKartTrack(trackId);
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
  host.appendChild(canvas);
  const renderer = createKartRenderer(canvas, { track, quality: o.quality ?? 'high', reducedMotion: o.reducedMotion ?? false, fx: o.fx ?? 'high' });
  if (o.materials) renderer.setThemeTokens({ materials: o.materials });

  const bots = Math.max(0, Math.min(KART_SIM.gridSlots - 1, o.bots ?? 7));
  const sim = new KartSim(track, { laps: 3, items: true, finishWindowMs: 25_000, maxRaceMs: 600_000 }, createSeededRng(track.def.decorSeed), 1);
  const localRacer = o.racer ?? 'nova';
  sim.addRacer(0, 'me', localRacer, o.autopilot ? 'hard' : null);
  const roster = [{ slot: 0, racer: localRacer, body: o.body ?? 'buggy', paint: o.paint ?? KART_RACERS[localRacer].colors.main, name: 'You', local: true }];
  for (let i = 1; i <= bots; i++) {
    const racer = KART_RACER_IDS[i % KART_RACER_IDS.length]!;
    sim.addRacer(i, `bot:${i}`, racer, i % 3 === 0 ? 'hard' : 'normal');
    roster.push({ slot: i, racer, body: KART_BODY_IDS[i % 3]!, paint: KART_RACERS[racer].colors.main, name: KART_RACERS[racer].name, local: false });
  }
  renderer.setRoster(roster);
  if (o.item) {
    const idx = (KART_ITEM_IDS as readonly string[]).indexOf(o.item);
    if (idx >= 0) {
      const k = sim.kart(0)!;
      k.state.item = idx + 1;
      k.state.itemUses = o.item.endsWith('3') ? 3 : 1;
    }
  }
  const countdownTicks = Math.round((KART_SIM.countdownMs / 1000) * KART_SIM.tickRate);
  if (o.noIntro) sim.go();
  else sim.startCountdown(countdownTicks);

  // --- input ------------------------------------------------------------------------------------
  const keys = new Set<string>();
  const kd = (e: KeyboardEvent) => {
    keys.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  };
  const ku = (e: KeyboardEvent) => keys.delete(e.code);
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  const input: KartInput = { throttle: 0, brake: 0, steer: 0, drift: false, item: false, back: false };
  const readInput = () => {
    input.throttle = keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0;
    input.brake = keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0;
    input.steer = (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0) - (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0);
    input.drift = keys.has('Space');
    input.item = keys.has('KeyX') || keys.has('ShiftLeft') || keys.has('ShiftRight');
    input.back = keys.has('KeyZ');
  };

  // --- view -------------------------------------------------------------------------------------
  const poses: KartPose[] = [];
  for (const k of sim.karts) poses.push(emptyPose(k.slot));
  const ents: KartEntityPose[] = [];
  const boxes: KartBoxState[] = track.itemBoxes.map((_, index) => ({ index, visible: true }));
  let cameraMode: KartCameraMode = o.camera ?? 'intro';
  let seq = 1;
  let acc = 0;
  let last = performance.now();
  let raf = 0;
  let stopped = false;
  let goSeenAt = -1;
  const onEvents = (evs: KartSimEvent[]) => {
    for (const e of evs) {
      switch (e.type) {
        case 'hit': {
          const k = sim.kart(e.victim);
          if (k) renderer.triggerFx(e.blocked ? 'blocked' : 'hit', { x: k.state.x, y: k.state.y, z: k.state.z, slot: e.victim });
          break;
        }
        case 'box': {
          const b = track.itemBoxes[e.box];
          if (b) renderer.triggerFx('pickup', { x: b.x, y: b.y, z: b.z, slot: e.slot });
          break;
        }
        case 'bump':
          renderer.triggerFx('wall', { x: e.x, y: e.y, z: e.z + 0.4 });
          break;
        case 'finish': {
          const k = sim.kart(e.slot);
          if (k && e.slot === 0) {
            renderer.triggerFx('confetti', { x: k.state.x, y: k.state.y, z: k.state.z, slot: 0 });
            cameraMode = 'orbit';
          }
          break;
        }
        case 'go':
          goSeenAt = sim.tick;
          if (cameraMode === 'intro') cameraMode = 'chase';
          break;
        default:
          break;
      }
    }
  };
  const stepOnce = () => {
    const me = sim.kart(0);
    if (me && !me.brain) {
      readInput();
      sim.pushInputs(0, seq, [packKartInput(input)]);
      seq++;
    }
    onEvents(sim.step());
    for (const k of sim.karts) {
      const i = k.info;
      if (i.wallImpact > 4) renderer.triggerFx('wall', { x: k.state.x, y: k.state.y, z: k.state.z + 0.4, slot: k.slot });
      if (i.fell) renderer.triggerFx('splash', { x: k.state.x, y: k.state.y, z: k.state.z - 2, slot: k.slot });
      if (i.boostPad) renderer.triggerFx('boost', { x: k.state.x, y: k.state.y, z: k.state.z, slot: k.slot });
      if (i.landed && k.state.trick) renderer.triggerFx('trick', { x: k.state.x, y: k.state.y, z: k.state.z, slot: k.slot });
    }
  };
  const skip = (seconds: number) => {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) stepOnce();
    if (sim.status === 'racing' && cameraMode === 'intro') cameraMode = 'chase';
  };

  const buildView = (dt: number) => {
    sim.karts.forEach((k, i) => {
      poseFromState(poses[i]!, k.slot, k.state, k.info, k.input, k.progress.finished, k.position);
      poses[i]!.active = !k.retired;
    });
    ents.length = 0;
    for (const e of sim.entities) ents.push({ id: e.id, kind: e.kind === 'puddle' ? 'fizz' : e.kind, x: e.x, y: e.y, z: e.z, heading: e.heading, age: e.age / 60 });
    sim.boxes.forEach((b, i) => (boxes[i]!.visible = b.present));
    let lights = -1;
    let introT = 1;
    if (sim.status === 'grid' && sim.goTick >= 0) {
      const left = (sim.goTick - sim.tick) / 60;
      introT = Math.max(0, Math.min(1, 1 - (left - 0.2) / (KART_SIM.countdownMs / 1000 - 0.2)));
      lights = left > 3 ? 0 : left > 2 ? 1 : left > 1 ? 2 : 3;
    } else if (goSeenAt >= 0 && sim.tick - goSeenAt < 120) lights = 4;
    return { karts: poses, entities: ents, boxes, tick: sim.tick, targetSlot: targetSlot, camera: cameraMode, introT, lights, dt };
  };
  let targetSlot = 0;

  const resize = () => renderer.resize(host.clientWidth, host.clientHeight, window.devicePixelRatio || 1);
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  const loop = (now: number) => {
    if (stopped) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    let n = 0;
    while (acc >= 1 / 60 && n < 6) {
      stepOnce();
      acc -= 1 / 60;
      n++;
    }
    if (n === 6) acc = 0;
    renderer.frame(buildView(dt));
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  const handle: HarnessHandle = {
    renderer,
    sim,
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      renderer.dispose();
      canvas.remove();
    },
  };
  (window as unknown as { __KH__: unknown }).__KH__ = {
    stats: () => renderer.stats(),
    camera: (m: KartCameraMode) => (cameraMode = m),
    target: (slot: number) => (targetSlot = slot),
    skip,
    fx: (kind: Parameters<KartRenderer['triggerFx']>[0], slot = 0) => {
      const k = sim.kart(slot);
      if (k) renderer.triggerFx(kind, { x: k.state.x, y: k.state.y, z: k.state.z, slot });
    },
    status: () => ({ status: sim.status, tick: sim.tick, lap: sim.kart(0)?.progress.lap, pos: sim.kart(0)?.position }),
    handle,
  };
  return handle;
}
