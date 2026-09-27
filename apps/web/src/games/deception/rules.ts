/**
 * DASception rules reference (shown in the kit's RulesDrawer) and the per-stage coach lines
 * that tell a first-timer exactly what to do right now and what happens next.
 */
import {
  DECEPTION_ROLE_INFO,
  DECEPTION_TEAM_INFO,
  type DeceptionPrivate,
  type DeceptionRole,
  type DeceptionSettings,
  type DeceptionSetup,
  type DeceptionStage,
} from '@dascade/shared/games/deception';
import type { RulesSection } from '../_party/index.ts';

export const STAGE_LABEL: Record<DeceptionStage, { kicker: string; title: string }> = {
  idle: { kicker: 'Lobby', title: 'Waiting' },
  boot: { kicker: 'Boot sequence', title: 'Your role' },
  night: { kicker: 'Night', title: 'Blackout' },
  dawn: { kicker: 'Dawn', title: 'System log' },
  day: { kicker: 'Day', title: 'Discussion' },
  vote: { kicker: 'Vote', title: 'Disconnect vote' },
  runoff: { kicker: 'Runoff', title: 'Tiebreak vote' },
  verdict: { kicker: 'Verdict', title: 'The network decides' },
  final: { kicker: 'Game over', title: 'Results' },
};

/** Rules section highlighted for each stage. */
export const STAGE_SECTION: Partial<Record<DeceptionStage, string>> = {
  boot: 'Your role',
  night: 'Night · Blackout',
  dawn: 'Dawn · System log',
  day: 'Day · Discussion',
  vote: 'Vote · Disconnect',
  runoff: 'Vote · Disconnect',
  verdict: 'Vote · Disconnect',
};

export const NEXT_STAGE: Partial<Record<DeceptionStage, string>> = {
  boot: 'Next: the first night falls.',
  night: 'Next: dawn reveals what happened.',
  dawn: 'Next: open discussion.',
  day: 'Next: the disconnect vote.',
  vote: 'Next: the votes are revealed.',
  runoff: 'Next: the runoff is revealed.',
  verdict: 'Next: night falls again — unless a team has won.',
};

export function rolesInPlay(setup: DeceptionSetup | null): DeceptionRole[] {
  if (!setup) return [];
  return (Object.keys(setup.counts) as DeceptionRole[]).filter((r) => setup.counts[r] > 0);
}

