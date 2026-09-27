/**
 * DASception game view. One layout for every stage (party kit PartyStage):
 *   top    — stage chip, online/Glitch counters, timer, host controls, rules
 *   main   — stage hero (role reveal / blackout / system log / discussion / vote / verdict),
 *            the network map, and a sticky action dock
 *   side   — role card (hideable), private intel, Glitch channel, chat + timeline
 *   bottom — who has read their card / is ready / has voted (never at night)
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { PlayerView } from '@dascade/shared';
import { Badge, Button, Segmented, Tabs, Toggle, cx } from '@dascade/ui';
import { Icon, type DxIconName } from './Icon.tsx';
import {
  DECEPTION_MSG,
  DECEPTION_ROLE_INFO,
  roleTeam,
  type DeceptionActionKind,
  type DeceptionDawnReport,
  type DeceptionLogEntry,
  type DeceptionPrivate,
  type DeceptionPublicState,
  type DeceptionRole,
  type DeceptionSettings,
  type DeceptionSetup,
  type DeceptionStage,
  type DeceptionVerdict,
} from '@dascade/shared/games/deception';
import { session, useGame } from '../../net/hooks.ts';
import { sfx } from '../../audio/audio.ts';
import {
  AnsweredStrip,
  HostBar,
  PARTY_COMPACT_QUERY,
  PartyStage,
  PartyTopBar,
  PausedBanner,
  RulesDrawer,
  StageTimer,
  parseJson,
  useMediaQuery,
  useTimerTicks,
} from '../_party/index.ts';
import { ROLE_COLOR } from './art.ts';
import { sortedNodes, useDeceptionPrivate, useHiddenRole, useSuspicion, useTeamLog, type NodeEntry } from './hooks.ts';
import { Network, type NodeDecor } from './Network.tsx';
import { RoleCard, RoleEmblem } from './RoleCard.tsx';
import { DawnReport, VerdictReveal } from './Reveal.tsx';
import { DeceptionChat, IntelPanel, TeamChannel, Timeline } from './Intel.tsx';
import { DeceptionResults } from './Results.tsx';
import { NEXT_STAGE, STAGE_LABEL, STAGE_SECTION, buildRules, coachLine } from './rules.ts';
import { useDeceptionSounds } from './sounds.ts';

const STAGE_ICON: Record<DeceptionStage, DxIconName> = {
  idle: 'clock',
  boot: 'user',
  night: 'eye',
  dawn: 'sparkle',
  day: 'chat',
  vote: 'flag',
  runoff: 'flag',
  verdict: 'flag',
  final: 'trophy',
};

const SKIP_LABEL: Partial<Record<DeceptionStage, string>> = {
  boot: 'Start night',
  dawn: 'Continue',
  day: 'Start vote',
  verdict: 'Continue',
};

const ACTION_VERB: Record<DeceptionActionKind, string> = { attack: 'Corrupt', scan: 'Scan', shield: 'Shield', jam: 'Jam' };
const ACTION_LABEL: Record<DeceptionActionKind, string> = { attack: 'Team strike', scan: 'Scan', shield: 'Shield', jam: 'Jam' };
const VOTE_COLOR = '#ff5a5f';

export function DeceptionView() {
  const game = useGame<DeceptionPublicState, DeceptionSettings>();
  const match = game?.state.match ?? 0;
  const me = useDeceptionPrivate(match);
  const teamLines = useTeamLog(match);
  const { tags, cycle: cycleTag } = useSuspicion(game?.state.code ?? '', match);
  const [hidden, setHidden] = useHiddenRole();
  const compact = useMediaQuery(PARTY_COMPACT_QUERY);
  const stage = (game?.state.stage ?? 'idle') as DeceptionStage;
  useDeceptionSounds(me?.team ?? null);
  useTimerTicks(Boolean(me?.alive) && (stage === 'vote' || stage === 'runoff' || stage === 'night'));

  if (!game) return null;
  const { state, phase, settings, playerId, isSpectator } = game;
  if (phase === 'RESULTS' || stage === 'final') return <DeceptionResults state={state} me={me} meId={playerId} />;
  if (phase !== 'PLAYING' || stage === 'idle') return <Booting />;
  // A participant whose private payload hasn't arrived yet (e.g. just reconnected): never flash
  // the spectator view — wait for the role.
  if (!me && playerId && state.nodes?.[playerId]) return <Booting title="Restoring your role…" />;
  return (
    <Live
      state={state}
      settings={settings}
      stage={stage}
      me={me}
      meId={playerId}
      spectator={isSpectator || !me}
      teamLines={teamLines}
      tags={tags}
      onTag={cycleTag}
      hidden={hidden}
      setHidden={setHidden}
      compact={compact}
    />
  );
}

function Booting({ title = 'Booting the network…' }: { title?: string }) {
  return (
    <PartyStage gameId="deception" className="dx-stage" stage="boot">
      <div className="dx-booting" role="status">
        <RoleEmblem role={null} size={72} />
        <p className="dx-booting__title">{title}</p>
        <p className="dc-muted">Roles are about to be dealt. Keep your screen to yourself.</p>
      </div>
    </PartyStage>
  );
}

interface LiveProps {
  state: DeceptionPublicState;
  settings: DeceptionSettings;
  stage: DeceptionStage;
  me: DeceptionPrivate | null;
  meId: string | null;
  spectator: boolean;
  teamLines: ReturnType<typeof useTeamLog>;
  tags: ReturnType<typeof useSuspicion>['tags'];
  onTag: (id: string) => void;
  hidden: boolean;
  setHidden: (v: boolean) => void;
  compact: boolean;
}

function Live({ state, settings, stage, me, meId, spectator, teamLines, tags, onTag, hidden, setHidden, compact }: LiveProps) {
  const nodes = useMemo(() => sortedNodes(state.nodes), [state.nodes]);
  const nodeMap = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  const setup = useMemo(() => parseJson<DeceptionSetup | null>(state.setupJson, null), [state.setupJson]);
  const dawn = useMemo(() => parseJson<DeceptionDawnReport | null>(state.dawnJson, null), [state.dawnJson]);
  const verdict = useMemo(() => parseJson<DeceptionVerdict | null>(state.verdictJson, null), [state.verdictJson]);
  const log = useMemo(() => parseJson<DeceptionLogEntry[]>(state.logJson, []), [state.logJson]);
  const runoff = useMemo(() => new Set(parseJson<string[]>(state.runoffJson, [])), [state.runoffJson]);
  const players = state.players;
  const alive = Boolean(me?.alive);
  const seatDone = (id: string) => Boolean(state.seats?.[id]?.answered);
  const iDone = meId ? seatDone(meId) : false;
  const allies = useMemo(() => new Map((me?.team === 'glitches' ? me.allies : []).map((a) => [a.id, a.role])), [me]);

  // ---- night selection -------------------------------------------------------------------
  const actions: readonly DeceptionActionKind[] = me && alive && stage === 'night' ? DECEPTION_ROLE_INFO[me.role!].actions : [];
  const [activeKind, setActiveKind] = useState<DeceptionActionKind | null>(null);
  const kind: DeceptionActionKind | null = actions.length
    ? activeKind && actions.includes(activeKind)
      ? activeKind
      : (actions.find((k) => !me?.picks[k]?.locked) ?? actions[0] ?? null)
    : null;
  const pickOf = (k: DeceptionActionKind) => me?.picks[k] ?? { target: null, locked: false };
  useEffect(() => setActiveKind(null), [state.cycle, stage]);

  const nightReason = (k: DeceptionActionKind, id: string): string | null => {
    if (!me) return null;
    if ((k === 'attack' || k === 'jam' || k === 'scan') && id === meId) return 'That’s you';
    if ((k === 'jam' || k === 'attack') && allies.has(id)) return 'A fellow Glitch';
    if (k === 'shield' && me.lastShield === id) return 'Shielded last night';
    return null;
  };

  // ---- vote selection --------------------------------------------------------------------
  const voting = stage === 'vote' || stage === 'runoff';
  const [voteTarget, setVoteTarget] = useState<string | null>(null);
  const [useSudo, setUseSudo] = useState(false);
  useEffect(() => {
    setVoteTarget(null);
    setUseSudo(false);
  }, [state.stageSeq]);
  const myVote = voting ? (me?.vote ?? null) : null;
  const voteReason = (id: string): string | null => {
    if (id === meId) return 'You can’t vote for yourself';
    if (stage === 'runoff' && !runoff.has(id)) return 'Not in the runoff';
    return null;
  };

  // ---- network mode ----------------------------------------------------------------------
  let mode: 'select' | 'tag' | 'view' = alive ? 'tag' : 'view';
  let verb: string | undefined;
  let accent: string | undefined;
  if (kind && !pickOf(kind).locked) {
    mode = 'select';
    verb = ACTION_VERB[kind];
    accent = me ? ROLE_COLOR[me.role!] : undefined;
  } else if (voting && alive && !myVote) {
    mode = 'select';
    verb = 'Vote for';
    accent = VOTE_COLOR;
  }
  const selected = mode === 'select' ? (voting ? voteTarget : kind ? pickOf(kind).target : null) : null;

  const pickedBy = useMemo(() => {
    const out = new Map<string, string[]>();
    if (!me || me.team !== 'glitches' || stage !== 'night') return out;
    for (const p of me.teamPicks) if (p.target) out.set(p.target, [...(out.get(p.target) ?? []), nodeMap[p.id]?.name ?? 'Ally']);
    return out;
  }, [me, stage, nodeMap]);

  const votesFor = useMemo(() => {
    const out = new Map<string, { count: number; voters: NodeEntry[]; sudo: boolean }>();
    if (stage !== 'verdict' || !verdict) return out;
    for (const t of verdict.tally) if (t.target !== 'skip') out.set(t.target, { count: t.votes, voters: [], sudo: false });
    for (const v of verdict.votes) {
      if (v.target === 'skip') continue;
      const entry = out.get(v.target);
      const voter = nodeMap[v.voterId];
      if (entry && voter) entry.voters.push(voter);
      if (entry && v.weight > 1) entry.sudo = true;
    }
    return out;
  }, [stage, verdict, nodeMap]);

  const flagLabel = stage === 'boot' ? 'read their role' : stage === 'day' ? 'ready to vote' : voting ? 'voted' : null;
  const decor = (node: NodeEntry): NodeDecor => ({
    flag: flagLabel && node.alive ? { done: seatDone(node.id), label: flagLabel } : null,
    ally: node.id !== meId ? (allies.get(node.id) ?? null) : null,
    pickedBy: pickedBy.get(node.id),
    votes: votesFor.get(node.id) ?? null,
    disabledReason: mode !== 'select' ? null : voting ? voteReason(node.id) : kind ? nightReason(kind, node.id) : null,
    spotlight:
      (stage === 'dawn' && dawn?.playerId === node.id) || (stage === 'verdict' && verdict?.playerId === node.id)
        ? 'victim'
        : (stage === 'runoff' || (stage === 'verdict' && verdict?.outcome === 'runoff')) &&
            (runoff.has(node.id) || verdict?.tied?.includes(node.id))
          ? 'runoff'
          : null,
  });

  const onSelect = (id: string) => {
    sfx('select');
    if (voting) {
      setVoteTarget(id);
      return;
    }
    if (kind) send(DECEPTION_MSG.act, { kind, target: id, lock: false });
  };

  // ---- counters --------------------------------------------------------------------------
  const online = nodes.filter((n) => n.alive).length;
  const glitchesOut = nodes.filter((n) => !n.alive && n.role && roleTeam(n.role as DeceptionRole) === 'glitches').length;
  const glitchTotal = setup?.glitches ?? 0;
  const label = STAGE_LABEL[stage];
  const cycleLabel = stage === 'boot' ? label.kicker : `${label.kicker} ${state.cycle}`;
  const rules = buildRules(me, setup, settings);
  const rulesButton = <RulesDrawer title="How DASception works" sections={rules} highlight={STAGE_SECTION[stage]} compact={compact} />;

  const top = (
    <PartyTopBar
      left={
        <>
          <span className="dx-stagechip" data-stage={stage}>
            <Icon name={STAGE_ICON[stage]} size={14} />
            <span className="dx-stagechip__kicker">{cycleLabel}</span>
            <span className="dx-stagechip__title">{label.title}</span>
          </span>
          <Badge icon="users" className="dx-count dx-count--online" aria-label={`${online} of ${nodes.length} players online`}>
            <span className="dc-num">
              {online}/{nodes.length}
            </span>{' '}
            online
          </Badge>
          {glitchTotal ? (
            <Badge
              color="var(--red)"
              className="dx-count"
              aria-label={
                settings.revealRoles ? `${glitchTotal - glitchesOut} of ${glitchTotal} Glitches left` : `${glitchTotal} Glitches in play`
              }
            >
              <Icon name="skull" size={11} />
              <span className="dc-num">{settings.revealRoles ? `${glitchTotal - glitchesOut}/${glitchTotal}` : glitchTotal}</span>
              <span className="dx-count__label">
                {' '}
                Glitch{glitchTotal === 1 ? '' : 'es'}
                {settings.revealRoles ? ' left' : ''}
              </span>
            </Badge>
          ) : null}
          {compact ? rulesButton : null}
        </>
      }
      timer={<StageTimer size={compact ? 48 : 58} />}
      right={
        <>
          <HostBar skipLabel={SKIP_LABEL[stage] ?? null} compact={compact} />
          {compact ? null : rulesButton}
        </>
      }
    />
  );

  const strip = flagLabel ? (
    <AnsweredStrip
      players={Object.values(players) as PlayerView[]}
      seats={state.seats}
      meId={meId}
      verb={flagLabel}
      max={compact ? 8 : 20}
    />
  ) : null;

  const side = (
    <SidePanel
      stage={stage}
      me={me}
      meId={meId}
      nodeMap={nodeMap}
      teamLines={teamLines}
      log={log}
      spectator={spectator}
      hidden={hidden}
      setHidden={setHidden}
    />
  );

  return (
    <PartyStage gameId="deception" className="dx-stage" stage={stage} top={top} side={side} sideOnCompact bottom={strip}>
      <PausedBanner />
      <div className="dx-scanlines" aria-hidden="true" />
      <Hero
        stage={stage}
        state={state}
        me={me}
        meId={meId}
        spectator={spectator}
        nodeMap={nodeMap}
        dawn={dawn}
        verdict={verdict}
        iDone={iDone}
        hidden={hidden}
        setHidden={setHidden}
      />
      <Network
        nodes={nodes}
        players={players}
        meId={meId}
        hostId={state.hostId}
        mode={mode}
        selected={selected}
        tags={tags}
        decor={decor}
        verb={verb}
        onSelect={onSelect}
        onTag={(id) => {
          sfx('click');
          onTag(id);
        }}
        accent={accent}
        label="Network — players"
        footnote={mode === 'tag' ? 'Tap a player to mark them Suspect or Trusted — only you can see your notes.' : null}
      />
      <Dock
        stage={stage}
        me={me}
        nodeMap={nodeMap}
        actions={actions}
        kind={kind}
        setKind={setActiveKind}
        pickOf={pickOf}
        voteTarget={voteTarget}
        myVote={myVote}
        useSudo={useSudo}
        setUseSudo={setUseSudo}
        allowSkip={settings.allowSkip}
        iDone={iDone}
        teamPicks={me?.teamPicks ?? []}
      />
      {me?.team === 'glitches' && alive && stage === 'night' ? <TeamChannel lines={teamLines} canSend meId={meId} /> : null}
    </PartyStage>
  );
}

// ---------------------------------------------------------------------------------------------
// Hero (stage headline + coach line)
// ---------------------------------------------------------------------------------------------

interface HeroProps {
  stage: DeceptionStage;
  state: DeceptionPublicState;
  me: DeceptionPrivate | null;
  meId: string | null;
  spectator: boolean;
  nodeMap: Record<string, NodeEntry>;
  dawn: DeceptionDawnReport | null;
  verdict: DeceptionVerdict | null;
  iDone: boolean;
  hidden: boolean;
  setHidden: (v: boolean) => void;
}

function Hero({ stage, state, me, meId, spectator, nodeMap, dawn, verdict, iDone }: HeroProps) {
  if (stage === 'dawn' && dawn) return <DawnReport report={dawn} nodes={nodeMap} intel={me?.intel ?? []} />;
  if (stage === 'verdict' && verdict) return <VerdictReveal verdict={verdict} nodes={nodeMap} />;
  if (stage === 'boot' && me) {
    return (
      <div className="dx-boot">
        <RoleCard me={me} nodes={nodeMap} meId={meId} variant="hero" />
        <p className="dx-hero__coach">{coachLine(stage, me, spectator)}</p>
        {iDone ? <p className="dx-hero__next">Waiting for everyone to read their role… {NEXT_STAGE.boot}</p> : null}
      </div>
    );
  }
  const label = STAGE_LABEL[stage];
  return (
    <section className="dx-hero" data-stage={stage} aria-live="polite">
      <p className="dx-hero__kicker">
        {label.kicker} {stage === 'boot' ? '' : <span className="dc-num">{state.cycle}</span>}
      </p>
      <h2 className="dx-hero__title" data-text={label.title}>
        {label.title}
      </h2>
      <p className="dx-hero__coach">{coachLine(stage, me, spectator)}</p>
      {NEXT_STAGE[stage] ? <p className="dx-hero__next">{NEXT_STAGE[stage]}</p> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Action dock (sticky primary action)
// ---------------------------------------------------------------------------------------------

interface DockProps {
  stage: DeceptionStage;
  me: DeceptionPrivate | null;
  nodeMap: Record<string, NodeEntry>;
  actions: readonly DeceptionActionKind[];
  kind: DeceptionActionKind | null;
  setKind: (k: DeceptionActionKind) => void;
  pickOf: (k: DeceptionActionKind) => { target: string | null; locked: boolean };
  voteTarget: string | null;
  myVote: DeceptionPrivate['vote'];
  useSudo: boolean;
  setUseSudo: (v: boolean) => void;
  allowSkip: boolean;
  iDone: boolean;
  teamPicks: DeceptionPrivate['teamPicks'];
}

function Dock(props: DockProps) {
  const { stage, me, nodeMap, actions, kind, setKind, pickOf, voteTarget, myVote, useSudo, setUseSudo, allowSkip, iDone, teamPicks } =
    props;
  const name = (id: string | null) => (id ? (nodeMap[id]?.name ?? 'Player') : '');
  let content: ReactNode;

  if (!me || !me.alive) return null;

  if (stage === 'boot') {
    content = iDone ? (
      <DockNote icon="check" tone="ok">
        Got it — waiting for the others.
      </DockNote>
    ) : (
      <Button variant="primary" size="lg" block icon="check" onClick={() => send(DECEPTION_MSG.ready, { ready: true })}>
        Got it — I know my role
      </Button>
    );
  } else if (stage === 'night') {
    if (!actions.length || !kind) {
      content = (
        <DockNote icon="eye" tone="info">
          {me.role === 'tracer' ? 'Your clue arrives at dawn.' : 'Nothing to do tonight — lie low until dawn.'}
        </DockNote>
      );
    } else {
      const pick = pickOf(kind);
      const teamLocked = kind === 'attack' ? teamPicks.filter((p) => p.locked).length : 0;
      content = (
        <>
          {actions.length > 1 ? (
            <Segmented
              label="Night ability"
              value={kind}
              className="dx-dock__kinds"
              options={actions.map((k) => ({ value: k, label: `${ACTION_LABEL[k]}${pickOf(k).locked ? ' ✓' : ''}` }))}
              onChange={(k) => setKind(k)}
            />
          ) : null}
          <div className="dx-dock__row">
            <span className="dx-dock__what" style={{ '--role': ROLE_COLOR[me.role!] } as CSSProperties}>
              <RoleEmblem role={me.role!} size={28} />
              <span>
                <span className="dx-dock__label">{ACTION_LABEL[kind]}</span>
                <span className="dx-dock__target">{pick.target ? name(pick.target) : 'Tap a player on the map'}</span>
              </span>
            </span>
            {pick.locked ? (
              <DockNote icon="lock" tone="ok">
                Locked in
              </DockNote>
            ) : (
              <Button
                variant="primary"
                size="lg"
                icon="lock"
                disabled={!pick.target}
                onClick={() => {
                  sfx('ready');
                  send(DECEPTION_MSG.act, { kind, target: pick.target, lock: true });
                }}
              >
                Lock in
              </Button>
            )}
          </div>
          {kind === 'attack' ? (
            <p className="dx-dock__hint">
              {teamPicks.length > 1 ? (
                <>
                  Team: <span className="dc-num">{teamLocked}</span>/<span className="dc-num">{teamPicks.length}</span> locked. The
                  most-picked player is corrupted (ties: random).
                </>
              ) : (
                'You strike alone tonight.'
              )}
            </p>
          ) : null}
        </>
      );
    }
  } else if (stage === 'day') {
    content = (
      <Button
        variant={iDone ? 'success' : 'primary'}
        size="lg"
        block
        icon={iDone ? 'check' : 'flag'}
        aria-pressed={iDone}
        onClick={() => {
          sfx('ready');
          send(DECEPTION_MSG.ready, { ready: !iDone });
        }}
      >
        {iDone ? 'Ready to vote — tap to keep talking' : 'Ready to vote'}
      </Button>
    );
  } else if (stage === 'vote' || stage === 'runoff') {
    if (myVote) {
      content = (
        <DockNote icon="lock" tone="ok">
          Your vote: <strong>{myVote.target === 'skip' ? 'Skip' : name(myVote.target)}</strong>
          {myVote.sudo ? ' (Sudo ×2)' : ''} — secret until the reveal.
        </DockNote>
      );
    } else {
      const canSudo = me.role === 'sudo' && !me.sudoUsed;
      content = (
        <>
          <div className="dx-dock__row">
            <span className="dx-dock__what dx-dock__what--vote">
              <Icon name="flag" size={20} />
              <span>
                <span className="dx-dock__label">{stage === 'runoff' ? 'Runoff vote' : 'Disconnect vote'}</span>
                <span className="dx-dock__target">{voteTarget ? name(voteTarget) : 'Tap a player on the map'}</span>
              </span>
            </span>
            <div className="dx-dock__buttons">
              {allowSkip ? (
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={() => {
                    sfx('click');
                    send(DECEPTION_MSG.vote, { target: 'skip' });
                  }}
                >
                  Skip
                </Button>
              ) : null}
              <Button
                variant="danger"
                size="lg"
                icon="lock"
                disabled={!voteTarget}
                onClick={() => {
                  if (!voteTarget) return;
                  sfx('ready');
                  send(DECEPTION_MSG.vote, { target: voteTarget, ...(useSudo && canSudo ? { sudo: true } : {}) });
                }}
              >
                {voteTarget ? `Vote ${name(voteTarget)}` : 'Vote'}
              </Button>
            </div>
          </div>
          {canSudo ? (
            <Toggle
              className="dx-dock__sudo"
              label="Use my Sudo vote (counts twice, once per game — reveals I’m the Sudo)"
              checked={useSudo}
              onChange={setUseSudo}
            />
          ) : null}
        </>
      );
    }
  } else {
    return null;
  }
  return (
    <div className="dx-dock" data-stage={stage}>
      {content}
    </div>
  );
}

function send(type: string, payload: unknown) {
  session.send(type, payload);
}

function DockNote({ icon, tone, children }: { icon: DxIconName; tone: 'ok' | 'info'; children: ReactNode }) {
  return (
    <p className={cx('dx-docknote', `dx-docknote--${tone}`)} role="status">
      <Icon name={icon} size={14} />
      <span>{children}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------------------------
// Side panel
// ---------------------------------------------------------------------------------------------

interface SideProps {
  stage: DeceptionStage;
  me: DeceptionPrivate | null;
  meId: string | null;
  nodeMap: Record<string, NodeEntry>;
  teamLines: ReturnType<typeof useTeamLog>;
  log: DeceptionLogEntry[];
  spectator: boolean;
  hidden: boolean;
  setHidden: (v: boolean) => void;
}

function SidePanel({ stage, me, meId, nodeMap, teamLines, log, spectator, hidden, setHidden }: SideProps) {
  const [tab, setTab] = useState<'chat' | 'log' | 'team'>('chat');
  const glitch = me?.team === 'glitches';
  const chatMode = spectator || (me && !me.alive) ? 'ghost' : stage === 'night' ? 'blackout' : 'open';
  const tabs: Array<{ value: 'chat' | 'log' | 'team'; label: ReactNode }> = [
    { value: 'chat', label: chatMode === 'ghost' ? 'Ghost chat' : 'Chat' },
    { value: 'log', label: 'Timeline' },
  ];
  if (glitch && stage !== 'night') tabs.push({ value: 'team', label: 'Glitch log' });
  const current = tabs.some((t) => t.value === tab) ? tab : 'chat';
  return (
    <>
      {me && stage !== 'boot' ? (
        <RoleCard me={me} nodes={nodeMap} meId={meId} variant="compact" hidden={hidden} onToggleHidden={setHidden} />
      ) : null}
      {me && stage !== 'boot' && !(hidden && me) ? <IntelPanel me={me} nodes={nodeMap} /> : null}
      <section className="dx-panel dx-comms" aria-label="Chat and timeline">
        <Tabs label="Chat and timeline" value={current} tabs={tabs} onChange={setTab} className="dx-comms__tabs" />
        {current === 'chat' ? (
          <DeceptionChat mode={chatMode} />
        ) : current === 'log' ? (
          <Timeline log={log} nodes={nodeMap} />
        ) : (
          <TeamChannel lines={teamLines} canSend={false} meId={meId} />
        )}
      </section>
    </>
  );
}
