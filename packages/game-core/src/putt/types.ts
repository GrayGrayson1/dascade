/**
 * DAS Putt hole definitions — pure data, validated by `HoleDefSchema` + `validateHole()`.
 *
 * World units: y grows downwards (screen space). A hole fits in roughly 1200 × 700 units;
 * the ball has a radius of 9 and the cup a radius of 15. Everything is data-driven so new
 * holes need no engine changes.
 */
import { z } from 'zod';

export type Pt = [number, number];

const Coord = z.number().finite().min(-100).max(1400);
const PtSchema = z.tuple([Coord, Coord]);
const PolySchema = z.array(PtSchema).min(3).max(96);
const UnitDir = z.tuple([z.number().finite().min(-1).max(1), z.number().finite().min(-1).max(1)]);

export const WallSchema = z.object({
  pts: z.array(PtSchema).min(2).max(96),
  closed: z.boolean().optional(),
  /** 'rail' = normal cushion · 'bank' = highlighted bank-shot cushion · 'kicker' = springy slingshot. */
  kind: z.enum(['rail', 'bank', 'kicker']).optional(),
  width: z.number().min(6).max(40).optional(),
});
export type WallDef = z.infer<typeof WallSchema>;

export const CircleSchema = z.object({ at: PtSchema, r: z.number().min(6).max(80) });
export type CircleDef = z.infer<typeof CircleSchema>;

export const SlopeSchema = z.object({
  poly: PolySchema,
  /** Constant acceleration while the ball is on the slope (units/s²), i.e. "downhill". */
  accel: z.tuple([z.number().finite().min(-900).max(900), z.number().finite().min(-900).max(900)]),
});
export type SlopeDef = z.infer<typeof SlopeSchema>;

export const PORTAL_COLORS = ['cyan', 'magenta', 'amber'] as const;
export const PortalSchema = z.object({
  /** Entry vortex. */
  from: PtSchema,
  /** Exit emitter. */
  to: PtSchema,
  /** Unit exit direction. */
  exit: UnitDir,
  color: z.enum(PORTAL_COLORS),
  /** Short label painted next to both ends (colour is never the only cue). */
  label: z.string().min(1).max(2),
});
export type PortalDef = z.infer<typeof PortalSchema>;

export const WindmillSchema = z.object({
  kind: z.literal('windmill'),
  at: PtSchema,
  arms: z.number().int().min(2).max(6),
  /** Arm length from the hub centre to the tip. */
  length: z.number().min(30).max(220),
  width: z.number().min(6).max(30),
  hubR: z.number().min(8).max(60),
  periodMs: z.number().int().min(1500).max(20000),
  /** Starting phase (0–1 of a revolution). */
  phase: z.number().min(0).max(1),
  /** 1 = clockwise on screen, -1 = counter-clockwise. */
  dir: z.union([z.literal(1), z.literal(-1)]),
});
export const SweeperSchema = z.object({
  kind: z.literal('sweeper'),
  /** The bar's centre glides between a and b and back (smooth ping-pong). */
  a: PtSchema,
  b: PtSchema,
  /** Unit direction of the bar itself. */
  axis: UnitDir,
  halfLength: z.number().min(10).max(200),
  width: z.number().min(6).max(30),
  periodMs: z.number().int().min(1500).max(20000),
  phase: z.number().min(0).max(1),
});
export const MoverSchema = z.discriminatedUnion('kind', [WindmillSchema, SweeperSchema]);
export type WindmillDef = z.infer<typeof WindmillSchema>;
export type SweeperDef = z.infer<typeof SweeperSchema>;
export type MoverDef = z.infer<typeof MoverSchema>;

export const DecorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('lamp'), at: PtSchema, color: z.string().regex(/^#[0-9a-f]{6}$/i) }),
  z.object({ kind: z.literal('chevrons'), at: PtSchema, dir: UnitDir, count: z.number().int().min(1).max(6) }),
  z.object({ kind: z.literal('sign'), at: PtSchema, text: z.string().min(1).max(16) }),
]);
export type DecorDef = z.infer<typeof DecorSchema>;

export const HoleDefSchema = z.object({
  number: z.number().int().min(1).max(99),
  id: z.string().regex(/^[a-z0-9-]{2,32}$/),
  name: z.string().min(2).max(32),
  par: z.number().int().min(2).max(6),
  /** One-line hint shown in the hole intro. */
  tip: z.string().min(4).max(90),
  tee: PtSchema,
  cup: PtSchema,
  /** Playable surfaces (union). Anything outside turf (and not water) is the void: out of bounds. */
  turf: z.array(PolySchema).min(1).max(12),
  walls: z.array(WallSchema).min(1).max(40),
  posts: z.array(CircleSchema).max(24).optional(),
  bumpers: z.array(CircleSchema).max(16).optional(),
  sand: z.array(PolySchema).max(12).optional(),
  water: z.array(PolySchema).max(8).optional(),
  slopes: z.array(SlopeSchema).max(12).optional(),
  portals: z.array(PortalSchema).max(4).optional(),
  movers: z.array(MoverSchema).max(4).optional(),
  decor: z.array(DecorSchema).max(40).optional(),
});
export type HoleDef = z.infer<typeof HoleDefSchema>;
