/**
 * DASQuest game view: scene art, narrative, votes and the party HUD during play,
 * the dice overlay for checks, and the results screen at the end.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { PlayerView } from '@dascade/shared';
import { Badge, Modal, Panel, PixelArt, PixelIcon, Tabs, cx, readThemeTokens, subscribeThemeTokens } from '@dascade/ui';
import {
  QUEST_MSG,
  QUEST_TIEBREAK_MS,
  type QuestCatalogView,
  type QuestCheckpointPayload,
  type QuestEventPayload,
  type QuestHeroView,
  type QuestLogEntryView,
  type QuestOutcomeView,
  type QuestPrivatePayload,
  type QuestPublicState,
  type QuestResultView,
  type QuestRollView,
  type QuestSceneView,
  type QuestSettings,
  type QuestTieView,
} from '@dascade/shared/games/quest';
import { GameStage } from '../../shell/common.tsx';
import { useCountdown, useGame, useLatestMessage, useRoomMessage, useRoomSelector } from '../../net/hooks.ts';
import { session, useSessionStore } from '../../net/session.ts';
import { persistence } from '../../persistence/index.ts';
import { useApp } from '../../app/store.ts';
import { SceneCanvas } from './scene/SceneCanvas.tsx';
import { Narrative } from './Narrative.tsx';
import { ChoiceList, VoteBar, type VoteBarProps } from './Choices.tsx';
import { HeroCard, Inventory, PartyStrip } from './Party.tsx';
import { AdventureLog } from './Log.tsx';
import { DiceOverlay } from './Dice.tsx';
import { QuestResults } from './Results.tsx';
import { PORTRAITS, UNKNOWN_PORTRAIT } from './art.ts';
import { questSound, sortHeroes, useJson } from './util.ts';
import { hasMaterials } from './themeAdapter.ts';

/** Checkpoints already stored this session (run id + save time; small keys, not the blobs). */
const savedCheckpoints = new Set<string>();

/** Store checkpoint saves the server sends to the host (deduped across reconnects). */
function useCheckpointSaver() {
  const latest = useLatestMessage<QuestCheckpointPayload>(QUEST_MSG.checkpoint);
  const toast = useApp((s) => s.toast);
  useEffect(() => {
    const key = latest ? `${latest.id}:${latest.info.savedAt}` : '';
    if (!latest || savedCheckpoints.has(key)) return;
    savedCheckpoints.add(key);
    persistence()
      .savePreset('quest-save', latest.name, latest, `quest-${latest.id}`)
      .then(() => {
        questSound.checkpoint();
        toast('success', `Checkpoint saved · Ch. ${latest.info.chapter}: ${latest.info.chapterTitle}`);
      })
      .catch(() => toast('warning', 'This device could not store the checkpoint.'));
  }, [latest, toast]);
}

/**
 * Theme adapter: flags the stage with [data-quest-mat] while the active theme defines playfield
 * materials (never under Delta Neon), so quest.css can dress the narrative as the theme's paper.
 * Imperative attribute toggle — a theme switch never re-renders or resets the play view.
 */
function useThemeMaterialsFlag(mounted: boolean) {
  useEffect(() => {
    if (!mounted) return;
    const apply = () => {
      const stage = document.querySelector<HTMLElement>('.qs-root[data-game="quest"]');
      if (stage) stage.toggleAttribute('data-quest-mat', hasMaterials(readThemeTokens(stage).materials));
    };
    apply();
    return subscribeThemeTokens(apply);
  }, [mounted]);
}

interface TopView {
  phase: string;
  resultJson: string;
  hasScene: boolean;
}
const pickTop = (s: QuestPublicState): TopView => ({ phase: s.phase, resultJson: s.resultJson, hasScene: Boolean(s.sceneJson) });

