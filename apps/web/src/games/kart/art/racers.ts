/**
 * The eight racers as chunky voxel characters (our own designs). Each racer is two parts so the
 * renderer can animate the head separately (lean into turns, look back when aiming backwards):
 *  - torso: hips at the seat origin (0,0,0), arms reaching forward to the wheel; +X forward, +Y up, −Z left.
 *  - head: built around the neck pivot (0,0,0); placed at HEAD_PIVOT on top of the torso.
 */
import type { KartRacerId } from '@dascade/shared/games/kart';
import { MeshBuilder } from './builder.ts';
import { RACER_ART, shadeInt, type RacerArt } from './palette.ts';

/** Neck pivot relative to the seat origin. */
export const HEAD_PIVOT = [-0.02, 0.5, 0] as const;

type Part = (b: MeshBuilder, a: RacerArt) => void;

const BLACK = 0x14121c;
const WHITE = 0xf8fafc;
const METAL = 0x9aa4b8;

/** Shared seated legs + hands on the wheel (most racers). */
function legsAndHands(b: MeshBuilder, leg: number, hand: number, sleeve: number): void {
  b.box(0.26, 0.06, -0.13, 0.52, 0.14, 0.16, leg).box(0.26, 0.06, 0.13, 0.52, 0.14, 0.16, leg);
  b.box(0.52, 0.06, -0.13, 0.1, 0.16, 0.18, BLACK).box(0.52, 0.06, 0.13, 0.1, 0.16, 0.18, BLACK);
  // upper arm → forearm → hands at the wheel (x ≈ 0.36, y ≈ 0.26)
  for (const s of [-1, 1]) {
    b.boxR(0.06, 0.34, s * 0.3, 0.3, 0.12, 0.12, 'z', -0.5, sleeve);
    b.box(0.25, 0.26, s * 0.24, 0.2, 0.1, 0.1, sleeve);
    b.box(0.37, 0.26, s * 0.18, 0.1, 0.1, 0.1, hand);
  }
}

