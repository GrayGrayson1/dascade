/**
 * One hand of no-limit Texas Hold'em as a deterministic state machine.
 *
 *   startHand → (betting ⇄ street-complete → dealNextStreet)* → showdown → resolveShowdown → complete
 *                      └── everyone else folds ─────────────────────────────────────────→ complete
 *
 * The server drives the pauses between stages (animations) and owns the clock;
 * everything that decides chips and cards lives here. The undealt deck and hole
 * cards are part of this server-side state and must never be synchronized.
 */
import { formatChips, shuffleInPlace, type Rng } from '@dascade/shared';
import { cardToCode, createDeck, type CardCode } from '../cards/index.ts';
import { evaluateBest, kickerNote, type EvaluatedHand } from './evaluator.ts';
import { buildPots, clockwiseFromButton, payouts, settlePots, type Pot, type PotAward } from './pots.ts';
import { blindSeats, nextSeat } from './table.ts';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type HandStage = 'betting' | 'street-complete' | 'showdown' | 'complete';
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';
export type LastAction = '' | 'sb' | 'bb' | ActionType;
export type RevealPolicy = 'all' | 'winners';

export interface HandPlayer {
  seat: number;
  id: string;
  name: string;
  /** Chips behind. */
  stack: number;
  /** Chips put in on the current street. */
  bet: number;
  /** Chips put in during the whole hand. */
  committed: number;
  folded: boolean;
  allIn: boolean;
  /** Has acted since betting was last (re)opened on this street. Posting a blind is not acting. */
  acted: boolean;
  /** The street's bet level right after this player's last action (short all-in reopen rule). */
  actedAt: number;
  hole: CardCode[];
  lastAction: LastAction;
  lastAmount: number;
  /** Stack at the start of the hand (before blinds). */
  startStack: number;
}

export interface LogLine {
  kind: 'hand' | 'blind' | 'action' | 'street' | 'show' | 'win' | 'info';
  text: string;
}

export interface ShownHand {
  seat: number;
  cards: CardCode[];
  hand: EvaluatedHand;
}

export interface WinnerLine {
  seat: number;
  potIndex: number;
  amount: number;
  /** '' for uncontested pots. */
  description: string;
  bestCards: CardCode[];
}

export interface HandResult {
  uncontested: boolean;
  awards: PotAward[];
  /** Net chips pushed to each seat (sum of its pot shares). */
  payouts: Array<{ seat: number; amount: number }>;
  /** Hands tabled at showdown, in showing order. */
  shown: ShownHand[];
  /** Live seats that did not have to show. */
  mucked: number[];
  winners: WinnerLine[];
}

export interface HandState {
  handNumber: number;
  tableSize: number;
  button: number;
  sbSeat: number;
  bbSeat: number;
  smallBlind: number;
  bigBlind: number;
  /** Everyone dealt in, ascending by seat. */
  players: HandPlayer[];
  /** Undealt cards, top first. SERVER ONLY. */
  deck: CardCode[];
  burned: CardCode[];
  board: CardCode[];
  street: Street;
  stage: HandStage;
  /** Seat to act, -1 when nobody. */
  toAct: number;
  /** Highest total bet on this street (preflop at least the big blind, even if the big blind was short). */
  currentBet: number;
  /** Size of the last full bet or raise on this street: the minimum raise increment. */
  minRaise: number;
  /** Last seat to bet or raise on this street (shows first at showdown). */
  lastAggressor: number;
  /** Betting is closed with 2+ live hands and at most one player able to bet: hands are tabled, the board runs out. */
  runout: boolean;
  /** Accepted actions so far. */
  actionCount: number;
  log: LogLine[];
  result: HandResult | null;
}

export interface HandConfig {
  handNumber: number;
  tableSize: number;
  button: number;
  smallBlind: number;
  bigBlind: number;
  players: ReadonlyArray<{ seat: number; id: string; name: string; stack: number }>;
  /** Exact deck order (top first) for tests. Otherwise a freshly shuffled 52-card deck. */
  deck?: CardCode[];
}

export interface LegalActions {
  seat: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** Chips a call puts in (capped at the stack: a short call is all-in). */
  callAmount: number;
  canRaise: boolean;
  /** Nothing bet yet on this street: the raise is a "bet". */
  isBet: boolean;
  /** Smallest legal total to bet/raise to (equals maxRaiseTo when only an all-in is possible). */
  minRaiseTo: number;
  /** Largest legal total (all-in). */
  maxRaiseTo: number;
}

