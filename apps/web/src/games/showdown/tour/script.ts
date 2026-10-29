/**
 * The Presenter Tour's script: thirteen chapters that walk the presenter through a DAS-O-Ween Trivia
 * show on the demo stage, in the runbook's order and with the console's own button names
 * (docs/DAS-O-WEEN-RUNBOOK.md), on the console's Dashboard layout.
 *
 * PRACTICE CONTENT ONLY: the boards are the rehearsal preset's candy and costume lists (practice
 * material, not secrets). The real show's answers never appear here — they live on the server, and
 * secrecy.test.ts fails the build if one turns up in web code.
 *
 * Beats marked `cut: 'film'` are Boo's extra bits in the film cut ("Boo's Backstage Tour").
 */
import {
  SHOWDOWN_PICK_LAND_MS,
  type ShowdownBoardView,
  type ShowdownEvent,
  type ShowdownFinale,
  type ShowdownFinaleStepKind,
  type ShowdownScoreboard,
  type ShowdownSettings,
  type ShowdownStage,
} from '@dascade/shared/games/showdown';
import type { AwardsView } from '../awards.ts';
import type { CinemaView } from '../cinema.ts';
import { EMPTY_SHOW, guestId, type DemoClock, type DemoShow } from './demoSource.ts';
import type { TourBeat, TourChapter } from './timeline.ts';

/** The demo room's code: not a real code (real ones never have an O), so nobody can join it. */
export const DEMO_CODE = 'DEMO';

export interface DemoAnswer {
  text: string;
  note: string;
  aliases: string[];
}

export interface DemoRound {
  title: string;
  prompt: string;
  source: string;
  /** The special answer's slot (#5). */
  special: number;
  answers: DemoAnswer[];
}

const a = (text: string, note: string, aliases: string[] = []): DemoAnswer => ({ text, note, aliases });

/** The rehearsal preset's practice boards. */
export const DEMO_ROUNDS: readonly [DemoRound, DemoRound] = [
  {
    title: 'Halloween Candy',
    prompt: 'Name the Top 10 Halloween Candies.',
    source: 'DAS-O-Ween Host Picks',
    special: 4,
    answers: [
      a('Peanut Butter Cups', 'Chocolate + peanut butter', ['peanut butter cup']),
      a('Candy Corn', 'Love it or hate it', ['candycorn']),
      a('Chocolate Bar', 'Any brand', ['chocolate', 'candy bar']),
      a('Gummy Worms', 'Wiggly', ['gummies']),
      a('Caramel Apple', 'Sticky', ['caramel apples', 'candy apple']),
      a('Lollipop', 'On a stick', ['lollipops', 'sucker']),
      a('Jelly Beans', 'Every flavour', ['jellybeans']),
      a('Licorice', 'Red or black', ['liquorice']),
      a('Sour Candy', 'Pucker up', ['sours']),
      a('Bubble Gum', 'Pop!', ['gum', 'bubblegum']),
    ],
  },
  {
    title: 'Halloween Costumes',
    prompt: 'Name the Top 10 Halloween Costumes.',
    source: 'DAS-O-Ween Host Picks',
    special: 4,
    answers: [
      a('Witch', 'Pointy hat', ['witches']),
      a('Vampire', 'Fangs', ['dracula']),
      a('Ghost', 'A bedsheet', ['ghosts']),
      a('Zombie', 'Braaains', ['zombies']),
      a('Superhero', 'Cape optional', ['super hero']),
      a('Pirate', 'Arr', ['pirates']),
      a('Skeleton', 'Bones', ['skeletons']),
      a('Black Cat', 'Ears and a tail', ['cat']),
      a('Mummy', 'Toilet paper', ['mummies']),
      a('Pumpkin', 'Round and orange', ['jack o lantern']),
    ],
  },
];

/** The show’s settings once the DAS-O-Ween 2026 preset is loaded (crowd points and the hot seat’s medals on). */
export const DEMO_SETTINGS: ShowdownSettings = {
  mode: 'showcase',
  title: 'DAS-O-Ween Trivia',
  eventName: 'Remoties DAS-O-Ween Happy Hour',
  look: 'halloween',
  source: 'custom',
  packs: ['spooky'],
  rounds: 2,
  scoring: 'flat',
  steal: false,
  audience: true,
  teamNames: ['', ''],
  minutes: 10,
  stageClock: true,
  display: 'auto',
  guesses: 10,
  pickMode: 'fair',
  crewDraw: false,
  points: true,
  medals: 'round',
  reveal: 'standings',
  gems: true,
  pops: true,
};

/** Before the preset: a new room's defaults. */
export const DEMO_SETTINGS_BEFORE: ShowdownSettings = { ...DEMO_SETTINGS, title: '', eventName: '', mode: 'showcase' };

/** The guests who joined on a phone (practice names: the picker draws from them). */
export const DEMO_GUESTS: readonly string[] = [
  'Ada',
  'Grace',
  'Hedy',
  'Linus',
  'Tim',
  'Katherine',
  'Alan',
  'Margaret',
  'Dennis',
  'Barbara',
  'Ken',
  'Radia',
];

const row = (name: string, points: number, rank: number) => ({ playerId: guestId(DEMO_GUESTS.indexOf(name)), name, points, rank });

/** The Standings card between rounds: the top five Guessers. */
const STANDINGS: ShowdownScoreboard = {
  points: true,
  medals: 'round',
  top: [row('Hedy', 46, 1), row('Ada', 41, 2), row('Linus', 33, 3), row('Grace', 28, 4), row('Tim', 25, 5)],
  of: 12,
  stars: [],
};

