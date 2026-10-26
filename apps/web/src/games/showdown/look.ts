/**
 * The two looks of the show — DAS Showtime (all year) and Halloween Night (October, or by choice) —
 * as data: names, copy, the host's lines and the reaction emoji. Colours, fonts and decor live in
 * showdown.css / stageShowcase.css under `[data-look='…']`; the components are shared, only this
 * layer differs.
 *
 * Host lines are picked from the board revision (or another number every screen shares, like a
 * miss's count), never at random, so every screen in the room shows the same line.
 *
 * Two line books per look: Team Showdown (classic: teams, strikes, steals) and Presenter Showcase
 * (one big Top-10 board for a crowd in a video call: found answers, misses, the special answer,
 * the round clock, Reveal remaining).
 */
import type {
  ShowdownBoardView,
  ShowdownCard,
  ShowdownCue,
  ShowdownEvent,
  ShowdownFinale,
  ShowdownLook,
  ShowdownMode,
  TeamSlot,
} from '@dascade/shared/games/showdown';

/**
 * The host's poses. Classic uses the first six; Presenter Showcase adds the character moments:
 * celebrate (the special answer: a jump and a spin), bye (the farewell: a wave and a hat tip), shiver
 * (a wrong answer), peek (peeking through the hands during the suspense beat) and startled (time up).
 */
export type HostMood = 'idle' | 'happy' | 'wow' | 'oops' | 'cheer' | 'think' | 'celebrate' | 'bye' | 'shiver' | 'peek' | 'startled';

export const HOST_MOODS: readonly HostMood[] = [
  'idle',
  'happy',
  'wow',
  'oops',
  'cheer',
  'think',
  'celebrate',
  'bye',
  'shiver',
  'peek',
  'startled',
];

export interface HostLine {
  /** Unique per moment (re-keys the speech bubble). */
  key: string;
  text: string;
  mood: HostMood;
}

export interface CardCopy {
  /** Small line above the headline. */
  kicker: string;
  /** The headline ('' = the event's name). */
  title: string;
  /** The line under it ({show} = the show's title). */
  sub: string;
}

