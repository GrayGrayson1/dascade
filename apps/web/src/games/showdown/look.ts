/**
 * The two looks of the show — DAS Showtime (all year) and Halloween Night (October, or by choice) —
 * as data: names, copy, the host's lines and the reaction emoji. Colours, fonts and decor live in
 * showdown.css under `.sd-stage[data-look='…']`; the components are shared, only this layer differs.
 *
 * Host lines are picked from the board revision, so every screen in the room shows the same line.
 */
import type { ShowdownBoardView, ShowdownCue, ShowdownEvent, ShowdownLook, TeamSlot } from '@dascade/shared/games/showdown';

export type HostMood = 'idle' | 'happy' | 'wow' | 'oops' | 'cheer' | 'think';

export interface HostLine {
  /** Unique per moment (re-keys the speech bubble). */
  key: string;
  text: string;
  mood: HostMood;
}

export interface LookCopy {
  /** The show's subtitle under the marquee. */
  tagline: string;
  hostName: string;
  hostTitle: string;
  bank: string;
  /** The board's empty-question placeholder. */
  waiting: string;
  reactions: readonly [string, string, string, string, string, string];
  reactionNames: readonly [string, string, string, string, string, string];
  hype: string;
  winner: string;
}

export const LOOK_COPY: Record<ShowdownLook, LookCopy> = {
  showtime: {
    tagline: 'Live from the DAScade',
    hostName: 'DASbot',
    hostTitle: 'Your host',
    bank: 'Bank',
    waiting: 'We surveyed 100 people…',
    reactions: ['👏', '🔥', '😮', '😂', '💯', '🎉'],
    reactionNames: ['Applause', 'Fire', 'Wow', 'Ha!', '100', 'Party'],
    hype: 'Hype',
    winner: 'And the winner is…',
  },
  halloween: {
    tagline: 'A Halloween Spooktacular',
    hostName: 'Boo',
    hostTitle: 'Your ghostly host',
    bank: 'Cauldron',
    waiting: 'We surveyed 100 ghouls…',
    reactions: ['👏', '🎃', '👻', '😱', '🦇', '🍬'],
    reactionNames: ['Applause', 'Pumpkin', 'Boo!', 'Eek!', 'Bats', 'Treat'],
    hype: 'Spirit',
    winner: 'And the spookiest team is…',
  },
};

type Lines = readonly string[];

interface LineBook {
  intro: Lines;
  round: Lines;
  double: Lines;
  question: Lines;
  control: Lines;
  top: Lines;
  good: Lines;
  late: Lines;
  cleared: Lines;
  strike: Lines;
  steal: Lines;
  stolen: Lines;
  defended: Lines;
  sweep: Lines;
  manual: Lines;
  lost: Lines;
  undo: Lines;
  finaleWin: Lines;
  finaleTie: Lines;
  cue: Record<ShowdownCue, Lines>;
}

const SHOWTIME_LINES: LineBook = {
  intro: ['Welcome to DAS Survey Showdown!', 'Lights! Camera! Survey!', 'Let’s play the feud of the century!'],
  round: ['Round {n}! {k} answers on the board.', 'Here comes round {n}…', 'Round {n} — let’s see what the people said!'],
  double: ['Points are worth ×{m} this round!', 'Big round — everything counts ×{m}!'],
  question: ['We asked 100 people…', 'Survey says… let’s find out!', 'Top answers on the board!'],
  control: ['{team}, you’re in control!', 'It’s all yours, {team}!'],
  top: ['Number one answer!', 'TOP ANSWER!', 'Right at the top!'],
  good: ['It’s on the board!', 'Good answer! Good answer!', 'Show me {answer}!', 'The people agree!'],
  late: ['And the rest of the board…', 'Let’s see what you missed…'],
  cleared: ['That’s the whole board!', 'Every answer revealed!'],
  strike: ['Ooh — strike {s}!', 'Not on the board!', 'Strike {s}! Careful now…'],
  steal: ['Three strikes! {team}, one guess to steal it all!', '{team} — huddle up and steal!'],
  stolen: ['Stolen! {team} takes {points}!', 'What a steal! {points} to {team}!'],
  defended: ['{team} holds on to {points}!', 'No steal! {points} stays with {team}!'],
  sweep: ['Clean sweep! {points} to {team}!', 'The whole board! {team} takes {points}!'],
  manual: ['{points} points to {team}!'],
  lost: ['Nobody takes the bank this time!'],
  undo: ['Wait — rewind that!', 'Let’s run that back.'],
  finaleWin: ['What a show! {team} wins!', '{team} are your champions!'],
  finaleTie: ['A tie! Everybody wins tonight!'],
  cue: {
    intro: ['Welcome to DAS Survey Showdown!'],
    drumroll: ['Drumroll, please…'],
    applause: ['Give it up!', 'Let’s hear it!'],
    aww: ['Awww…', 'So close!'],
    ding: ['Ding ding ding!'],
    suspense: ['Hmm… the tension!'],
  },
};