const TORSO: Record<KartRacerId, Part> = {
  byte(b, a) {
    b.box(-0.05, 0.25, 0, 0.34, 0.46, 0.5, a.trim);
    b.box(0.125, 0.28, 0, 0.02, 0.22, 0.3, a.dark);
    b.box(0.14, 0.29, 0, 0.01, 0.13, 0.22, a.main, 0.95);
    b.box(-0.05, 0.02, 0, 0.3, 0.06, 0.44, a.dark);
    legsAndHands(b, a.dark, a.dark, a.main);
    b.box(-0.05, 0.47, -0.27, 0.16, 0.12, 0.08, a.main).box(-0.05, 0.47, 0.27, 0.16, 0.12, 0.08, a.main);
    // back: battery pack with a glowing charge bar
    b.box(-0.27, 0.3, 0, 0.1, 0.32, 0.3, a.main);
    b.box(-0.325, 0.3, 0, 0.012, 0.24, 0.08, 0x2de38f, 1);
    b.box(-0.325, 0.44, -0.1, 0.012, 0.04, 0.04, a.accent, 1).box(-0.325, 0.44, 0.1, 0.012, 0.04, 0.04, a.eye, 1);
  },
  nova(b, a) {
    b.box(-0.05, 0.25, 0, 0.36, 0.46, 0.5, a.light);
    b.box(0.135, 0.32, 0, 0.02, 0.09, 0.5, a.main);
    b.box(0.135, 0.18, -0.12, 0.02, 0.1, 0.1, a.accent, 0.6);
    b.box(0.135, 0.18, 0.04, 0.02, 0.06, 0.06, 0xff4f6d, 0.6);
    // life-support backpack: panel, orange stripe, twin thrusters glowing cyan
    b.box(-0.3, 0.32, 0, 0.18, 0.48, 0.46, shadeInt(a.light, -0.1));
    b.box(-0.395, 0.46, 0, 0.012, 0.08, 0.44, a.main);
    b.box(-0.395, 0.32, 0, 0.012, 0.12, 0.2, 0x1e2a4a).box(-0.4, 0.32, -0.05, 0.01, 0.03, 0.03, 0x2de38f, 1).box(-0.4, 0.32, 0.05, 0.01, 0.03, 0.03, 0xff4f6d, 1);
    for (const z of [-0.14, 0.14]) {
      b.cyl(-0.4, 0.14, z, 0.06, 0.1, 0x9aa4b8, 8, 'x');
      b.cyl(-0.455, 0.14, z, 0.045, 0.02, a.accent, 8, 'x', 1);
    }
    legsAndHands(b, a.light, a.main, a.light);
  },
  rex(b, a) {
    b.box(-0.05, 0.25, 0, 0.38, 0.48, 0.5, a.main);
    b.box(0.15, 0.2, 0, 0.04, 0.36, 0.32, a.trim);
    for (let i = 0; i < 4; i++) b.box(0.172, 0.08 + i * 0.09, 0, 0.01, 0.015, 0.3, shadeInt(a.trim, -0.18));
    // legs
    b.box(0.24, 0.07, -0.14, 0.46, 0.16, 0.18, a.main).box(0.24, 0.07, 0.14, 0.46, 0.16, 0.18, a.main);
    // tiny arms (they don't reach the wheel — Rex steers with his knees)
    b.box(0.2, 0.34, -0.26, 0.18, 0.07, 0.07, a.main).box(0.2, 0.34, 0.26, 0.18, 0.07, 0.07, a.main);
    b.box(0.3, 0.32, -0.26, 0.04, 0.05, 0.04, WHITE).box(0.3, 0.32, 0.26, 0.04, 0.05, 0.04, WHITE);
    // back spines (yellow, big enough to read from the chase cam)
    for (let i = 0; i < 3; i++) b.cone(-0.26, 0.16 + i * 0.15, 0, 0.09, 0.2, a.trim, 4, 'x', 0, true);
    // chunky tail curling up and out over the seat back
    // swings out to the right so it reads from behind (not end-on)
    b.push().rotate('y', 0.55);
    b.boxR(-0.4, 0.14, 0, 0.3, 0.16, 0.18, 'z', 0.25, a.main);
    b.boxR(-0.6, 0.26, 0, 0.24, 0.13, 0.14, 'z', 0.7, a.main);
    b.boxR(-0.72, 0.42, 0, 0.16, 0.1, 0.1, 'z', 1.1, shadeInt(a.main, 0.1));
    b.cone(-0.5, 0.3, 0, 0.05, 0.12, a.trim, 4, 'y').cone(-0.64, 0.4, 0, 0.045, 0.1, a.trim, 4, 'y');
    b.pop();
  },
  mochi(b, a) {
    b.box(-0.05, 0.24, 0, 0.34, 0.44, 0.48, a.main);
    b.box(0.125, 0.2, 0, 0.02, 0.3, 0.3, a.light);
    b.box(0.13, 0.4, 0, 0.02, 0.06, 0.36, 0xfde047, 0.3); // bell collar
    b.box(0.14, 0.34, 0, 0.04, 0.06, 0.06, 0xfde047, 0.5);
    legsAndHands(b, a.main, a.light, a.main);
    // big S-curve tail rising above the seat back (pink tip)
    b.box(-0.3, 0.16, 0.14, 0.1, 0.12, 0.1, a.main);
    b.box(-0.36, 0.3, 0.2, 0.1, 0.2, 0.1, a.main);
    b.box(-0.4, 0.5, 0.22, 0.1, 0.22, 0.1, a.main);
    b.box(-0.37, 0.68, 0.16, 0.1, 0.16, 0.1, a.main);
    b.box(-0.32, 0.8, 0.1, 0.11, 0.1, 0.11, a.accent);
  },
  brick(b, a) {
    // stacked tiles with gold seams
    const tile = (x: number, y: number, z: number, w: number, h: number, d: number, c: number) =>
      b.box(x, y, z, w, h, d, c).box(x + w / 2 + 0.005, y, z, 0.01, h * 0.9, d * 0.9, shadeInt(c, 0.12));
    tile(-0.05, 0.12, 0, 0.4, 0.22, 0.56, a.main);
    tile(-0.05, 0.36, 0, 0.4, 0.24, 0.6, shadeInt(a.main, -0.12));
    b.box(-0.05, 0.245, 0, 0.42, 0.03, 0.62, a.trim, 0.25);
    // huge shoulders
    b.box(-0.02, 0.44, -0.36, 0.28, 0.22, 0.2, a.main).box(-0.02, 0.44, 0.36, 0.28, 0.22, 0.2, a.main);
    b.box(-0.02, 0.56, -0.36, 0.28, 0.03, 0.2, a.trim).box(-0.02, 0.56, 0.36, 0.28, 0.03, 0.2, a.trim);
    // arms
    for (const s of [-1, 1]) {
      b.box(0.12, 0.3, s * 0.36, 0.24, 0.16, 0.16, shadeInt(a.main, -0.08));
      b.box(0.34, 0.26, s * 0.22, 0.14, 0.14, 0.14, a.trim);
    }
    b.box(0.25, 0.07, -0.15, 0.5, 0.16, 0.2, a.dark).box(0.25, 0.07, 0.15, 0.5, 0.16, 0.2, a.dark);
    b.box(0.2, 0.34, 0, 0.02, 0.1, 0.1, a.trim, 0.6);
    // back: glowing gold core in a tile frame
    b.box(-0.26, 0.3, 0, 0.02, 0.22, 0.22, a.dark);
    b.box(-0.272, 0.3, 0, 0.012, 0.14, 0.14, a.trim, 1);
    b.box(-0.26, 0.245, 0, 0.03, 0.02, 0.62, a.trim, 0.6);
  },
  glitch(b, a) {
    const body = a.main;
    b.box(0, 0.26, 0, 0.42, 0.44, 0.54, body, 0.18);
    // jagged pixel skirt
    for (let i = 0; i < 6; i++) {
      const z = -0.225 + i * 0.09;
      b.box(0, i % 2 ? 0.02 : 0.0, z, 0.42, 0.08, 0.09, i % 2 ? body : shadeInt(body, -0.2), 0.18);
    }
    // stubby arms reaching the wheel
    b.box(0.22, 0.3, -0.24, 0.3, 0.1, 0.1, body, 0.18).box(0.22, 0.3, 0.24, 0.3, 0.1, 0.1, body, 0.18);
    b.box(0.38, 0.27, -0.2, 0.08, 0.08, 0.08, a.light, 0.3).box(0.38, 0.27, 0.2, 0.08, 0.08, 0.08, a.light, 0.3);
    // stray pixels + wisps trailing off behind like a bad signal
    b.box(0.22, 0.12, -0.24, 0.05, 0.05, 0.05, a.accent, 1).box(-0.1, 0.5, 0.3, 0.05, 0.05, 0.05, a.accent, 1);
    const wisps: [number, number, number, number, number][] = [
      [-0.28, 0.3, 0.2, 0.08, a.main],
      [-0.4, 0.42, 0.14, 0.07, a.accent],
      [-0.5, 0.26, -0.18, 0.06, a.main],
      [-0.36, 0.14, -0.26, 0.07, a.accent],
      [-0.62, 0.36, 0.02, 0.05, a.main],
      [-0.3, 0.52, -0.12, 0.06, a.light],
      [-0.72, 0.2, -0.08, 0.04, a.accent],
    ];
    for (const [x, y, z, s0, c] of wisps) b.box(x, y, z, s0, s0, s0, c, 0.9);
  },
  quack(b, a) {
    b.ball(-0.04, 0.24, 0, 0.3, a.main, 1, 0, 0.28, 0.3);
    b.ball(0.14, 0.2, 0, 0.16, a.light, 1, 0, 0.18, 0.2);
    // racing vest
    b.box(-0.04, 0.3, 0, 0.5, 0.12, 0.56, a.accent);
    b.box(0.2, 0.3, 0.12, 0.02, 0.1, 0.12, WHITE, 0.2);
    // wings on the wheel
    b.ball(0.22, 0.28, -0.26, 0.14, a.main, 1, 0, 0.08, 0.1).ball(0.22, 0.28, 0.26, 0.14, a.main, 1, 0, 0.08, 0.1);
    // webbed feet
    b.box(0.5, 0.05, -0.12, 0.22, 0.05, 0.16, a.trim).box(0.5, 0.05, 0.12, 0.22, 0.05, 0.16, a.trim);
    // upturned tail-feather fan
    for (const [z, a0] of [[-0.1, -0.35], [0, 0], [0.1, 0.35]] as const) {
      b.push().translate(-0.36, 0.34, z).rotate('x', a0).rotate('z', -0.9);
      b.box(0, 0.1, 0, 0.08, 0.22, 0.09, a.main);
      b.box(0, 0.22, 0, 0.06, 0.05, 0.08, shadeInt(a.main, 0.15));
      b.pop();
    }
  },
  coin(b, a) {
    // captain's coat
    b.box(-0.05, 0.22, 0, 0.32, 0.42, 0.46, a.dark);
    b.box(0.115, 0.22, 0, 0.02, 0.4, 0.06, 0xfbbf24, 0.3);
    for (let i = 0; i < 3; i++) b.box(0.13, 0.12 + i * 0.1, -0.08, 0.02, 0.04, 0.04, 0xfbbf24, 0.5);
    b.box(-0.05, 0.43, -0.25, 0.18, 0.05, 0.12, 0xfbbf24, 0.4).box(-0.05, 0.43, 0.25, 0.18, 0.05, 0.12, 0xfbbf24, 0.4);
    legsAndHands(b, BLACK, WHITE, a.dark);
  },
};

