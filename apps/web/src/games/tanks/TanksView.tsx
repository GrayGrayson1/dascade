/**
 * DAS Tanks game view: the Phaser battlefield, HUD and gunner deck. The presenter
 * (playback) and aim controller live for the lifetime of this component; the Phaser game
 * is rebuilt only when graphics settings change. Drag anywhere on the battlefield to aim.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { TANK_GEOM, type TanksPublicState } from '@dascade/shared/games/tanks';
import { PixelIcon, ProgressBar } from '@dascade/ui';
import { GameStage } from '../../shell/common.tsx';
import { useApp } from '../../app/store.ts';
import { useRoomSelector } from '../../net/hooks.ts';
import { useSessionStore } from '../../net/session.ts';
import { BattlePresenter } from './model/presenter.ts';
import { AimController, bindKeyboard } from './model/aim.ts';
import { createBattleGame, type BattleGame } from './scene/createGame.ts';
import { ensureArtFonts } from './art/themes.ts';
import { TanksContext, useTanks, type TanksControllers } from './context.ts';
import { Hud, OverviewToggle } from './hud/Hud.tsx';
import { Controls } from './hud/Controls.tsx';
import { Results } from './Results.tsx';
import { tankSfx } from './audio.ts';

declare global {
  interface Window {
    __TANKS__?: { game: BattleGame['game']; scene: BattleGame['scene']; presenter: BattlePresenter; aim: AimController };
  }
}

/** World units of drag distance for full power. */
const AIM_RADIUS = 230;

export function TanksView() {
  const phase = useRoomSelector((s) => s.phase);
  const results = phase === 'RESULTS';
  return (
    <GameStage gameId="tanks" className="tk-stage">
      <Battlefield dimmed={results} />
      {results ? <Results /> : null}
    </GameStage>
  );
}

