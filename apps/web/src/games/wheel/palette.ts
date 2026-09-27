/**
 * Wheel hardware palette for the Canvas renderer: the rim, bulb channel, sockets, pegs and bulbs
 * follow the active theme's materials (metal / metalHighlight / stage / stageLight / led).
 * Slice colours are the host's choice (meaningful) and never change with the theme.
 *
 * Without materials (Delta Neon) every value is the wheel's original hand-tuned colour, exactly.
 */
import { shade } from '@dascade/game-core/wheel';
import type { MaterialKey } from '@dascade/ui';

export interface WheelPalette {
  /** Grounding disc under the rim. */
  base: string;
  /** Outer lip gradient, top → bottom (5 stops). */
  lip: readonly [string, string, string, string, string];
  lipEdge: string;
  /** Bulb channel gradient, top → bottom (3 stops). */
  channel: readonly [string, string, string];
  pinstripe: string;
  /** Inner lip gradient, top → bottom (3 stops). */
  innerLip: readonly [string, string, string];
  /** Backing disc behind the face. */
  faceBack: string;
  socket: string;
  socketEdge: string;
  /** Peg gradient, highlight → shadow (3 stops). */
  peg: readonly [string, string, string];
  /** Idle bulb colour (lit) and unlit bulb tint. */
  bulbOn: string;
  bulbOff: string;
  /** Empty-wheel face gradient + dashed guide. */
  emptyInner: string;
  emptyOuter: string;
  emptyGuide: string;
}

export const DEFAULT_WHEEL_PALETTE: WheelPalette = {
  base: '#1a0c02',
  lip: ['#fff0c2', '#ffc94d', '#e38b00', '#8f4a00', '#4d2600'],
  lipEdge: 'rgba(255, 246, 214, 0.6)',
  channel: ['#0b0401', '#1f0f03', '#321805'],
  pinstripe: 'rgba(255, 79, 129, 0.55)',
  innerLip: ['#6e3700', '#d68200', '#ffe3a1'],
  faceBack: '#0a0400',
  socket: '#070200',
  socketEdge: 'rgba(255, 200, 110, 0.35)',
  peg: ['#fff8de', '#ffc54a', '#8a4c00'],
  bulbOn: '#ffc451',
  bulbOff: '#ffb020',
  emptyInner: '#2a1a3a',
  emptyOuter: '#120a1c',
  emptyGuide: 'rgba(255, 176, 32, 0.35)',
};

const HEX = /^#[0-9a-f]{6}$/i;
/** Materials arrive as #rrggbb or rgba(); only opaque hex can be shaded, others pass through. */
const hex = (c: string | undefined): string | undefined => (c && HEX.test(c) ? c.toLowerCase() : undefined);
function alpha(color: string, a: number): string {
  const h = hex(color);
  if (!h) return color;
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * Maps theme materials to the wheel hardware. Each group only switches when its material is
 * present (and a usable colour), so a partial material set still falls back per part.
 */
export function wheelPalette(materials: Partial<Record<MaterialKey, string>>): WheelPalette {
  const d = DEFAULT_WHEEL_PALETTE;
  const metal = hex(materials.metal);
  const hi = hex(materials.metalHighlight) ?? (metal ? shade(metal, 0.7) : undefined);
  const stage = hex(materials.stage);
  const light = materials.stageLight;
  const led = hex(materials.led);
  return {
    base: stage ? shade(stage, -0.55) : d.base,
    lip: metal && hi ? [hi, shade(metal, 0.3), metal, shade(metal, -0.4), shade(metal, -0.68)] : d.lip,
    lipEdge: hi ? alpha(hi, 0.6) : d.lipEdge,
    channel: stage ? [shade(stage, -0.6), shade(stage, -0.35), stage] : d.channel,
    pinstripe: light ? alpha(light, 0.55) : d.pinstripe,
    innerLip: metal && hi ? [shade(metal, -0.5), metal, hi] : d.innerLip,
    faceBack: stage ? shade(stage, -0.75) : d.faceBack,
    socket: stage ? shade(stage, -0.8) : d.socket,
    socketEdge: hi ? alpha(hi, 0.35) : d.socketEdge,
    peg: metal && hi ? [hi, metal, shade(metal, -0.5)] : d.peg,
    bulbOn: led ?? d.bulbOn,
    // Unlit bulbs are the lit colour darkened by the sprite painter (same as the default amber).
    bulbOff: led ?? d.bulbOff,
    emptyInner: stage ? shade(stage, 0.12) : d.emptyInner,
    emptyOuter: stage ? shade(stage, -0.3) : d.emptyOuter,
    emptyGuide: light ? alpha(light, 0.35) : d.emptyGuide,
  };
}

/** Stable key so the renderer only repaints when the palette actually changed. */
export function paletteKey(p: WheelPalette): string {
  return JSON.stringify(p);
}