const HEAD: Record<KartRacerId, Part> = {
  byte(b, a) {
    b.box(0, 0.04, 0, 0.12, 0.08, 0.12, a.dark);
    b.box(0, 0.29, 0, 0.46, 0.4, 0.52, a.main);
    b.box(0, 0.5, 0, 0.4, 0.03, 0.46, shadeInt(a.main, 0.25));
    b.box(0.235, 0.3, 0, 0.02, 0.18, 0.42, a.dark);
    b.box(0.25, 0.31, -0.1, 0.02, 0.09, 0.09, a.eye, 1).box(0.25, 0.31, 0.1, 0.02, 0.09, 0.09, a.eye, 1);
    b.box(0.25, 0.23, 0, 0.02, 0.02, 0.14, a.eye, 0.8);
    b.cyl(0, 0.3, -0.28, 0.08, 0.06, METAL, 8, 'z').cyl(0, 0.3, 0.28, 0.08, 0.06, METAL, 8, 'z');
    // back of the head: vent grille with glowing slats
    b.box(-0.235, 0.3, 0, 0.02, 0.26, 0.36, a.dark);
    for (let i = 0; i < 3; i++) b.box(-0.248, 0.22 + i * 0.08, 0, 0.01, 0.03, 0.28, a.eye, 0.9);
    // tall antenna with a glowing tip
    b.cyl(-0.04, 0.66, 0, 0.025, 0.3, METAL, 6);
    b.cyl(-0.04, 0.54, 0, 0.06, 0.05, a.dark, 8);
    b.ball(-0.04, 0.84, 0, 0.075, a.accent, 1, 1);
  },
  nova(b, a) {
    b.cyl(0, 0.05, 0, 0.19, 0.08, a.main, 10);
    b.ball(0, 0.3, 0, 0.29, a.light, 2, 0, 0.28, 0.29);
    b.box(0.19, 0.31, 0, 0.14, 0.22, 0.38, 0x172554);
    b.box(0.262, 0.36, -0.08, 0.01, 0.05, 0.14, a.eye, 0.9);
    b.box(0.262, 0.28, 0.1, 0.01, 0.03, 0.06, a.eye, 0.5);
    b.box(-0.02, 0.56, 0, 0.26, 0.04, 0.08, a.main);
    // orange equator band + a stripe over the crown (reads from behind)
    b.cyl(0, 0.24, 0, 0.297, 0.07, a.main, 16);
    b.box(-0.02, 0.5, 0, 0.5, 0.06, 0.09, a.main);
    // ribbed neck seal at the back (not a visor: nothing that reads as a face from behind)
    for (let i = 0; i < 3; i++) b.box(-0.24, 0.1 + i * 0.05, 0, 0.06, 0.02, 0.3, shadeInt(a.light, -0.18));
    b.cyl(-0.12, 0.66, -0.14, 0.015, 0.2, METAL, 5).ball(-0.12, 0.77, -0.14, 0.04, 0xff4f6d, 0, 1);
  },
  rex(b, a) {
    b.box(0.04, 0.26, 0, 0.42, 0.36, 0.44, a.main);
    b.box(0.34, 0.2, 0, 0.26, 0.2, 0.36, a.main);
    b.box(0.33, 0.07, 0, 0.26, 0.08, 0.32, shadeInt(a.main, 0.2));
    for (let i = 0; i < 4; i++) b.box(0.42, 0.115, -0.12 + i * 0.08, 0.04, 0.03, 0.03, WHITE);
    b.box(0.475, 0.26, -0.07, 0.01, 0.03, 0.03, a.dark).box(0.475, 0.26, 0.07, 0.01, 0.03, 0.03, a.dark);
    for (const s of [-1, 1]) {
      b.box(0.14, 0.38, s * 0.2, 0.14, 0.14, 0.06, WHITE);
      b.box(0.19, 0.38, s * 0.225, 0.06, 0.08, 0.02, a.eye);
      b.box(0.14, 0.47, s * 0.2, 0.16, 0.03, 0.07, a.dark);
    }
    for (let i = 0; i < 4; i++) b.cone(-0.08 - i * 0.08, 0.5 - i * 0.07, 0, 0.075, 0.18, a.trim, 4);
    // cap turned backwards
    b.box(-0.02, 0.47, 0, 0.3, 0.06, 0.4, 0xff5a5f).box(-0.24, 0.45, 0, 0.14, 0.02, 0.3, 0xff5a5f);
  },
  mochi(b, a) {
    b.box(0.02, 0.27, 0, 0.44, 0.38, 0.56, a.main);
    // tabby stripes on the back of the head
    for (let i = 0; i < 3; i++) b.box(-0.205, 0.2 + i * 0.1, 0, 0.012, 0.035, 0.3 - i * 0.06, shadeInt(a.main, -0.28));
    b.box(0.02, 0.47, 0, 0.36, 0.04, 0.46, a.main);
    b.box(0.245, 0.19, 0, 0.04, 0.14, 0.26, a.light);
    b.box(0.27, 0.24, 0, 0.02, 0.05, 0.07, a.accent);
    for (const s of [-1, 1]) {
      b.box(0.245, 0.33, s * 0.13, 0.02, 0.12, 0.1, WHITE);
      b.box(0.258, 0.32, s * 0.13, 0.01, 0.1, 0.05, a.eye, 0.5);
      b.box(0.262, 0.32, s * 0.13, 0.01, 0.08, 0.02, BLACK);
      b.cone(0.0, 0.58, s * 0.17, 0.11, 0.2, a.main, 4);
      b.cone(0.03, 0.56, s * 0.17, 0.06, 0.12, a.accent, 4);
      b.box(0.265, 0.2, s * 0.22, 0.01, 0.01, 0.2, a.dark).box(0.265, 0.16, s * 0.22, 0.01, 0.01, 0.18, a.dark);
    }
  },
  brick(b, a) {
    b.box(0, 0.2, 0, 0.4, 0.34, 0.44, a.main);
    b.box(0.01, 0.4, 0, 0.36, 0.06, 0.4, shadeInt(a.main, 0.12));
    b.box(0.205, 0.26, 0, 0.02, 0.1, 0.38, a.dark);
    b.box(0.215, 0.26, -0.1, 0.02, 0.06, 0.12, a.eye, 1).box(0.215, 0.26, 0.1, 0.02, 0.06, 0.12, a.eye, 1);
    b.box(0.205, 0.1, 0, 0.02, 0.04, 0.2, a.trim, 0.3);
    b.box(0.0, 0.44, 0, 0.12, 0.06, 0.12, a.trim, 0.5);
  },
  glitch(b, a) {
    b.box(0, 0.18, 0, 0.42, 0.32, 0.54, a.main, 0.18);
    b.box(0, 0.37, 0, 0.36, 0.08, 0.46, a.main, 0.18);
    b.box(0, 0.44, 0, 0.26, 0.06, 0.34, a.main, 0.18);
    for (const s of [-1, 1]) {
      b.box(0.215, 0.2, s * 0.12, 0.02, 0.16, 0.1, a.eye);
      b.box(0.225, 0.24, s * 0.1, 0.01, 0.05, 0.04, a.accent, 1);
    }
    b.box(0.215, 0.06, 0, 0.02, 0.04, 0.08, a.eye);
  },
  quack(b, a) {
    b.ball(0.02, 0.26, 0, 0.25, a.main, 2);
    b.box(0.27, 0.2, 0, 0.18, 0.07, 0.22, a.trim);
    b.box(0.25, 0.15, 0, 0.14, 0.04, 0.18, shadeInt(a.trim, -0.15));
    b.box(0.02, 0.36, 0, 0.44, 0.05, 0.54, a.dark);
    for (const s of [-1, 1]) {
      b.box(0.21, 0.36, s * 0.1, 0.08, 0.11, 0.11, a.dark);
      b.box(0.25, 0.36, s * 0.1, 0.01, 0.08, 0.08, a.accent, 0.6);
    }
    b.box(0.02, 0.5, 0, 0.12, 0.06, 0.04, a.main);
  },
  coin(b, a) {
    b.cyl(0.02, 0.3, 0, 0.3, 0.12, a.main, 14, 'x');
    b.torus(0.02, 0.3, 0, 0.29, 0.035, shadeInt(a.main, -0.18), 5, 16, 0, 'x');
    b.cyl(0.085, 0.3, 0, 0.22, 0.02, shadeInt(a.main, 0.18), 14, 'x', 0.15);
    // reverse face: raised disc with a star, reeded rim
    b.cyl(-0.045, 0.3, 0, 0.22, 0.02, shadeInt(a.main, 0.1), 14, 'x', 0.1);
    b.push().translate(-0.06, 0.3, 0).rotate('z', Math.PI / 2);
    b.octa(0, 0, 0, 0.13, 0xfff3c4, 0.45, 0.25);
    b.pop();
    for (let i = 0; i < 20; i++) {
      const ang = (i / 20) * Math.PI * 2;
      b.box(0.02, 0.3 + Math.cos(ang) * 0.305, Math.sin(ang) * 0.305, 0.1, 0.03, 0.03, shadeInt(a.main, -0.25));
    }
    b.box(0.1, 0.36, -0.08, 0.02, 0.08, 0.05, BLACK).box(0.1, 0.36, 0.08, 0.02, 0.08, 0.05, BLACK);
    b.box(0.105, 0.38, -0.07, 0.01, 0.03, 0.02, WHITE).box(0.105, 0.38, 0.09, 0.01, 0.03, 0.02, WHITE);
    b.box(0.1, 0.24, -0.08, 0.02, 0.04, 0.12, shadeInt(a.dark, -0.2)).box(0.1, 0.24, 0.08, 0.02, 0.04, 0.12, shadeInt(a.dark, -0.2));
    // captain's hat
    b.box(0.0, 0.62, 0, 0.3, 0.1, 0.36, a.dark);
    b.box(0.0, 0.575, 0, 0.32, 0.03, 0.38, BLACK);
    b.box(0.17, 0.57, 0, 0.12, 0.02, 0.32, BLACK);
    b.box(0.155, 0.63, 0, 0.01, 0.06, 0.08, 0xfbbf24, 0.6);
  },
};

export function buildRacerTorso(b: MeshBuilder, racer: KartRacerId): void {
  TORSO[racer](b, RACER_ART[racer]);
}

export function buildRacerHead(b: MeshBuilder, racer: KartRacerId): void {
  HEAD[racer](b, RACER_ART[racer]);
}
