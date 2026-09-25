/**
 * DASQuest game view: scene art, narrative, votes and the party HUD during play,
 * the dice overlay for checks, and the results screen at the end.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Badge, Modal, Panel, PixelArt, PixelIcon, Tabs, cx } from '@dascade/ui';
import {
  QUEST_MSG,
  type QuestCatalogView,
  type QuestCheckpointPayload,
  type QuestEventPayload,
  type QuestHeroView,
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
import { useCountdown, useGame, useLatestMessage, useRoomMessage } from '../../net/hooks.ts';
import { session } from '../../net/session.ts';
import { persistence } from '../../persistence/index.ts';
import { useApp } from '../../app/store.ts';
import { SceneCanvas } from './scene/SceneCanvas.tsx';
import { Narrative } from './Narrative.tsx';
import { ChoiceList, VoteBar } from './Choices.tsx';
import { HeroCard, Inventory, PartyStrip } from './Party.tsx';
import { AdventureLog } from './Log.tsx';
import { DiceOverlay } from './Dice.tsx';
import { QuestResults } from './Results.tsx';
import { PORTRAITS, UNKNOWN_PORTRAIT } from './art.ts';
import { questSound, sortHeroes, useJson } from './util.ts';

const savedBlobs = new Set<string>();

/** Store checkpoint saves the server sends to the host (deduped across reconnects). */
function useCheckpointSaver() {
  const latest = useLatestMessage<QuestCheckpointPayload>(QUEST_MSG.checkpoint);
  const toast = useApp((s) => s.toast);
  useEffect(() => {
    if (!latest || savedBlobs.has(latest.blob)) return;
    savedBlobs.add(latest.blob);
    persistence()
      .savePreset('quest-save', latest.name, latest, `quest-${latest.id}`)
      .then(() => {
        questSound.checkpoint();
        toast('success', `Checkpoint saved · Ch. ${latest.info.chapter}: ${latest.info.chapterTitle}`);
      })
      .catch(() => toast('warning', 'This device could not store the checkpoint.'));
  }, [latest, toast]);
}