/** Presenter Showcase stage copy. `{n}`, `{show}`, `{found}`, `{total}` are filled in by the stage. */
export interface ShowcaseCopy {
  /** Under the marquee (opening, lobby holding screen). */
  tagline: string;
  /** "According to {source}…" kicker over the question. */
  according: string;
  /** The special answer's label on the board and in the status column. */
  special: string;
  /** The celebration banner of a special answer. */
  specialBanner: string;
  /** The banner of the presenter's Celebrate cue. */
  cueBanner: string;
  /** Board complete with every answer found / with some revealed by the sweep. */
  allFound: string;
  complete: string;
  /** Sub line of the complete flourish. */
  completeSub: string;
  /** The strip while Reveal remaining runs, and during its drumroll. */
  sweeping: string;
  suspense: string;
  /** The stage clock at 0 (the stage never shows a negative time). */
  finalGuesses: string;
  /** "{found} / {total} found". */
  found: string;
  /** The category card's tile count chip: "Top {n}". */
  topN: string;
  /** The lobby / welcome card sub line. */
  startsSoon: string;
  /** The finale. */
  wrap: string;
  wrapSub: string;
  /** Per-round recap line. */
  recap: string;
  /** The join hint (phones are optional), long and short. */
  playAlong: string;
  playAlongShort: string;
  /** The tag on a stage running practice boards. */
  rehearsal: string;
  // ---- The pick (the Spotlight picker) and the hot seat ----
  /** The spotlight overlay's title. */
  pickTitle: string;
  /** "{n} in the pool". */
  pickPool: string;
  /** The landing card: the kicker over the name, and the line under it. */
  pickUp: string;
  pickAsk: string;
  /** The words on a seat: away, their turn counted this round, the one picked. */
  seatAway: string;
  seatDone: string;
  seatHot: string;
  /** The hot-seat podium: its kicker, the timer's word ("answering · 0:12"), and when their answer flips. */
  hotSeat: string;
  answering: string;
  calledIt: string;
  /** "#{n} found". */
  foundRank: string;
  /** The credit on a tile someone in the hot seat called ("called by Priya"). */
  calledBy: string;
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
  showcase: ShowcaseCopy;
  /** The holding cards the presenter puts up (any phase). */
  cards: Record<ShowdownCard, CardCopy>;
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
    showcase: {
      tagline: 'Top-10 trivia · Live from the DAScade',
      according: 'According to',
      special: 'Special',
      specialBanner: 'The DAS Special!',
      cueBanner: 'Showstopper!',
      allFound: 'You found them all!',
      complete: 'Board complete!',
      completeSub: 'The crowd found {found} of {total}',
      sweeping: 'Revealing the rest…',
      suspense: 'Here comes the special answer…',
      finalGuesses: 'Final guesses!',
      found: 'found',
      topN: 'Top {n}',
      startsSoon: '{show} starts soon',
      wrap: 'That’s a wrap!',
      wrapSub: 'Thanks for playing along',
      recap: 'The crowd found {found} of {total}',
      playAlong: 'Cheer along on your phone',
      playAlongShort: 'Cheer along',
      rehearsal: 'Rehearsal',
      pickTitle: 'Spotlight on…',
      pickPool: '{n} in the pool',
      pickUp: 'You’re up!',
      pickAsk: 'Unmute and give us your answer!',
      seatAway: 'away',
      seatDone: 'done',
      seatHot: 'hot seat',
      hotSeat: 'In the hot seat',
      answering: 'answering',
      calledIt: 'Called it!',
      foundRank: '#{n} found',
      calledBy: 'called by',
    },
    cards: {
      welcome: { kicker: 'Welcome to', title: '', sub: '{show} starts soon' },
      break: { kicker: 'Intermission', title: 'Be right back', sub: 'Stay tuned — the show returns in a moment.' },
      prizes: { kicker: 'Up next', title: 'Prize time!', sub: 'And the winners are…' },
      thanks: { kicker: '{event}', title: 'Thanks for playing!', sub: 'Good night, everybody!' },
    },
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
    showcase: {
      tagline: 'A spooktacular Top-10 showdown',
      according: 'According to',
      special: 'Special',
      specialBanner: 'The DAS-O-Ween Special!',
      cueBanner: 'Spooktacular!',
      allFound: 'You found them all!',
      complete: 'Board complete!',
      completeSub: 'The crowd found {found} of {total}',
      sweeping: 'Raising the rest from the grave…',
      suspense: 'The special answer stirs…',
      finalGuesses: 'Final guesses!',
      found: 'found',
      topN: 'Top {n}',
      startsSoon: '{show} starts soon',
      wrap: 'That’s a wrap!',
      wrapSub: 'Happy Halloween, boils and ghouls',
      recap: 'The crowd found {found} of {total}',
      playAlong: 'Cheer along on your phone',
      playAlongShort: 'Cheer along',
      rehearsal: 'Rehearsal',
      pickTitle: 'The spotlight is searching…',
      pickPool: '{n} in the pool',
      pickUp: 'You’re up!',
      pickAsk: 'Unmute and give us your answer, ghoul!',
      seatAway: 'away',
      seatDone: 'done',
      seatHot: 'hot seat',
      hotSeat: 'In the hot seat',
      answering: 'answering',
      calledIt: 'Called it!',
      foundRank: '#{n} found',
      calledBy: 'called by',
    },
    cards: {
      welcome: { kicker: 'Welcome, boils & ghouls', title: '', sub: '{show} starts soon' },
      break: { kicker: 'Intermission', title: 'Be right back', sub: 'Grab a treat — the show returns in a moment.' },
      prizes: { kicker: 'Up next', title: 'Prize time!', sub: 'The spookiest prizes of the night…' },
      thanks: { kicker: '{event}', title: 'Thanks for playing!', sub: 'Happy Halloween from all of us!' },
    },
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
  // ---- Presenter Showcase (kept for callers without a board: see SHOWCASE books below) ----
  miss: Lines;
  special: Lines;
  /** Reveal remaining begins. */
  sweeping: Lines;
  suspense: Lines;
  timeup: Lines;
  restart: Lines;
  reset: Lines;
}

