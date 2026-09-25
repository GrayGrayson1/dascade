/**
 * The DAS Bingo game view (every phase except LOBBY).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BINGO_MSG,
  type BingoClaimResultPayload,
  type BingoEvent,
  type BingoPublicState,
  type BingoSettings,
} from '@dascade/shared/games/bingo';
import { centerIndex } from '@dascade/game-core/bingo';
import { Badge, PixelIcon, Spinner, Tabs, cx } from '@dascade/ui';
import { useGame, useRoomMessage, type GameContext } from '../../net/hooks.ts';
import { sfx, synth } from '../../audio/audio.ts';
import { ChatPanel, GameStage } from '../../shell/common.tsx';
import { BingoCardView } from './Card.tsx';
import { NumberBoard, TextBoard } from './Caller.tsx';
import { BingoBurst, Confetti, FalseAlarmStamp, type BurstInfo } from './Celebration.tsx';
import { CallerPanel, HostControls, Intermission, Leaderboard, PatternPanel } from './Panels.tsx';
import { Results } from './Results.tsx';
import {
  loadVoicePref,
  maskOf,
  parsePlan,
  saveVoicePref,
  speak,
  spokenCall,
  standings,
  tokenLabel,
  useCalledSet,
  useMyCard,
  useReducedMotion,
  useTicker,
  voiceSupported,
} from './util.ts';

type Game = GameContext<BingoPublicState, BingoSettings>;

export function BingoGameView() {
  const game = useGame<BingoPublicState, BingoSettings>();
  if (!game) return null;
  return (
    <GameStage gameId="bingo" className="bg-stage">
      {game.phase === 'RESULTS' ? <Results game={game} /> : <Play game={game} />}
    </GameStage>
  );
}

interface Notice {
  id: number;
  text: string;
  tone: 'info' | 'warn' | 'win';
}

function Play({ game }: { game: Game }) {
  const { state, settings, playerId, isHost, isSpectator, send, serverNow, phase } = game;
  const items = useMemo(() => settings.items ?? [], [settings.items]);
  const mode = state.mode;
  const size = state.size || 5;
  const plan = useMemo(() => parsePlan(state.planJson), [state.planJson]);
  const roundPlan = plan[state.round - 1];
  const card = useMyCard(state.matchId);
  const calls = state.calls;
  const called = useCalledSet(calls);
  // A card dealt mid-round only counts calls made after it was dealt (the server checks the same).
  const fromCall = Math.min(card?.fromCall ?? 0, calls.length);
  const cardCalled = useCalledSet(fromCall > 0 ? calls.slice(fromCall) : calls);
  const latest = calls.length ? (calls[calls.length - 1] as number) : null;
  const freeIndex = state.free ? centerIndex(size) : null;
  const reduced = useReducedMotion();

  // ---- marks -------------------------------------------------------------
  const [manualMarks, setManualMarks] = useState<Set<number>>(() => new Set(card?.marks ?? []));
  const cardIdentity = card ? `${card.matchId}:${card.deal}:${card.serial}` : '';
  useEffect(() => {
    setManualMarks(new Set(card?.marks ?? []));
    // Only reset when a different card arrives (not on every re-send).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardIdentity]);
  const marks = useMemo(() => {
    if (!card) return new Set<number>();
    if (!state.autoMark) return manualMarks;
    const out = new Set<number>();
    card.cells.forEach((t, i) => {
      if (cardCalled.has(t)) out.add(i);
    });
    return out;
  }, [card, state.autoMark, manualMarks, cardCalled]);

  const toggleMark = useCallback(
    (i: number) => {
      if (!card || state.autoMark) return;
      const next = new Set(manualMarks);
      const marked = !next.has(i);
      if (marked) next.add(i);
      else next.delete(i);
      setManualMarks(next);
      sfx(marked ? 'pop' : 'tick');
      send(BINGO_MSG.mark, { cell: i, marked });
    },
    [card, state.autoMark, manualMarks, send],
  );

  // ---- local readiness (the server still decides) ----------------------
  const roundMasks = useMemo(() => (roundPlan?.patterns ?? []).flatMap((p) => p.masks.map(maskOf)), [roundPlan]);
  const { ready, target } = useMemo(() => {
    if (!card || roundMasks.length === 0) return { ready: false, target: null as boolean[] | null };
    const covered = card.cells.map((t, i) => i === freeIndex || (cardCalled.has(t) && (state.autoMark || marks.has(i))));
    let best: boolean[] | null = null;
    let bestMissing = Infinity;
    for (const m of roundMasks) {
      let miss = 0;
      for (let i = 0; i < m.length; i++) if (m[i] && !covered[i]) miss++;
      if (miss < bestMissing) {
        bestMissing = miss;
        best = m;
      }
    }
    return { ready: bestMissing === 0, target: best };
  }, [card, roundMasks, cardCalled, marks, state.autoMark, freeIndex]);

  // ---- claim / lockout -------------------------------------------------
  const myView = playerId ? state.bingo?.[playerId] : undefined;
  const lockedUntil = Math.max(myView?.lockedUntil ?? 0, card?.lockedUntil ?? 0);
  const [claimPending, setClaimPending] = useState(false);
  const [stamp, setStamp] = useState(0);
  const anyLocked = Object.values(state.bingo ?? {}).some((b) => b.lockedUntil > serverNow());
  const now = useTicker(anyLocked || stamp > 0, 250);
  const lockLeft = Math.max(0, Math.ceil((lockedUntil - serverNow()) / 1000));
  const iWon = Boolean(playerId && state.winners.some((w) => w.round === state.round && w.playerId === playerId));
  const roundOpen = phase === 'PLAYING' && (state.roundStatus === 'calling' || state.roundStatus === 'claiming');
  const canClaim = Boolean(card) && !isSpectator && roundOpen && lockLeft === 0 && !iWon && !claimPending;

  const claim = () => {
    if (!canClaim) return;
    setClaimPending(true);
    send(BINGO_MSG.claim, {});
  };
  useEffect(() => {
    if (!claimPending) return;
    const t = setTimeout(() => setClaimPending(false), 4000);
    return () => clearTimeout(t);
  }, [claimPending]);

  // ---- notices / celebration -------------------------------------------
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeId = useRef(0);
  const announce = useCallback((text: string, tone: Notice['tone'] = 'info') => {
    noticeId.current += 1;
    setNotice({ id: noticeId.current, text, tone });
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(t);
  }, [notice]);

  const [burst, setBurst] = useState<BurstInfo | null>(null);
  const [confetti, setConfetti] = useState(0);
  const burstSeq = useRef(0);

  useRoomMessage<BingoClaimResultPayload>(BINGO_MSG.claimResult, (r) => {
    setClaimPending(false);
    if (r.ok) return;
    if (r.reason === 'no_pattern') {
      sfx('error');
      setStamp(Date.now());
    } else {
      sfx('wrong');
      announce(r.message, 'warn');
    }
  });

  useRoomMessage<BingoEvent>(BINGO_MSG.event, (e) => {
    if (e.kind === 'winner') {
      const prize = plan[e.round - 1]?.prize ?? '';
      setBurst((prev) =>
        prev && prev.round === e.round
          ? { ...prev, winners: [...prev.winners.filter((w) => w.id !== e.playerId), { id: e.playerId, name: e.name }] }
          : { id: ++burstSeq.current, round: e.round, winners: [{ id: e.playerId, name: e.name }], patternName: e.patternName, meId: playerId, prize },
      );
      setConfetti((c) => c + 1);
      sfx(e.playerId === playerId ? 'bigwin' : 'bingo', 200);
      if (e.playerId === playerId) setStamp(0);
    } else if (e.kind === 'falseAlarm') {
      if (e.playerId !== playerId) {
        announce(`${e.name}'s BINGO was a false alarm!`, 'warn');
        sfx('wrong');
      }
    } else if (e.kind === 'undo') {
      announce(`The host took back ${tokenLabel(mode, e.token, items)}.`, 'info');
      sfx('back');
    } else if (e.kind === 'roundOver' && e.reason === 'exhausted') {
      announce('Every ball was called and nobody claimed.', 'warn');
    }
  });

  // ---- call arrival: sound, voice, "you have it!" ------------------------
  const [voice, setVoice] = useState(loadVoicePref);
  const prevCalls = useRef(calls.length);
  const cardCells = card?.cells;
  useEffect(() => {
    const prev = prevCalls.current;
    prevCalls.current = calls.length;
    if (calls.length <= prev || latest === null) return;
    sfx('ding', 120);
    synth.noise({ dur: 0.28, gain: 0.08, freq: 500, q: 0.8, to: 1600, type: 'bandpass' });
    if (voice) speak(spokenCall(mode, latest, items));
    if (cardCells?.includes(latest)) setTimeout(() => sfx('pop'), 380);
  }, [calls.length, latest, voice, mode, items, cardCells]);

  useEffect(() => {
    if (stamp === 0) return;
    const t = setTimeout(() => setStamp(0), Math.max(2600, lockedUntil - serverNow() + 400));
    return () => clearTimeout(t);
  }, [stamp, lockedUntil, serverNow]);

  // ---- side panel -------------------------------------------------------
  const [sideTab, setSideTab] = useState<'players' | 'chat'>('players');
  const rows = useMemo(() => standings(state, playerId), [state, playerId]);
  const pick =
    isHost && state.callerMode === 'manual' && state.manualPick && phase === 'PLAYING' && state.roundStatus === 'calling'
      ? (token: number) => send(BINGO_MSG.call, { value: token })
      : undefined;
  const board =
    mode === 'numbers' ? (
      <NumberBoard called={called} latest={latest} onPick={pick} />
    ) : (
      <TextBoard items={items} calls={calls} latest={latest} onPick={pick} />
    );
  const myWins = myView?.wins ?? 0;

  return (
    <div className="bg-play" data-spectator={isSpectator ? 'true' : undefined}>
      <div className="bg-hud">
        <CallerPanel
          state={state}
          items={items}
          onFirstCall={
            isHost && phase === 'PLAYING' && state.roundStatus === 'calling' && state.callerMode === 'manual' && calls.length === 0
              ? () => send(BINGO_MSG.call, {})
              : undefined
          }
          serverNow={serverNow}
          voice={voice}
          voiceAvailable={voiceSupported()}
          onVoice={(on) => {
            setVoice(on);
            saveVoicePref(on);
            if (on && latest !== null) speak(spokenCall(mode, latest, items));
          }}
        />
        <PatternPanel round={roundPlan} roundNo={state.round} totalRounds={state.totalRounds} size={size} freeIndex={freeIndex} />
        {isHost ? <HostControls state={state} send={send} phase={phase} /> : null}
      </div>

      <div className="bg-center">
        <div className="bg-status" aria-live="polite">
          {notice ? (
            <span key={notice.id} className="bg-status__notice" data-tone={notice.tone}>
              <PixelIcon name={notice.tone === 'warn' ? 'warning' : 'info'} /> {notice.text}
            </span>
          ) : state.roundStatus === 'claiming' ? (
            <span className="bg-status__notice" data-tone="win">
              <PixelIcon name="sparkle" /> BINGO! Checking for simultaneous claims…
            </span>
          ) : (
            <span className="bg-status__text">
              {state.totalRounds === 1 && roundPlan && !state.statusText.startsWith('Every')
                ? `First to ${roundPlan.title.charAt(0).toLowerCase()}${roundPlan.title.slice(1)} wins${roundPlan.prize ? ` · ${roundPlan.prize}` : ''}`
                : state.statusText || 'DAS Bingo'}
            </span>
          )}
          {myWins > 0 ? (
            <Badge color="var(--yellow)" icon="trophy">
              {myWins} win{myWins === 1 ? '' : 's'}
            </Badge>
          ) : null}
        </div>

        {isSpectator ? (
          <div className="bg-spectate">
            <p className="bg-spectate__note">
              <PixelIcon name="eye" /> You’re watching. Every call lights up below.
            </p>
            {board}
          </div>
        ) : card ? (
          <div className={cx('bg-card-wrap', stamp > 0 && !reduced && 'is-shaking')} key={cardIdentity}>
            <BingoCardView
              size={card.size}
              cells={card.cells}
              mode={mode}
              items={items}
              called={cardCalled}
              marks={marks}
              hints={!state.autoMark}
              target={phase === 'PLAYING' && !ready ? target : null}
              highlight={ready && phase === 'PLAYING' ? target : null}
              latest={latest}
              onCellClick={state.autoMark || phase !== 'PLAYING' ? undefined : toggleMark}
              serial={card.serial}
              title={`Card #${String(card.serial).padStart(4, '0')}`}
              label="Your bingo card"
            />
            {stamp > 0 ? <FalseAlarmStamp secondsLeft={lockLeft} /> : null}
          </div>
        ) : (
          <div className="bg-card-wait">
            <Spinner label="Dealing your card" /> Dealing your card…
          </div>
        )}

        {!isSpectator ? (
          <div className="bg-claim">
            {fromCall > 0 && card && phase === 'PLAYING' ? (
              <span className="bg-claim__hint">
                <PixelIcon name="info" /> You joined mid-round — only calls from here on count on your card
              </span>
            ) : !state.autoMark && card && phase === 'PLAYING' ? (
              <span className="bg-claim__hint">
                <PixelIcon name="pencil" /> Tap called squares to daub them
              </span>
            ) : null}
            <button
              type="button"
              className="bg-bingo-btn"
              data-ready={ready && canClaim ? 'true' : undefined}
              data-locked={lockLeft > 0 ? 'true' : undefined}
              disabled={!canClaim}
              onClick={claim}
              aria-label={iWon ? 'Your BINGO is verified' : lockLeft > 0 ? `Benched for ${lockLeft} seconds` : 'BINGO!'}
            >
              <span className="bg-bingo-btn__text">{iWon ? 'VERIFIED!' : lockLeft > 0 ? `BENCHED ${lockLeft}s` : claimPending ? 'CHECKING…' : 'BINGO!'}</span>
              {ready && canClaim ? <span className="bg-bingo-btn__sub">Your pattern is complete — call it!</span> : null}
            </button>
          </div>
        ) : null}
      </div>

      <aside className="bg-side">
        {!isSpectator ? (
          <section className="bg-side__board dc-panel" aria-label="Call board">
            <header className="bg-side__head">
              <span className="dc-panel__title">{mode === 'numbers' ? 'Call board' : 'Called squares'}</span>
              <Badge color="var(--accent)">
                {calls.length}/{state.poolSize}
              </Badge>
            </header>
            {board}
          </section>
        ) : null}
        <section className="bg-side__social dc-panel">
          <Tabs
            className="bg-side__tabs"
            label="Players and chat"
            value={sideTab}
            onChange={setSideTab}
            tabs={[
              { value: 'players', label: `Players ${rows.length}` },
              { value: 'chat', label: 'Chat' },
            ]}
          />
          <div className="bg-side__body">
            {sideTab === 'players' ? (
              <>
                <WinnersSoFar state={state} />
                <Leaderboard rows={rows} showProgress={state.showProgress} now={now + (serverNow() - Date.now())} />
              </>
            ) : (
              <ChatPanel className="bg-chat" placeholder="Cheer, groan, trash talk…" />
            )}
          </div>
        </section>
      </aside>

      {phase === 'INTERMISSION' ? <Intermission state={state} plan={plan} items={items} isHost={isHost} send={send} freeIndex={freeIndex} /> : null}
      {burst ? <BingoBurst info={burst} onDone={() => setBurst(null)} /> : null}
      <Confetti burst={confetti} />
      {phase === 'COUNTDOWN' ? (
        <div className="bg-deal-note">
          <PixelIcon name="sparkle" /> Shuffling cards…
        </div>
      ) : null}
    </div>
  );
}

function WinnersSoFar({ state }: { state: BingoPublicState }) {
  if (state.winners.length === 0) return null;
  return (
    <div className="bg-sofar" aria-label="Winners so far">
      {state.winners.map((w) => (
        <span key={`${w.round}-${w.playerId}`} className="bg-sofar__item">
          <PixelIcon name="trophy" /> R{w.round} · <strong>{w.name}</strong> · {w.patternName}
        </span>
      ))}
    </div>
  );
}
