/**
 * Dev-only entry for harness.html (query params → startKartHarness).
 *   ?track=…&bots=11&auto=1&skip=20&cam=chase&q=high&fx=high&rm=1&theme=<id>
 *   ?gallery=1&slot=0          all racers × bodies parked on the grid, orbit camera on `slot`
 *   ?portraits=1               the menu portraits (renderRacerPortrait) for every racer/body
 *   ?icons=1                   the item HUD icons
 */
import { KART_BODY_IDS, KART_ITEM_IDS, KART_RACERS, KART_RACER_IDS, KART_TRACK_IDS, type KartBodyId, type KartRacerId, type KartTrackId } from '@dascade/shared/games/kart';
import { getKartTrack, worldAt } from '@dascade/game-core/kart';
import { getTheme } from '@dascade/ui';
import { drawAttract } from '../../../arcade/attract.ts';
import { itemIconUrl } from '../art/icons.ts';
import { renderRacerPortrait } from '../art/portrait.ts';
import { startKartHarness } from './harness.ts';
import { createKartRenderer } from './renderer.ts';
import { emptyPose } from './pose.ts';
import { KF, type KartCameraMode, type KartFxLevel, type KartPose, type KartQuality, type KartRosterEntry } from './types.ts';

const q = new URLSearchParams(location.search);
const trackParam = q.get('track') as KartTrackId | null;
const track: KartTrackId = trackParam && (KART_TRACK_IDS as readonly string[]).includes(trackParam) ? trackParam : 'pixel-plaza';
const theme = q.get('theme');
const host = document.getElementById('host')!;
const hud = document.getElementById('hud')!;
if (q.get('hud') === '0') hud.style.display = 'none';