/** Presenter Showcase: one board, a crowd, no teams. Placeholders: {show} {n} {k} {title} {answer} {rank}. */
interface ShowcaseBook {
  opening: Lines;
  /** A round's title card with its category… */
  category: Lines;
  /** …and without one. */
  round: Lines;
  question: Lines;
  found: Lines;
  top: Lines;
  special: Lines;
  miss: Lines;
  sweeping: Lines;
  late: Lines;
  lateTop: Lines;
  suspense: Lines;
  timeup: Lines;
  /** The whole board found by the crowd. */
  allFound: Lines;
  /** The whole board up, some of it by Reveal remaining. */
  complete: Lines;
  restart: Lines;
  reset: Lines;
  farewell: Lines;
  cards: Record<ShowdownCard, Lines>;
  // ---- The pick (placeholders: {name}) ----
  /** The spotlight starts searching (never the name: the stage hasn't landed yet). */
  pick: Lines;
  /** A reroll's new search. */
  reroll: Lines;
  /** The landing: "{name}, you're up!" */
  land: Lines;
  /** Their turn counted ("Thanks, {name}!")… */
  done: Lines;
  /** …and the same without a name (a screen that doesn't know it). */
  doneAnon: Lines;
  /** No answer: back in the pool, no harm done. */
  noAnswer: Lines;
  /** One minute left on the round clock. */
  oneMinute: Lines;
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
    celebrate: ['What a moment!', 'Now THAT’S showbiz!'],
  },
  miss: ['Not on the list!', 'Nope — keep guessing!'],
  special: ['THE SPECIAL ANSWER!', 'You found the special one!'],
  sweeping: ['Let’s see the rest of the board!'],
  suspense: ['Here comes the special answer…'],
  timeup: ['Time’s up! Last guesses!'],
  restart: ['Let’s take that from the top.'],
  reset: ['Back to the beginning!'],
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
    celebrate: ['A spooktacular moment!', 'Now THAT’S a scream!'],
  },
  miss: ['Boo! Not on the list!', 'Eek — that one’s a ghost!'],
  special: ['THE SPECIAL ANSWER! Fang-tastic!', 'You summoned the special one!'],
  sweeping: ['Let’s raise the rest from the grave…'],
  suspense: ['The special answer stirs…'],
  timeup: ['The clock struck midnight — last guesses!'],
  restart: ['Let me un-haunt that round.'],
  reset: ['Back to the very first scream!'],
};

