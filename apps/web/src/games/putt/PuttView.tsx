/**
 * DAS Putt game view (immersive): full-bleed course canvas with HUD chrome around it. The
 * chrome is measured so the camera fits the hole into the free space between the top plate,
 * the leaderboard and the aim dock on every screen size.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PuttPublicState } from '@dascade/shared/games/putt';
import { GameStage } from '../../shell/common.tsx';
import { useRoomSelector } from '../../net/hooks.ts';
import { PuttController } from './game/controller.ts';
import type { Insets } from './game/camera.ts';
import { CourseCanvas } from './CourseCanvas.tsx';
import { AimDock, Callouts, HoleIntro, Leaderboard, ScorecardModal, TopHud } from './hud/Hud.tsx';
import { HoleSummary } from './HoleSummary.tsx';
import { Results } from './Results.tsx';

function useTouch(): boolean {
  const [touch, setTouch] = useState(() => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(pointer: coarse)');
    const on = () => setTouch(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return touch;
}

const key = (list: Insets[]) => list.map((i) => `${i.top},${i.right},${i.bottom},${i.left}`).join('|');

export function PuttView() {
  const phase = useRoomSelector<PuttPublicState, string>((s) => s.phase);
  const [ctrl] = useState(() => new PuttController());
  const [cardOpen, setCardOpen] = useState(false);
  const touch = useTouch();
  const stageRef = useRef<HTMLDivElement>(null);
  const [insets, setInsets] = useState<Insets[]>([{ top: 64, right: 12, bottom: 110, left: 12 }]);

  useEffect(() => {
    ctrl.start();
    return () => ctrl.destroy();
  }, [ctrl]);

  /**
   * Candidate camera insets around the HUD chrome. A narrow leaderboard can sit beside the hole
   * or above it — the renderer picks whichever lets the hole be drawn larger. A dock parked at
   * the right edge (short landscape phones) reserves width instead of height.
   */
  const measure = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    const top = stage.querySelector<HTMLElement>('.pt-top');
    const board = stage.querySelector<HTMLElement>('.pt-board');
    const dock = stage.querySelector<HTMLElement>('.pt-dock');
    const base = { top: 10, right: 10, bottom: 10, left: 10 };
    if (top) base.top = Math.max(base.top, top.getBoundingClientRect().bottom - r.top + 6);
    if (dock) {
      const dr = dock.getBoundingClientRect();
      if (dr.left > r.left + r.width * 0.5 && dr.width < r.width * 0.4) base.right = Math.max(base.right, r.right - dr.left + 8);
      else base.bottom = Math.max(base.bottom, r.bottom - dr.top + 6);
    }
    const list: Insets[] = [];
    if (board) {
      const br = board.getBoundingClientRect();
      list.push({ ...base, top: Math.max(base.top, br.bottom - r.top + 6) });
      if (br.width < r.width * 0.45) list.push({ ...base, left: Math.max(base.left, br.right - r.left + 8) });
    } else list.push(base);
    const next = list.map((i) => ({ top: Math.round(i.top), right: Math.round(i.right), bottom: Math.round(i.bottom), left: Math.round(i.left) }));
    setInsets((prev) => (key(prev) === key(next) ? prev : next));
  }, []);

  useLayoutEffect(() => {
    measure();
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(stage);
    for (const el of stage.querySelectorAll('.pt-top, .pt-board, .pt-dock')) ro.observe(el);
    // Chrome elements mount/unmount with the phase: re-observe on DOM changes.
    const mo = new MutationObserver(() => {
      for (const el of stage.querySelectorAll('.pt-top, .pt-board, .pt-dock')) ro.observe(el);
      measure();
    });
    mo.observe(stage, { childList: true, subtree: false });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [measure]);

  return (
    <GameStage gameId="putt" className="pt-stage">
      <div className="pt-layout" ref={stageRef} data-touch={touch ? 'true' : undefined}>
        <CourseCanvas ctrl={ctrl} insets={insets} />
        <TopHud ctrl={ctrl} onScorecard={() => setCardOpen(true)} />
        <Leaderboard />
        <AimDock ctrl={ctrl} touch={touch} />
        <HoleIntro />
        <Callouts ctrl={ctrl} />
        {phase === 'INTERMISSION' ? <HoleSummary /> : null}
        {phase === 'RESULTS' ? <Results /> : null}
      </div>
      <ScorecardModal open={cardOpen} onClose={() => setCardOpen(false)} />
    </GameStage>
  );
}
