/**
 * Tournament view-model: what every bracket/standings component renders. It is derived from the
 * server's public tournament view by `adapt.ts`, so the React components never depend on the
 * engine's internal shapes (and tests/fixtures can build it directly).
 */

export type SectionId = 'winners' | 'losers' | 'finals' | 'main';

export type MatchStatusVM = 'waiting' | 'ready' | 'live' | 'done' | 'forfeit' | 'void' | 'bye';

export interface SlotVM {
  participantId: string | null;
  /** Participant name, or placeholder text ("Winner of W2·M1", "Bye", "TBD"). */
  name: string;
  seed: number | null;
  /** Series score (games won) once the match started, else null. */
  score: number | null;
  isWinner: boolean;
  isLoser: boolean;
  /** Not a real participant yet (waiting on another match). */
  placeholder: boolean;
  isBye: boolean;
  /** This slot is the current viewer. */
  isMe: boolean;
  /** Side for the first game when the game has sides (chess: first = white). */
  side?: 'first' | 'second';
}

export interface FeederVM {
  matchId: string;
  take: 'winner' | 'loser';
  /** Which slot of this match the feeder fills (0 = top, 1 = bottom). */
  slot: 0 | 1;
}

export interface MatchVM {
  id: string;
  /** Short code shown on the card, e.g. "W2·M3", "GF". */
  code: string;
  roundLabel: string;
  section: SectionId;
  /** 1-based round within its section. */
  round: number;
  /** 0-based order within its round (top to bottom). */
  order: number;
  status: MatchStatusVM;
  slots: [SlotVM, SlotVM];
  bestOf: number;
  /** Game currently being played (1-based) while live. */
  gameNumber: number;
  /** Short note: "Forfeit", "Bye", "Organizer decision", "Draw", "Decider". */
  note: string | null;
  /** Live match room (spectate). */
  roomCode: string | null;
  feeders: FeederVM[];
  involvesMe: boolean;
}

export interface RoundVM {
  key: string;
  section: SectionId;
  round: number;
  label: string;
  matches: MatchVM[];
  state: 'upcoming' | 'live' | 'done';
}

export interface SectionVM {
  id: SectionId;
  label: string;
  rounds: RoundVM[];
}

export interface BracketVM {
  sections: SectionVM[];
}

export interface StandingVM {
  rank: number;
  /** Tied with another row on every tiebreak (shown as "=3"). */
  shared: boolean;
  participantId: string;
  name: string;
  seed: number | null;
  points: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  byes: number;
  tiebreaks: Record<string, number>;
  isMe: boolean;
  /** Withdrawn / disqualified participants stay listed but dimmed. */
  inactive: boolean;
}

export interface TiebreakVM {
  id: string;
  short: string;
  name: string;
  explanation: string;
}

/** One cell of a round-robin crosstable, from the row player's point of view. */
export interface CrossCellVM {
  matchId: string | null;
  /** 'W' | 'L' | 'D' | null (not played yet). */
  result: 'W' | 'L' | 'D' | null;
  /** Series score from the row's perspective, e.g. "2–1". */
  score: string | null;
  status: MatchStatusVM | null;
  round: number | null;
}