const SHOWTIME_SHOWCASE: ShowcaseBook = {
  opening: ['Welcome, everybody, to {show}!', 'Lights! Camera! It’s {show}!', 'Good evening and welcome to {show}!'],
  category: [
    'Round {n}: {title}! Ten answers are hiding up here.',
    'Round {n} — the category is… {title}!',
    'Here we go! Round {n}: {title}!',
  ],
  round: ['Round {n}! {k} answers are hiding on the board.', 'Here comes round {n}…', 'Round {n} — get those guesses ready!'],
  question: ['Shout your guesses in the chat!', 'The board is live — type your answers!', 'What’s up there? Let’s find out!'],
  found: [
    'Show me {answer}!',
    'It’s on the board!',
    '{answer}! Great call!',
    'Good answer! Good answer!',
    'The crowd knows its stuff!',
    'There it is — {answer}!',
  ],
  top: ['NUMBER ONE! {answer}!', 'Right at the top — {answer}!', 'The top answer! Take a bow!'],
  special: ['THE SPECIAL ANSWER! {answer}!', 'You found it! The special one!', 'Stop the show — it’s the special answer!'],
  miss: [
    'Not on the list!',
    'Nope — keep guessing!',
    'Ooh, good guess… but no!',
    'Not up there, I’m afraid!',
    'The board says… no!',
    'Close, but no cigar!',
    'Swing and a miss!',
    'Not this time — try again!',
    'Hmm, the board disagrees!',
    'Nice try — keep them coming!',
  ],
  sweeping: ['Let’s reveal the rest of the board!', 'Time to see what you missed!'],
  late: ['Nobody got {answer}!', 'Hiding at #{rank}: {answer}!', 'Ooh — {answer}!', 'And at #{rank}… {answer}!'],
  lateTop: ['And the number one answer… {answer}!'],
  suspense: ['Drumroll… here comes the special answer…', 'Ooh, this is the special one…'],
  timeup: ['Time’s up! Final guesses!', 'That’s the clock! Last calls!'],
  allFound: ['You found every single one! Amazing!', 'A perfect board! Take a bow!'],
  complete: ['And that’s the whole board!', 'Every answer is up!'],
  restart: ['Let’s take that from the top.'],
  reset: ['Back to the beginning!'],
  farewell: ['That’s a wrap! Thanks for playing, everybody!', 'What a show! Good night, everybody!'],
  cards: {
    welcome: ['Welcome, welcome! Grab a seat — we start soon.', 'Make yourselves comfortable — the show starts soon!'],
    break: ['Don’t go anywhere — we’ll be right back!', 'Quick break! Stretch those legs.'],
    prizes: ['Who’s taking home the prizes? Let’s find out!', 'Prize time! Drumroll, please…'],
    thanks: ['Thanks for playing — good night, everybody!', 'You’ve been a wonderful crowd!'],
  },
  pick: ['The spotlight’s looking for someone…', 'Who’s next? Let’s find out!', 'Lights, please… who’s up?'],
  reroll: ['Let’s try someone else!', 'One more sweep of the spotlight!'],
  land: ['{name}, you’re up!', 'Come on down, {name}!', '{name} — it’s your turn!'],
  done: ['Thanks, {name}!', 'Great job, {name}!', 'Give it up for {name}!'],
  doneAnon: ['Thanks for playing along!', 'Give them a big hand!'],
  noAnswer: ['No answer? No problem — back in the pool!', 'That’s fine — you might get another turn!'],
  oneMinute: ['One minute left!', 'Sixty seconds on the clock!'],
};

const HALLOWEEN_SHOWCASE: ShowcaseBook = {
  opening: ['Welcome, boils and ghouls, to {show}!', 'Boo! Welcome to {show}!', 'Lights down, spirits up — it’s {show}!'],
  category: [
    'Round {n}: {title}! Ten answers lurk on the board…',
    'Round {n}… the category is {title}! Mwa-ha-ha!',
    'Dare you face round {n}? {title}!',
  ],
  round: ['Round {n}! {k} answers lurk on the board.', 'Round {n}… if you dare!', 'Here comes round {n}! Mwa-ha-ha!'],
  question: [
    'Shout your guesses in the chat, ghouls!',
    'The board is haunted — type your answers!',
    'What lurks up there? Let’s find out!',
  ],
  found: [
    'Show me {answer}!',
    'It’s on the board! Boo-tiful!',
    '{answer}! Fang-tastic!',
    'Wicked good — {answer}!',
    'The spirits agree!',
    'Spook-tacular call!',
  ],
  top: ['NUMBER ONE! {answer}! Fang-tastic!', 'Top of the tombstones — {answer}!', 'The number one answer rises!'],
  special: ['THE SPECIAL ANSWER! {answer}!', 'You summoned the special one!', 'Stop the séance — it’s the special answer!'],
  miss: [
    'Boo! Not on the list!',
    'Eek — that one’s a ghost!',
    'The spirits say… no!',
    'Not on this board, ghoul!',
    'That guess vanished into the fog!',
    'Brrr… not up there!',
    'Ooh, spooky guess — but no!',
    'The crystal ball says: try again!',
    'Not in this graveyard!',
    'That one’s a phantom answer!',
  ],
  sweeping: ['Let’s raise the rest from the grave…', 'Time to unearth what you missed…'],
  late: ['Nobody summoned {answer}!', 'Lurking at #{rank}: {answer}!', 'Eek — {answer}!', 'And at #{rank}… {answer}!'],
  lateTop: ['And the number one answer… {answer}!'],
  suspense: ['Drumroll from beyond… the special answer…', 'Something special stirs on the board…'],
  timeup: ['The clock struck midnight — final guesses!', 'Time’s up, ghouls! Last calls!'],
  allFound: ['You found every single one! Fang-tastic!', 'A perfect board! The spirits are proud!'],
  complete: ['The whole board has risen!', 'Every answer unearthed!'],
  restart: ['Let me un-haunt that round.'],
  reset: ['Back to the very first scream!'],
  farewell: ['That’s a wrap! Happy Halloween, boils and ghouls!', 'Thanks for haunting with us — Happy Halloween!'],
  cards: {
    welcome: ['Welcome, boils and ghouls! The fun starts soon.', 'Pull up a tombstone — we start soon!'],
    break: ['Don’t float away — we’ll be right back!', 'A quick break… I’ll be haunting nearby!'],
    prizes: ['Who’s taking home the treats? Let’s find out!', 'Prize time! The spirits are restless…'],
    thanks: ['Thanks for haunting with us! Happy Halloween!', 'Boo-bye, everybody! Happy Halloween!'],
  },
  pick: ['The spotlight’s looking for someone…', 'Ooh, who will the spirits choose?', 'The lights are searching the crowd…'],
  reroll: ['Let’s try someone else…', 'The spirits will pick again!'],
  land: ['{name}, you’re up!', 'Boo! {name}, it’s your turn!', '{name} — the spotlight found you!'],
  done: ['Thanks, {name}!', 'Fang-tastic, {name}!', 'Give it up for {name}!'],
  doneAnon: ['Thanks for that answer!', 'Give them a ghostly round of applause!'],
  noAnswer: ['No answer? No boo-hoo — back in the pool!', 'That’s okay — the spirits may call again!'],
  oneMinute: ['One minute left, ghouls!', 'Tick-tock… one spooky minute to go!'],
};

