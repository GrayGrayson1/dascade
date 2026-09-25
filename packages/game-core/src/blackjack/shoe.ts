/**
 * The dealing shoe: 1–8 decks, a cut card at the configured penetration, a
 * discard tray, and an emergency reshuffle of the discards if a round ever
 * drains the shoe. Server-side only: the order of the shoe is secret.
 */
import { shuffleInPlace, type Rng } from '@dascade/shared';
import { cardToCode, createShoe, parseCard, type Card, type CardCode } from '../cards/index.ts';

export class Shoe {
  readonly decks: number;
  /** Fraction of the shoe dealt before the cut card comes out. */
  readonly penetration: number;
  private cards: Card[] = [];
  private pos = 0;
  private cutIndex = 0;
  private discardTray: Card[] = [];
  private onTable: Card[] = [];
  private emergency = false;
  /** Completed shuffles (including the initial one). */
  shuffles = 0;

  constructor(
    decks: number,
    penetrationPercent: number,
    private readonly rng: Rng,
  ) {
    if (!Number.isInteger(decks) || decks < 1 || decks > 8) throw new RangeError(`decks must be 1–8, got ${decks}`);
    this.decks = decks;
    this.penetration = Math.min(0.95, Math.max(0.25, penetrationPercent / 100));
    this.shuffle();
  }

  /** Fresh shuffle of every card (call between rounds only). */
  shuffle(): void {
    this.cards = shuffleInPlace(createShoe(this.decks), this.rng);
    this.pos = 0;
    this.cutIndex = Math.floor(this.cards.length * this.penetration);
    this.discardTray = [];
    this.onTable = [];
    this.emergency = false;
    this.shuffles++;
  }

  get size(): number {
    return this.decks * 52;
  }

  get remaining(): number {
    return this.cards.length - this.pos;
  }

  /** Cards left in the shoe at the moment the cut card comes out. */
  get cutRemaining(): number {
    return Math.max(0, this.cards.length - this.cutIndex);
  }

  get discards(): number {
    return this.discardTray.length;
  }

  /** The cut card has come out (or the shoe ran dry): reshuffle before the next round. */
  get needsShuffle(): boolean {
    return this.emergency || this.pos >= this.cutIndex;
  }

  draw(): Card {
    if (this.pos >= this.cards.length) this.refillFromDiscards();
    const card = this.cards[this.pos++]!;
    this.onTable.push(card);
    return card;
  }

  /** Round finished: the cards on the table go to the discard tray. */
  endRound(): void {
    this.discardTray.push(...this.onTable);
    this.onTable = [];
  }

  /**
   * The shoe ran out mid-round: shuffle the discard tray (never the cards on the
   * table) into a new shoe and force a full reshuffle once the round ends.
   */
  private refillFromDiscards(): void {
    const pool = this.discardTray.length > 0 ? this.discardTray : createShoe(this.decks);
    this.cards = shuffleInPlace(pool.slice(), this.rng);
    this.discardTray = [];
    this.pos = 0;
    this.cutIndex = this.cards.length;
    this.emergency = true;
  }

  /**
   * TEST SUPPORT ONLY (the server enables it only outside production): arrange the
   * next cards to be dealt. Matching cards are moved up from deeper in the shoe so
   * the composition is unchanged; a card that is no longer in the shoe is substituted.
   */
  stackTop(codes: readonly CardCode[]): void {
    codes.forEach((code, i) => {
      const want = parseCard(code);
      const at = this.pos + i;
      if (at >= this.cards.length) {
        this.cards.push(want);
        return;
      }
      let found = -1;
      for (let j = at; j < this.cards.length; j++) {
        const c = this.cards[j]!;
        if (c.rank === want.rank && c.suit === want.suit) {
          found = j;
          break;
        }
      }
      if (found >= 0) {
        const tmp = this.cards[at]!;
        this.cards[at] = this.cards[found]!;
        this.cards[found] = tmp;
      } else {
        this.cards[at] = want;
      }
    });
  }

  /** TEST SUPPORT ONLY: peek at upcoming cards. */
  peekCodes(n: number): CardCode[] {
    return this.cards.slice(this.pos, this.pos + n).map(cardToCode);
  }
}
