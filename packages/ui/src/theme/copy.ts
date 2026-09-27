/**
 * Themed microcopy. A theme may rename a handful of *headings and flavour labels* (Executive
 * Edition's "Match Performance Review", Shareware's "REGISTERED VERSION"). Functional labels —
 * buttons that do things, form labels, errors, anything a test or screen reader relies on — stay
 * plain: components pass the plain text as the fallback and keep it as the accessible name.
 *
 * Usage (apps/web): const t = useThemeCopy();  <h2>{t('results.title', 'Results')}</h2>
 */
export const THEME_COPY_KEYS = [
  /** Small line under the DASCADE logo on the arcade floor. */
  'arcade.tagline',
  /** Ambient status ticker items on the floor, separated by "|" ("MODEM READY|4 CABINETS ONLINE"). */
  'arcade.status',
  /** Tiny flavour badge (e.g. "REGISTERED COPY", "SERVER 01"). */
  'arcade.badge',
  /** Heading on a multi-game cabinet picker ("Choose a game"). */
  'cabinet.heading',
  /** Lobby heading ("Lobby"). */
  'lobby.title',
  /** Player list heading ("Players"). */
  'lobby.players',
  /** Results / game-over heading ("Results"). */
  'results.title',
  /** Tournament Center title and subtitle. */
  'tournament.title',
  'tournament.subtitle',
  /** Settings dialog title ("Settings"). */
  'settings.title',
  /** Jukebox window title ("Jukebox"). */
  'jukebox.title',
  /** Loading / connecting flavour ("Loading", "Connecting"). */
  'state.loading',
  'state.connecting',
  /** Empty-state flavour ("Nothing here yet"). */
  'state.empty',
  /** Error screen heading ("Something went wrong"). */
  'state.error',
] as const;

export type ThemeCopyKey = (typeof THEME_COPY_KEYS)[number];
export type ThemeCopy = Partial<Record<ThemeCopyKey, string>>;