const BOOKS: Record<ShowdownLook, LineBook> = { showtime: SHOWTIME_LINES, halloween: HALLOWEEN_LINES };
const SHOWCASE: Record<ShowdownLook, ShowcaseBook> = { showtime: SHOWTIME_SHOWCASE, halloween: HALLOWEEN_SHOWCASE };

function pick(lines: Lines, seed: number): string {
  return lines[Math.abs(Math.floor(seed)) % lines.length] ?? '';
}

/** Fills `{name}` placeholders (an unknown name becomes ''). Exported for the stage's copy. */
export function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

export interface LineContext {
  look: ShowdownLook;
  board: ShowdownBoardView | null;
  teamNames: [string, string];
  /** The show's format when known (the board says during a show; before it, the settings). */
  mode?: ShowdownMode;
  /** The show's title, for the opening line. */
  show?: string;
  /** A player's display name (the pick lines thank people by name); '' or absent = unknown. */
  nameOf?: (playerId: string) => string;
}

const teamOf = (ctx: LineContext, team: TeamSlot) => (team === 0 || team === 1 ? ctx.teamNames[team] : 'Nobody');
const isShowcase = (ctx: Pick<LineContext, 'mode' | 'board'>) => (ctx.mode ?? ctx.board?.mode) === 'showcase';