const HALLOWEEN_LINES: LineBook = {
  intro: ['Welcome, boils and ghouls, to DAS Survey Showdown!', 'Get ready for a spooktacular showdown!', 'Boo! It’s showtime!'],
  round: ['Round {n}! {k} answers lurk on the board.', 'Round {n}… if you dare!', 'Here comes round {n}! Mwa-ha-ha!'],
  double: ['This round haunts ×{m} points!', 'Spooky big round — ×{m} points!'],
  question: ['We surveyed 100 ghouls…', 'The spirits have spoken…', 'Let’s summon the answers!'],
  control: ['{team}, the cauldron is yours!', '{team}, you’re in control!'],
  top: ['Number one! Fang-tastic!', 'TOP ANSWER! Spook-tacular!', 'The ghouls agree — number one!'],
  good: ['It’s on the board!', 'Boo-tiful answer!', 'Show me {answer}!', 'Wicked good!'],
  late: ['Let’s raise the rest from the grave…', 'And the rest of the board…'],
  cleared: ['The whole board has risen!', 'Every answer unearthed!'],
  strike: ['Eek! Strike {s}!', 'That guess is a ghost — not on the board!', 'Boo! Strike {s}!'],
  steal: ['Three strikes! {team}, haunt that cauldron!', '{team} — one guess to snatch it all!'],
  stolen: ['Snatched from the grave! {team} takes {points}!', 'Spooky steal! {points} to {team}!'],
  defended: ['{team} keeps the cauldron — {points} points!', 'The steal vanished! {points} for {team}!'],
  sweep: ['A monster sweep! {points} to {team}!', 'The whole board! {team} takes {points}!'],
  manual: ['{points} points to {team}!'],
  lost: ['The cauldron goes cold — no points!'],
  undo: ['Spooky — time went backwards!', 'Let me un-haunt that.'],
  finaleWin: ['Fang-tastic show! {team} wins!', '{team} rule the night!'],
  finaleTie: ['A tie! The spirits are pleased with everyone!'],
  cue: {
    intro: ['Welcome, boils and ghouls!'],
    drumroll: ['Drumroll… from beyond the grave!'],
    applause: ['Let’s hear those skeletons clap!', 'Give it up, ghouls!'],
    aww: ['Awww… boo-hoo!'],
    ding: ['Ding! The bell tolls!'],
    suspense: ['Ooooh… the suspense!'],
  },
};

const BOOKS: Record<ShowdownLook, LineBook> = { showtime: SHOWTIME_LINES, halloween: HALLOWEEN_LINES };

function pick(lines: Lines, seed: number): string {
  return lines[Math.abs(seed) % lines.length] ?? '';
}

function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

export interface LineContext {
  look: ShowdownLook;
  board: ShowdownBoardView | null;
  teamNames: [string, string];
}

const teamOf = (ctx: LineContext, team: TeamSlot) => (team === 0 || team === 1 ? ctx.teamNames[team] : 'Nobody');

