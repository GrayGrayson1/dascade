/** F3 / ?netdebug=1 overlay: netcode + renderer stats and client-side latency/jitter simulation. */
import { useEffect, useState } from 'react';
import { Button } from '@dascade/ui';
import { useSessionStore } from '../../../net/session.ts';
import type { KartController } from '../race/controller.ts';
import type { NetStats } from '../net/netClient.ts';
import type { KartRenderStats } from '../render/types.ts';

const LAGS = [0, 60, 120, 200, 350];
const JITTERS = [0, 15, 40, 80];

export function NetDebug({ ctrl, renderer }: { ctrl: KartController; renderer: { stats(): KartRenderStats } | null }) {
  const [stats, setStats] = useState<NetStats>(() => ctrl.netStats());
  const [gfx, setGfx] = useState<KartRenderStats | null>(null);
  const [cfg, setCfg] = useState(() => ({ ...ctrl.netSim.config }));
  const ping = useSessionStore((s) => s.pingMs);
  useEffect(() => {
    const t = setInterval(() => {
      setStats(ctrl.netStats());
      setGfx(renderer?.stats() ?? null);
    }, 250);
    return () => clearInterval(t);
  }, [ctrl, renderer]);
  const apply = (next: typeof cfg) => {
    setCfg(next);
    ctrl.setNetSim(next);
  };
  const cycle = (list: number[], value: number) => list[(list.indexOf(value) + 1) % list.length] ?? 0;
  const rows: Array<[string, string]> = [
    ['Ping (clock sync)', ping === null ? '—' : `${ping} ms`],
    ['Input RTT', `${stats.rttMs} ms`],
    ['Jitter', `${stats.jitterMs} ms`],
    ['Interp delay', `${stats.interpDelayMs} ms`],
    ['Snapshot buffer', `${stats.buffered}`],
    ['Snapshots/s', `${stats.snapsPerSec}`],
    ['Downlink', `${stats.kbps} kbit/s`],
    ['Unacked inputs', `${stats.pendingInputs}`],
    ['Corrections', `${stats.corrections} (last ${stats.lastCorrection} u)`],
    ['Extrapolations', `${stats.extrapolating}`],
    ['Server tick', `${stats.serverTick}`],
    ['Packets sent / held', `${stats.packetsSent} / ${stats.packetsHeld}`],
    [
      'Own states / predicting',
      `${ctrl.net.ownSeen} / ${ctrl.net.predicting ? 'yes' : 'no'}${ctrl.net.ownRejected ? ` (${ctrl.net.ownRejected})` : ''}`,
    ],
  ];
  if (gfx) {
    rows.push(['FPS / frame', `${Math.round(gfx.fps)} / ${gfx.frameMs.toFixed(1)} ms`]);
    rows.push(['Draw calls / tris', `${gfx.drawCalls} / ${Math.round(gfx.triangles / 1000)}k`]);
    rows.push(['Quality / DPR', `${gfx.quality} / ${gfx.pixelRatio.toFixed(2)}`]);
  }
  return (
    <aside className="kh-netdebug" aria-label="Network debug">
      <header>
        <b>NET DEBUG</b> <span>F3</span>
      </header>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="kh-netdebug__sim">
        <Button size="sm" onClick={() => apply({ ...cfg, lagMs: cycle(LAGS, cfg.lagMs) })}>
          Sim lag {cfg.lagMs} ms
        </Button>
        <Button size="sm" onClick={() => apply({ ...cfg, jitterMs: cycle(JITTERS, cfg.jitterMs) })}>
          Jitter ±{cfg.jitterMs} ms
        </Button>
      </div>
    </aside>
  );
}