/** What the host says about a board event (null = stay quiet). */
export function lineForEvent(e: ShowdownEvent, ctx: LineContext): HostLine | null {
  if (isShowcase(ctx)) {
    const line = showcaseLine(e, ctx);
    if (line !== undefined) return line;
  }
  const book = BOOKS[ctx.look];
  const b = ctx.board;
  const key = `${e.type}:${e.rev}`;
  switch (e.type) {
    case 'intro':
      return { key, text: pick(book.intro, e.rev), mood: 'cheer' };
    case 'round': {
      // From the event: it arrives before the patch that carries the new board.
      const k = e.answers;
      const text =
        e.multiplier > 1
          ? `${fill(pick(book.round, e.rev), { n: e.round + 1, k })} ${fill(pick(book.double, e.rev), { m: e.multiplier })}`
          : fill(pick(book.round, e.rev), { n: e.round + 1, k });
      return { key, text, mood: 'happy' };
    }
    case 'question':
      return { key, text: pick(book.question, e.rev), mood: 'think' };
    case 'control':
      return { key, text: fill(pick(book.control, e.rev), { team: teamOf(ctx, e.team) }), mood: 'happy' };
    case 'reveal': {
      if (e.special) return { key, text: pick(book.special, e.rev), mood: 'cheer' };
      if (e.cleared && e.late) return { key, text: pick(book.cleared, e.rev), mood: 'cheer' };
      if (e.late) return { key, text: pick(book.late, e.rev), mood: 'happy' };
      const answer = e.text || b?.slots[e.slot]?.text || '';
      return e.top
        ? { key, text: pick(book.top, e.rev), mood: 'wow' }
        : { key, text: fill(pick(book.good, e.rev), { answer: answer || 'it' }), mood: 'happy' };
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
      const lines =
        e.how === 'steal'
          ? book.stolen
          : e.how === 'defend'
            ? book.defended
            : e.how === 'sweep'
              ? book.sweep
              : e.how === 'none'
                ? book.lost
                : book.manual;
      return { key, text: fill(pick(lines, e.rev), vars), mood: e.how === 'none' ? 'oops' : 'cheer' };
    }
    case 'undo':
      return { key, text: pick(book.undo, e.rev), mood: 'think' };
    case 'adjust':
      return null;
    case 'miss':
      return { key: `miss:${e.round}:${e.n}`, text: pick(book.miss, e.n), mood: 'oops' };
    case 'sweep':
      return e.on ? { key, text: pick(book.sweeping, e.rev), mood: 'think' } : null;
    case 'suspense':
      return { key: `suspense:${e.rev}:${e.slot}`, text: pick(book.suspense, e.rev), mood: 'think' };
    case 'timeup':
      return { key: `timeup:${e.round}`, text: pick(book.timeup, e.round), mood: 'wow' };
    case 'restart':
      return { key, text: pick(book.restart, e.rev), mood: 'think' };
    case 'reset':
      return { key, text: pick(book.reset, e.rev), mood: 'think' };
    // The picker and the clock cues exist only in Presenter Showcase; Boo has lines for them in both looks.
    case 'pick':
      return pickLine(ctx.look, e);
    case 'pickEnd':
      return pickEndLine(ctx.look, e, ctx.nameOf?.(e.playerId) ?? '');
    case 'clockWarn':
      return clockWarnLine(ctx.look, e.round);
    // The last ten seconds tick and the sound station moves without a word from the host.
    case 'tick':
    case 'station':
      return null;
  }
}

/** Presenter Showcase lines (undefined = fall back to the shared line for this event). */
function showcaseLine(e: ShowdownEvent, ctx: LineContext): HostLine | null | undefined {
  const book = SHOWCASE[ctx.look];
  const b = ctx.board;
  const key = `${e.type}:${e.rev}`;
  switch (e.type) {
    case 'intro':
      return { key, text: fill(pick(book.opening, e.rev), { show: ctx.show || 'the show' }), mood: 'cheer' };
    case 'round': {
      // The board in hand may still be the previous one: only use its category if it's this round's.
      const title = b && b.round === e.round ? b.title : '';
      return title
        ? { key, text: fill(pick(book.category, e.rev), { n: e.round + 1, title }), mood: 'happy' }
        : { key, text: fill(pick(book.round, e.rev), { n: e.round + 1, k: e.answers }), mood: 'happy' };
    }
    case 'question':
      return { key, text: pick(book.question, e.rev), mood: 'happy' };
    case 'reveal': {
      const answer = e.text || b?.slots[e.slot]?.text || 'it';
      const vars = { answer, rank: e.slot + 1 };
      if (e.special) return { key, text: fill(pick(book.special, e.rev), vars), mood: 'celebrate' };
      if (e.cleared) {
        const allFound = !e.late && (b ? b.slots.every((s, i) => i === e.slot || (s.revealed && !s.late)) : false);
        return { key, text: pick(allFound ? book.allFound : book.complete, e.rev), mood: 'cheer' };
      }
      if (e.late) return { key, text: fill(pick(e.top ? book.lateTop : book.late, e.rev), vars), mood: e.top ? 'wow' : 'happy' };
      return e.top
        ? { key, text: fill(pick(book.top, e.rev), vars), mood: 'wow' }
        : { key, text: fill(pick(book.found, e.rev), vars), mood: 'happy' };
    }
    case 'miss':
      // Keyed by the miss count: back-to-back misses never repeat a line.
      return { key: `miss:${e.round}:${e.n}`, text: pick(book.miss, e.n + e.round * 3), mood: 'shiver' };
    case 'sweep':
      return e.on ? { key, text: pick(book.sweeping, e.rev), mood: 'think' } : null;
    case 'suspense':
      return { key: `suspense:${e.rev}:${e.slot}`, text: pick(book.suspense, e.rev), mood: 'peek' };
    case 'timeup':
      return { key: `timeup:${e.round}`, text: pick(book.timeup, e.round), mood: 'startled' };
    case 'restart':
      return { key, text: pick(book.restart, e.rev), mood: 'think' };
    case 'reset':
      return { key, text: pick(book.reset, e.rev), mood: 'think' };
    default:
      return undefined;
  }
}