export type ActionErrorCode = 'not_your_turn' | 'illegal_action' | 'bad_amount' | 'insufficient_chips';

export type ActionResult =
  | { ok: true; action: LastAction; amount: number }
  | { ok: false; code: ActionErrorCode; message: string };

export interface PlayerAction {
  type: ActionType;
  /** bet/raise: the street total to bet to. */
  amount?: number;
}

const fmt = formatChips;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function playerAt(h: HandState, seat: number): HandPlayer | undefined {
  return h.players.find((p) => p.seat === seat);
}

export function livePlayers(h: HandState): HandPlayer[] {
  return h.players.filter((p) => !p.folded);
}

function seatsOf(h: HandState): number[] {
  return h.players.map((p) => p.seat);
}

/** Whether a player still owes a decision on this street. */
export function needsToAct(h: HandState, p: HandPlayer): boolean {
  if (p.folded || p.allIn) return false;
  const others = h.players.filter((o) => o !== p && !o.folded);
  if (others.length === 0) return false;
  const othersCanAct = others.some((o) => !o.allIn);
  if (!othersCanAct) {
    // Nobody left to bet against: only a shortfall against the all-in players needs settling.
    return p.bet < Math.max(...others.map((o) => o.bet));
  }
  return !p.acted || p.bet < h.currentBet;
}

/** First seat, clockwise starting AT `from`, that needs to act; -1 if none. */
function findToAct(h: HandState, from: number): number {
  const seats = seatsOf(h);
  for (let step = 0; step < h.tableSize; step++) {
    const seat = (from + step) % h.tableSize;
    if (!seats.includes(seat)) continue;
    const p = playerAt(h, seat)!;
    if (needsToAct(h, p)) return seat;
  }
  return -1;
}

/** Legal actions for `seat` right now (null when it is not that seat's turn). */
export function legalActions(h: HandState, seat: number): LegalActions | null {
  if (h.stage !== 'betting' || h.toAct !== seat) return null;
  const p = playerAt(h, seat);
  if (!p || p.folded || p.allIn) return null;
  return computeLegal(h, p);
}

function computeLegal(h: HandState, p: HandPlayer): LegalActions {
  const others = h.players.filter((o) => o !== p && !o.folded);
  const othersCanAct = others.some((o) => !o.allIn);
  const maxOther = Math.max(0, ...others.map((o) => o.bet));
  // With every opponent all-in, matching the biggest all-in is all that can be asked.
  const target = othersCanAct ? h.currentBet : Math.min(h.currentBet, maxOther);
  const toCall = Math.max(0, target - p.bet);
  const maxTo = p.bet + p.stack;
  // A short all-in raise does not reopen the betting for someone who already acted,
  // unless the raises since their last action add up to a full raise.
  const reopened = !p.acted || h.currentBet - p.actedAt >= h.minRaise;
  const canRaise = othersCanAct && reopened && maxTo > h.currentBet && p.stack > toCall;
  const fullMin = h.currentBet + h.minRaise;
  return {
    seat: p.seat,
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    callAmount: Math.min(toCall, p.stack),
    canRaise,
    isBet: h.currentBet === 0,
    minRaiseTo: canRaise ? Math.min(fullMin, maxTo) : 0,
    maxRaiseTo: canRaise ? maxTo : 0,
  };
}

/** Chips in the middle that are already collected (bets on the current street excluded). */
export function collectedPots(h: HandState): Pot[] {
  return buildPots(h.players.map((p) => ({ seat: p.seat, amount: p.committed - p.bet, folded: p.folded })));
}

/** Every chip committed this hand (collected pots + current bets). */
export function totalPot(h: HandState): number {
  return h.players.reduce((s, p) => s + p.committed, 0);
}