function Battlefield({ dimmed }: { dimmed: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [presenter] = useState(() => new BattlePresenter());
  const [aim] = useState(() => new AimController());
  const [overview, setOverview] = useState(false);
  const fx = useApp((s) => s.settings.fx);
  const reducedMotion = useApp((s) => s.settings.reducedMotion);
  const [ready, setReady] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  const gameRef = useRef<BattleGame | null>(null);
  const hudTop = useRef<HTMLElement | null>(null);
  const deck = useRef<HTMLElement | null>(null);
  const hasBattle = useRoomSelector((s: TanksPublicState) => Boolean(s.battle?.terrain));

  useEffect(() => {
    presenter.localAim = () => aim.live();
    presenter.start();
    aim.start();
    aim.onFire = () => tankSfx.aimTick();
    const unbind = bindKeyboard(aim);
    return () => {
      unbind();
      aim.destroy();
      presenter.destroy();
    };
  }, [presenter, aim]);

  useEffect(() => {
    let alive = true;
    void ensureArtFonts().then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const measure = useCallback(() => {
    const scene = gameRef.current?.scene;
    const root = containerRef.current;
    if (!scene || !root) return;
    const box = root.getBoundingClientRect();
    const top = hudTop.current ? Math.max(0, hudTop.current.getBoundingClientRect().bottom - box.top) : 64;
    const bottom = deck.current ? Math.max(0, box.bottom - deck.current.getBoundingClientRect().top) : 16;
    scene.setInsets(Math.min(box.height * 0.35, top + 6), Math.min(box.height * 0.5, bottom + 8));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !fontsReady || !hasBattle) return;
    const mobile = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || Math.min(window.innerWidth, window.innerHeight) < 560;
    const bg = createBattleGame(el, { presenter, fx, reducedMotion, mobile, onReady: () => setReady(true) });
    gameRef.current = bg;
    measure();
    const ro = new ResizeObserver(() => {
      bg.resize(el.clientWidth, el.clientHeight);
      measure();
    });
    ro.observe(el);
    window.__TANKS__ = { game: bg.game, scene: bg.scene, presenter, aim };
    return () => {
      ro.disconnect();
      bg.destroy();
      gameRef.current = null;
      if (window.__TANKS__?.presenter === presenter) delete window.__TANKS__;
    };
  }, [presenter, aim, fx, reducedMotion, fontsReady, hasBattle, measure]);

  useEffect(() => {
    if (gameRef.current) gameRef.current.scene.overview = overview;
  }, [overview, ready]);

  // Re-measure the insets whenever the HUD / deck resize (orientation, deck state).
  const observe = useMemo(() => {
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null;
    return {
      ro,
      ref: (slot: 'top' | 'deck') => (el: HTMLElement | null) => {
        const prev = slot === 'top' ? hudTop.current : deck.current;
        if (prev && ro) ro.unobserve(prev);
        if (slot === 'top') hudTop.current = el;
        else deck.current = el;
        if (el && ro) ro.observe(el);
        measure();
      },
    };
  }, [measure]);
  useEffect(() => () => observe.ro?.disconnect(), [observe]);
  const topRef = useMemo(() => observe.ref('top'), [observe]);
  const deckRef = useMemo(() => observe.ref('deck'), [observe]);

  // Drag (or tap) on the battlefield to aim: direction = angle, distance = power.
  const dragging = useRef<number | null>(null);
  const aimAt = (e: ReactPointerEvent<HTMLDivElement>) => {
    const scene = gameRef.current?.scene;
    const me = useSessionStore.getState().playerId;
    const tank = me ? presenter.tanks.get(me) : undefined;
    const box = containerRef.current?.getBoundingClientRect();
    if (!scene || !tank || !tank.alive || !box) return;
    const p = scene.screenToWorld(e.clientX - box.left, e.clientY - box.top);
    if (!p) return;
    const dx = p.x - tank.x;
    const dy = p.y - (tank.y + TANK_GEOM.pivot);
    let angle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
    if (angle < 0) angle = dx >= 0 ? 0 : 180;
    const power = Math.round((Math.hypot(dx, dy) / AIM_RADIUS) * 100);
    aim.setAngle(angle);
    aim.setPower(power);
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dimmed || !aim.getSnapshot().inBattle) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    aimAt(e);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current !== e.pointerId) return;
    aimAt(e);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current === e.pointerId) dragging.current = null;
  };

  const controllers: TanksControllers = useMemo(() => ({ presenter, aim, overview, setOverview }), [presenter, aim, overview]);
  const spectating = useRoomSelector((s: TanksPublicState) => {
    const id = useSessionStore.getState().playerId;
    return Boolean(id && s.players?.[id]?.spectator);
  });

  return (
    <TanksContext.Provider value={controllers}>
      <div className="tk-battle" data-part="battlefield" data-dimmed={dimmed ? 'true' : undefined}>
        <div
          className="tk-canvas"
          data-part="terrain"
          ref={containerRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          data-aimable={!spectating ? 'true' : undefined}
        />
        {!dimmed ? (
          <>
            <div className="tk-hud-top" data-part="hud-top" ref={topRef}>
              <Hud />
            </div>
            <div className="tk-hud-bottom">
              <div className="tk-hud-bottom__tools">
                <OverviewToggle />
                <KeyHints />
              </div>
              <Controls deckRef={deckRef} />
            </div>
          </>
        ) : null}
        {!ready ? (
          <div className="tk-loading" role="status" aria-live="polite">
            <span className="dc-pixel">Rolling out the battlefield</span>
            <ProgressBar value={hasBattle ? 0.7 : 0.3} label="Loading battlefield" />
          </div>
        ) : null}
        <div className="dc-rotate-hint tk-rotate" role="note">
          <PixelIcon name="refresh" /> Rotate for the widest battlefield — or play on in portrait.
        </div>
      </div>
    </TanksContext.Provider>
  );
}

function KeyHints() {
  const { aim } = useTanks();
  const a = useSyncExternalStore(aim.subscribe, aim.getSnapshot, aim.getSnapshot);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (!a.inBattle) return null;
  if (coarse) return <span className="tk-hints tk-hints--touch">Drag the battlefield to aim · tap FIRE</span>;
  return (
    <span className="tk-hints" aria-hidden>
      <span>
        <kbd>←</kbd>
        <kbd>→</kbd> angle
      </span>
      <span>
        <kbd>↑</kbd>
        <kbd>↓</kbd> power
      </span>
      <span>
        <kbd>A</kbd>
        <kbd>D</kbd> drive
      </span>
      <span>
        <kbd>Tab</kbd> weapon
      </span>
      <span>
        <kbd>Space</kbd> fire
      </span>
    </span>
  );
}