/**
 * The spotlight starts searching. Never the name: the pick event carries it, but the stage hasn't
 * landed yet, and Boo mustn't spoil the moment.
 */
export function pickLine(look: ShowdownLook, e: { drawNo: number; reroll?: boolean }): HostLine {
  const book = SHOWCASE[look];
  return { key: `pick:${e.drawNo}`, text: pick(e.reroll ? book.reroll : book.pick, e.drawNo), mood: 'peek' };
}

/** The landing: the stage has found them ("Priya, you're up!"). */
export function landLine(look: ShowdownLook, drawNo: number, name: string): HostLine {
  const book = SHOWCASE[look];
  return name
    ? { key: `land:${drawNo}`, text: fill(pick(book.land, drawNo), { name }), mood: 'cheer' }
    : { key: `land:${drawNo}`, text: pick(book.pick, drawNo), mood: 'cheer' };
}

/**
 * The hot seat emptied: thanks (their turn counted) or a kind word (no answer). A reroll says nothing
 * here (its new search speaks), and a guest a moderator hid leaves quietly.
 */
export function pickEndLine(
  look: ShowdownLook,
  e: { drawNo: number; how: 'done' | 'noAnswer' | 'reroll' | 'cleared' },
  name: string,
): HostLine | null {
  const book = SHOWCASE[look];
  const key = `pickEnd:${e.drawNo}:${e.how}`;
  if (e.how === 'done')
    return name
      ? { key, text: fill(pick(book.done, e.drawNo), { name }), mood: 'cheer' }
      : { key, text: pick(book.doneAnon, e.drawNo), mood: 'cheer' };
  if (e.how === 'noAnswer') return { key, text: pick(book.noAnswer, e.drawNo), mood: 'happy' };
  return null;
}

/** One minute left on the round clock. */
export function clockWarnLine(look: ShowdownLook, round: number): HostLine {
  return { key: `clockWarn:${round}`, text: pick(SHOWCASE[look].oneMinute, round), mood: 'wow' };
}

export function lineForCue(cue: ShowdownCue, id: number, look: ShowdownLook): HostLine {
  const mood: HostMood =
    cue === 'aww' ? 'oops' : cue === 'suspense' || cue === 'drumroll' ? 'think' : cue === 'celebrate' ? 'celebrate' : 'cheer';
  return { key: `cue:${cue}:${id}`, text: pick(BOOKS[look].cue[cue], id), mood };
}

export function lineForFinale(look: ShowdownLook, winner: TeamSlot, names: [string, string]): HostLine {
  const book = BOOKS[look];
  return winner === -1
    ? { key: 'finale:tie', text: pick(book.finaleTie, 0), mood: 'cheer' }
    : { key: `finale:${winner}`, text: fill(pick(book.finaleWin, winner), { team: names[winner] }), mood: 'cheer' };
}