/** Seats whose cards are face up for everyone right now (all-in runout / showdown). */
export function exposedSeats(h: HandState): number[] {
  if (h.result) return h.result.shown.map((s) => s.seat);
  if (h.runout) return livePlayers(h).map((p) => p.seat);
  return [];
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Posts blinds, deals two cards to everyone and sets the first player to act. */
export function startHand(cfg: HandConfig, rng: Rng): HandState {
  const players = [...cfg.players].sort((a, b) => a.seat - b.seat);
  if (players.length < 2) throw new Error('A hand needs at least two players');
  if (players.length > cfg.tableSize) throw new Error('More players than seats');
  const seen = new Set<number>();
  for (const p of players) {
    if (p.seat < 0 || p.seat >= cfg.tableSize || seen.has(p.seat)) throw new Error(`Bad seat ${p.seat}`);
    if (!Number.isInteger(p.stack) || p.stack <= 0) throw new Error(`Seat ${p.seat} has no chips`);
    seen.add(p.seat);
  }
  if (!seen.has(cfg.button)) throw new Error('The button must be on a dealt seat');
  if (!Number.isInteger(cfg.smallBlind) || !Number.isInteger(cfg.bigBlind) || cfg.smallBlind < 0 || cfg.bigBlind < 1) {
    throw new Error('Bad blinds');
  }

  const deck = cfg.deck ? [...cfg.deck] : shuffleInPlace(createDeck().map(cardToCode), rng);
  const seats = players.map((p) => p.seat);
  const { sb, bb } = blindSeats(cfg.button, seats, cfg.tableSize);
  const h: HandState = {
    handNumber: cfg.handNumber,
    tableSize: cfg.tableSize,
    button: cfg.button,
    sbSeat: sb,
    bbSeat: bb,
    smallBlind: cfg.smallBlind,
    bigBlind: cfg.bigBlind,
    players: players.map((p) => ({
      seat: p.seat,
      id: p.id,
      name: p.name,
      stack: p.stack,
      bet: 0,
      committed: 0,
      folded: false,
      allIn: false,
      acted: false,
      actedAt: 0,
      hole: [],
      lastAction: '',
      lastAmount: 0,
      startStack: p.stack,
    })),
    deck,
    burned: [],
    board: [],
    street: 'preflop',
    stage: 'betting',
    toAct: -1,
    currentBet: 0,
    minRaise: cfg.bigBlind,
    lastAggressor: -1,
    runout: false,
    actionCount: 0,
    log: [],
    result: null,
  };

  h.log.push({ kind: 'hand', text: `Hand #${h.handNumber} · blinds ${fmt(h.smallBlind)}/${fmt(h.bigBlind)} · ${playerAt(h, h.button)!.name} has the button` });
  postBlind(h, playerAt(h, sb)!, h.smallBlind, 'sb');
  postBlind(h, playerAt(h, bb)!, h.bigBlind, 'bb');
  // Callers owe the full big blind even when the big blind itself is short.
  h.currentBet = h.bigBlind;
  h.minRaise = h.bigBlind;

  // Two rounds, one card at a time, starting left of the button.
  const order = clockwiseFromButton(seats, h.button, h.tableSize);
  for (let round = 0; round < 2; round++) {
    for (const seat of order) playerAt(h, seat)!.hole.push(draw(h));
  }

  // Preflop the first action is left of the big blind (heads-up: the button/small blind).
  const first = seats.length === 2 ? h.button : nextSeat(bb, seats, h.tableSize);
  const toAct = findToAct(h, first);
  if (toAct >= 0) h.toAct = toAct;
  else closeBettingRound(h);
  return h;
}

function draw(h: HandState): CardCode {
  const card = h.deck.shift();
  if (!card) throw new Error('Deck exhausted');
  return card;
}

function postBlind(h: HandState, p: HandPlayer, amount: number, kind: 'sb' | 'bb'): void {
  const pay = Math.min(amount, p.stack);
  put(p, pay);
  p.lastAction = kind;
  p.lastAmount = pay;
  const label = kind === 'sb' ? 'small blind' : 'big blind';
  h.log.push({ kind: 'blind', text: `${p.name} posts ${label} ${fmt(pay)}${p.allIn ? ' and is all-in' : ''}` });
}

function put(p: HandPlayer, amount: number): void {
  if (amount < 0 || amount > p.stack) throw new Error('Chip accounting error');
  p.stack -= amount;
  p.bet += amount;
  p.committed += amount;
  if (p.stack === 0) p.allIn = true;
}

/** Applies a betting action for `seat`. Illegal actions change nothing. */
export function applyAction(h: HandState, seat: number, action: PlayerAction): ActionResult {
  if (h.stage !== 'betting' || h.toAct !== seat) return fail('not_your_turn', 'It is not your turn.');
  const p = playerAt(h, seat)!;
  const legal = computeLegal(h, p);
  let recorded: LastAction;
  let amount = 0;

  switch (action.type) {
    case 'fold': {
      p.folded = true;
      recorded = 'fold';
      h.log.push({ kind: 'action', text: `${p.name} folds` });
      break;
    }
    case 'check': {
      if (!legal.canCheck) return fail('illegal_action', `You can't check — it's ${fmt(legal.callAmount)} to call.`);
      recorded = 'check';
      h.log.push({ kind: 'action', text: `${p.name} checks` });
      break;
    }
    case 'call': {
      if (!legal.canCall) return fail('illegal_action', 'There is no bet to call — check instead.');
      amount = legal.callAmount;
      put(p, amount);
      recorded = p.allIn ? 'allin' : 'call';
      h.log.push({ kind: 'action', text: `${p.name} calls ${fmt(amount)}${p.allIn ? ' and is all-in' : ''}` });
      break;
    }
    case 'bet':
    case 'raise': {
      if (!legal.canRaise) return fail('illegal_action', legal.canCall ? 'You can only call or fold here.' : 'You can only check or fold here.');
      if (action.type === 'bet' && !legal.isBet) return fail('illegal_action', 'There is already a bet — raise instead.');
      if (action.type === 'raise' && legal.isBet) return fail('illegal_action', 'Nothing has been bet yet — bet instead.');
      const to = action.amount;
      if (to === undefined || !Number.isInteger(to)) return fail('bad_amount', 'Choose a whole-chip amount.');
      if (to > legal.maxRaiseTo) return fail('insufficient_chips', `You only have ${fmt(legal.maxRaiseTo)} in total.`);
      if (to < legal.minRaiseTo) {
        return fail('bad_amount', `The minimum ${legal.isBet ? 'bet' : 'raise'} is to ${fmt(legal.minRaiseTo)}.`);
      }
      amount = to;
      recorded = raiseTo(h, p, to, legal.isBet);
      break;
    }
    case 'allin': {
      const to = p.bet + p.stack;
      if (legal.canRaise) {
        amount = to;
        recorded = raiseTo(h, p, to, legal.isBet);
      } else if (legal.canCall && p.stack <= legal.callAmount) {
        amount = p.stack;
        put(p, amount);
        recorded = 'allin';
        h.log.push({ kind: 'action', text: `${p.name} calls ${fmt(amount)} and is all-in` });
      } else {
        return fail('illegal_action', legal.canCall ? 'You can only call or fold here.' : 'You can only check or fold here.');
      }
      break;
    }
    default:
      return fail('illegal_action', 'Unknown action.');
  }

  p.acted = true;
  p.actedAt = h.currentBet;
  p.lastAction = recorded;
  p.lastAmount = recorded === 'fold' || recorded === 'check' ? 0 : p.bet;
  h.actionCount++;
  advanceAfterAction(h, seat);
  return { ok: true, action: recorded, amount };
}

function fail(code: ActionErrorCode, message: string): ActionResult {
  return { ok: false, code, message };
}

function raiseTo(h: HandState, p: HandPlayer, to: number, isBet: boolean): LastAction {
  const size = to - h.currentBet;
  put(p, to - p.bet);
  if (size >= h.minRaise) {
    // A full bet/raise sets the next minimum increment and reopens the action for everyone.
    h.minRaise = size;
    for (const o of h.players) if (o !== p && !o.folded && !o.allIn) o.acted = false;
  }
  h.currentBet = Math.max(h.currentBet, to);
  h.lastAggressor = p.seat;
  const verb = isBet ? 'bets' : 'raises to';
  h.log.push({ kind: 'action', text: `${p.name} ${verb} ${fmt(to)}${p.allIn ? ' and is all-in' : ''}` });
  return p.allIn ? 'allin' : isBet ? 'bet' : 'raise';
}

function advanceAfterAction(h: HandState, seat: number): void {
  if (livePlayers(h).length === 1) {
    finishUncontested(h);
    return;
  }
  const next = findToAct(h, (seat + 1) % h.tableSize);
  if (next >= 0) h.toAct = next;
  else closeBettingRound(h);
}

/** Gives back the part of the largest bet nobody matched. */
function returnUncalled(h: HandState): void {
  const sorted = [...h.players].sort((a, b) => b.committed - a.committed);
  const top = sorted[0];
  const second = sorted[1]?.committed ?? 0;
  if (!top || top.folded || top.committed <= second) return;
  const refund = Math.min(top.committed - second, top.bet);
  if (refund <= 0) return;
  top.stack += refund;
  top.bet -= refund;
  top.committed -= refund;
  if (top.stack > 0) {
    top.allIn = false;
    // A shove that was only partly called is, in effect, a bet/raise of the matched amount.
    if (top.lastAction === 'allin') top.lastAction = h.street === 'preflop' ? 'raise' : 'bet';
  }
  if (top.lastAmount > top.bet) top.lastAmount = top.bet;
  h.log.push({ kind: 'info', text: `Uncalled ${fmt(refund)} returned to ${top.name}` });
}

function closeBettingRound(h: HandState): void {
  h.toAct = -1;
  returnUncalled(h);
  const live = livePlayers(h);
  if (live.length === 1) {
    finishUncontested(h);
    return;
  }
  // Nobody (or only one player) can still bet: all-in, the hands are tabled and the board runs out.
  if (live.filter((p) => !p.allIn).length < 2) h.runout = true;
  for (const p of h.players) p.bet = 0;
  h.stage = h.street === 'river' ? 'showdown' : 'street-complete';
}

/** Burns and deals the next street, then opens its betting (or keeps running out the board). */
export function dealNextStreet(h: HandState): CardCode[] {
  if (h.stage !== 'street-complete') throw new Error(`Cannot deal the next street during ${h.stage}`);
  h.burned.push(draw(h));
  const count = h.street === 'preflop' ? 3 : 1;
  const cards: CardCode[] = [];
  for (let i = 0; i < count; i++) cards.push(draw(h));
  h.board.push(...cards);
  h.street = h.street === 'preflop' ? 'flop' : h.street === 'flop' ? 'turn' : 'river';
  h.currentBet = 0;
  h.minRaise = h.bigBlind;
  h.lastAggressor = -1;
  for (const p of h.players) {
    p.bet = 0;
    p.acted = false;
    p.actedAt = 0;
    if (!p.folded && !p.allIn) {
      p.lastAction = '';
      p.lastAmount = 0;
    }
  }
  const label = h.street === 'flop' ? 'Flop' : h.street === 'turn' ? 'Turn' : 'River';
  h.log.push({ kind: 'street', text: `${label}: ${h.board.join(' ')}` });
  const first = findToAct(h, (h.button + 1) % h.tableSize);
  if (first >= 0) {
    h.stage = 'betting';
    h.toAct = first;
  } else {
    h.stage = h.street === 'river' ? 'showdown' : 'street-complete';
    h.toAct = -1;
    h.runout = livePlayers(h).length >= 2;
  }
  return cards;
}

function finishUncontested(h: HandState): void {
  h.toAct = -1;
  returnUncalled(h);
  const winner = livePlayers(h)[0]!;
  const total = totalPot(h);
  winner.stack += total;
  for (const p of h.players) p.bet = 0;
  const award: PotAward = { potIndex: 0, amount: total, eligible: [winner.seat], winners: [winner.seat], shares: [{ seat: winner.seat, amount: total }] };
  h.result = {
    uncontested: true,
    awards: [award],
    payouts: [{ seat: winner.seat, amount: total }],
    shown: [],
    mucked: [],
    winners: [{ seat: winner.seat, potIndex: 0, amount: total, description: '', bestCards: [] }],
  };
  h.runout = false;
  h.stage = 'complete';
  h.log.push({ kind: 'win', text: `${winner.name} wins ${fmt(total)} uncontested` });
}

/** Evaluates every live hand, awards the main pot and side pots and tables hands per the reveal policy. */
export function resolveShowdown(h: HandState, policy: RevealPolicy = 'all'): HandResult {
  if (h.stage !== 'showdown') throw new Error(`Cannot resolve a showdown during ${h.stage}`);
  if (h.board.length !== 5) throw new Error('Showdown needs a full board');
  const live = livePlayers(h);
  const evals = new Map<number, EvaluatedHand>();
  for (const p of live) evals.set(p.seat, evaluateBest([...p.hole, ...h.board]));
  const pots = buildPots(h.players.map((p) => ({ seat: p.seat, amount: p.committed, folded: p.folded })));
  const scores = new Map([...evals].map(([seat, e]) => [seat, e.score]));
  const awards = settlePots(pots, scores, h.button, h.tableSize);
  const paid = payouts(awards);
  for (const [seat, amount] of paid) playerAt(h, seat)!.stack += amount;

  const winnerSeats = new Set(awards.flatMap((a) => a.winners));
  // Showing order: the river's last aggressor, else first live seat left of the button.
  const start = h.lastAggressor >= 0 && evals.has(h.lastAggressor) ? h.lastAggressor : nextSeat(h.button, [...evals.keys()], h.tableSize);
  const order = clockwiseFromButton([...evals.keys()], (start - 1 + h.tableSize) % h.tableSize, h.tableSize);
  // TDA 16: once a player is all-in and the betting is over, every live hand is tabled (side-pot bettors too).
  const allInShowdown = h.runout || live.some((p) => p.allIn);
  const mustShow = (seat: number) => allInShowdown || policy === 'all' || winnerSeats.has(seat);
  const shown: ShownHand[] = [];
  const mucked: number[] = [];
  for (const seat of order) {
    const p = playerAt(h, seat)!;
    if (mustShow(seat)) {
      shown.push({ seat, cards: [...p.hole], hand: evals.get(seat)! });
      h.log.push({ kind: 'show', text: `${p.name} shows ${p.hole.join(' ')} — ${evals.get(seat)!.description}` });
    } else {
      mucked.push(seat);
      h.log.push({ kind: 'show', text: `${p.name} mucks` });
    }
  }

  const winners: WinnerLine[] = [];
  awards.forEach((award, i) => {
    const potName = awards.length === 1 ? 'the pot' : i === 0 ? 'the main pot' : `side pot ${i}`;
    const contenders = award.eligible.filter((s) => evals.has(s));
    const losers = contenders.filter((s) => !award.winners.includes(s)).sort((a, b) => evals.get(b)!.score - evals.get(a)!.score);
    const bestLoser = losers.length ? evals.get(losers[0]!)! : null;
    for (const share of award.shares) {
      const hand = evals.get(share.seat)!;
      const kicker = bestLoser ? kickerNote(hand, bestLoser) : null;
      const description = kicker ? `${hand.description} (${kicker})` : hand.description;
      winners.push({ seat: share.seat, potIndex: award.potIndex, amount: share.amount, description, bestCards: [...hand.cards] });
    }
    const names = award.shares.map((s) => playerAt(h, s.seat)!.name);
    const verb = award.shares.length > 1 ? `split ${fmt(award.amount)}` : `wins ${fmt(award.amount)}`;
    const how = evals.get(award.winners[0]!)!.description;
    h.log.push({ kind: 'win', text: `${names.join(' & ')} ${verb} from ${potName} with ${how}` });
  });

  h.result = {
    uncontested: false,
    awards,
    payouts: [...paid].map(([seat, amount]) => ({ seat, amount })),
    shown,
    mucked,
    winners,
  };
  h.stage = 'complete';
  return h.result;
}

/**
 * Folds a seat out of turn (the player left the table or was removed). Their
 * chips already in the pot stay there as dead money. Works in any stage.
 */
export function forceFold(h: HandState, seat: number): boolean {
  const p = playerAt(h, seat);
  if (!p || p.folded || h.stage === 'complete') return false;
  if (h.stage === 'betting' && h.toAct === seat) {
    return applyAction(h, seat, { type: 'fold' }).ok;
  }
  p.folded = true;
  p.lastAction = 'fold';
  p.lastAmount = 0;
  h.log.push({ kind: 'action', text: `${p.name} folds (left the table)` });
  if (livePlayers(h).length === 1) {
    finishUncontested(h);
    return true;
  }
  if (h.stage === 'betting') {
    const next = findToAct(h, h.toAct);
    if (next >= 0) h.toAct = next;
    else closeBettingRound(h);
  }
  return true;
}

/**
 * Cancels an unfinished hand (host ended the game): every chip committed this
 * hand goes back to the player who put it in.
 */
export function cancelHand(h: HandState): void {
  if (h.stage === 'complete') return;
  for (const p of h.players) {
    p.stack += p.committed;
    p.committed = 0;
    p.bet = 0;
  }
  h.toAct = -1;
  h.stage = 'complete';
  h.result = { uncontested: true, awards: [], payouts: [], shown: [], mucked: [], winners: [] };
  h.log.push({ kind: 'info', text: `Hand #${h.handNumber} cancelled — all bets returned` });
}

/** Sum of every stack plus everything committed: constant for the whole hand (chip conservation). */
export function chipsInPlay(h: HandState): number {
  return h.players.reduce((s, p) => s + p.stack + (h.stage === 'complete' ? 0 : p.committed), 0);
}
