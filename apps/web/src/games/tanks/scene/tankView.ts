/**
 * Tank display objects: pixel-art hull (tinted per player), a rotating barrel, a neon
 * under-glow, a wind flag on the antenna, name + hit-point bar, the active-turn chevron
 * and a smoking wreck when destroyed.
 */
import Phaser from 'phaser';
import { TANK_GEOM, TEAM_NAMES } from '@dascade/shared/games/tanks';
import { restHeight, type Terrain } from '@dascade/game-core/tanks';
import type { DisplayTank } from '../model/presenter.ts';
import { DISPLAY_FONT, NUM_FONT, TEAM_TINT, hexToInt, shade } from '../art/themes.ts';

const S = 3; // texels per world unit
const W = 34;
const HGT = 22;

function hullCanvas(color: string, accent: string, wreck: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W * S;
  c.height = HGT * S;
  const g = c.getContext('2d')!;
  g.scale(S, S);
  const body = wreck ? '#2a2630' : color;
  // Tracks.
  g.fillStyle = wreck ? '#141218' : '#16131f';
  g.beginPath();
  g.roundRect(2, 15, 30, 7, 3.4);
  g.fill();
  g.strokeStyle = wreck ? '#2c2833' : '#3d3752';
  g.lineWidth = 0.7;
  g.stroke();
  for (const x of [6, 11.5, 17, 22.5, 28]) {
    g.fillStyle = wreck ? '#25222c' : '#453e5e';
    g.beginPath();
    g.arc(x, 18.5, 2.3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = wreck ? '#1a171f' : '#8d86ad';
    g.fillRect(x - 0.5, 18, 1, 1);
  }
  // Hull.
  const grad = g.createLinearGradient(0, 8, 0, 16);
  grad.addColorStop(0, wreck ? '#3a3540' : shade(body, 0.35));
  grad.addColorStop(0.55, body);
  grad.addColorStop(1, wreck ? '#1d1a22' : shade(body, -0.45));
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(3.5, 15.5);
  g.lineTo(30.5, 15.5);
  g.lineTo(27, 9);
  g.lineTo(8, 9);
  g.closePath();
  g.fill();
  g.fillStyle = wreck ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.45)';
  g.fillRect(8.5, 9, 18, 0.8);
  // Accent stripe (team colour or a darker shade).
  g.fillStyle = wreck ? '#18151c' : accent;
  g.fillRect(6, 12.4, 22, 1.4);
  // Rivets.
  g.fillStyle = wreck ? '#0f0d12' : shade(body, -0.55);
  for (const x of [9, 13, 21, 25]) g.fillRect(x, 10.6, 0.9, 0.9);
  // Turret dome (pivot at 13 above ground → y = 9).
  const dome = g.createRadialGradient(15, 5, 1, 17, 9, 8);
  dome.addColorStop(0, wreck ? '#3a3540' : shade(body, 0.5));
  dome.addColorStop(1, wreck ? '#1d1a22' : shade(body, -0.25));
  g.fillStyle = dome;
  g.beginPath();
  g.arc(17, 9.2, 6.6, Math.PI, 0);
  g.closePath();
  g.fill();
  g.fillStyle = wreck ? '#0d0b10' : shade(body, -0.6);
  g.fillRect(15, 4, 4, 1.2);
  if (wreck) {
    g.fillStyle = 'rgba(0,0,0,0.55)';
    for (let i = 0; i < 16; i++) g.fillRect(4 + ((i * 7) % 26), 8 + ((i * 5) % 12), 1.2, 1.2);
  }
  return c;
}

function barrelCanvas(color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const len = TANK_GEOM.barrel + 1;
  c.width = len * S;
  c.height = 4 * S;
  const g = c.getContext('2d')!;
  g.scale(S, S);
  const grad = g.createLinearGradient(0, 0.4, 0, 3.6);
  grad.addColorStop(0, shade(color, 0.45));
  grad.addColorStop(1, shade(color, -0.5));
  g.fillStyle = grad;
  g.fillRect(0, 1, len - 2.5, 2);
  g.fillStyle = shade(color, -0.2);
  g.fillRect(len - 3.5, 0.5, 3.5, 3);
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fillRect(len - 3.5, 0.5, 3.5, 0.6);
  return c;
}

const refs = new WeakMap<Phaser.Scene, Map<string, number>>();

function retain(scene: Phaser.Scene, key: string, make: () => HTMLCanvasElement): string {
  let m = refs.get(scene);
  if (!m) refs.set(scene, (m = new Map()));
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, make());
  m.set(key, (m.get(key) ?? 0) + 1);
  return key;
}

