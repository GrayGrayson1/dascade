/** F3 / ?netdebug=1 overlay: live netcode stats + client-side latency/jitter simulation. */
import { useEffect, useState } from 'react';
import { Button } from '@dascade/ui';
import { useSessionStore } from '../../../net/session.ts';
import type { RaceController } from '../race/controller.ts';
import type { NetStats } from '../net/netClient.ts';

const LAGS = [0, 60, 120, 200, 350];
const JITTERS = [0, 15, 40, 80];

export function NetDebug({ ctrl }: { ctrl: RaceController }) {
  const [stats, setStats] = useState<NetStats>(() => ctrl.netStats());
  const [cfg, setCfg] = useState(() => ({ ...ctrl.netSim.config }));
  const ping = useSessionStore((s) => s.pingMs);
  useEffect(() => {
    const t = setInterval(() => setStats(ctrl.netStats()), 250);
    return () => clearInterval(t);
  }, [ctrl]);
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
    ['Corrections', `${stats.corrections} (last ${stats.lastCorrectionPx}px)`],
    ['Extrapolations', `${stats.extrapolating}`],
    ['Server tick', `${stats.serverTick}`],
    ['Packets sent / held', `${stats.packetsSent} / ${stats.packetsHeld}`],
  ];
  return (
    <aside className="ci-netdebug" aria-label="Network debug">
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
      <div className="ci-netdebug__sim">
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