export function QuestView() {
  // Only what picks the screen: votes, log pushes and player patches don't re-render this.
  const top = useRoomSelector<QuestPublicState, TopView>(pickTop);
  const playerId = useSessionStore((s) => s.playerId);
  const result = useJson<QuestResultView>(top?.resultJson);
  useCheckpointSaver();
  useThemeMaterialsFlag(Boolean(top));
  useRoomMessage<QuestEventPayload>(QUEST_MSG.event, (e) => {
    if (e.kind === 'scene') questSound.scene();
    else if (e.kind === 'ko') questSound.ko();
    else if (e.kind === 'revive') questSound.revive();
    else if (e.kind === 'item') questSound.item();
    else if (e.kind === 'tie') questSound.tie();
  });
  if (!top) return null;
  return (
    <GameStage gameId="quest" className="qs-root">
      {top.phase === 'RESULTS' && result ? <QuestResults result={result} myId={playerId} /> : top.hasScene ? <QuestPlay /> : <Prologue />}
    </GameStage>
  );
}

function Prologue() {
  const game = useGame<QuestPublicState, QuestSettings>();
  if (!game) return null;
  const heroes = sortHeroes(game.state.heroes).filter((h) => game.seated.some((p) => p.id === h.playerId));
  return (
    <div className="qs-prologue">
      <span className="dc-label">DASQuest presents</span>
      <h1 className="qs-prologue__title">{game.state.packTitle || 'An adventure'}</h1>
      <ul className="qs-prologue__party">
        {game.seated.map((p) => {
          const h = heroes.find((x) => x.playerId === p.id);
          return (
            <li key={p.id} style={{ '--hero': p.color } as CSSProperties}>
              <PixelArt rows={h?.archetype ? PORTRAITS[h.archetype] : UNKNOWN_PORTRAIT} mainColor={p.color} />
              <span>{p.name}</span>
            </li>
          );
        })}
      </ul>
      <p className="dc-muted">Gathering the party…</p>
    </div>
  );
}

