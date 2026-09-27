/**
 * DASception — authoritative social-deduction room (built on the DAStravaganza party kit).
 *
 * Stage flow (all inside PLAYING; the match ends in RESULTS):
 *   boot (private role cards) → night "Blackout" (secret actions) → dawn (public system log)
 *   → day (timed discussion, "ready to vote") → vote (private until reveal) → [runoff]
 *   → verdict (reveal + disconnect) → win check → night …                         → final
 *
 * Secrets: the DeceptionGame instance (roles, picks, votes, intel) lives only in server memory.
 * Each participant receives their own `deception:private` payload (re-sent by syncPrivate on
 * reconnect); living Glitches additionally receive the team channel. Public state carries only
 * alive/fate, *whether* someone read their card / is ready / voted (kit seats — never during the
 * night), and roles that have been revealed. Spectators receive nothing private.
 *
 * Chat while a match is live:
 *   - Night: public chat is offline ("blackout"); living Glitches talk in their team channel.
 *   - Offline (eliminated) players and spectators talk in a ghost channel that living players
 *     never receive.
 *
 * Host controls (kit): pause/resume any stage; skip only boot, dawn, day and verdict (never the
 * night or a vote, which would cut someone's secret action or ballot short).
 */
import { RATE, cleanText, maskProfanity, randomId, type ChatMessage, type CreateOptions } from '@dascade/shared';
import {
  DECEPTION_GHOST_PREFIX,
  DECEPTION_LIMITS,
  DECEPTION_MSG,
  DECEPTION_ROLE_INFO,
  DEFAULT_DECEPTION_SETTINGS,
  DeceptionActSchema,
  DeceptionReadySchema,
  DeceptionSettingsSchema,
  DeceptionTeamSaySchema,
  DeceptionVoteSchema,
  planSetup,
  roleTeam,
  type DeceptionActPayload,
  type DeceptionDawnReport,
  type DeceptionEvent,
  type DeceptionLogEntry,
  type DeceptionPrivate,
  type DeceptionSettings,
  type DeceptionStage,
  type DeceptionTeamLine,
  type DeceptionTeamLog,
  type DeceptionVerdict,
  type DeceptionVotePayload,
} from '@dascade/shared/games/deception';
import { DeceptionGame, type DeceptionWin } from '@dascade/game-core/deception';
import type { PlayerRecord, RemovalReason } from '../BaseGameRoom.ts';
import { PartyRoom, type PartyCollector } from '../party/index.ts';
import { DeceptionNodeState, DeceptionState } from './schema.ts';

type Tracked = 'boot' | 'day' | 'vote';

export class DeceptionRoom extends PartyRoom<DeceptionState, DeceptionSettings> {
  readonly gameId = 'deception' as const;
  protected readonly settingsSchema = DeceptionSettingsSchema;
  /** Beat between the last ready/vote and the stage change (lets the UI show the lock-in). */
  protected override allAnsweredDelayMs = 1_200;
  /** Late joiners spectate until the next match (catalog: lateJoinAsPlayer false). */
  protected override lateJoinersCanAnswer = false;
  protected override skippableStages: readonly string[] = ['boot', 'dawn', 'day', 'verdict'];

  // Stage lengths (ms). Integration tests shorten these.
  protected bootMs = 20_000;
  protected dawnMs = 8_000;
  protected verdictMs = 8_000;
  /** The night never ends earlier than this, so a fast night can't hint at who acted. */
  protected nightFloorMs = 8_000;
  protected nightMs(): number {
    return this.getSettings().nightSeconds * 1000;
  }
  protected dayMs(): number {
    return this.getSettings().discussionSeconds * 1000;
  }
  protected voteMs(): number {
    return this.getSettings().voteSeconds * 1000;
  }

  private game: DeceptionGame | null = null;
  private matchNo = 0;
  private nightStartedAt = 0;
  private log: DeceptionLogEntry[] = [];
  private teamLog: DeceptionTeamLine[] = [];
  /** Participant names captured at deal time (players who leave keep their name in the recap). */
  private names = new Map<string, string>();
  /** Winner decided by the last night/vote/leaver, applied when the current reveal ends. */
  private pendingWin: DeceptionWin | null = null;