/** What the host says about a board event (null = stay quiet). */
export function lineForEvent(e: ShowdownEvent, ctx: LineContext): HostLine | null {
  const book = BOOKS[ctx.look];
  const b = ctx.board;
  const key = `${e.type}:${e.rev}`;
  switch (e.type) {
    case 'intro':
      return { key, text: pick(book.intro, e.rev), mood: 'cheer' };
    case 'round': {
      const k = b?.slots.length ?? 0;
      const text = e.multiplier > 1 ? `${fill(pick(book.round, e.rev), { n: e.round + 1, k })} ${fill(pick(book.double, e.rev), { m: e.multiplier })}` : fill(pick(book.round, e.rev), { n: e.round + 1, k });
      return { key, text, mood: 'happy' };
    }
    case 'question':
      return { key, text: pick(book.question, e.rev), mood: 'think' };
    case 'control':
      return { key, text: fill(pick(book.control, e.rev), { team: teamOf(ctx, e.team) }), mood: 'happy' };
    case 'reveal': {
      if (e.cleared && e.late) return { key, text: pick(book.cleared, e.rev), mood: 'cheer' };
      if (e.late) return { key, text: pick(book.late, e.rev), mood: 'happy' };
      const answer = e.text || b?.slots[e.slot]?.text || '';
      return e.top ? { key, text: pick(book.top, e.rev), mood: 'wow' } : { key, text: fill(pick(book.good, e.rev), { answer: answer || 'it' }), mood: 'happy' };
    }
    case 'strike':
      if (e.stealFailed) return null; // the award line follows
      if (e.steal) {
        const stealer: TeamSlot = b && b.control !== -1 ? (b.control === 0 ? 1 : 0) : -1;
        return { key, text: fill(pick(book.steal, e.rev), { team: teamOf(ctx, stealer) }), mood: 'think' };
      }
      return { key, text: fill(pick(book.strike, e.rev), { s: e.strikes }), mood: 'oops' };
    case 'award': {
      const vars = { team: teamOf(ctx, e.team), points: e.points };
      const lines = e.how === 'steal' ? book.stolen : e.how === 'defend' ? book.defended : e.how === 'sweep' ? book.sweep : e.how === 'none' ? book.lost : book.manual;
      return { key, text: fill(pick(lines, e.rev), vars), mood: e.how === 'none' ? 'oops' : 'cheer' };
    }
    case 'undo':
      return { key, text: pick(book.undo, e.rev), mood: 'think' };
    case 'adjust':
      return null;
  }
}

export function lineForCue(cue: ShowdownCue, id: number, look: ShowdownLook): HostLine {
  const mood: HostMood = cue === 'aww' ? 'oops' : cue === 'suspense' || cue === 'drumroll' ? 'think' : 'cheer';
  return { key: `cue:${cue}:${id}`, text: pick(BOOKS[look].cue[cue], id), mood };
}

export function lineForFinale(look: ShowdownLook, winner: TeamSlot, names: [string, string]): HostLine {
  const book = BOOKS[look];
  return winner === -1
    ? { key: 'finale:tie', text: pick(book.finaleTie, 0), mood: 'cheer' }
    : { key: `finale:${winner}`, text: fill(pick(book.finaleWin, winner), { team: names[winner] }), mood: 'cheer' };
}

/** What the host says when nothing just happened (late joiners, a refreshed screen). */
export function idleLine(look: ShowdownLook, board: ShowdownBoardView | null, names: [string, string]): HostLine {
  const book = BOOKS[look];
  if (!board || board.stage === 'intro') return { key: 'idle:intro', text: pick(book.intro, 0), mood: 'happy' };
  if (board.stage === 'title') return { key: `idle:round:${board.round}`, text: fill(pick(book.round, board.round), { n: board.round + 1, k: board.slots.length }), mood: 'happy' };
  if (board.stage === 'steal') {
    const stealer: TeamSlot = board.control === 0 ? 1 : board.control === 1 ? 0 : -1;
    return { key: `idle:steal:${board.round}`, text: fill(pick(book.steal, board.round), { team: stealer === -1 ? 'Team' : names[stealer] }), mood: 'think' };
  }
  if (board.stage === 'live' && board.control !== -1) return { key: `idle:control:${board.round}`, text: fill(pick(book.control, board.round), { team: names[board.control] }), mood: 'happy' };
  return { key: `idle:q:${board.round}`, text: pick(book.question, board.round), mood: 'think' };
}

/** Big-screen / join hint: the short address people type on their phones. */
export function joinAddress(code: string): { short: string; url: string } {
  const host = typeof location !== 'undefined' ? location.host : 'dascade';
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return { short: `${host}/r/${code}`, url: `${origin}/r/${code}` };
}
