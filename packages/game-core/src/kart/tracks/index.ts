/**
 * The eight tracks. The core lane owns the two reference tracks (pixel-plaza, dune-drift); the
 * tracks lane owns the other six files. To add a track: add its id to KART_TRACK_IDS in the shared
 * contract, write `tracks/<id>.ts` exporting a `KartTrackDef`, and register it here.
 */
import type { KartTrackId } from '@dascade/shared/games/kart';
import type { KartTrackDef } from '../trackdef.ts';
import { DUNE_DRIFT } from './dune-drift.ts';
import { FROSTBYTE_PASS } from './frostbyte-pass.ts';
import { GEARWORKS } from './gearworks.ts';
import { HARBOR_HAIRPINS } from './harbor-hairpins.ts';
import { MIDNIGHT_MAINFRAME } from './midnight-mainframe.ts';
import { PINBALL_PARK } from './pinball-park.ts';
import { PIXEL_PLAZA } from './pixel-plaza.ts';
import { SKYWAY_SPRINT } from './skyway-sprint.ts';

export const KART_TRACK_DEFS: Record<KartTrackId, KartTrackDef> = {
  'pixel-plaza': PIXEL_PLAZA,
  'dune-drift': DUNE_DRIFT,
  'harbor-hairpins': HARBOR_HAIRPINS,
  'frostbyte-pass': FROSTBYTE_PASS,
  'pinball-park': PINBALL_PARK,
  gearworks: GEARWORKS,
  'skyway-sprint': SKYWAY_SPRINT,
  'midnight-mainframe': MIDNIGHT_MAINFRAME,
};

/** Ids whose def is still a placeholder (none: the tracks lane has written all six). */
export const KART_PLACEHOLDER_TRACKS: ReadonlySet<KartTrackId> = new Set<KartTrackId>();