  protected defaultSettings(): DeceptionSettings {
    return structuredClone(DEFAULT_DECEPTION_SETTINGS);
  }

  protected createState(): DeceptionState {
    return new DeceptionState();
  }

  private get dstage(): DeceptionStage {
    return this.state.stage as DeceptionStage;
  }

  // ===========================================================================
  // Messages
  // ===========================================================================

  protected override onRoomCreated(options: CreateOptions): void {
    super.onRoomCreated(options);
    this.handle(DECEPTION_MSG.ready, DeceptionReadySchema, (p, { ready }) => this.onReady(p, ready), {
      phases: ['PLAYING'],
      playersOnly: true,
    });
    this.handle(DECEPTION_MSG.act, DeceptionActSchema, (p, payload) => this.onAct(p, payload), {
      phases: ['PLAYING'],
      playersOnly: true,
    });
    this.handle(DECEPTION_MSG.vote, DeceptionVoteSchema, (p, payload) => this.onVote(p, payload), {
      phases: ['PLAYING'],
      playersOnly: true,
    });
    this.handle(DECEPTION_MSG.teamSay, DeceptionTeamSaySchema, (p, { text }) => this.onTeamSay(p, text), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: RATE.chat,
    });
  }

  private onReady(player: PlayerRecord, ready: boolean): void {
    const game = this.game;
    if (!game || !game.has(player.id)) return this.reject(player, DECEPTION_MSG.ready, 'not_allowed', 'You are not playing in this match.');
    if (this.dstage === 'boot') {
      this.markAnswered(player.id, true);
      this.checkAllAnswered();
      return;
    }
    if (this.dstage === 'day') {
      if (!game.isAlive(player.id))
        return this.reject(player, DECEPTION_MSG.ready, 'not_allowed', 'You are offline — you can no longer vote.');
      this.markAnswered(player.id, ready);
      this.checkAllAnswered();
      return;
    }
    this.reject(player, DECEPTION_MSG.ready, 'wrong_phase', 'That is not available right now.');
  }

  private onAct(player: PlayerRecord, { kind, target, lock }: DeceptionActPayload): void {
    const game = this.game;
    if (!game || this.dstage !== 'night')
      return this.reject(player, DECEPTION_MSG.act, 'wrong_phase', 'Night actions are only possible during the blackout.');
    const res = game.submitAction(player.id, kind, target, Boolean(lock));
    if (!res.ok) {
      this.reject(player, DECEPTION_MSG.act, res.code === 'wrong_phase' ? 'wrong_phase' : 'not_allowed', res.message);
      this.pushPrivate(player);
      return;
    }
    // Attack picks are a team decision: every Glitch sees the team's picks update live.
    if (kind === 'attack') this.forGlitches((p) => this.pushPrivate(p));
    else this.pushPrivate(player);
    if (lock) this.maybeEndNight();
  }

  private onVote(player: PlayerRecord, { target, sudo }: DeceptionVotePayload): void {
    const game = this.game;
    if (!game || (this.dstage !== 'vote' && this.dstage !== 'runoff')) {
      return this.reject(player, DECEPTION_MSG.vote, 'wrong_phase', 'Voting is closed.');
    }
    const res = game.castVote(player.id, target, { sudo, allowSkip: this.getSettings().allowSkip });
    if (!res.ok) return this.reject(player, DECEPTION_MSG.vote, res.code === 'wrong_phase' ? 'wrong_phase' : 'not_allowed', res.message);
    this.markAnswered(player.id, true);
    this.pushPrivate(player);
    this.checkAllAnswered();
  }

  private onTeamSay(player: PlayerRecord, raw: string): void {
    const game = this.game;
    if (!game || !game.isGlitch(player.id) || !game.isAlive(player.id)) {
      return this.reject(player, DECEPTION_MSG.teamSay, 'not_allowed', 'Only online Glitches can use the team channel.');
    }
    if (this.dstage !== 'night')
      return this.reject(player, DECEPTION_MSG.teamSay, 'wrong_phase', 'The Glitch channel only opens at night.');
    const text = maskProfanity(cleanText(raw, DECEPTION_LIMITS.teamChatChars));
    if (!text) return;
    this.teamLog.push({ id: randomId(10), playerId: player.id, name: player.state.name, text, ts: Date.now(), cycle: game.cycle });
    if (this.teamLog.length > DECEPTION_LIMITS.teamChatLines) this.teamLog.splice(0, this.teamLog.length - DECEPTION_LIMITS.teamChatLines);
    this.forGlitches((p) => this.pushTeamLog(p));
  }

  // ===========================================================================
  // Chat channels
  // ===========================================================================

  /** Mid-match kicks could let a host on the Glitch team remove Sysops to reach parity. */
  protected override kickBlocker(target: PlayerRecord): string | null {
    const inMatch = this.phase === 'COUNTDOWN' || this.phase === 'PLAYING' || this.phase === 'INTERMISSION';
    if (inMatch && !target.state.spectator) return 'Players can’t be removed during a DASception match — timers keep the game moving.';
    return null;
  }

  protected override interceptChat(player: PlayerRecord, text: string): boolean {
    const game = this.game;
    if (this.phase !== 'PLAYING' || !game) return false;
    if (this.isGhost(player)) {
      const line: ChatMessage = {
        id: `${DECEPTION_GHOST_PREFIX}${randomId(10)}`,
        playerId: player.id,
        name: player.state.name,
        color: player.state.color,
        text: maskProfanity(text),
        ts: Date.now(),
        kind: 'chat',
      };
      this.pushChat(line, (r) => this.isGhost(r));
      return true;
    }
    if (this.dstage === 'night') {
      const text = game.isGlitch(player.id)
        ? 'Blackout: public comms are offline. Use the Glitch channel to talk to your team.'
        : 'Blackout: public comms are offline until dawn.';
      this.pushChat(
        { id: randomId(10), playerId: null, name: 'DASception', text, ts: Date.now(), kind: 'system' },
        (r) => r.id === player.id,
      );
      return true;
    }
    return false;
  }

  /** Spectators and offline participants (the ghost channel audience) while a match is live. */
  private isGhost(p: PlayerRecord): boolean {
    if (p.state.spectator) return true;
    return Boolean(this.game?.has(p.id) && !this.game.isAlive(p.id));
  }

  // ===========================================================================
  // Match flow
  // ===========================================================================

  private participants(): PlayerRecord[] {
    return this.seatedPlayers().filter((p) => !p.away);
  }

  protected override validateStart(): string | null {
    const res = planSetup(this.participants().length, this.getSettings());
    return res.ok ? null : res.error;
  }

  protected onGameStart(): void {
    const roster = this.participants();
    const plan = planSetup(roster.length, this.getSettings());
    if (!plan.ok) {
      this.toast('all', 'warning', plan.error);
      this.returnToLobby();
      return;
    }
    this.startParty({ totalRounds: 0 });
    this.matchNo++;
    this.game = DeceptionGame.deal(
      roster.map((p) => p.id),
      plan.setup,
      this.rng,
    );
    this.log = [];
    this.teamLog = [];
    this.pendingWin = null;
    this.names = new Map(roster.map((p) => [p.id, p.state.name]));
    const s = this.state;
    s.match = this.matchNo;
    s.nodes.clear();
    roster.forEach((p, seat) => {
      const node = new DeceptionNodeState();
      node.seat = seat;
      node.name = p.state.name;
      node.avatar = p.state.avatar;
      node.color = p.state.color;
      s.nodes.set(p.id, node);
    });
    s.setupJson = JSON.stringify(plan.setup);
    s.dawnJson = '';
    s.verdictJson = '';
    s.runoffJson = '[]';
    s.logJson = '[]';
    s.winner = '';
    s.finalJson = '';
    s.cycle = 0;
    this.track(
      this.tracker(
        'boot',
        roster.map((p) => p.id),
      ),
      roster.map((p) => p.id),
    );
    this.runStage('boot', this.bootMs, () => this.startNight());
    this.emit({ type: 'boot' });
    this.pushAllPrivate();
    this.forGlitches((p) => this.pushTeamLog(p));
    this.systemChat('Roles are dealt. Check your role card — and keep it secret!');
  }

  /**
   * "Everyone is done" tracker for the kit (drives `seats[id].answered` counts + early stage end).
   * Boot/day completion = the kit's answered flags; votes = the engine's ballots.
   */
  private tracker(kind: Tracked, eligible: readonly string[]): PartyCollector {
    const pending = (present?: Iterable<string>) => {
      const here = new Set(present ?? this.presentIds());
      return eligible.filter((id) => {
        if (!here.has(id)) return false;
        if (kind === 'vote') return Boolean(this.game?.isAlive(id)) && !this.game?.hasVoted(id);
        if (kind === 'day' && !this.game?.isAlive(id)) return false;
        return !this.state.seats.get(id)?.answered;
      });
    };
    const open = () => {
      const stage = this.dstage;
      return kind === 'vote' ? stage === 'vote' || stage === 'runoff' : stage === kind;
    };
    return {
      get isOpen() {
        return open();
      },
      isComplete: (present) => pending(present).length === 0,
      pending,
    };
  }

  private isOnline(id: string): boolean {
    const p = this.players.get(id);
    return Boolean(p && p.client && !p.away);
  }

  // --- night -----------------------------------------------------------------

  private startNight(): void {
    const game = this.game;
    if (!game) return;
    game.beginNight();
    this.state.cycle = game.cycle;
    this.state.round = game.cycle;
    this.state.statusText = `Night ${game.cycle}`;
    // Nothing public is tracked at night: clear every seat flag (who acts would reveal roles).
    this.track(this.tracker('boot', []), []);
    this.untrack();
    this.nightStartedAt = Date.now();
    this.runStage('night', this.nightMs(), () => this.endNight());
    this.emit({ type: 'night', cycle: game.cycle });
    this.pushAllPrivate();
    this.maybeEndNight();
  }

  /** End the night early once every online actor locked in — never before the floor. */
  private maybeEndNight(): void {
    const game = this.game;
    if (this.dstage !== 'night' || !game || !this.stagePending) return;
    if (!game.nightDone((id) => this.isOnline(id))) return;
    const floor = Math.max(0, this.nightStartedAt + this.nightFloorMs - Date.now());
    this.endStageSoon(Math.max(floor, this.allAnsweredDelayMs));
  }

  private endNight(): void {
    const game = this.game;
    if (!game || this.dstage !== 'night') return;
    const out = game.resolveNight(this.rng);
    const reveal = this.getSettings().revealRoles;
    const report: DeceptionDawnReport = out.corrupted
      ? { cycle: game.cycle, outcome: 'corrupted', playerId: out.corrupted, role: reveal ? (game.roleOf(out.corrupted) ?? '') : '' }
      : { cycle: game.cycle, outcome: out.blocked ? 'blocked' : 'quiet' };
    if (out.corrupted) this.syncNode(out.corrupted);
    this.state.dawnJson = JSON.stringify(report);
    this.pushLog({ kind: 'dawn', ...report });
    this.state.statusText = `Dawn ${game.cycle}`;
    this.pendingWin = game.winner();
    this.runStage('dawn', this.dawnMs, () => (this.pendingWin ? this.finish(this.pendingWin) : this.startDay()));
    this.emit({ type: 'dawn', cycle: game.cycle, outcome: report.outcome, playerId: report.playerId });
    this.pushAllPrivate();
    if (out.corrupted) {
      const name = this.nameOf(out.corrupted);
      this.systemChat(
        report.role
          ? `${name} was corrupted in the night. They were a ${DECEPTION_ROLE_INFO[report.role].name}.`
          : `${name} was corrupted in the night.`,
      );
    } else if (out.blocked) {
      this.systemChat('The Glitches struck in the night — but a Firewall shield held!');
    } else {
      this.systemChat('A quiet night. Nobody was corrupted.');
    }
  }

  // --- day -------------------------------------------------------------------

  private startDay(): void {
    const game = this.game;
    if (!game) return;
    this.state.statusText = `Day ${game.cycle}`;
    const living = game.alive();
    this.track(this.tracker('day', living), living);
    this.runStage('day', this.dayMs(), () => this.startVote(false));
    this.emit({ type: 'day', cycle: game.cycle });
  }

  // --- vote ------------------------------------------------------------------

  private startVote(runoff: boolean): void {
    const game = this.game;
    if (!game) return;
    game.beginVote(runoff ? game.runoff : null);
    this.state.runoffJson = JSON.stringify(runoff ? game.voteCandidates() : []);
    this.state.statusText = runoff ? `Runoff ${game.cycle}` : `Vote ${game.cycle}`;
    const living = game.alive();
    this.track(this.tracker('vote', living), living);
    this.runStage(runoff ? 'runoff' : 'vote', this.voteMs(), () => this.endVote());
    this.emit({ type: 'vote', cycle: game.cycle, runoff });
    this.pushAllPrivate();
    this.checkAllAnswered();
  }

  private endVote(): void {
    const game = this.game;
    if (!game || (this.dstage !== 'vote' && this.dstage !== 'runoff')) return;
    this.untrack();
    const settings = this.getSettings();
    const runoff = this.dstage === 'runoff';
    const out = game.resolveVote({ allowSkip: settings.allowSkip, tieRule: settings.tieRule });
    const verdict: DeceptionVerdict = {
      cycle: game.cycle,
      runoff,
      mode: settings.voteReveal,
      votes: settings.voteReveal === 'full' ? out.lines : [],
      tally: out.tally,
      sudo: out.sudo,
      outcome: out.outcome,
      abstained: out.abstained,
    };
    if (out.playerId) {
      verdict.playerId = out.playerId;
      verdict.role = settings.revealRoles ? (game.roleOf(out.playerId) ?? '') : '';
      this.syncNode(out.playerId);
    }
    if (out.tied) verdict.tied = out.tied;
    this.state.verdictJson = JSON.stringify(verdict);
    if (out.outcome !== 'runoff') {
      this.pushLog({ kind: 'verdict', cycle: game.cycle, outcome: out.outcome, playerId: out.playerId, role: verdict.role, runoff });
    }
    this.pendingWin = game.winner();
    this.runStage('verdict', this.verdictMs, () => this.afterVerdict());
    this.emit({ type: 'verdict', cycle: game.cycle, outcome: out.outcome, playerId: out.playerId });
    this.pushAllPrivate();
    this.systemChat(this.verdictLine(verdict));
  }

  private verdictLine(v: DeceptionVerdict): string {
    switch (v.outcome) {
      case 'disconnected': {
        const name = this.nameOf(v.playerId ?? '');
        return v.role
          ? `The network disconnected ${name}. They were a ${DECEPTION_ROLE_INFO[v.role].name}.`
          : `The network disconnected ${name}.`;
      }
      case 'runoff':
        return `Tie! Runoff vote between ${(v.tied ?? []).map((id) => this.nameOf(id)).join(' and ')}.`;
      case 'tie':
        return 'The vote tied — nobody was disconnected.';
      case 'skipped':
        return 'The network voted to skip. Nobody was disconnected.';
      default:
        return 'Nobody voted. Nobody was disconnected.';
    }
  }

  private afterVerdict(): void {
    const game = this.game;
    if (!game) return;
    if (this.pendingWin) return this.finish(this.pendingWin);
    if (game.runoff) return this.startVote(true);
    if (game.cycle >= DECEPTION_LIMITS.maxCycles) {
      this.systemChat('The audit ran out of time — the Glitches survived!');
      return this.finish({ team: 'glitches', reason: 'timeout' });
    }
    this.startNight();
  }

  // --- end -------------------------------------------------------------------

  private finish(win: DeceptionWin): void {
    const game = this.game;
    if (!game || this.phase !== 'PLAYING' || this.dstage === 'final') return;
    this.cancelStage();
    this.untrack();
    this.pendingWin = null;
    const report = game.finalReport(win, this.names);
    const s = this.state;
    for (const row of report.roles) {
      const node = s.nodes.get(row.playerId);
      if (node) node.role = row.role;
      const p = this.players.get(row.playerId);
      if (p) p.state.score = row.score;
    }
    s.stage = 'final';
    s.stageSeq = (s.stageSeq + 1) >>> 0;
    s.stageMs = 0;
    s.winner = win.team;
    s.finalJson = JSON.stringify(report);
    s.statusText = win.team === 'sysops' ? 'Sysops win' : 'Glitches win';
    this.emit({ type: 'final', winner: win.team });
    // Team result: every member of the winning team shares first place (winning team first).
    const winners = report.roles.filter((r) => roleTeam(r.role) === win.team);
    const losers = report.roles.filter((r) => roleTeam(r.role) !== win.team);
    this.reportOutcome({
      placements: [winners.map((r) => r.playerId), losers.map((r) => r.playerId)],
      scores: Object.fromEntries(report.roles.map((r) => [r.playerId, r.score])),
      reason: win.reason,
      details: { winner: win.team, cycles: game.cycle, roles: Object.fromEntries(report.roles.map((r) => [r.playerId, r.role])) },
    });
    this.endMatch({
      players: report.roles.map((r) => {
        const p = this.players.get(r.playerId);
        return {
          playerId: r.playerId,
          name: r.name,
          guestId: p?.guestId,
          userId: p?.userId,
          score: r.score,
          placement: roleTeam(r.role) === win.team ? 1 : 2,
        };
      }),
      details: { winner: win.team, reason: win.reason, cycles: game.cycle },
    });
    this.systemChat(
      win.team === 'sysops' ? 'Every Glitch is disconnected. The Sysops secured the network!' : 'The Glitches took over the network!',
    );
    this.pushAllPrivate();
  }

  // ===========================================================================
  // Player lifecycle
  // ===========================================================================

  // Disconnects, lost connections and leavers never end the night early: if the night ended the
  // moment someone dropped, everyone would learn that they were the last actor still choosing (a
  // Glitch or a special role). Offline actors are simply skipped when the last online actor locks
  // in (maybeEndNight ignores them) or when the night timer runs out — so the room never stalls.

  /** No pausing at night: a host on the Glitch team could buy their private channel extra time. */
  protected override pauseStage(): boolean {
    if (this.dstage === 'night') {
      const host = this.hostRecord;
      if (host) this.toast(host, 'info', 'The night can’t be paused — pause during the discussion instead.');
      return false;
    }
    return super.pauseStage();
  }

  protected override resumeStage(): boolean {
    const resumed = super.resumeStage();
    if (resumed) {
      this.checkAllAnswered();
      this.maybeEndNight();
    }
    return resumed;
  }

  /**
   * A participant left for good (or was kicked): they go offline with fate 'left'.
   * The engine update runs BEFORE the kit's bookkeeping so the kit's "everyone done?" check sees the
   * new roster. Votes for the leaver are void, but their voters keep their public "voted" flag (and
   * still count as done): flipping it back would tell everyone who voted for the leaver. Only the
   * voters themselves learn, privately, that they may vote again.
   */
  protected override onPlayerRemoved(player: PlayerRecord, reason: RemovalReason): void {
    const game = this.game;
    const live = game && game.has(player.id) && this.phase === 'PLAYING' && this.dstage !== 'final';
    const voided = live && game.isVoting ? game.alive().filter((id) => id !== player.id && game.voteOf(id)?.target === player.id) : [];
    if (live && game.eliminate(player.id, 'left')) {
      const role = this.getSettings().revealRoles ? (game.roleOf(player.id) ?? '') : '';
      this.syncNode(player.id);
      this.pushLog({ kind: 'left', cycle: game.cycle, playerId: player.id, role });
      this.emit({ type: 'left', playerId: player.id });
      this.systemChat(
        role
          ? `${player.state.name} left the network. They were a ${DECEPTION_ROLE_INFO[role].name}.`
          : `${player.state.name} left the network.`,
      );
      this.pushAllPrivate();
      for (const id of voided) {
        const voter = this.players.get(id);
        if (voter) this.toast(voter, 'info', `${player.state.name} left — your vote no longer counts. You can vote again.`);
      }
      const win = game.winner();
      if (win) {
        // Mid-reveal the winner is applied when the reveal ends; otherwise end right away.
        if (this.dstage === 'dawn' || this.dstage === 'verdict') this.pendingWin = win;
        else this.finish(win);
      }
    }
    super.onPlayerRemoved(player, reason);
  }

  protected override onReturnToLobby(): void {
    super.onReturnToLobby();
    this.game = null;
    this.log = [];
    this.teamLog = [];
    this.pendingWin = null;
    const s = this.state;
    s.cycle = 0;
    s.nodes.clear();
    s.setupJson = '';
    s.dawnJson = '';
    s.verdictJson = '';
    s.runoffJson = '[]';
    s.logJson = '[]';
    s.winner = '';
    s.finalJson = '';
  }

  // ===========================================================================
  // Private sync
  // ===========================================================================

  protected override syncPrivate(player: PlayerRecord): void {
    super.syncPrivate(player);
    this.pushPrivate(player);
    this.pushTeamLog(player);
  }

  /** Everything this player may currently know, or null (spectators / not dealt in). */
  private privateFor(player: PlayerRecord): DeceptionPrivate | null {
    const game = this.game;
    if (!game || player.state.spectator || !game.has(player.id)) return null;
    const role = game.roleOf(player.id);
    if (!role) return null;
    const team = roleTeam(role);
    const alive = game.isAlive(player.id);
    const night = game.isNight && this.dstage === 'night';
    return {
      match: this.matchNo,
      role,
      team,
      alive,
      allies: team === 'glitches' ? game.glitchRoster() : [],
      picks: alive && night ? game.picksOf(player.id) : {},
      teamPicks: team === 'glitches' && alive && night ? game.teamPicks() : [],
      lastShield: role === 'firewall' ? game.lastShieldOf(player.id) : null,
      sudoUsed: role === 'sudo' ? game.sudoUsed(player.id) : false,
      vote: game.isVoting ? game.voteOf(player.id) : null,
      intel: game.intelOf(player.id),
    };
  }

  private pushPrivate(player: PlayerRecord): void {
    const payload = this.privateFor(player);
    if (payload) this.sendTo(player, DECEPTION_MSG.private, payload);
  }

  private pushAllPrivate(): void {
    for (const p of this.players.values()) this.pushPrivate(p);
  }

  private pushTeamLog(player: PlayerRecord): void {
    const game = this.game;
    if (!game || !game.isGlitch(player.id) || player.state.spectator) return;
    // Offline Glitches become ghosts: no more team lines for them.
    const payload: DeceptionTeamLog = { match: this.matchNo, lines: game.isAlive(player.id) ? [...this.teamLog] : [] };
    this.sendTo(player, DECEPTION_MSG.team, payload);
  }

  /** Run `fn` for every Glitch participant in the room. */
  private forGlitches(fn: (p: PlayerRecord) => void): void {
    const game = this.game;
    if (!game) return;
    for (const p of this.players.values()) if (game.isGlitch(p.id) && !p.state.spectator) fn(p);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private syncNode(id: string): void {
    const node = this.state.nodes.get(id);
    const seat = this.game?.seats.get(id);
    if (!node || !seat) return;
    node.alive = seat.alive;
    node.fate = seat.fate;
    node.outCycle = seat.outCycle;
    if (!seat.alive && this.getSettings().revealRoles) node.role = seat.role;
    this.markAnswered(id, false);
    const kitSeat = this.state.seats.get(id);
    if (kitSeat && !seat.alive) kitSeat.eligible = false;
    this.refreshAnswerCounts();
  }

  private pushLog(entry: DeceptionLogEntry): void {
    this.log.push(entry);
    if (this.log.length > DECEPTION_LIMITS.log) this.log.splice(0, this.log.length - DECEPTION_LIMITS.log);
    this.state.logJson = JSON.stringify(this.log);
  }

  private nameOf(id: string): string {
    return this.players.get(id)?.state.name ?? this.names.get(id) ?? 'A player';
  }

  private emit(event: DeceptionEvent): void {
    this.broadcast(DECEPTION_MSG.event, event);
  }
}
