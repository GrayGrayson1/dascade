/**
 * DASketch game view: HUD + canvas + tools in the middle, scoreboard and guess chat
 * around it (stacked on phones). Results get their own screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, PixelIcon, Spinner } from '@dascade/ui';
import type { BoardRejectReason } from '@dascade/game-core/dasketch';
import { GameStage } from '../../shell/common.tsx';
import { useApp } from '../../app/store.ts';
import { canvasStore } from './canvas/canvasStore.ts';
import { SketchCanvas } from './canvas/SketchCanvas.tsx';
import type { SketchRenderer } from './canvas/renderer.ts';
import { COMPACT_QUERY, useMediaQuery, useSketchGame, useSketchPrivate } from './hooks.ts';
import { SketchHud } from './Hud.tsx';
import { SketchToolbar, type ToolState } from './Toolbar.tsx';
import { ScoreStrip, Scoreboard, useScoreRows } from './Scoreboard.tsx';
import { SketchChat, type ChatMode } from './SketchChat.tsx';
import { ChooseWordOverlay, CorrectBurst, GetReadyOverlay, RevealOverlay, RoundBanner, WaitingOverlay } from './Overlays.tsx';
import { SketchResults } from './Results.tsx';
import { addToGallery, resetGallery } from './gallery.ts';
import { useSketchSounds } from './sounds.ts';

const LIMIT_TEXT: Partial<Record<BoardRejectReason, string>> = {
  stroke_too_long: 'That stroke is very long — lift the pen and keep going.',
  too_many_points: 'This canvas is packed! Undo or clear to keep drawing.',
  too_many_ops: 'This canvas is packed! Undo or clear to keep drawing.',
  too_many_fills: 'That’s all the paint-bucket fills for this turn — keep going with the brush.',
};

export function SketchGameView() {
  const game = useSketchGame();
  useSketchSounds(game?.playerId ?? null);
  if (!game) {
    return (
      <GameStage gameId="dasketch" className="sk-stage">
        <div className="center-screen">
          <Spinner label="Loading DASketch" />
        </div>
      </GameStage>
    );
  }
  if (game.phase === 'RESULTS' || game.state.stage === 'final') return <SketchResults />;
  return <SketchTable />;
}

function SketchTable() {
  const game = useSketchGame();
  const state = game?.state;
  const turn = state?.turn ?? 0;
  const priv = useSketchPrivate(turn);
  const compact = useMediaQuery(COMPACT_QUERY);
  const [tools, setTools] = useState<ToolState>({ tool: 'brush', color: '#16121f', size: 9 });
  const renderer = useRef<SketchRenderer | null>(null);
  const toast = useApp((s) => s.toast);
  const rows = useScoreRows(state ?? null, game?.players ?? []);

  const stage = state?.stage ?? 'idle';
  const phase = game?.phase;
  const meId = game?.playerId ?? null;
  const isSpectator = Boolean(game?.isSpectator);
  const isArtist = Boolean(state && meId && state.artistId === meId && (stage === 'choosing' || stage === 'drawing' || stage === 'reveal'));
  const canDraw = isArtist && stage === 'drawing' && phase === 'PLAYING' && Boolean(priv?.word);
  const knows = Boolean(priv?.word);

  // Viewers ask for a fresh canvas when the view mounts mid-turn (late join, reload).
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current || !state) return;
    mounted.current = true;
    if (state.stage !== 'idle' && !isArtist) canvasStore.requestSync(true);
  }, [state, isArtist]);

  // New match: clear last match's gallery.
  useEffect(() => {
    if (phase === 'COUNTDOWN') resetGallery();
  }, [phase]);

  // Capture each finished drawing for the results gallery.
  const word = state?.word ?? '';
  const artistId = state?.artistId ?? '';
  const artistName = (artistId && state?.players[artistId]?.name) || 'The artist';
  useEffect(() => {
    if (stage !== 'reveal' || !word) return;
    const t = setTimeout(() => {
      if (!renderer.current || canvasStore.board.isBlank()) return;
      addToGallery({ turn, word, artistId, artistName, src: renderer.current.thumbnail() });
    }, 120);
    return () => clearTimeout(t);
  }, [stage, word, turn, artistId, artistName]);

  const onRenderer = useCallback((r: SketchRenderer | null) => {
    renderer.current = r;
  }, []);
  const onReject = useCallback((reason: BoardRejectReason) => toast('warning', LIMIT_TEXT[reason] ?? 'That stroke could not be drawn.'), [toast]);

  if (!game || !state) return null;
  const artist = game.players.find((p) => p.id === state.artistId);
  const spectators = game.players.filter((p) => p.spectator).length;
  const chatMode: ChatMode =
    phase === 'PLAYING' && stage === 'drawing' ? (isSpectator ? 'spectator' : isArtist ? 'artist' : knows ? 'knower' : 'guess') : 'open';

  let overlay: React.ReactNode = null;
  if (phase === 'COUNTDOWN' || stage === 'idle') overlay = <GetReadyOverlay />;
  else if (stage === 'choosing') {
    overlay = isArtist && priv?.choices ? <ChooseWordOverlay key={turn} choices={priv.choices} endsAt={state.phaseEndsAt} /> : <WaitingOverlay artist={artist} round={state.round} totalRounds={state.totalRounds} />;
  } else if (stage === 'reveal') overlay = <RevealOverlay state={state} players={game.players} meId={meId} />;

  const canvas = (
    <SketchCanvas
      canDraw={canDraw}
      tool={tools.tool}
      color={tools.color}
      size={tools.size}
      label={canDraw ? `Your canvas. Draw “${priv?.word ?? ''}” — no letters!` : stage === 'drawing' ? `${artist?.name ?? 'The artist'} is drawing` : 'Drawing canvas'}
      onReject={onReject}
      onRenderer={onRenderer}
    >
      {overlay}
      <RoundBanner hidden={isArtist && stage === 'choosing'} />
      <CorrectBurst meId={meId} />
      {isSpectator ? (
        <Badge className="sk-spectating" color="var(--purple)" icon="eye">
          Spectating
        </Badge>
      ) : null}
    </SketchCanvas>
  );
  const toolbar = canDraw ? <SketchToolbar value={tools} onChange={setTools} compact={compact} /> : null;
  const hud = <SketchHud state={state} priv={priv} artistName={artist?.name ?? 'The artist'} isArtist={isArtist} />;
  const chat = <SketchChat mode={chatMode} meId={meId} inputFirst={compact} />;

  return (
    <GameStage gameId="dasketch" className="sk-stage">
      {compact ? (
        <div className="sk-table sk-table--compact" data-stage={stage} data-drawing={canDraw ? 'true' : undefined}>
          <div className="sk-main">
            {hud}
            {canvas}
            {toolbar}
          </div>
          <div className="sk-social">
            <ScoreStrip rows={rows} meId={meId} />
            {chat}
          </div>
        </div>
      ) : (
        <div className="sk-table" data-stage={stage} data-drawing={canDraw ? 'true' : undefined}>
          <aside className="sk-left" aria-label="Players">
            <Scoreboard rows={rows} meId={meId} spectators={spectators} />
            <SideTip isArtist={isArtist} stage={stage} knows={knows} />
          </aside>
          <section className="sk-center" aria-label="Drawing">
            {hud}
            {canvas}
            {toolbar}
          </section>
          <aside className="sk-right" aria-label="Guesses and chat">
            <div className="sk-right__board">
              <Scoreboard rows={rows} meId={meId} spectators={spectators} />
            </div>
            {chat}
          </aside>
        </div>
      )}
    </GameStage>
  );
}

function SideTip({ isArtist, stage, knows }: { isArtist: boolean; stage: string; knows: boolean }) {
  let text = 'Type guesses in the chat. Faster guesses score more!';
  let icon: 'bolt' | 'pencil' | 'check' | 'clock' = 'bolt';
  if (isArtist && stage === 'drawing') {
    text = 'Draw your word — no letters or numbers. You score when others guess it.';
    icon = 'pencil';
  } else if (knows) {
    text = 'You got it! Your chat now only reaches players who know the word.';
    icon = 'check';
  } else if (stage === 'reveal') {
    text = 'Next artist coming up…';
    icon = 'clock';
  }
  return (
    <div className="sk-tip">
      <PixelIcon name={icon} className="sk-tip__icon" />
      <p>{text}</p>
    </div>
  );
}