export function QuestView() {
  const game = useGame<QuestPublicState, QuestSettings>();
  const result = useJson<QuestResultView>(game?.state.resultJson);
  useCheckpointSaver();
  useRoomMessage<QuestEventPayload>(QUEST_MSG.event, (e) => {
    if (e.kind === 'scene') questSound.scene();
    else if (e.kind === 'ko') questSound.ko();
    else if (e.kind === 'revive') questSound.revive();
    else if (e.kind === 'item') questSound.item();
    else if (e.kind === 'tie') questSound.tie();
  });
  if (!game) return null;
  return (
    <GameStage gameId="quest" className="qs-root">
      {game.phase === 'RESULTS' && result ? <QuestResults result={result} myId={game.playerId} /> : game.state.sceneJson ? <QuestPlay /> : <Prologue />}
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

function QuestPlay() {
  const game = useGame<QuestPublicState, QuestSettings>()!;
  const { state, settings, playerId, isHost, isSpectator, seated, players } = game;
  const scene = useJson<QuestSceneView>(state.sceneJson);
  const outcome = useJson<QuestOutcomeView>(state.outcomeJson);
  const catalog = useJson<QuestCatalogView>(state.catalogJson);
  const tie = useJson<QuestTieView>(state.tieJson);
  const rollState = useJson<QuestRollView>(state.rollJson);
  const priv = useLatestMessage<QuestPrivatePayload>(QUEST_MSG.private);
  const remaining = useCountdown(state.phaseEndsAt);
  const [activeRoll, setActiveRoll] = useState<QuestRollView | null>(null);
  const [doneRev, setDoneRev] = useState(-1);
  const [sheet, setSheet] = useState<null | 'party' | 'bag' | 'log'>(null);
  const [sideTab, setSideTab] = useState<'log' | 'bag'>('log');
  const seenRoll = useRef(0);
  const reduced = useApp((s) => s.settings.reducedMotion);

  useRoomMessage<QuestRollView>(QUEST_MSG.roll, (r) => {
    seenRoll.current = r.id;
    setActiveRoll(r);
  });
  // Reconnected mid-roll: show the result without replaying the tumble.
  useEffect(() => {
    if (state.stage === 'rolling' && rollState && seenRoll.current !== rollState.id) {
      seenRoll.current = rollState.id;
      setActiveRoll(rollState);
    }
  }, [state.stage, rollState]);
  // Close the dice shortly after the next scene arrives.
  const rev = scene?.rev ?? 0;
  const rollAtRev = useRef(0);
  useEffect(() => {
    if (!activeRoll) return;
    if (rollAtRev.current === 0) rollAtRev.current = rev;
    if (rev !== rollAtRev.current) {
      const id = setTimeout(() => {
        setActiveRoll(null);
        rollAtRev.current = 0;
      }, reduced ? 600 : 1500);
      return () => clearTimeout(id);
    }
  }, [rev, activeRoll, reduced]);

  const heroes = useMemo(() => sortHeroes(state.heroes), [state.heroes]);
  const heroesById = useMemo(() => new Map(heroes.map((h) => [h.playerId, h])), [heroes]);
  const eligible = seated.filter((p) => p.connected);
  const eligibleIds = new Set(eligible.map((p) => p.id));
  const votes = state.votes ?? {};
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

  if (!scene) return null;
  const canUseItems = !isSpectator && (state.stage === 'voting' || state.stage === 'tiebreak');
  const reveal = doneRev === scene.rev || reduced;
  const partyList = (
    <ul className="qs-party">
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
  const bag = <Inventory inventory={state.inventory ?? {}} credits={state.credits} catalog={catalog} heroes={heroes} canUse={canUseItems} onUse={applyItem} />;
  const log = <AdventureLog entries={state.log ?? []} />;

  return (
    <div className="qs-layout">
      <div className="qs-main">
        <PartyStrip heroes={heroes} myId={playerId} votes={votes} onOpen={setSheet} />
        <SceneCanvas key={scene.rev} theme={scene.theme} art={scene.art} seed={`${scene.nodeId}:${scene.rev}`} label={`Scene: ${scene.title}`} className="qs-main__scene">
          <div className="qs-caption">
            <span className="qs-caption__chapter">
              Chapter {scene.chapter} · {scene.chapterTitle}
            </span>
            <h2 className="qs-caption__title">{scene.title}</h2>
          </div>
          <div className="qs-hud">
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

        <article className="qs-story" aria-labelledby="qs-scene-title">
          <h3 id="qs-scene-title" className="visually-hidden">
            {scene.title}
          </h3>
          <Narrative key={scene.rev} paragraphs={scene.paragraphs} onDone={() => setDoneRev(scene.rev)} />
          {scene.revealOdds ? (
            <p className="qs-story__note">
              <PixelIcon name="info" /> Your Analyst is running the numbers: exact DCs and odds are shown.
            </p>
          ) : null}
        </article>
        </div>

        <VoteBar
          stage={state.stage}
          remainingMs={remaining}
          totalMs={state.stage === 'tiebreak' ? 15_000 : settings.voteSeconds * 1000}
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
              { value: 'bag', label: `Bag · ${Object.values(state.inventory ?? {}).reduce((a, b) => a + b, 0)}` },
            ]}
          />
          <div className="qs-side__pane">{sideTab === 'log' ? log : bag}</div>
        </Panel>
      </aside>

      {activeRoll ? <DiceOverlay key={activeRoll.id} roll={activeRoll} onClose={() => setActiveRoll(null)} /> : null}

      <Modal open={sheet !== null} onClose={() => setSheet(null)} title={sheet === 'bag' ? 'Party bag' : sheet === 'log' ? 'Adventure log' : 'Party'} className={cx('qs-sheet')}>
        {sheet === 'bag' ? bag : sheet === 'log' ? log : sheet === 'party' ? partyList : null}
      </Modal>
    </div>
  );
}

export type { QuestHeroView };