function OutcomeCard({ outcome }: { outcome: QuestOutcomeView }) {
  const verdict = outcome.success === null ? null : outcome.crit === 'success' ? 'Critical success' : outcome.crit === 'failure' ? 'Critical fumble' : outcome.success ? 'Success' : 'Failure';
  return (
    <section className="qs-outcome" data-result={outcome.success === null ? 'none' : outcome.success ? 'pass' : 'fail'} aria-label="What just happened">
      <div className="qs-outcome__head">
        <span className="dc-label">Previously · {outcome.fromTitle}</span>
        {verdict ? <span className="qs-outcome__verdict">{verdict}</span> : null}
      </div>
      <p className="qs-outcome__choice">
        “{outcome.choiceLabel}” <span className="qs-outcome__votes">{outcome.votes}/{outcome.voters} votes{outcome.tieRule ? ` · ${outcome.tieRule}` : ''}</span>
      </p>
      {outcome.text ? <p className="qs-outcome__text">{outcome.text}</p> : null}
      {outcome.changes.length ? (
        <ul className="qs-outcome__changes">
          {outcome.changes.slice(0, 10).map((c, i) => (
            <li key={i} className="qs-change" data-tone={c.tone} data-kind={c.kind}>
              {c.text}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** The play-screen slice of state (everything except the log, which renders on its own). */
interface PlayView {
  stage: QuestPublicState['stage'];
  sceneJson: string;
  outcomeJson: string;
  catalogJson: string;
  tieJson: string;
  rollJson: string;
  phaseEndsAt: number;
  hostId: string;
  settingsJson: string;
  credits: number;
  score: number;
  votes: Record<string, string>;
  inventory: Record<string, number>;
  heroes: Record<string, QuestHeroView>;
  players: Record<string, PlayerView>;
}

const EMPTY: Record<string, never> = {};
const pickPlay = (s: QuestPublicState): PlayView => ({
  stage: s.stage,
  sceneJson: s.sceneJson,
  outcomeJson: s.outcomeJson,
  catalogJson: s.catalogJson,
  tieJson: s.tieJson,
  rollJson: s.rollJson,
  phaseEndsAt: s.phaseEndsAt,
  hostId: s.hostId,
  settingsJson: s.settingsJson,
  credits: s.credits,
  score: s.score,
  votes: s.votes ?? EMPTY,
  inventory: s.inventory ?? EMPTY,
  heroes: s.heroes ?? EMPTY,
  players: s.players ?? EMPTY,
});

function valueEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  return false;
}
/** Same keys, and every value equal (one level deep; arrays of primitives compared by value). */
function recordEqual(a: object, b: object, deep: boolean): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    const va = (a as Record<string, unknown>)[k];
    const vb = (b as Record<string, unknown>)[k];
    if (deep ? !(va && vb && typeof va === 'object' && typeof vb === 'object' && recordEqual(va, vb, false)) : !valueEqual(va, vb)) return false;
  }
  return true;
}
function playEqual(a: PlayView, b: PlayView): boolean {
  return (
    a.stage === b.stage &&
    a.sceneJson === b.sceneJson &&
    a.outcomeJson === b.outcomeJson &&
    a.catalogJson === b.catalogJson &&
    a.tieJson === b.tieJson &&
    a.rollJson === b.rollJson &&
    a.phaseEndsAt === b.phaseEndsAt &&
    a.hostId === b.hostId &&
    a.settingsJson === b.settingsJson &&
    a.credits === b.credits &&
    a.score === b.score &&
    recordEqual(a.votes, b.votes, false) &&
    recordEqual(a.inventory, b.inventory, false) &&
    recordEqual(a.heroes, b.heroes, true) &&
    recordEqual(a.players, b.players, true)
  );
}

const logEqual = (a: QuestLogEntryView[], b: QuestLogEntryView[]) => a.length === b.length && a[0]?.id === b[0]?.id && a.at(-1)?.id === b.at(-1)?.id;
const pickLog = (s: QuestPublicState): QuestLogEntryView[] => s.log ?? [];

/** The adventure log, subscribed on its own (entries are immutable once pushed). */
const LiveLog = memo(function LiveLog() {
  const entries = useRoomSelector<QuestPublicState, QuestLogEntryView[]>(pickLog, logEqual);
  return <AdventureLog entries={entries ?? []} />;
});

/** The vote bar owns the ~4 Hz countdown, so the ticking timer doesn't re-render the whole play view. */
function TimedVoteBar({ endsAt, ...props }: Omit<VoteBarProps, 'remainingMs'> & { endsAt: number }) {
  const remaining = useCountdown(endsAt);
  return <VoteBar {...props} remainingMs={remaining} />;
}

/** Scene art, the previous outcome and the narrative: re-renders only when the scene or outcome JSON changes. */
const SceneStory = memo(function SceneStory({ scene, outcome, onDone }: { scene: QuestSceneView; outcome: QuestOutcomeView | null; onDone: (rev: number) => void }) {
  return (
    <>
      <SceneCanvas key={scene.rev} theme={scene.theme} art={scene.art} seed={`${scene.nodeId}:${scene.rev}`} label={`Scene: ${scene.title}`} className="qs-main__scene">
        <div className="qs-caption">
          <span className="qs-caption__chapter">
            Chapter {scene.chapter} · {scene.chapterTitle}
          </span>
          <h2 className="qs-caption__title">{scene.title}</h2>
        </div>
        <div className="qs-hud" data-part="hud">
          <span className="qs-hud__pill" title="In-game time">
            <PixelIcon name="clock" /> {scene.clock}
          </span>
          {scene.checkpoint ? (
            <span className="qs-hud__pill qs-hud__pill--save" title="Checkpoint: the host’s device saves the adventure here">
              <PixelIcon name="flag" /> Checkpoint
            </span>
          ) : null}
        </div>
      </SceneCanvas>

      <div className="qs-storycol">
        {outcome ? <OutcomeCard key={`o${scene.rev}`} outcome={outcome} /> : null}

        <article className="qs-story" data-part="narrative" aria-labelledby="qs-scene-title">
          <h3 id="qs-scene-title" className="visually-hidden">
            {scene.title}
          </h3>
          <Narrative key={scene.rev} paragraphs={scene.paragraphs} onDone={() => onDone(scene.rev)} />
          {scene.revealOdds ? (
            <p className="qs-story__note">
              <PixelIcon name="info" /> Your Analyst is running the numbers: exact DCs and odds are shown.
            </p>
          ) : null}
        </article>
      </div>
    </>
  );
});

interface ActiveRoll {
  roll: QuestRollView;
  /** Scene revision the roll was made in (the overlay closes after the next scene arrives). */
  rev: number;
  /** Reconnected mid-roll: show the result without replaying the tumble. */
  instant: boolean;
}

function QuestPlay() {
  const view = useRoomSelector<QuestPublicState, PlayView>(pickPlay, playEqual);
  const playerId = useSessionStore((s) => s.playerId);
  const state = view ?? pickPlay({} as QuestPublicState);
  const settings = useJson<QuestSettings>(state.settingsJson);
  const players = useMemo(() => Object.values(state.players).sort((a, b) => a.joinOrder - b.joinOrder), [state.players]);
  const seated = useMemo(() => players.filter((p) => !p.spectator), [players]);
  const me = playerId ? state.players[playerId] : undefined;
  const isHost = Boolean(playerId && state.hostId === playerId);
  const isSpectator = Boolean(me?.spectator);
  const scene = useJson<QuestSceneView>(state.sceneJson);
  const outcome = useJson<QuestOutcomeView>(state.outcomeJson);
  const catalog = useJson<QuestCatalogView>(state.catalogJson);
  const tie = useJson<QuestTieView>(state.tieJson);
  const rollState = useJson<QuestRollView>(state.rollJson);
  const priv = useLatestMessage<QuestPrivatePayload>(QUEST_MSG.private);
  const [activeRoll, setActiveRoll] = useState<ActiveRoll | null>(null);
  const [doneRev, setDoneRev] = useState(-1);
  const [sheet, setSheet] = useState<null | 'party' | 'bag' | 'log'>(null);
  const [sideTab, setSideTab] = useState<'log' | 'bag'>('log');
  const seenRoll = useRef(0);
  const reduced = useApp((s) => s.settings.reducedMotion);
  const rev = scene?.rev ?? 0;
  const revRef = useRef(rev);
  useEffect(() => {
    revRef.current = rev;
  }, [rev]);

  // The roll event arrives before the next scene: remember the scene it belongs to.
  useRoomMessage<QuestRollView>(QUEST_MSG.roll, (r) => {
    seenRoll.current = r.id;
    setActiveRoll({ roll: r, rev: revRef.current, instant: false });
  });
  // Reconnected mid-roll: show the result without replaying the tumble.
  useEffect(() => {
    if (state.stage === 'rolling' && rollState && seenRoll.current !== rollState.id) {
      seenRoll.current = rollState.id;
      setActiveRoll({ roll: rollState, rev, instant: true });
    }
  }, [state.stage, rollState, rev]);
  // Close the dice shortly after the next scene arrives (each roll tracks its own scene, so a
  // roll dismissed early can never make the next roll's overlay close before its verdict).
  useEffect(() => {
    if (!activeRoll || rev === activeRoll.rev) return;
    const id = setTimeout(() => setActiveRoll((cur) => (cur === activeRoll ? null : cur)), reduced ? 600 : 1500);
    return () => clearTimeout(id);
  }, [rev, activeRoll, reduced]);
  const closeRoll = useCallback(() => setActiveRoll(null), []);
  const onNarrativeDone = useCallback((doneAt: number) => setDoneRev(doneAt), []);

  const heroes = useMemo(() => sortHeroes(state.heroes), [state.heroes]);
  const heroesById = useMemo(() => new Map(heroes.map((h) => [h.playerId, h])), [heroes]);
  const eligible = seated.filter((p) => p.connected);
  const eligibleIds = new Set(eligible.map((p) => p.id));
  const votes = state.votes;
  const votedCount = Object.keys(votes).filter((id) => eligibleIds.has(id)).length;
  const waiting = eligible.filter((p) => !votes[p.id]).map((p) => p.name);
  const myVote = playerId ? (votes[playerId] ?? null) : null;
  const canVote = !isSpectator && state.stage === 'voting';
  const omens = useMemo(() => new Map((priv && priv.rev === rev ? priv.omens : []).map((o) => [o.choiceId, o.text])), [priv, rev]);
  const myVoteLabel = scene?.choices.find((c) => c.id === myVote)?.label ?? null;

  const vote = useCallback(
    (choiceId: string | null) => {
      if (!scene) return;
      if (choiceId) questSound.vote();
      session.send(QUEST_MSG.vote, { choiceId, rev: scene.rev });
    },
    [scene],
  );
  const tiebreak = useCallback((choiceId: string) => session.send(QUEST_MSG.tiebreak, { choiceId }), []);
  const applyItem = useCallback((itemId: string, targetId: string) => session.send(QUEST_MSG.use, { itemId, targetId }), []);

  if (!view || !scene) return null;
  const canUseItems = !isSpectator && (state.stage === 'voting' || state.stage === 'tiebreak');
  const reveal = doneRev === scene.rev || reduced;
  const partyList = (
    <ul className="qs-party" data-part="party">
      {heroes.map((h) => (
        <HeroCard
          key={h.playerId}
          hero={h}
          player={players.find((p) => p.id === h.playerId)}
          me={h.playerId === playerId}
          voted={Boolean(votes[h.playerId])}
          votingOpen={state.stage === 'voting'}
          catalog={catalog}
        />
      ))}
    </ul>
  );
  const bag = <Inventory inventory={state.inventory} credits={state.credits} catalog={catalog} heroes={heroes} canUse={canUseItems} onUse={applyItem} />;
  const log = <LiveLog />;

  return (
    <div className="qs-layout">
      <div className="qs-main">
        <PartyStrip heroes={heroes} myId={playerId} votes={votes} onOpen={setSheet} />
        <SceneStory scene={scene} outcome={outcome} onDone={onNarrativeDone} />

        <TimedVoteBar
          stage={state.stage}
          endsAt={state.phaseEndsAt}
          totalMs={state.stage === 'tiebreak' ? QUEST_TIEBREAK_MS : (settings?.voteSeconds ?? 45) * 1000}
          votedCount={votedCount}
          eligible={eligible.length}
          waitingNames={waiting}
          myVoteLabel={myVoteLabel}
          isHost={isHost}
          isSpectator={isSpectator}
          paused={state.stage === 'voting' && state.phaseEndsAt === 0}
          onDecide={() => session.send(QUEST_MSG.decide, {})}
          onClear={() => vote(null)}
          onOpen={(panel) => setSheet(panel)}
        />

        <ChoiceList
          choices={scene.choices}
          votes={votes}
          heroesById={heroesById}
          myVote={myVote}
          eligible={Math.max(1, eligible.length)}
          canVote={canVote}
          tied={state.stage === 'tiebreak' && tie ? tie.choiceIds : null}
          canBreakTie={isHost}
          omens={omens}
          reveal={reveal}
          onVote={vote}
          onTiebreak={tiebreak}
        />
      </div>

      <aside className="qs-side" aria-label="Party and log">
        <Panel title={`Party · ${heroes.length}`} className="qs-side__party" actions={<Badge color="var(--accent)">{state.score.toLocaleString()} pts</Badge>}>
          {partyList}
        </Panel>
        <Panel className="qs-side__tabs" padded={false}>
          <Tabs
            label="Party bag and log"
            value={sideTab}
            onChange={setSideTab}
            tabs={[
              { value: 'log', label: 'Log' },
              { value: 'bag', label: `Bag · ${Object.values(state.inventory).reduce((a, b) => a + b, 0)}` },
            ]}
          />
          <div className="qs-side__pane">{sideTab === 'log' ? log : bag}</div>
        </Panel>
      </aside>

      {activeRoll ? <DiceOverlay key={activeRoll.roll.id} roll={activeRoll.roll} instant={activeRoll.instant} onClose={closeRoll} /> : null}

      <Modal open={sheet !== null} onClose={() => setSheet(null)} title={sheet === 'bag' ? 'Party bag' : sheet === 'log' ? 'Adventure log' : 'Party'} className={cx('qs-sheet')}>
        {sheet === 'bag' ? bag : sheet === 'log' ? log : sheet === 'party' ? partyList : null}
      </Modal>
    </div>
  );
}

export type { QuestHeroView };