if (q.has('attract')) {
  // the DAS Raceway cabinet attract scene at a few sizes (t = ?t= seconds, frozen)
  host.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;padding:12px;background:#111';
  const t0 = Number(q.get('t') ?? -1);
  for (const [w, h] of [[160, 120], [96, 72], [64, 48]] as const) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.style.cssText = `width:${w * (w > 100 ? 5 : 6)}px;height:${h * (w > 100 ? 5 : 6)}px;image-rendering:pixelated`;
    host.appendChild(c);
    const ctx = c.getContext('2d')!;
    const start = performance.now();
    const loop = () => {
      const t = t0 >= 0 ? t0 : (performance.now() - start) / 1000;
      drawAttract({ ctx, W: w, H: h, t, active: true, hud: true, still: false, scenes: ['kart'], title: 'DAS RACEWAY', accent: { primary: '#22d3ee', secondary: '#ff4fd8', glow: '#22d3ee' } as never });
      requestAnimationFrame(loop);
    };
    loop();
  }
} else if (q.has('portraits') || q.has('icons')) {
  host.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding:12px;background:#1a1330;overflow:auto;height:auto;min-height:100%';
  document.body.style.overflow = 'auto';
  if (q.has('icons')) {
    for (const id of ['prism', ...KART_ITEM_IDS] as const) {
      const img = document.createElement('img');
      img.src = itemIconUrl(id);
      img.width = 96;
      img.height = 96;
      img.title = id;
      img.style.cssText = 'background:#2a2146;border-radius:12px;padding:6px';
      host.appendChild(img);
    }
  } else {
    const view = q.get('view') === 'face' ? 'face' : q.get('view') === 'rear' ? 'rear' : 'kart';
    const only = q.get('only');
    const bodyOnly = q.get('bodyOnly');
    const px = Number(q.get('size') ?? 0);
    for (const racer of KART_RACER_IDS)
      for (const body of KART_BODY_IDS) {
        if (only && racer !== only) continue;
        if (bodyOnly && body !== bodyOnly) continue;
        const img = document.createElement('img');
        img.width = view === 'rear' ? 236 : 200;
        img.height = view === 'rear' ? 236 : 200;
        img.style.cssText = 'background:radial-gradient(#3b2d6b,#150f2a);border-radius:12px';
        host.appendChild(img);
        if (px) {
          img.width = px;
          img.height = px;
        }
        void renderRacerPortrait(racer, body, KART_RACERS[racer].colors.main, px || 256, view).then((u) => (img.src = u));
      }
  }
} else if (q.has('gallery')) {
  const t = getKartTrack(track);
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%';
  host.appendChild(canvas);
  const r = createKartRenderer(canvas, { track: t, quality: 'high', reducedMotion: false, fx: 'high' });
  const roster: KartRosterEntry[] = [];
  const poses: KartPose[] = [];
  let i = 0;
  for (const racer of KART_RACER_IDS)
    for (const body of KART_BODY_IDS) {
      if (i >= t.grid.length) break;
      roster.push({ slot: i, racer: racer as KartRacerId, body: body as KartBodyId, paint: KART_RACERS[racer].colors.main, name: KART_RACERS[racer].name, local: i === 0 });
      const g = t.grid[i]!;
      const p = emptyPose(i);
      p.active = true;
      p.x = g.x;
      p.y = g.y;
      p.z = g.z;
      p.heading = g.heading;
      poses.push(p);
      i++;
    }
  // ?at=<lap fraction>&d=<lateral>: park kart 0 there (chase-cam views of any spot); ?solo=1 hides the rest
  if (q.has('at')) {
    const at = Number(q.get('at'));
    const d = Number(q.get('d') ?? 0);
    const w = worldAt(t, at * t.length, d);
    const p0 = poses[0]!;
    p0.x = w.x;
    p0.y = w.y;
    p0.z = w.z;
    p0.heading = w.heading;
  }
  if (q.get('solo') === '1') for (const p of poses.slice(1)) p.active = false;
  r.setRoster(roster);
  const slot = Number(q.get('slot') ?? 0);
  const cam = (q.get('cam') as KartCameraMode | null) ?? 'orbit';
  const flags = Number(q.get('flags') ?? 0);
  const stage = Number(q.get('stage') ?? 0);
  for (const p of poses) {
    p.flags = flags;
    p.driftStage = stage;
    if (flags & KF.drifting) p.speed = 20;
  }
  const resize = () => r.resize(host.clientWidth, host.clientHeight, devicePixelRatio || 1);
  resize();
  addEventListener('resize', resize);
  let last = performance.now();
  let tick = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    tick += dt * 60;
    r.frame({ karts: poses, entities: [], tick, targetSlot: slot, camera: cam, dt, lights: Number(q.get('lights') ?? -1) });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  (window as unknown as { __KH__: unknown }).__KH__ = { stats: () => r.stats(), fx: (k: never) => r.triggerFx(k, { x: poses[slot]!.x, y: poses[slot]!.y, z: poses[slot]!.z, slot }) };
} else {
  const h = startKartHarness(host, {
    track,
    bots: Number(q.get('bots') ?? 7),
    quality: (q.get('q') as KartQuality | null) ?? 'high',
    fx: (q.get('fx') as KartFxLevel | null) ?? 'high',
    reducedMotion: q.get('rm') === '1',
    autopilot: q.get('auto') === '1',
    camera: (q.get('cam') as KartCameraMode | null) ?? 'intro',
    noIntro: q.has('skip') || q.get('intro') === '0',
    materials: theme ? ((getTheme(theme).materials as Partial<Record<string, string>> | undefined) ?? null) : null,
    racer: (q.get('racer') as KartRacerId | null) ?? undefined,
    body: (q.get('body') as KartBodyId | null) ?? undefined,
    item: q.get('item') ?? undefined,
  });
  const skip = Number(q.get('skip') ?? 0);
  if (skip > 0) (window as unknown as { __KH__: { skip(s: number): void } }).__KH__.skip(skip);
  setInterval(() => {
    const s = h.renderer.stats();
    hud.textContent = `${track}  ${s.fps} fps  ${s.frameMs} ms  calls ${s.drawCalls}  tris ${s.triangles}  q ${s.quality}  pr ${s.pixelRatio}`;
  }, 500);
}
