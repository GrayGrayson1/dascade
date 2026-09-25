/**
 * Hosts the Phaser race view + HUD. The controller and Phaser game live for the
 * lifetime of this component; everything is torn down on unmount.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CircuitPublicState } from '@dascade/shared/games/circuit';
import { PixelIcon, ProgressBar } from '@dascade/ui';
import { useApp } from '../../app/store.ts';
import { useRoomSelector } from '../../net/hooks.ts';
import { RaceController } from './race/controller.ts';
import { HudBridge } from './hud/bridge.ts';
import { Hud } from './hud/Hud.tsx';
import { TouchControls } from './hud/TouchControls.tsx';
import { NetDebug } from './hud/NetDebug.tsx';
import { createRaceGame, type RaceGame } from './scene/createGame.ts';
import { ensureArtFonts } from './art/palette.ts';

declare global {
  interface Window {
    __CIRCUIT__?: { game: RaceGame['game']; controller: RaceController };
  }
}

export function RaceStage({ dimmed }: { dimmed: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ctrl] = useState(() => new RaceController(new HudBridge()));
  const fx = useApp((s) => s.settings.fx);
  const reducedMotion = useApp((s) => s.settings.reducedMotion);
  const [loading, setLoading] = useState({ progress: 0, ready: false });
  const ui = useSyncExternalStore(ctrl.subscribeUi, ctrl.getUi, ctrl.getUi);
  const boostOn = useRoomSelector((s: CircuitPublicState) => {
    try {
      return (JSON.parse(s.settingsJson) as { boost?: boolean }).boost !== false;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    ctrl.start();
    return () => ctrl.destroy();
  }, [ctrl]);

  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void ensureArtFonts().then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !fontsReady) return;
    const mobile = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || Math.min(window.innerWidth, window.innerHeight) < 560;
    let lastReport = -1;
    const rg = createRaceGame(el, {
      controller: ctrl,
      fx,
      reducedMotion,
      mobile,
      onProgress: (progress, ready) => {
        if (ready || progress - lastReport > 0.08) {
          lastReport = progress;
          setLoading({ progress, ready });
        }
      },
    });
    const ro = new ResizeObserver(() => rg.resize(el.clientWidth, el.clientHeight));
    ro.observe(el);
    window.__CIRCUIT__ = { game: rg.game, controller: ctrl };
    return () => {
      ro.disconnect();
      rg.destroy();
      if (window.__CIRCUIT__?.controller === ctrl) delete window.__CIRCUIT__;
    };
  }, [ctrl, fx, reducedMotion, fontsReady]);

  return (
    <div className="ci-race" data-dimmed={dimmed ? 'true' : undefined}>
      <div className="ci-canvas" ref={containerRef} />
      <Hud ctrl={ctrl} />
      {ui.touch && !ui.spectating && !dimmed ? <TouchControls sampler={ctrl.sampler} boost={boostOn !== false} /> : null}
      {ui.netDebug ? <NetDebug ctrl={ctrl} /> : null}
      {!loading.ready ? (
        <div className="ci-loading" role="status" aria-live="polite">
          <span className="dc-pixel">Building circuit</span>
          <ProgressBar value={Math.round(loading.progress * 100)} label="Loading track" />
        </div>
      ) : null}
      <div className="dc-rotate-hint ci-rotate" role="note">
        <PixelIcon name="refresh" /> Rotate for the widest view — or race on in portrait.
      </div>
    </div>
  );
}