/** A pretend photo for the awards (a picture drawn here, not a person). */
const photo = (emoji: string, bg: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="${bg}"/><text x="60" y="84" font-size="72" text-anchor="middle">${emoji}</text></svg>`,
  )}`;

/** The Awards desk, filled in during the quiz (one award, so the ceremony fits the tour). */
function awards(at: number): AwardsView {
  return {
    categories: [
      {
        id: 'costume',
        title: 'Best Costume',
        places: [
          { name: 'Katherine', photo: 'p1' },
          { name: 'Alan', photo: 'p2' },
          { name: 'Margaret', photo: 'p3' },
        ],
      },
    ],
    photos: { p1: photo('🧛', '#3b1f5c'), p2: photo('🧟', '#1f4d3a'), p3: photo('🎃', '#5c3a12') },
    at,
    rolling: false,
    ready: true,
  };
}

/** The cartoon in the Cinema tool (a name only: the tour plays no video). */
function cinema(patch: Partial<CinemaView> = {}): CinemaView {
  return {
    clips: [{ id: 'demo-clip', name: 'Spooky Cartoon.mp4', url: '' }],
    clipId: 'demo-clip',
    frame: 'cinema',
    onStage: false,
    window: true,
    playing: false,
    ended: false,
    time: 0,
    duration: 372,
    blocked: false,
    failed: false,
    ...patch,
  };
}

// ---------------------------------------------------------------------------
// Builders (revisions only need to be distinct and repeatable: Boo picks his lines by them)
// ---------------------------------------------------------------------------

let rev = 40;
const nextRev = () => ++rev;

const MIN = 60_000;
const clock = (left: number, running = true): DemoClock => ({ max: 10 * MIN, left, running, show: true });
const STOPPED = clock(10 * MIN, false);

function intro(): ShowdownBoardView {
  return board(-1, 'intro');
}

/** A board of round 0 or 1 (-1: the opening) with these slots found by the crowd and these revealed late. */
function board(
  round: -1 | 0 | 1,
  stage: ShowdownStage,
  found: readonly number[] = [],
  late: readonly number[] = [],
  results: ShowdownBoardView['results'] = [],
): ShowdownBoardView {
  const def = round === -1 ? null : DEMO_ROUNDS[round];
  const asked = stage === 'live' || stage === 'done';
  let seq = 0;
  return {
    rev: nextRev(),
    mode: 'showcase',
    stage,
    round,
    totalRounds: DEMO_ROUNDS.length,
    multiplier: 1,
    title: def?.title ?? '',
    prompt: def && asked ? def.prompt : '',
    source: def && asked ? def.source : '',
    special: def?.special ?? -1,
    slots: (def?.answers ?? []).map((ans, i) => {
      const isLate = late.includes(i);
      if (!found.includes(i) && !isLate) return { revealed: false, by: -1, seq: 0, callers: 0, late: false };
      return { revealed: true, text: ans.text, note: ans.note, points: 0, by: -1, seq: ++seq, callers: 0, late: isLate };
    }),
    control: -1,
    strikes: 0,
    stealFailed: false,
    bank: 0,
    scores: [0, 0],
    roundWinner: -1,
    roundHow: '',
    results,
  };
}

const R1_RESULT = { index: 0, winner: -1 as const, points: 0, how: 'none' as const, found: 4, total: 10 };
const R2_RESULT = { index: 1, winner: -1 as const, points: 0, how: 'none' as const, found: 3, total: 10 };

const FINALE: ShowdownFinale = {
  mode: 'showcase',
  winner: -1,
  scores: [0, 0],
  names: ['', ''],
  results: [R1_RESULT, R2_RESULT],
  callers: [],
  members: [[], []],
  podium: [row('Hedy', 88, 1), row('Ada', 79, 2), row('Linus', 64, 3)],
  stars: [],
  medals: 'round',
};

const ev = {
  intro: (): ShowdownEvent => ({ type: 'intro', rev: nextRev() }),
  round: (round: number): ShowdownEvent => ({ type: 'round', rev: nextRev(), round, multiplier: 1, answers: 10 }),
  question: (): ShowdownEvent => ({ type: 'question', rev: nextRev() }),
  miss: (round: number, n: number): ShowdownEvent => ({ type: 'miss', rev: nextRev(), round, n }),
  sweep: (on: boolean): ShowdownEvent => ({ type: 'sweep', rev: nextRev(), on }),
  suspense: (slot: number): ShowdownEvent => ({ type: 'suspense', rev: nextRev(), slot }),
  timeup: (round: number): ShowdownEvent => ({ type: 'timeup', rev: nextRev(), round }),
  undo: (): ShowdownEvent => ({ type: 'undo', rev: nextRev() }),
  restart: (round: number): ShowdownEvent => ({ type: 'restart', rev: nextRev(), round }),
  /** The picker drew `name` (the stage's sounds time the landing from landAt). */
  pick: (name: string, poolSize: number): ShowdownEvent => ({
    type: 'pick',
    rev: nextRev(),
    drawNo: 1,
    winnerId: guestId(DEMO_GUESTS.indexOf(name)),
    name,
    poolSize,
    landAt: SHOWDOWN_PICK_LAND_MS,
    reroll: false,
  }),
  pickEnd: (name: string): ShowdownEvent => ({
    type: 'pickEnd',
    rev: nextRev(),
    drawNo: 1,
    playerId: guestId(DEMO_GUESTS.indexOf(name)),
    how: 'done',
  }),
  finale: (step: number, kind: ShowdownFinaleStepKind): ShowdownEvent => ({ type: 'finale', rev: nextRev(), step, kind }),
};

/**
 * A reveal of `slot` in `round`: the board after it (with these found / late) and its event.
 * `cleared` = it was the last hidden tile (the board is complete).
 */
function reveal(
  round: 0 | 1,
  slot: number,
  found: readonly number[],
  late: readonly number[] = [],
  sweep = false,
): Pick<TourBeat, 'show' | 'events'> {
  const isLate = late.includes(slot);
  const cleared = found.length + late.length === 10;
  const ans = DEMO_ROUNDS[round].answers[slot]!;
  const results = round === 1 ? [R1_RESULT] : [];
  return {
    show: {
      board: board(round, cleared ? 'done' : 'live', found, late, cleared ? (round === 0 ? [R1_RESULT] : [R1_RESULT, R2_RESULT]) : results),
    },
    events: [
      {
        type: 'reveal',
        rev: nextRev(),
        slot,
        text: ans.text,
        note: ans.note,
        points: 0,
        top: slot === 0,
        late: isLate,
        callers: 0,
        cleared,
        special: slot === DEMO_ROUNDS[round].special,
        sweep,
      },
    ],
  };
}

/** A demo show: the guests are in the room (the picker's pool) unless the patch says otherwise. */
const show = (patch: Partial<DemoShow>): DemoShow => ({ ...EMPTY_SHOW, guests: DEMO_GUESTS, ...patch });

/** Reveal remaining, tile by tile from #10 up (`order` = the hidden slots in sweep order). */
function sweepBeats(
  round: 0 | 1,
  found: readonly number[],
  order: readonly number[],
  step: number,
  captions: Record<number, string> = {},
): TourBeat[] {
  const late: number[] = [];
  const beats: TourBeat[] = [];
  order.forEach((slot, i) => {
    const special = slot === DEMO_ROUNDS[round].special;
    if (special) {
      beats.push({
        hold: 2600,
        filmHold: 3000,
        events: [ev.suspense(slot)],
        caption: captions[-1],
        boo: { act: 'drums', mood: 'peek', say: 'Drumroll, please… I’ll do it myself!' },
      });
    }
    late.push(slot);
    const last = i === order.length - 1;
    beats.push({
      hold: special ? 4200 : last ? 2200 : step,
      filmHold: special ? 4400 : last ? 2600 : Math.round(step * 1.3),
      ...reveal(round, slot, found, [...late], true),
      ...(captions[i] ? { caption: captions[i] } : {}),
      ...(special ? { boo: { act: 'spin' as const, mood: 'celebrate' as const } } : {}),
    });
  });
  return beats;
}

// ---------------------------------------------------------------------------
// The chapters
// ---------------------------------------------------------------------------

const R1_LIVE_START = clock(10 * MIN - 20_000);

/** A beat that also changes something else on the stage (the reveal builders set only the board). */
function withShow(beat: Pick<TourBeat, 'show' | 'events'>, patch: Partial<DemoShow>): Pick<TourBeat, 'show' | 'events'> {
  return { ...beat, show: { ...beat.show, ...patch } };
}

export const TOUR_CHAPTERS: readonly TourChapter[] = [
  {
    id: 'big-picture',
    title: 'Big picture',
    film: 'Two windows and a secret',
    setup: show({ card: 'welcome' }),
    screen: 'diagram',
    stage: true,
    preset: true,
    beats: [
      {
        hold: 3800,
        step: 0,
        caption: 'You run DAS-O-Ween Trivia on your own, from one laptop, with **two windows**.',
        boo: { say: 'Psst! Welcome backstage. Two windows. One of them is a secret.', act: 'point', mood: 'happy' },
      },
      {
        hold: 4400,
        step: 1,
        caption:
          'The **presenter console** is yours alone: every answer and every control. Its red **PRIVATE** band says it: **never share it.**',
        boo: { say: 'Never share the console: it has the ANSWERS!', act: 'cover', mood: 'peek' },
      },
      {
        hold: 4000,
        step: 2,
        caption: 'The **stage window** is the show: the board, Boo and the effects, but never the answers.',
        boo: { say: 'The stage window is where I work. Lights! Glamour! Me!', act: 'spin', mood: 'cheer' },
      },
      {
        hold: 4600,
        step: 3,
        caption: 'In Teams, share the **stage window** with *Include sound* on, so everyone sees and hears the show.',
        boo: { say: 'Share the stage, with sound. Otherwise my jokes fall flat.', act: 'listen', mood: 'happy' },
      },
      {
        hold: 4000,
        step: 4,
        caption: 'The answers stay locked away on the server. A tile only flips when you say so.',
        boo: { say: 'The answers stay locked up. Like my cousin in the attic.', act: 'shrug', mood: 'think' },
      },
      {
        hold: 3800,
        step: 5,
        caption: 'Guests join on their phones with the room’s QR code: they can be picked to answer, and they score with their own Top 10.',
        boo: { say: 'Phones can cheer. I LOVE cheering.', act: 'float', mood: 'cheer' },
      },
    ],
  },
  {
    id: 'getting-ready',
    title: 'Getting ready',
    film: 'Setting the stage',
    setup: show({}),
    screen: 'lobby',
    stage: false,
    preset: false,
    beats: [
      {
        hold: 1500,
        console: { screen: 'lobby', tab: 'settings', point: 'preset-load', zoom: 1.15 },
        caption:
          'In the lobby, under [[Settings]] → [[Event presets]], press [[Load]] next to [[DAS-O-Ween 2026]], then load your show file.',
        boo: { say: 'First, the preset: the clock, the scoring and my favourite look.', act: 'point', mood: 'happy' },
      },
      { hold: 2600, console: { click: true }, preset: true },
      {
        hold: 1300,
        console: { tab: 'setup', point: 'open-stage', zoom: 1.4 },
        caption: 'Under [[Your setup]], press [[Open stage window]]…',
      },
      {
        hold: 3000,
        console: { click: true },
        stage: true,
        caption: '…and the show pops up in its own window. Drag it to your second screen.',
        boo: { say: 'Ta-da! My dressing room.', act: 'spin', mood: 'wow' },
      },
      {
        hold: 2600,
        console: { point: 'open-stage', zoom: 1.5 },
        caption: 'The button says what’s next: click the stage window once and press {{F}} for full screen…',
      },
      {
        hold: 3000,
        full: true,
        caption: '…the browser bar is gone from the share, and the button says [[Stage full screen]]. {{Esc}} leaves it.',
        boo: { say: 'Full screen! Nothing between me and my adoring public.', act: 'float', mood: 'cheer' },
      },
      {
        hold: 2400,
        console: { screen: 'share' },
        step: 0,
        caption: 'In Teams, press *Share*…',
        boo: { say: 'Now the meeting app. Share!', act: 'point', mood: 'happy' },
      },
      { hold: 2200, step: 1, caption: '…turn on *Include sound*…' },
      {
        hold: 3200,
        step: 2,
        caption: '…choose *Window* and pick “DAS-O-Ween Trivia — STAGE (share this)”, never “🔒 PRESENTER — don’t share”.',
      },
      {
        hold: 1300,
        console: { screen: 'lobby', tab: 'setup', point: 'test-sound', zoom: 1.4 },
        caption: 'Press [[Test sound]]: the meeting should hear a ding.',
      },
      {
        hold: 2300,
        console: { click: true },
        sound: 'ding',
        boo: { say: 'Ding! Did you hear that? I heard that.', act: 'listen', mood: 'wow' },
      },
      {
        hold: 1200,
        console: { point: 'card-welcome', zoom: 1.4 },
        caption: 'While people arrive, put up the [[Welcome]] card: it carries the big join QR.',
      },
      {
        hold: 3200,
        console: { click: true },
        show: { card: 'welcome' },
        boo: { say: 'Welcome, boils and ghouls!', act: 'float', mood: 'happy' },
      },
      {
        hold: 1300,
        console: { point: 'lobby-qr', zoom: 1.4 },
        caption: 'Post the join link too: [[Copy QR image]] and [[Copy link]], then paste both in the Teams chat.',
      },
      {
        hold: 2600,
        console: { click: true },
        toast: 'QR image copied: paste it in the Teams chat.',
        boo: { say: 'Scan me! Well, scan the ticket. I don’t show up on cameras.', act: 'shrug', mood: 'happy' },
      },
    ],
  },
  {
    id: 'start',
    title: 'Start the show',
    film: 'It’s showtime!',
    setup: show({ card: 'welcome' }),
    screen: 'lobby',
    stage: true,
    preset: true,
    full: true,
    beats: [
      {
        hold: 1400,
        console: { screen: 'lobby', tab: 'setup', point: 'start-game', zoom: 1.3 },
        caption: 'Showtime! Press [[Start game]]. The Welcome card comes down by itself.',
      },
      {
        hold: 5200,
        filmHold: 6400,
        console: { click: true, screen: 'console' },
        show: { phase: 'PLAYING', card: null, board: intro() },
        events: [ev.intro()],
        caption: 'The opening plays on the stage, and your console opens.',
        boo: { say: 'That’s my entrance music! Fabulous, right?', act: 'spin', mood: 'cheer' },
      },
      {
        hold: 3600,
        console: { point: '', zoom: 1 },
        caption: 'This is the **Dashboard**: your answer sheet, the rail of show controls, and every tool open beside them.',
        boo: { say: 'Look at all those buttons! Don’t worry, I’ll show you each one.', act: 'point', mood: 'happy' },
      },
      {
        hold: 2600,
        console: { point: 'tool-sound', zoom: 1.5 },
        caption: 'Click a tool’s title to fold it away. The console remembers.',
      },
      {
        hold: 2800,
        console: { point: 'layout-switch', zoom: 1.7 },
        caption: 'Prefer the older tabbed drawer? [[Classic]] in the bar brings it back, and [[Dashboard]] returns.',
      },
      {
        hold: 1300,
        console: { point: 'next-step', key: 'Q', zoom: 1.5 },
        caption: 'Welcome everyone, then press [[Start round 1]].',
      },
      {
        hold: 3600,
        console: { click: true, key: 'Q' },
        show: { board: board(0, 'title'), clock: STOPPED },
        events: [ev.round(0)],
        caption: 'Round 1’s category card goes up.',
      },
      {
        hold: 1300,
        console: { point: 'next-step', key: 'Q' },
        caption: 'When you’re ready, press [[Show the question]]…',
      },
      {
        hold: 4200,
        console: { click: true, key: 'Q' },
        show: { board: board(0, 'live'), clock: clock(10 * MIN) },
        events: [ev.question()],
        caption: '…the question appears, and the 10-minute clock starts.',
        boo: { say: 'Ten minutes on the clock. Plenty of time to be fabulous.', act: 'watch', mood: 'happy' },
      },
    ],
  },
  {
    id: 'right',
    title: 'Right answer',
    film: 'Ding! Clang!',
    setup: show({ phase: 'PLAYING', board: board(0, 'live'), clock: R1_LIVE_START }),
    screen: 'console',
    stage: true,
    preset: true,
    full: true,
    beats: [
      {
        hold: 2200,
        chat: { who: 'Ada', text: 'candy corn!!' },
        console: { screen: 'console', point: 'answer-2', zoom: 1.6 },
        caption: 'Someone names an answer in your meeting chat…',
        boo: { act: 'listen', mood: 'think' },
      },
      {
        hold: 3800,
        console: { click: true, key: '2' },
        ...reveal(0, 1, [1]),
        caption: '…click it on your [[Answer sheet]] (or press its number). Ding, clang: the tile flips.',
        boo: { say: 'Ding! Clang! My two favourite sounds.', act: 'float', mood: 'happy' },
      },
      {
        hold: 1500,
        chat: { who: 'Grace', text: 'peanut butter cups?' },
        console: { point: 'answer-1' },
        caption: 'Number keys work too: {{1}} to {{9}}, and {{0}} for #10.',
      },
      { hold: 3200, console: { click: true, key: '1' }, ...reveal(0, 0, [0, 1]) },
      // (The film skips the third answer: two make the point.)
      { hold: 1300, cut: 'tour', chat: { who: 'Hedy', text: 'Chocolate bar' }, console: { point: 'answer-3' } },
      { hold: 3000, cut: 'tour', console: { click: true, key: '3' }, ...reveal(0, 2, [0, 1, 2]) },
    ],
  },
  {
    id: 'wrong',
    title: 'Wrong answer',
    film: 'Eek!',
    setup: show({ phase: 'PLAYING', board: board(0, 'live', [0, 1, 2]), clock: clock(9 * MIN + 5_000) }),
    screen: 'console',
    stage: true,
    preset: true,
    full: true,
    beats: [
      {
        hold: 2400,
        chat: { who: 'Linus', text: 'pickles?' },
        console: { screen: 'console', point: 'wrong', zoom: 1.5 },
        caption: 'Not on the board?',
        boo: { say: 'Pickles?! For Halloween?!', act: 'faint', mood: 'oops' },
      },
      {
        hold: 3200,
        console: { click: true, key: 'X' },
        events: [ev.miss(0, 1)],
        caption: 'Press [[Wrong]] (or {{X}}): a buzzer and a giant ✕ on the stage.',
        boo: { say: 'AAH! That buzzer gets me every time.', act: 'jump', mood: 'startled' },
      },
      { hold: 1300, chat: { who: 'Tim', text: 'broccoli' } },
      {
        hold: 2700,
        console: { click: true, key: 'X' },
        events: [ev.miss(0, 2)],
        caption: 'Press it as often as you like. It’s never a strike, and nothing is counted.',
      },
      { hold: 1200, chat: { who: 'Katherine', text: 'a toothbrush' } },
      {
        hold: 2600,
        console: { click: true, key: 'X' },
        events: [ev.miss(0, 3)],
        boo: { say: 'A toothbrush. The scariest treat of all.', act: 'shrug', mood: 'oops' },
      },
    ],
  },
  {
    id: 'picker',
    title: 'Pick who answers',
    film: 'Who’s up?',
    setup: show({ phase: 'PLAYING', board: board(0, 'live', [0, 1, 2]), clock: clock(8 * MIN + 50_000) }),
    screen: 'console',
    stage: true,
    preset: true,
    full: true,
    beats: [
      {
        hold: 1500,
        console: { screen: 'console', point: 'pick', key: 'K', zoom: 1.6 },
        caption: 'Want a guest to answer out loud? Press [[Pick someone]] (or {{K}}).',
        boo: { say: 'Ooh, who will it be? Not me. I’m busy being fabulous.', act: 'listen', mood: 'think' },
      },
      {
        hold: 2400,
        console: { click: true, key: 'K' },
        show: { hot: 'Grace' },
        events: [ev.pick('Grace', DEMO_GUESTS.length - 1)],
        caption: 'The server draws someone fairly, and **you see the name first**…',
      },
      {
        hold: 3600,
        console: { point: '', zoom: 1 },
        caption: '…while the stage sweeps its spotlights and lands on them. Their phone says “You’re up!”',
        boo: { act: 'spin', mood: 'cheer' },
      },
      {
        hold: 2200,
        chat: { who: 'Grace', text: 'pumpkin pie?' },
        console: { point: 'wrong', zoom: 1.5 },
        caption: 'They answer out loud or in the chat: flip it or press [[Wrong]], as always…',
      },
      {
        hold: 2400,
        console: { click: true, key: 'X' },
        events: [ev.miss(0, 4)],
        boo: { say: 'Pumpkin PIE? So close. So very, very close.', act: 'shrug', mood: 'oops' },
      },
      {
        hold: 1500,
        console: { point: 'pick-done', key: 'D', zoom: 1.6 },
        caption: '…then [[Mark done]] (or {{D}}) counts their turn. [[No answer]] (or {{A}}) skips them with no penalty.',
      },
      {
        hold: 2600,
        console: { click: true, key: 'D' },
        show: { hot: '', done: ['Grace'] },
        events: [ev.pickEnd('Grace')],
      },
      {
        hold: 3400,
        console: { point: 'spotlight', zoom: 1.6 },
        caption: 'Fair mode gives everyone a turn before anyone gets a second. [[Spotlight…]] (or {{F}}) calls anyone up by name.',
      },
      {
        hold: 3400,
        console: { point: 'picker-exclude', zoom: 1.5 },
        caption: 'In the [[Picker]] tool, [[Exclude]] takes someone out of the random draw, and [[Include]] puts them back.',
        boo: { say: 'Exclude me? You can’t exclude a ghost. I’m everywhere.', act: 'float', mood: 'happy' },
      },
    ],
  },
  {
    id: 'special',
    title: 'Number 5',
    film: 'Number five!',
    setup: show({ phase: 'PLAYING', board: board(0, 'live', [0, 1, 2]), clock: clock(8 * MIN + 20_000), done: ['Grace'] }),
    screen: 'console',
    stage: true,
    preset: true,
    full: true,
    beats: [
      {
        hold: 2400,
        chat: { who: 'Alan', text: 'CARAMEL APPLE' },
        console: { screen: 'console', point: 'answer-5', zoom: 1.6 },
        caption: '**#5 is the special answer**: the one with the pumpkin on your sheet.',
        boo: { say: 'Oh oh oh! Is it… is it number five?!', act: 'listen', mood: 'wow' },
      },
      {
        hold: 2900,
        console: { click: true, key: '5', armed: true },
        caption: 'Click it (or press {{5}}) and it **arms** instead of flipping: nobody sees it yet.',
        boo: { act: 'drums', mood: 'peek' },
      },
      {
        hold: 1500,
        console: { point: 'take-special', key: 'Space', zoom: 1.5 },
        caption: 'Build the suspense, then press [[Take special]] (or {{Space}}). {{Esc}} disarms it.',
      },
      {
        hold: 5200,
        filmHold: 6000,
        console: { click: true, key: 'Space', armed: false },
        ...reveal(0, 4, [0, 1, 2, 4]),
        caption: 'It flips, and the big DAS-O-Ween celebration plays. One stray click can never spoil #5.',
        boo: { say: 'IT IS! Victory spin!', act: 'spin', mood: 'celebrate' },
      },
      {
        hold: 1500,
        console: { point: 'celebrate', key: 'C', zoom: 1.6 },
        caption: 'Want it again? [[Celebrate!]] in the [[Sound]] tool (or {{C}}) replays it any time.',
      },
      { hold: 4600, console: { click: true, key: 'C' }, cue: 'celebrate', boo: { say: 'Again! Again!', act: 'spin', mood: 'celebrate' } },
    ],
  },
  {
    id: 'clock',
    title: 'Clock & reveal',
    film: 'Tick, tock',
    setup: show({ phase: 'PLAYING', board: board(0, 'live', [0, 1, 2, 4]), clock: clock(3 * MIN + 10_000), done: ['Grace'] }),
    screen: 'console',
    stage: true,
    preset: true,
    full: true,
    beats: [
      {
        hold: 1300,
        console: { screen: 'console', point: 'clock-go', key: 'P', zoom: 1.6 },
        caption: '[[Pause]] (or {{P}}) stops the clock…',
      },
      { hold: 1500, console: { click: true, key: 'P' }, show: { clock: clock(3 * MIN + 8_000, false) } },
      { hold: 1000, console: { point: 'clock-plus' }, caption: '…[[+1 min]] and [[−1 min]] change it…' },
      { hold: 1500, console: { click: true }, show: { clock: clock(4 * MIN + 8_000, false) } },
      { hold: 1000, console: { point: 'clock-go', key: 'P' }, caption: '…and [[Start]] carries on.' },
      { hold: 1500, console: { click: true, key: 'P' }, show: { clock: clock(4 * MIN + 8_000) } },
      {
        hold: 3300,
        filmHold: 3300,
        console: { point: '', zoom: 1 },
        show: { clock: clock(3200) },
        caption: 'A few minutes later, the clock runs out…',
        boo: { say: 'Tick, tock, tick, tock…', act: 'watch', mood: 'think' },
      },
      {
        hold: 3600,
        events: [ev.timeup(0)],
        caption: '…but nothing is revealed: the stage says “Final guesses!” and your console says wrap up.',
        boo: { say: 'Time’s up! Well. Almost up. Up-ish.', act: 'watch', mood: 'startled' },
      },
      {
        hold: 1400,
        console: { point: 'sweep', key: 'R', zoom: 1.5 },
        caption: 'Take a last guess or two, then press [[Reveal remaining]] (or {{R}}). While the clock still runs, you hold it a moment.',
      },
      {
        hold: 1200,
        console: { click: true, key: 'R' },
        show: { sweep: true, clock: clock(-2000, false) },
        events: [ev.sweep(true)],
        caption: 'It flips what nobody found, from #10 up to #1…',
        boo: { say: 'Raising the rest from the grave!', act: 'float', mood: 'think' },
      },
      ...sweepBeats(0, [0, 1, 2, 4], [9, 8, 7, 6, 5, 3], 950, { 3: '…and those tiles look different from the ones the crowd found.' }),
      {
        hold: 3200,
        console: { point: '', zoom: 1 },
        show: { sweep: false },
        events: [ev.sweep(false)],
        caption: 'Bright tiles: found by the crowd. Darker tiles: revealed at the end.',
      },
      {
        hold: 1300,
        console: { point: 'standings', zoom: 1.6 },
        caption: 'Between rounds, [[Show standings]] in the [[Cards]] tool puts the top five Guessers on the stage…',
      },
      {
        hold: 3400,
        console: { click: true },
        show: { card: 'standings', scores: STANDINGS },
        boo: { say: 'Look at those scores! Hedy, you legend.', act: 'point', mood: 'cheer' },
      },
      {
        hold: 1100,
        console: { point: 'standings' },
        caption: '…and [[Hide standings]] takes them down. Phones show each guest their own rank.',
      },
      { hold: 1500, console: { click: true }, show: { card: null } },
    ],
  },
  {
    id: 'next-round',
    title: 'Next round',
    film: 'Round two!',
    setup: show({
      phase: 'PLAYING',
      board: board(0, 'done', [0, 1, 2, 4], [9, 8, 7, 6, 5, 3], [R1_RESULT]),
      clock: clock(-30_000, false),
      scores: STANDINGS,
    }),
    screen: 'console',
    stage: true,
    preset: true,
    full: true,
    beats: [
      {
        hold: 1200,
        console: { screen: 'console', point: 'next', key: 'N', zoom: 1.5 },
        caption: 'Board complete? Press [[Next round]] (or {{N}}).',
      },
      {
        hold: 3000,
        console: { click: true, key: 'N' },
        show: { board: board(1, 'title', [], [], [R1_RESULT]), clock: STOPPED },
        events: [ev.round(1)],
        caption: 'Round 2’s category card goes up with its sting.',
      },
      { hold: 1100, console: { point: 'next-step', key: 'Q' }, caption: 'Show the question and play it the same way.' },
      {
        hold: 2200,
        console: { click: true, key: 'Q' },
        show: { board: board(1, 'live', [], [], [R1_RESULT]), clock: clock(10 * MIN) },
        events: [ev.question()],
      },
      {
        hold: 1300,
        console: { point: 'join-pop', key: 'J', zoom: 1.6 },
        caption: 'Latecomers? [[Join pop-up]] (or {{J}}) puts the join QR beside the board for 20 seconds.',
      },
      {
        hold: 3400,
        console: { click: true, key: 'J' },
        show: { join: true },
        boo: { say: 'Come in, come in! Plenty of room. I’m see-through.', act: 'float', mood: 'happy' },
      },
      {
        hold: 1450,
        chat: { who: 'Grace', text: 'WITCH' },
        console: { point: 'answer-1', click: true, key: '1', zoom: 1.5 },
        ...withShow(reveal(1, 0, [0]), { join: false }),
      },
      {
        hold: 1450,
        chat: { who: 'Linus', text: 'vampire!' },
        console: { point: 'answer-2', click: true, key: '2' },
        ...reveal(1, 1, [0, 1]),
      },
      {
        hold: 1550,
        chat: { who: 'Ada', text: 'zombies' },
        console: { point: 'answer-4', click: true, key: '4' },
        ...reveal(1, 3, [0, 1, 3]),
      },
      {
        hold: 2400,
        console: { point: '', zoom: 1 },
        show: { clock: clock(-1000) },
        events: [ev.timeup(1)],
        caption: 'Nobody found #5 this time. When time’s up…',
        boo: { say: 'Nobody found number five? Oh, this is my favourite part.', act: 'listen', mood: 'think' },
      },
      { hold: 1100, console: { point: 'sweep', key: 'R', zoom: 1.5 }, caption: '…press [[Reveal remaining]]…' },
      { hold: 1000, console: { click: true, key: 'R' }, show: { sweep: true, clock: clock(-3000, false) }, events: [ev.sweep(true)] },
      ...sweepBeats(1, [0, 1, 3], [9, 8, 7, 6, 5, 4, 2], 720, {
        [-1]: '…and the special answer gets a drumroll and a spotlight before it flips.',
      }),
      { hold: 3000, console: { point: '', zoom: 1 }, show: { sweep: false }, events: [ev.sweep(false)], caption: 'The whole board is up.' },
    ],
  },
  {
    id: 'scenes',
    title: 'Scenes & Cinema',
    film: 'Cartoon break!',
    setup: show({
      phase: 'PLAYING',
      board: board(1, 'done', [0, 1, 3], [9, 8, 7, 6, 5, 4, 2], [R1_RESULT, R2_RESULT]),
      clock: clock(-60_000, false),
      scores: STANDINGS,
    }),
    screen: 'console',
    stage: true,
    preset: true,
    full: true,
    beats: [
      {
        hold: 3800,
        console: { screen: 'console', point: 'scene-show', zoom: 1.6 },
        caption:
          'The scene strip picks what the stage window shows: [[Show]] (the board), [[Cinema]], [[Awards]] or [[Cards]]. Nobody re-shares in Teams.',
        boo: { say: 'One window, many costumes. Just like me.', act: 'point', mood: 'happy' },
      },
      {
        hold: 1400,
        console: { point: 'cinema-load', tool: 'cinema', zoom: 1.6 },
        caption: 'Cartoon time? In the [[Cinema]] tool, [[Load video…]] picks a file from this computer. It never uploads.',
      },
      { hold: 2200, console: { click: true }, show: { cinema: cinema() } },
      {
        hold: 2600,
        console: { point: 'cinema-frame', zoom: 1.6 },
        caption: 'Pick its frame: **Retro TV**, **Haunted cinema** or **Gilded portrait**.',
      },
      {
        hold: 1400,
        console: { point: 'cinema-up', key: 'V', zoom: 1.6 },
        caption: '[[Put Cinema on the stage]] (or {{V}}) swaps the board for the frame…',
      },
      {
        hold: 3000,
        console: { click: true, key: 'V' },
        show: { card: 'cinema', cinema: cinema({ onStage: true }) },
        boo: { say: 'Popcorn time! I brought extra butter. Ghost butter.', act: 'float', mood: 'happy' },
      },
      { hold: 1300, console: { point: 'cinema-play' }, caption: '…then [[Play]]: it plays in the stage window, sound and all.' },
      { hold: 3000, console: { click: true }, show: { cinema: cinema({ onStage: true, playing: true, time: 3 }) } },
      {
        hold: 2800,
        console: { point: 'cinema-seek', zoom: 1.6 },
        show: { cinema: cinema({ onStage: true, playing: true, time: 64 }) },
        caption: 'The seek bar and the 10-second skips move through it.',
      },
      {
        hold: 1400,
        console: { point: 'cinema-back', key: 'B', zoom: 1.6 },
        show: { cinema: cinema({ onStage: true, playing: true, time: 69 }) },
        caption: 'When it ends, [[Back to the show]] (or {{B}}) brings the board back.',
      },
      {
        hold: 2800,
        console: { click: true, key: 'B' },
        show: { card: null, cinema: cinema({ time: 69 }) },
        boo: { say: 'Back to the board! Did I miss anything?', act: 'jump', mood: 'wow' },
      },
      {
        hold: 3600,
        console: { point: 'card-break', zoom: 1.5 },
        caption: 'A scene pauses the round clock ({{P}} starts it again). For a plain break, [[Be right back]] is in the [[Cards]] tool.',
      },
    ],
  },
  {
    id: 'finish',
    title: 'Finish & finale',
    film: 'That’s a wrap!',
    setup: show({
      phase: 'PLAYING',
      board: board(1, 'done', [0, 1, 3], [9, 8, 7, 6, 5, 4, 2], [R1_RESULT, R2_RESULT]),
      clock: clock(-60_000, false),
      scores: STANDINGS,
      // The Awards desk was filled in during the quiz.
      awards: awards(-1),
    }),
    screen: 'console',
    stage: true,
    preset: true,
    full: true,
    beats: [
      {
        hold: 1400,
        console: { screen: 'console', point: 'next', key: 'N', zoom: 1.5 },
        caption: 'After the last board, press [[Finish show]]…',
      },
      { hold: 1300, console: { click: true, key: 'N', dialog: 'finish', zoom: 1 } },
      {
        hold: 1100,
        console: { point: 'end-hold', zoom: 1.3 },
        caption: '…then press and hold [[Hold to finish the show]]: ending the show can’t be undone, so it takes a moment.',
      },
      { hold: 1800, console: { click: true, held: true } },
      {
        hold: 5200,
        filmHold: 6200,
        console: { dialog: null, screen: 'results' },
        show: { phase: 'RESULTS', finale: FINALE, finaleStep: 0, sweep: false },
        caption: '“That’s a wrap!” Boo says goodbye to a round of applause.',
        boo: { say: 'That’s a wrap, boils and ghouls!', act: 'wave', mood: 'bye' },
      },
      {
        hold: 1500,
        console: { point: 'finale-next', zoom: 1.4 },
        caption: '[[The finale]] steps through the podium: [[Next]] for 3rd, 2nd and 1st, each with its drumroll.',
      },
      { hold: 3000, console: { click: true }, show: { finaleStep: 1 }, events: [ev.finale(1, 'third')] },
      { hold: 3000, console: { click: true }, show: { finaleStep: 2 }, events: [ev.finale(2, 'second')] },
      {
        hold: 4600,
        filmHold: 5200,
        console: { click: true },
        show: { finaleStep: 3 },
        events: [ev.finale(3, 'first')],
        boo: { say: 'Hedy wins! I knew it. I totally knew it.', act: 'spin', mood: 'celebrate' },
      },
      {
        hold: 3200,
        console: { point: 'scores-download', zoom: 1.5 },
        caption: '[[Download CSV]] or [[Download JSON]] keeps the scores. They never include a hidden answer.',
      },
    ],
  },
  {
    id: 'awards',
    title: 'Awards',
    film: 'And the winner is…',
    setup: show({
      phase: 'RESULTS',
      board: board(1, 'done', [0, 1, 3], [9, 8, 7, 6, 5, 4, 2], [R1_RESULT, R2_RESULT]),
      finale: FINALE,
      finaleStep: 3,
      scores: STANDINGS,
      awards: awards(-1),
    }),
    screen: 'results',
    stage: true,
    preset: true,
    full: true,
    beats: [
      {
        hold: 3800,
        console: { screen: 'results', point: 'awards-names', zoom: 1.5 },
        caption:
          'During the quiz, fill in the [[Awards]] desk: a name per place, and a photo if you like (paste a Teams screenshot). It stays in your browser.',
        boo: { say: 'Best costume? Obviously mine. A classic bedsheet.', act: 'point', mood: 'happy' },
      },
      { hold: 1300, console: { point: 'awards-start', zoom: 1.5 }, caption: 'Nothing shows on the share until [[Start the ceremony]]…' },
      { hold: 2800, console: { click: true }, show: { card: 'awards', awards: awards(0) } },
      {
        hold: 1300,
        console: { point: 'awards-next' },
        caption: '…then [[Next]] for each step: the award, then 3rd, 2nd and 1st, each after a drumroll.',
      },
      { hold: 2600, console: { click: true }, show: { awards: awards(1) } },
      { hold: 3000, console: { click: true }, show: { awards: awards(2) }, cue: 'drumroll' },
      { hold: 3000, console: { click: true }, show: { awards: awards(3) }, cue: 'drumroll' },
      {
        hold: 2400,
        console: { click: true },
        show: { awards: { ...awards(3), rolling: true } },
        cue: 'drumroll',
        caption: 'Fireworks go up with the last winner…',
      },
      {
        hold: 5200,
        filmHold: 6000,
        show: { awards: awards(4) },
        cue: 'applause',
        boo: { say: 'Fireworks! Ooh! Aah! Boo!', act: 'spin', mood: 'celebrate' },
      },
      { hold: 1300, console: { point: 'card-prizes', zoom: 1.4 }, caption: 'Then [[Prize time]] for the prizes…' },
      {
        hold: 2600,
        console: { click: true },
        show: { card: 'prizes' },
        boo: { say: 'Prizes! Is one of them for me?', act: 'spin', mood: 'cheer' },
      },
      { hold: 1000, console: { point: 'card-thanks' }, caption: '…and [[Thanks for playing]] to close the night.' },
      { hold: 3400, console: { click: true }, show: { card: 'thanks' }, boo: { act: 'wave', mood: 'bye' } },
    ],
  },
  {
    id: 'safety-net',
    title: 'Safety net',
    film: 'Oops-proof',
    setup: show({ phase: 'PLAYING', board: board(0, 'live', [0, 1, 2]), clock: clock(7 * MIN + 40_000) }),
    screen: 'console',
    stage: true,
    preset: true,
    full: true,
    beats: [
      {
        hold: 1300,
        console: { screen: 'console', point: 'undo', key: 'U', zoom: 1.6 },
        caption: 'Flipped the wrong tile? [[Undo]] (or {{U}}) steps back one action at a time.',
        boo: { say: 'Even ghosts make mistakes.', act: 'shrug', mood: 'oops' },
      },
      {
        hold: 2600,
        console: { click: true, key: 'U' },
        show: { board: board(0, 'live', [0, 1]) },
        events: [ev.undo()],
      },
      {
        hold: 1300,
        console: { point: 'end-show', zoom: 1.5 },
        caption: '[[End show]] is the one thing Undo can’t bring back, so it asks twice…',
      },
      { hold: 1300, console: { click: true, dialog: 'end', zoom: 1.2 } },
      {
        hold: 2400,
        console: { point: 'end-hold' },
        caption: '…it lists the answers still hidden, and only a long press on [[Hold to end the show]] ends it.',
      },
      { hold: 1300, console: { point: 'end-keep' }, caption: '[[Keep playing]] closes it.' },
      { hold: 1300, console: { click: true, dialog: null } },
      {
        hold: 1200,
        console: { point: 'tool-fix', zoom: 1.5 },
        caption: 'Bigger slip? Open the [[Fix]] tool.',
        boo: { say: 'Oops-proof. I like it.', act: 'float', mood: 'happy' },
      },
      { hold: 1200, console: { click: true, tool: 'fix' } },
      {
        hold: 1100,
        console: { point: 'restart-round', zoom: 1.5 },
        caption: 'Press and hold [[Restart this round]] until its ring fills: a stray click does nothing.',
      },
      { hold: 1700, console: { click: true, held: true } },
      {
        hold: 2900,
        console: { point: 'undo-toast', zoom: 1.4 },
        show: { board: board(0, 'title'), clock: STOPPED },
        events: [ev.restart(0)],
        undo: 'Round 1 restarted',
        caption: 'Every answer goes back under its tile, and an [[Undo]] waits for 12 seconds in case you slipped.',
      },
      {
        hold: 1500,
        undo: '',
        stage: false,
        full: false,
        console: { point: 'stage-window', zoom: 1.6 },
        caption: 'Closed the stage window? Press [[Stage window]] again, pick it again in Teams, and press {{F}} in it.',
        boo: { say: 'Hey! Who turned off the lights?', act: 'jump', mood: 'startled' },
      },
      { hold: 2200, console: { click: true }, stage: true, boo: { say: 'Phew.', act: 'float', mood: 'happy' } },
      {
        hold: 3600,
        console: { point: '', zoom: 1 },
        toast: 'reload',
        caption: 'Reloaded the console? Open the room link again in the same browser: you’re still the presenter, right where you were.',
      },
      {
        hold: 1300,
        toast: '',
        console: { point: 'presenter-link', zoom: 1.5 },
        caption: 'Another laptop? Under [[Fix]], [[Presenter tools]] → [[Copy presenter link]]. Keep it private: it shows the answers.',
      },
      { hold: 2600, console: { click: true }, toast: 'Presenter link copied — open it on your other device' },
      {
        hold: 3600,
        toast: '',
        console: { point: '', zoom: 1 },
        caption: 'That’s everything. You’re ready to run the show!',
        boo: { say: 'You’re ready. Break a leg! I don’t have any, so you’ll have to.', act: 'wave', mood: 'bye' },
      },
    ],
  },
];

/** The answers on the mock console's sheet for the round on the board (the presenter's own view). */
export function sheetRound(board: ShowdownBoardView | null): DemoRound {
  return DEMO_ROUNDS[board && board.round === 1 ? 1 : 0];
}
