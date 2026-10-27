/**
 * The Presenter Tour's script: ten chapters that walk the presenter through a DAS-O-Ween Trivia show
 * on the demo stage, in the runbook's order and with the console's own button names
 * (docs/DAS-O-WEEN-RUNBOOK.md).
 *
 * PRACTICE CONTENT ONLY: the boards are the rehearsal preset's candy and costume lists (practice
 * material, not secrets). The real show's answers never appear here — they live on the server, and
 * secrecy.test.ts fails the build if one turns up in web code.
 *
 * Beats marked `cut: 'film'` are Boo's extra bits in the film cut ("Boo's Backstage Tour").
 */
import {
  type ShowdownBoardView,
  type ShowdownEvent,
  type ShowdownFinale,
  type ShowdownSettings,
  type ShowdownStage,
} from '@dascade/shared/games/showdown';
import { EMPTY_SHOW, type DemoClock, type DemoShow } from './demoSource.ts';
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

/** The show's settings once the DAS-O-Ween 2026 preset is loaded (as the preset sets them). */
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
  audience: false,
  teamNames: ['', ''],
  minutes: 10,
  stageClock: true,
  display: 'auto',
};

/** Before the preset: a new room's defaults. */
export const DEMO_SETTINGS_BEFORE: ShowdownSettings = { ...DEMO_SETTINGS, title: '', eventName: '', mode: 'showcase' };

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

const show = (patch: Partial<DemoShow>): DemoShow => ({ ...EMPTY_SHOW, ...patch });

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
        caption: 'Phones are optional: anyone can cheer along with the room code. Guesses go in the meeting chat.',
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
        caption: 'In the lobby, under [[Settings]] → [[Event presets]], press [[Load]] next to [[DAS-O-Ween 2026]].',
        boo: { say: 'First, the preset: both boards, the clock and my favourite look.', act: 'point', mood: 'happy' },
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
        caption: 'While people arrive, put up the [[Welcome]] card under [[Stage cards]].',
      },
      {
        hold: 3600,
        console: { click: true },
        show: { card: 'welcome' },
        boo: { say: 'Welcome, boils and ghouls!', act: 'float', mood: 'happy' },
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
        hold: 1300,
        console: { screen: 'console', point: 'next-step', key: 'Q', zoom: 1.5 },
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
    id: 'special',
    title: 'Number 5',
    film: 'Number five!',
    setup: show({ phase: 'PLAYING', board: board(0, 'live', [0, 1, 2]), clock: clock(8 * MIN + 20_000) }),
    screen: 'console',
    stage: true,
    preset: true,
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
        hold: 1300,
        console: { point: 'tab-sound', zoom: 1.5 },
        caption: 'Want it again? Open [[Sound]] in the drawer…',
      },
      { hold: 1300, console: { click: true, drawer: 'sound' } },
      {
        hold: 1300,
        console: { point: 'celebrate', key: 'C', zoom: 1.6 },
        caption: '…and [[Celebrate!]] (or {{C}}) replays it any time.',
      },
      { hold: 4600, console: { click: true, key: 'C' }, cue: 'celebrate', boo: { say: 'Again! Again!', act: 'spin', mood: 'celebrate' } },
    ],
  },
  {
    id: 'clock',
    title: 'Clock & reveal',
    film: 'Tick, tock',
    setup: show({ phase: 'PLAYING', board: board(0, 'live', [0, 1, 2, 4]), clock: clock(3 * MIN + 10_000) }),
    screen: 'console',
    stage: true,
    preset: true,
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
        hold: 3600,
        console: { point: '', zoom: 1 },
        show: { sweep: false },
        events: [ev.sweep(false)],
        caption: 'Bright tiles: found by the crowd. Darker tiles: revealed at the end.',
      },
    ],
  },
  {
    id: 'next-round',
    title: 'Next round',
    film: 'Round two!',
    setup: show({ phase: 'PLAYING', board: board(0, 'done', [0, 1, 2, 4], [9, 8, 7, 6, 5, 3], [R1_RESULT]), clock: clock(-30_000, false) }),
    screen: 'console',
    stage: true,
    preset: true,
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
      { hold: 1450, chat: { who: 'Grace', text: 'WITCH' }, console: { point: 'answer-1', click: true, key: '1' }, ...reveal(1, 0, [0]) },
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
    id: 'finish',
    title: 'Finish & cards',
    film: 'That’s a wrap!',
    setup: show({
      phase: 'PLAYING',
      board: board(1, 'done', [0, 1, 3], [9, 8, 7, 6, 5, 4, 2], [R1_RESULT, R2_RESULT]),
      clock: clock(-60_000, false),
    }),
    screen: 'console',
    stage: true,
    preset: true,
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
        show: { phase: 'RESULTS', finale: FINALE, sweep: false },
        caption: '“That’s a wrap!” Boo says goodbye to a round of applause.',
        boo: { say: 'That’s a wrap, boils and ghouls!', act: 'wave', mood: 'bye' },
      },
      {
        hold: 1300,
        console: { point: 'card-break', zoom: 1.3 },
        caption: 'Stage cards work any time: [[Be right back]] for the cartoon…',
      },
      {
        hold: 2600,
        console: { click: true },
        show: { card: 'break' },
        boo: { say: 'Cartoon break! I’ll get the popcorn.', act: 'float', mood: 'think' },
      },
      { hold: 1000, console: { point: 'card-prizes' }, caption: '…[[Prize time]] for the winners…' },
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
        console: { point: 'tab-fix', zoom: 1.5 },
        caption: 'Bigger slip? Open [[Fix]] in the drawer.',
        boo: { say: 'Oops-proof. I like it.', act: 'float', mood: 'happy' },
      },
      { hold: 1200, console: { click: true, drawer: 'fix' } },
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
        hold: 1300,
        undo: '',
        stage: false,
        console: { point: 'stage-window', zoom: 1.6 },
        caption: 'Closed the stage window? Press [[Stage window]] again, then pick it again in Teams.',
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