/** Presenter Showcase: the host's farewell on the finale (no winner — never an invented one). */
export function farewellLine(look: ShowdownLook, finale: Pick<ShowdownFinale, 'results'>): HostLine {
  const found = finale.results.reduce((n, r) => n + (r.found ?? 0), 0);
  return { key: `farewell:${finale.results.length}`, text: pick(SHOWCASE[look].farewell, found), mood: 'bye' };
}

/** Presenter Showcase: what the host says on a holding card. */
export function cardLine(look: ShowdownLook, card: ShowdownCard): HostLine {
  return {
    key: `card:${card}`,
    text: pick(SHOWCASE[look].cards[card], 0),
    mood: card === 'thanks' ? 'bye' : card === 'prizes' ? 'cheer' : card === 'break' ? 'think' : 'happy',
  };
}

/** Presenter Showcase: the opening's welcome (the show title, which the intro event doesn't carry). */
export function openingLine(look: ShowdownLook, show: string): HostLine {
  return { key: 'opening', text: fill(pick(SHOWCASE[look].opening, 0), { show }), mood: 'cheer' };
}

/** Presenter Showcase: the host announcing a round's category on its title card. */
export function categoryLine(look: ShowdownLook, board: Pick<ShowdownBoardView, 'round' | 'title' | 'slots'>): HostLine {
  const book = SHOWCASE[look];
  const n = board.round + 1;
  return board.title
    ? { key: `category:${board.round}`, text: fill(pick(book.category, board.round), { n, title: board.title }), mood: 'happy' }
    : { key: `category:${board.round}`, text: fill(pick(book.round, board.round), { n, k: board.slots.length }), mood: 'happy' };
}

/** What the host says when nothing just happened (late joiners, a refreshed screen). */
export function idleLine(look: ShowdownLook, board: ShowdownBoardView | null, names: [string, string], show = ''): HostLine {
  const book = BOOKS[look];
  if (board?.mode === 'showcase') {
    if (board.stage === 'intro') return { ...openingLine(look, show || 'the show'), key: 'idle:opening' };
    if (board.stage === 'title') return categoryLine(look, board);
    if (board.stage === 'done') return { key: `idle:done:${board.round}`, text: pick(SHOWCASE[look].complete, board.round), mood: 'happy' };
    return { key: `idle:q:${board.round}`, text: pick(SHOWCASE[look].question, board.round), mood: 'happy' };
  }
  if (!board || board.stage === 'intro') return { key: 'idle:intro', text: pick(book.intro, 0), mood: 'happy' };
  if (board.stage === 'title')
    return {
      key: `idle:round:${board.round}`,
      text: fill(pick(book.round, board.round), { n: board.round + 1, k: board.slots.length }),
      mood: 'happy',
    };
  if (board.stage === 'steal') {
    const stealer: TeamSlot = board.control === 0 ? 1 : board.control === 1 ? 0 : -1;
    return {
      key: `idle:steal:${board.round}`,
      text: fill(pick(book.steal, board.round), { team: stealer === -1 ? 'Team' : names[stealer] }),
      mood: 'think',
    };
  }
  if (board.stage === 'live' && board.control !== -1)
    return {
      key: `idle:control:${board.round}`,
      text: fill(pick(book.control, board.round), { team: names[board.control] }),
      mood: 'happy',
    };
  return { key: `idle:q:${board.round}`, text: pick(book.question, board.round), mood: 'think' };
}

/** Big-screen / join hint: the short address people type on their phones. */
export function joinAddress(code: string): { short: string; url: string } {
  const host = typeof location !== 'undefined' ? location.host : 'dascade';
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return { short: `${host}/r/${code}`, url: `${origin}/r/${code}` };
}

/** The line book's keys of a showcase look (for tests: both looks must carry the same ones). */
export function showcaseBookKeys(look: ShowdownLook): string[] {
  return Object.keys(SHOWCASE[look]).sort();
}

/** Every line a showcase look can say (for tests). */
export function showcaseBookLines(look: ShowdownLook): string[] {
  const book = SHOWCASE[look];
  return Object.values(book).flatMap((v: Lines | Record<ShowdownCard, Lines>) =>
    Array.isArray(v) ? [...(v as Lines)] : Object.values(v as Record<ShowdownCard, Lines>).flat(),
  );
}
