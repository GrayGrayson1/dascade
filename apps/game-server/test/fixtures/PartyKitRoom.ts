/**
 * Minimal party game used to integration-test the party kit (registered as "partykit" in
 * test/party-kit.test.ts; borrows the 'trivia' catalog entry for capacity).
 *
 * Flow per round: 'answer' stage (players send kit:answer) → 'reveal' (10 points per answer) → …
 * Round 2 is a vote round (kit:vote on the answers' authors) when settings.vote is on.
 */
import { t, type SchemaType } from '@colyseus/schema';
import { z } from 'zod';
import type { AnswerBox, VoteBox } from '@dascade/game-core/party';
import { PartyRoom, PartyRoomState } from '../../src/rooms/party/index.ts';

export const PartyKitState = PartyRoomState.extend({ prompt: t.uint16().default(0) }, 'PartyKitState');
export type PartyKitState = SchemaType<typeof PartyKitState>;

const SettingsSchema = z.object({
  rounds: z.number().int().min(1).max(5),
  teams: z.number().int().min(0).max(6),
  answerMs: z.number().int().min(50).max(60_000),
  allowChange: z.boolean(),
});
type Settings = z.infer<typeof SettingsSchema>;

export class PartyKitRoom extends PartyRoom<PartyKitState, Settings> {
  readonly gameId = 'trivia' as const;
  protected readonly settingsSchema = SettingsSchema;
  override countdownMs = 0;
  override allAnsweredDelayMs = 30;
  revealMs = 150;
  box: AnswerBox<string> | null = null;
  vote: VoteBox | null = null;

  protected defaultSettings(): Settings {
    return { rounds: 2, teams: 0, answerMs: 4000, allowChange: false };
  }
  protected createState(): PartyKitState {
    return new PartyKitState();
  }

  protected override onRoomCreated(options: Parameters<PartyRoom<PartyKitState, Settings>['onRoomCreated']>[0]): void {
    super.onRoomCreated(options);
    this.handle(
      'kit:answer',
      z.object({ seq: z.number().int(), text: z.string().min(1).max(40) }),
      (p, { seq, text }) => {
        if (!this.box || seq !== this.state.prompt) return this.rejectReason(p, 'kit:answer', 'stale');
        if (this.submitAnswer(p, this.box, text, 'kit:answer'))
          this.sendPrivate(p, 'kit:private', { seq, text, locked: this.box.isLocked(p.id) });
      },
      { phases: ['PLAYING'] },
    );
    this.handle(
      'kit:lock',
      z.object({}).optional(),
      (p) => {
        if (this.box) this.lockAnswer(p, this.box, 'kit:lock');
      },
      { phases: ['PLAYING'] },
    );
    this.handle(
      'kit:vote',
      z.object({ choice: z.string().max(64).nullable() }),
      (p, { choice }) => {
        if (this.vote) this.submitVote(p, this.vote, choice, 'kit:vote');
      },
      { phases: ['PLAYING'] },
    );
  }

  protected onGameStart(): void {
    const s = this.getSettings();
    this.startParty({ totalRounds: s.rounds, teams: s.teams >= 2 ? { count: s.teams, scoring: 'sum' } : null });
    this.nextPrompt();
  }

  private nextPrompt(): void {
    const s = this.getSettings();
    if (this.state.round >= s.rounds) {
      this.finishParty({ details: { kit: true } });
      return;
    }
    this.state.round += 1;
    this.state.prompt += 1;
    this.box = this.openAnswers<string>({ allowChange: s.allowChange });
    this.runStage('answer', s.answerMs, () => this.reveal());
  }

  private reveal(): void {
    const box = this.box;
    if (!box) return;
    box.close();
    this.untrack();
    for (const r of box.entries()) this.addPoints(r.playerId, 10);
    this.commitScores();
    this.runStage('reveal', this.revealMs, () => this.nextPrompt());
  }

  /** Test hook: end the match with explicit placements (not reachable from clients). */
  finishWith(placements: string[][]): void {
    this.finishParty({ placements, reason: 'team_win' });
  }

  /** Test hook: open a vote over the current seats (not reachable from clients). */
  openTestVote(): void {
    const ids = this.seatedPlayers().map((p) => p.id);
    this.vote = this.openVote({ options: ids, ownerOf: (o) => o });
  }
}