function release(scene: Phaser.Scene, key: string): void {
  const m = refs.get(scene);
  const n = m?.get(key) ?? 0;
  if (n > 1) {
    m!.set(key, n - 1);
    return;
  }
  m?.delete(key);
  if (scene.sys?.textures && scene.textures.exists(key)) scene.textures.remove(key);
}

export interface TankRenderInfo {
  now: number;
  labelScale: number;
  active: boolean;
  me: boolean;
  wind: number;
  reducedMotion: boolean;
  worldH: number;
  terrain: Terrain;
  teams: boolean;
}

export class TankView {
  readonly id: string;
  private readonly scene: Phaser.Scene;
  private readonly glow: Phaser.GameObjects.Image;
  private readonly hull: Phaser.GameObjects.Image;
  private readonly barrel: Phaser.GameObjects.Image;
  private readonly flag: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Container;
  private readonly name: Phaser.GameObjects.Text;
  private readonly hpText: Phaser.GameObjects.Text;
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly chevron: Phaser.GameObjects.Image;
  private keys: string[] = [];
  private look = '';
  private wrecked = false;
  private lastHp = -1;
  private lastMax = -1;
  private hpShown = -1;
  private nameColor = '';
  seen = 0;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, t: DisplayTank, depth: number, dpr: number) {
    this.scene = scene;
    this.id = t.id;
    this.glow = scene.add.image(0, 0, 'tk-glow').setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.3).setDepth(depth - 0.5);
    this.barrel = scene.add.image(0, 0, 'tk-px').setOrigin(0.08, 0.5).setDepth(depth);
    this.hull = scene.add.image(0, 0, 'tk-px').setOrigin(0.5, 1).setDepth(depth + 0.1);
    this.flag = scene.add.graphics().setDepth(depth + 0.05);
    this.name = scene.add
      .text(0, 0, t.name, { fontFamily: DISPLAY_FONT, fontSize: '13px', color: '#f8f6ff', stroke: '#07050f', strokeThickness: 4, resolution: dpr * 2 })
      .setOrigin(0.5, 1);
    this.hpText = scene.add
      .text(0, 0, '', { fontFamily: NUM_FONT, fontSize: '10px', fontStyle: '700', color: '#f8f6ff', stroke: '#07050f', strokeThickness: 3, resolution: dpr * 2 })
      .setOrigin(0, 0.5);
    this.bar = scene.add.graphics();
    this.label = scene.add.container(0, 0, [this.bar, this.name, this.hpText]).setDepth(depth + 5);
    this.chevron = scene.add.image(0, 0, 'tk-chevron').setOrigin(0.5, 1).setDepth(depth + 5).setVisible(false);
    for (const o of [this.glow, this.barrel, this.hull, this.flag, this.label, this.chevron]) layer.add(o);
    this.applyLook(t, false);
  }

  private applyLook(t: DisplayTank, wreck: boolean): void {
    const accent = t.team >= 0 ? TEAM_TINT[t.team] ?? '#ffffff' : shade(t.color, -0.4);
    const key = `${t.color}|${accent}|${wreck ? 1 : 0}`;
    if (key === this.look) return;
    const old = this.keys;
    this.keys = [
      retain(this.scene, `tk-hull-${key}`, () => hullCanvas(t.color, accent, wreck)),
      retain(this.scene, `tk-barrel-${t.color}|${wreck ? 1 : 0}`, () => barrelCanvas(wreck ? '#2a2630' : t.color)),
    ];
    this.hull.setTexture(this.keys[0]!).setDisplaySize(W, HGT);
    this.barrel.setTexture(this.keys[1]!).setDisplaySize(TANK_GEOM.barrel + 1, 4);
    this.glow.setTint(hexToInt(t.color));
    for (const k of old) release(this.scene, k);
    this.look = key;
    this.wrecked = wreck;
  }

  update(t: DisplayTank, info: TankRenderInfo): void {
    const H = info.worldH;
    const wreck = !t.alive;
    if (wreck !== this.wrecked || !this.look) this.applyLook(t, wreck);
    const gone = t.gone && wreck && info.now - t.diedAt > 1500;
    const visible = !gone;
    for (const o of [this.hull, this.barrel, this.glow, this.flag, this.label]) o.setVisible(visible);
    if (!visible) {
      this.chevron.setVisible(false);
      return;
    }
    const px = t.x;
    const py = H - t.y;
    // Tilt with the ground under the tracks.
    const l = restHeight(info.terrain, t.x - 9);
    const r = restHeight(info.terrain, t.x + 9);
    const tilt = t.anim ? 0 : Math.max(-0.26, Math.min(0.26, Math.atan2(r - l, 18) * 0.8));
    this.hull.setPosition(px, py + 0.5).setRotation(-tilt);
    // The barrel pivots exactly where the server launches shells from (the hull only leans a little).
    const pivotX = px;
    const pivotY = py - TANK_GEOM.pivot;
    this.barrel.setPosition(pivotX, pivotY).setRotation((-t.angle * Math.PI) / 180);
    this.barrel.setVisible(!wreck);
    const flash = info.now - t.hitAt < 140;
    if (flash) this.hull.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    else this.hull.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
    this.glow
      .setPosition(px, py - 4)
      .setDisplaySize(64, 34)
      .setAlpha(wreck ? 0 : info.active ? 0.55 + 0.15 * Math.sin(info.now / 220) : 0.28);

    // Wind flag on the antenna.
    const f = this.flag;
    f.clear();
    if (!wreck) {
      const ax = px - 8;
      const ay = py - 17;
      f.lineStyle(0.8, 0xd3cdf0, 0.8);
      f.lineBetween(ax, py - 9, ax, ay - 8);
      const w = info.wind;
      const len = 4 + Math.min(15, Math.abs(w)) * 0.55;
      const dir = w === 0 ? 0.3 : Math.sign(w);
      const flutter = info.reducedMotion ? 0 : Math.sin(info.now / 90 + t.slot) * (0.6 + Math.abs(w) * 0.08);
      const droop = w === 0 ? 5 : Math.max(0.5, 3.5 - Math.abs(w) * 0.2);
      const color = t.team >= 0 ? hexToInt(TEAM_TINT[t.team] ?? '#ffffff') : hexToInt(t.color);
      f.fillStyle(color, 0.95);
      f.fillTriangle(ax, ay - 8, ax, ay - 4, ax + dir * len, ay - 8 + droop + flutter);
    }

    // Label + HP bar (constant on-screen size).
    const ls = info.labelScale;
    this.label.setPosition(px, py - 27 * Math.min(1.4, Math.max(0.8, ls))).setScale(ls);
    const text = this.labelText(t, info);
    if (this.name.text !== text) this.name.setText(text);
    const color = info.me ? '#ffd23f' : t.team >= 0 ? (TEAM_TINT[t.team] ?? '#f8f6ff') : '#f8f6ff';
    if (color !== this.nameColor) {
      this.nameColor = color;
      this.name.setColor(color);
    }
    // Smoothly drain the bar.
    if (this.hpShown < 0) this.hpShown = t.hp;
    this.hpShown += (t.hp - this.hpShown) * 0.2;
    if (Math.abs(this.hpShown - t.hp) < 0.3) this.hpShown = t.hp;
    if (this.hpShown !== this.lastHp || t.maxHp !== this.lastMax) {
      this.lastHp = this.hpShown;
      this.lastMax = t.maxHp;
      const g = this.bar;
      g.clear();
      const bw = 42;
      const k = Math.max(0, Math.min(1, this.hpShown / Math.max(1, t.maxHp)));
      const color = k > 0.5 ? 0x2de38f : k > 0.25 ? 0xffd23f : 0xff5a5f;
      g.fillStyle(0x07050f, 0.85);
      g.fillRoundedRect(-bw / 2 - 2, -2, bw + 4, 8, 3);
      g.fillStyle(0x2e2856, 1);
      g.fillRect(-bw / 2, 0, bw, 4);
      g.fillStyle(color, 1);
      g.fillRect(-bw / 2, 0, bw * k, 4);
      this.hpText.setText(wreck ? 'KO' : String(Math.max(0, Math.round(t.hp))));
      this.hpText.setPosition(bw / 2 + 5, 2);
    }
    this.name.setPosition(0, -3);
    this.label.setAlpha(wreck ? 0.5 : 1);

    // Active chevron.
    if (info.active && !wreck) {
      const bob = info.reducedMotion ? 0 : Math.sin(info.now / 180) * 3;
      this.chevron
        .setVisible(true)
        .setPosition(px, py - (46 + bob) * Math.min(1.4, Math.max(0.8, ls)))
        .setScale(ls * 0.8)
        .setTint(info.me ? 0xffd23f : hexToInt(t.color));
    } else this.chevron.setVisible(false);
  }

  private labelText(t: DisplayTank, info: TankRenderInfo): string {
    const tag = t.cpu ? ' · CPU' : '';
    const team = info.teams && t.team >= 0 ? ` · ${TEAM_NAMES[t.team] ?? ''}` : '';
    return `${info.me ? 'YOU' : t.name}${tag}${info.teams ? team : ''}`;
  }

  destroy(): void {
    for (const o of [this.glow, this.barrel, this.hull, this.flag, this.label, this.chevron]) o.destroy();
    for (const k of this.keys) release(this.scene, k);
    this.keys = [];
  }
}