export function buildRules(me: DeceptionPrivate | null, setup: DeceptionSetup | null, settings: DeceptionSettings): RulesSection[] {
  const sections: RulesSection[] = [];
  if (me?.role) {
    const info = DECEPTION_ROLE_INFO[me.role];
    const items = [
      `You are a ${info.name} (${DECEPTION_TEAM_INFO[info.team].name}). ${info.rule}`,
      info.tip,
      `Goal: ${DECEPTION_TEAM_INFO[info.team].goal}`,
    ];
    if (!me.alive)
      items.push('You are offline: you can watch and talk with other offline players and spectators, but you can no longer act or vote.');
    sections.push({ title: 'Your role', icon: 'user', items });
  } else {
    sections.push({
      title: 'Your role',
      icon: 'eye',
      items: ['You are watching this match. Roles are revealed to everyone when it ends.'],
    });
  }
  sections.push({
    title: 'Goal',
    icon: 'trophy',
    items: [
      `Sysops: ${DECEPTION_TEAM_INFO.sysops.goal}`,
      `Glitches: ${DECEPTION_TEAM_INFO.glitches.goal} The Glitches know each other; the Sysops don't.`,
    ],
  });
  sections.push({
    title: 'Night · Blackout',
    icon: 'eye',
    items: [
      'The Glitches secretly pick one player to corrupt (they see each other’s picks and chat in their own channel).',
      'Special roles use their ability in secret. Everyone else lies low — tap players to keep private notes.',
      'Public chat is offline at night. Nobody can see who is acting.',
    ],
  });
  sections.push({
    title: 'Dawn · System log',
    icon: 'info',
    items: [
      `The log shows who was corrupted${settings.revealRoles ? ' and their role' : ''} — or that a Firewall shield blocked the attack.`,
      'Abilities report back privately (scan results, clues, shields).',
    ],
  });
  sections.push({
    title: 'Day · Discussion',
    icon: 'chat',
    items: [
      'Talk it out: share what you know — or bluff. Anyone can claim any role.',
      'Tap “Ready to vote” when you are done. The vote starts when everyone is ready or time runs out.',
    ],
  });
  const tie =
    settings.tieRule === 'runoff'
      ? 'A tie between players goes to one runoff vote; if the runoff ties too, nobody is disconnected.'
      : 'A tie means nobody is disconnected.';
  sections.push({
    title: 'Vote · Disconnect',
    icon: 'flag',
    items: [
      'Votes are secret until everyone has voted (or time is up), then revealed together. You can’t change a vote.',
      settings.allowSkip
        ? 'The player with the most votes is disconnected — unless Skip has as many votes or more.'
        : 'The player with the most votes is disconnected.',
      tie,
      'No vote in time = abstain (counts for nothing).',
      settings.voteReveal === 'full' ? 'The reveal shows who voted for whom.' : 'The reveal shows only the totals.',
    ],
  });
  const roles = rolesInPlay(setup);
  if (roles.length) {
    sections.push({
      title: 'Roles in this game',
      icon: 'users',
      items: roles.map(
        (r) =>
          `${DECEPTION_ROLE_INFO[r].name}${setup && setup.counts[r] > 1 ? ` ×${setup.counts[r]}` : ''} — ${DECEPTION_ROLE_INFO[r].rule}`,
      ),
    });
  }
  sections.push({
    title: 'Offline players',
    icon: 'wifi-off',
    items: [
      'Corrupted, disconnected and departed players go offline: they keep watching, but can’t act, vote, or talk to online players.',
      'Offline players and spectators share their own ghost chat.',
      settings.revealRoles ? 'An offline player’s role is revealed.' : 'Roles stay hidden until the end of the game.',
    ],
  });
  return sections;
}

/** What to do right now (one line) for this viewer. */
export function coachLine(stage: DeceptionStage, me: DeceptionPrivate | null, spectator: boolean): string {
  if (spectator || !me) {
    if (stage === 'night') return 'The network is dark. Watch the story unfold — roles are revealed at the end.';
    return 'You are spectating. Chat with other spectators and offline players below.';
  }
  if (!me.alive) return 'You are offline. Watch, and chat with other offline players and spectators.';
  switch (stage) {
    case 'boot':
      return me.team === 'glitches'
        ? 'Memorise your role and your fellow Glitches, then tap “Got it”. Keep your screen private!'
        : 'Memorise your role, then tap “Got it”. Keep your screen private!';
    case 'night':
      switch (me.role) {
        case 'glitch':
          return 'Pick the player your team will corrupt, then lock it in. Agree with your fellow Glitches in the team channel.';
        case 'jammer':
          return 'Pick who to corrupt with your team, and who to jam tonight. Lock in both.';
        case 'scanner':
          return 'Tap a player to scan them, then lock it in. You’ll learn at dawn whether they are a Glitch.';
        case 'firewall':
          return 'Tap a player to shield tonight (you can pick yourself), then lock it in.';
        case 'tracer':
          return 'Your clue arrives automatically at dawn. Meanwhile, tap players to mark your suspicions.';
        case 'sudo':
          return 'No night ability — your double vote is for the day. Tap players to mark your suspicions.';
        default:
          return 'You have no night ability. Tap players to mark who you suspect (only you can see this).';
      }
    case 'dawn':
      return 'Read the system log — who was hit, and what did your ability reveal?';
    case 'day':
      return 'Discuss who might be a Glitch. Tap “Ready to vote” when you’re done talking.';
    case 'vote':
      return 'Tap the player you want to disconnect, then confirm — or skip.';
    case 'runoff':
      return 'Tiebreak: vote for one of the tied players, then confirm.';
    case 'verdict':
      return 'The votes are in.';
    default:
      return '';
  }
}
