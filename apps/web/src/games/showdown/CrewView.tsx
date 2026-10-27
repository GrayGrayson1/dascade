/**
 * The crew screen (ADM-04, JOI-02, OPS-03): for crew who aren't presenting — a moderator, a backup
 * presenter, or a producer on a second device — in every phase. A header with their role(s) in words,
 * the stage preview (what the audience sees, never an answer), and the tabs their permissions allow:
 * Names, Crew & log, Preflight. A backup presenter can take the show here while the presenter is
 * offline (the server refuses it while they're online). Crew are never in the picker pool. Single
 * column on phones.
 */
import { useEffect, useState } from 'react';
import {
  SHOWDOWN_ROLE_INFO,
  showTitle,
  type ShowdownLook,
  type ShowdownPublicState,
  type ShowdownSettings,
} from '@dascade/shared/games/showdown';
import { Button, PixelIcon, Tabs } from '@dascade/ui';
import { useRoomSelector } from '../../net/hooks.ts';
import { useSessionStore } from '../../net/session.ts';
import { sfx } from '../../audio/audio.ts';
import { GameStage, LeaveButton } from '../../shell/common.tsx';
import { hidesArcadeExit } from '../../shell/arcadeExit.ts';
import { Stage } from './Stage.tsx';
import { showdownApi } from './api.ts';
import { CrewPanel, NamesPanel, PreflightPanel } from './panels/index.ts';
import { CREW_TAB_LABEL, crewTabs, roleWords, type CrewTab } from './panels/tabs.ts';
import { useCrew, useRehearsal } from './state.ts';
import './panels/panels.css';

interface PresenterInfo {
  name: string;
  connected: boolean;
}

export function CrewView({ look, settings, code }: { look: ShowdownLook; settings: ShowdownSettings | null; code: string }) {
  const crew = useCrew();
  const rehearsal = useRehearsal();
  const presenter = useRoomSelector<ShowdownPublicState, PresenterInfo | null>((s) => {
    const p = s.presenterId ? s.players[s.presenterId] : undefined;
    return p ? { name: p.name, connected: p.connected } : null;
  });
  const phase = useRoomSelector<ShowdownPublicState, string>((s) => s.phase) ?? 'LOBBY';
  const tabs = crewTabs(crew?.perms ?? []);
  const tabKey = tabs.join(',');
  const [tab, setTab] = useState<CrewTab | null>(tabs[0] ?? null);
  // Permissions can change (a revoked link, a new role): keep the open tab valid.
  useEffect(() => {
    const list = tabKey ? (tabKey.split(',') as CrewTab[]) : [];
    setTab((t) => (t && list.includes(t) ? t : (list[0] ?? null)));
  }, [tabKey]);

  const roles = crew?.roles ?? [];
  const title = settings ? showTitle(settings) : '';
  const where = phase === 'LOBBY' || phase === 'COUNTDOWN' ? 'Before the show' : phase === 'RESULTS' ? 'After the show' : 'Show running';

  return (
    <GameStage gameId="showdown" className="sd-room sdp-crewview">
      <div className="sdp-crewview__grid" data-look={look}>
        <header className="sdp-crewbar" data-part="showdown-crew-screen">
          <div className="sdp-crewbar__who">
            <span className="sdp-crewbar__kicker">
              <PixelIcon name="crown" /> You’re crew
            </span>
            <h2 className="sdp-crewbar__roles">{roleWords(roles, SHOWDOWN_ROLE_INFO) || 'Crew'}</h2>
            <span className="sdp-crewbar__where">
              {title ? `${title} · ` : ''}
              {where}
              {rehearsal ? ' · Rehearsal' : ''} · Room <span className="dc-num">{code}</span>
            </span>
          </div>
          {hidesArcadeExit('showdown') ? null : <LeaveButton size="sm" collapseLabel />}
        </header>

        <p className="sdp-crewnote">
          <PixelIcon name="info" />
          <span>
            You’re crew, so you’re not in the picker pool. Presenter: <b>{presenter ? presenter.name : 'nobody'}</b>
            {presenter ? (presenter.connected ? ' (online)' : ' (offline)') : ''}.
          </span>
        </p>

        <div className="sdp-crewview__stage sd-preview" role="img" aria-label="Stage preview: what the audience sees">
          <Stage look={look} settings={settings} variant="preview" />
        </div>

        <div className="sdp-crewview__tools">
          {roles.includes('backup') ? <BackupTakeover presenter={presenter} /> : null}
          {tabs.length > 1 ? (
            <Tabs
              label="Crew tools"
              value={tab ?? tabs[0]!}
              tabs={tabs.map((t) => ({ value: t, label: CREW_TAB_LABEL[t] }))}
              onChange={setTab}
            />
          ) : null}
          {tab ? (
            <div role={tabs.length > 1 ? 'tabpanel' : undefined} aria-label={CREW_TAB_LABEL[tab]} className="sdp-crewview__panel">
              {tab === 'names' ? (
                <NamesPanel />
              ) : tab === 'crew' ? (
                <CrewPanel code={code} />
              ) : (
                <PreflightPanel look={look} code={code} title={title} />
              )}
            </div>
          ) : !roles.includes('backup') ? (
            <p className="sdp-empty">Your role has no tools on this screen right now.</p>
          ) : null}
        </div>
      </div>
    </GameStage>
  );
}

/**
 * A backup presenter's one button: take the show while the presenter is offline. The server checks
 * again (it refuses while the presenter is online) and logs it; nobody has to reload.
 */
function BackupTakeover({ presenter }: { presenter: PresenterInfo | null }) {
  const myId = useSessionStore((s) => s.playerId);
  const offline = !presenter || !presenter.connected;
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (!offline) setSent(false);
  }, [offline]);
  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(() => setSent(false), 4000);
    return () => clearTimeout(t);
  }, [sent]);
  const name = presenter?.name ?? 'the presenter';
  return (
    <section className="sdp-panel sdp-backup" aria-labelledby="sdp-backup-title" data-part="showdown-backup">
      <h3 className="sd-panel__title" id="sdp-backup-title">
        <PixelIcon name="crown" /> Backup presenter
      </h3>
      <p className="sdp-lead">
        If the presenter drops, you can take over here: the console comes to you with the same board and clock, and nobody has to reload.
      </p>
      <p className="sdp-status" data-state={offline ? 'silent' : 'ok'} role="status">
        <span className="sdp-status__icon" aria-hidden>
          {offline ? '!' : '✓'}
        </span>
        <span>
          {offline
            ? `${presenter ? `${name} is offline` : 'There’s no presenter'} — you can take over now.`
            : `${name} is online. Take over opens if they drop.`}
        </span>
      </p>
      <Button
        variant={offline ? 'primary' : 'secondary'}
        icon="crown"
        disabled={!offline || !myId || sent}
        loading={sent}
        onClick={() => {
          if (!myId) return;
          sfx('select');
          setSent(true);
          showdownApi.assign(myId, 'The presenter is offline');
        }}
        data-part="showdown-backup-takeover"
      >
        Take over the show
      </Button>
    </section>
  );
}
