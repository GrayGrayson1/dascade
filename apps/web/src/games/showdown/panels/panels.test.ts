import { describe, expect, it } from 'vitest';
import {
  SHOWDOWN_AUDIT_ACTIONS,
  SHOWDOWN_NO_SHOW_MS,
  SHOWDOWN_PICK_LAND_MS,
  SHOWDOWN_ROLE_INFO,
  SHOWDOWN_ROLE_PERMISSIONS,
  permissionsOf,
  type ShowdownAuditEntry,
  type ShowdownPreflightData,
} from '@dascade/shared/games/showdown';
import { auditActor, auditFileName, auditReason, auditRole, auditSentence, auditWords, newestFirst, untilWords } from './audit.ts';
import { buildPeople, filterPeople, peopleSummary, type PeopleInput } from './people.ts';
import { foldDraw, formatElapsed, pickerPhase, type DrawLine } from './picker.ts';
import { evaluatePreflight, formatUptime, preflightSummary, type PreflightInput } from './preflight.ts';
import { shortcutBlockedBy, type GuardEvent } from './shortcuts.ts';
import { crewTabs, roleWords } from './tabs.ts';

// ---------------------------------------------------------------------------
// Picker strip
// ---------------------------------------------------------------------------

describe('picker strip phases', () => {
  const base = { mode: 'showcase' as const, stage: 'live' as const, hotSeat: '', hotName: '', landAt: 0, poolSize: 12 };

  it('is off before round 1 and outside Presenter Showcase', () => {
    expect(pickerPhase({ ...base, stage: 'intro' }, 0)).toEqual({ kind: 'off', why: 'intro' });
    expect(pickerPhase({ ...base, mode: 'classic' }, 0)).toEqual({ kind: 'off', why: 'mode' });
  });

  it('is ready with the pool size, and says when the pool is empty', () => {
    expect(pickerPhase(base, 0)).toEqual({ kind: 'ready', pool: 12 });
    expect(pickerPhase({ ...base, poolSize: 0 }, 0)).toEqual({ kind: 'empty' });
  });

  it('names the winner at once, counting "on stage in 2 s" down to landAt − 1500', () => {
    const pickAt = 1_000_000;
    const hot = { ...base, hotSeat: 'p1', hotName: 'Priya S.', landAt: pickAt + SHOWDOWN_PICK_LAND_MS };
    expect(pickerPhase(hot, pickAt)).toEqual({ kind: 'heads', name: 'Priya S.', seconds: 2 });
    expect(pickerPhase(hot, pickAt + 1200)).toEqual({ kind: 'heads', name: 'Priya S.', seconds: 1 });
    const converge = pickerPhase(hot, pickAt + 2000);
    expect(converge.kind).toBe('answering');
  });

  it('counts the answer time from the landing and opens Reroll after 30 s', () => {
    const landAt = 2_000_000;
    const hot = { ...base, hotSeat: 'p1', hotName: 'Priya S.', landAt };
    const at12 = pickerPhase(hot, landAt + 12_400);
    expect(at12).toMatchObject({ kind: 'answering', elapsedMs: 12_400 });
    expect(at12.kind === 'answering' && at12.rerollInMs > 0).toBe(true);
    const at30 = pickerPhase(hot, landAt + SHOWDOWN_NO_SHOW_MS);
    expect(at30.kind === 'answering' && at30.rerollInMs <= 0).toBe(true);
    // During the converge (before the landing) the clock shows 0:00.
    expect(pickerPhase(hot, landAt - 500)).toMatchObject({ kind: 'answering', elapsedMs: 0 });
  });

  it('treats a hot seat without a landing time (a restored show) as on stage, Reroll open', () => {
    expect(pickerPhase({ ...base, hotSeat: 'p1', hotName: '' }, 5)).toEqual({
      kind: 'answering',
      name: 'Someone',
      elapsedMs: null,
      rerollInMs: 0,
    });
  });

  it('formats the answer clock', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(12_900)).toBe('0:12');
    expect(formatElapsed(90_000)).toBe('1:30');
    expect(formatElapsed(-5)).toBe('0:00');
  });

  it('keeps a draw history from pick / pickEnd events, ignoring repeats', () => {
    let list: DrawLine[] = [];
    list = foldDraw(list, { type: 'pick', drawNo: 1, name: 'Priya', reroll: false }, 10);
    list = foldDraw(list, { type: 'pick', drawNo: 1, name: 'Priya', reroll: false }, 11);
    expect(list).toHaveLength(1);
    list = foldDraw(list, { type: 'pickEnd', drawNo: 1, how: 'reroll' }, 12);
    list = foldDraw(list, { type: 'pick', drawNo: 2, name: 'Sam', reroll: true }, 13);
    list = foldDraw(list, { type: 'pickEnd', drawNo: 2, how: 'done' }, 14);
    expect(list.map((l) => [l.drawNo, l.how, l.reroll])).toEqual([
      [2, 'done', true],
      [1, 'reroll', false],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Permission-based tabs
// ---------------------------------------------------------------------------

describe('crew tabs follow permissions (deny by default)', () => {
  it('gives each role preset exactly its tabs', () => {
    expect(crewTabs(permissionsOf(['moderator']))).toEqual(['names']);
    expect(crewTabs(permissionsOf(['producer']))).toEqual(['names', 'crew', 'preflight']);
    expect(crewTabs(permissionsOf(['presenter']))).toEqual(['names', 'crew', 'preflight']);
    expect(crewTabs(permissionsOf(['backup']))).toEqual([]);
  });

  it('grants nothing for unknown roles or no permissions', () => {
    expect(crewTabs(permissionsOf(['janitor']))).toEqual([]);
    expect(crewTabs([])).toEqual([]);
    // Picker powers alone (an ordinary showcase room) open no crew tab.
    expect(crewTabs(['picker.run', 'picker.reroll'])).toEqual([]);
  });

  it('opens a tab for any one of its permissions', () => {
    expect(crewTabs(['people.hide'])).toEqual(['names']);
    expect(crewTabs(['audit.read'])).toEqual(['crew']);
    expect(crewTabs(['preflight.read'])).toEqual(['preflight']);
    expect(SHOWDOWN_ROLE_PERMISSIONS.moderator).not.toContain('audit.read');
  });

  it('writes roles in words, in a stable order', () => {
    expect(roleWords(['moderator', 'producer', 'moderator'], SHOWDOWN_ROLE_INFO)).toBe('Producer · Moderator');
    expect(roleWords(['backup'], SHOWDOWN_ROLE_INFO)).toBe('Backup presenter');
  });
});

// ---------------------------------------------------------------------------
// Audit wording
// ---------------------------------------------------------------------------

const entry = (over: Partial<ShowdownAuditEntry>): ShowdownAuditEntry => ({
  seq: 1,
  at: 0,
  actorId: 'm1',
  actorName: 'Ravi P.',
  role: 'moderator',
  action: 'people.rename',
  ...over,
});

describe('audit log in plain words', () => {
  it('words every action the server can log (none falls through to its code)', () => {
    for (const action of SHOWDOWN_AUDIT_ACTIONS) {
      const words = auditWords(entry({ action, target: 'p9', targetName: 'Zoe H.', before: 'A', after: 'B' }));
      expect(words, action).not.toBe(action);
      expect(words.length, action).toBeGreaterThan(5);
      // Raw ids never show.
      expect(words, action).not.toContain('p9');
    }
  });

  it('says renames and hides with their names', () => {
    expect(auditWords(entry({ target: 'p9', before: 'xXghostXx', after: 'Zoe H.' }))).toBe('renamed “xXghostXx” to “Zoe H.”');
    expect(auditWords(entry({ action: 'people.hide', target: 'p9', targetName: 'Zoe H.' }))).toBe(
      'hid Zoe H. from the stage and the picker',
    );
    expect(auditWords(entry({ action: 'people.unhide', target: 'p9', targetName: 'Zoe H.' }))).toBe('put Zoe H. back on the stage');
  });

  it('says presenter changes, crew links and the sound station as the server records them', () => {
    expect(auditWords(entry({ action: 'presenter.assign', targetName: 'Dana', before: 'Marcus', after: 'Dana' }))).toBe(
      'made Dana the presenter (was Marcus)',
    );
    expect(auditWords(entry({ action: 'crew.issue', targetName: 'Ravi', after: 'moderator' }))).toBe('issued a moderator link for Ravi');
    expect(auditWords(entry({ action: 'crew.revoke', targetName: 'Ravi', before: 'backup' }))).toBe('revoked Ravi’s backup presenter link');
    expect(auditWords(entry({ action: 'audio.station', target: 's1', after: 'Stage laptop' }))).toBe(
      'moved the sound station to Stage laptop',
    );
    expect(auditWords(entry({ action: 'picker.draw', targetName: 'Priya', before: '12 in the pool', after: 'draw 3' }))).toBe(
      'drew Priya (draw 3, 12 in the pool)',
    );
  });

  it('names the actor and role, and the server for automatic entries', () => {
    expect(auditActor(entry({}))).toBe('Ravi P.');
    expect(auditRole(entry({}))).toBe('Moderator');
    const server = entry({ actorId: '', actorName: 'Server', role: 'server', action: 'audio.failover', before: 'Big screen' });
    expect(auditActor(server)).toBe('The server');
    expect(auditRole(server)).toBe('');
    expect(
      auditSentence(entry({ action: 'picker.reroll', targetName: 'Sam', reason: 'No answer', role: 'presenter', actorName: 'Marcus' })),
    ).toBe('Marcus (Presenter) rerolled and drew Sam. Reason: No answer');
  });

  it('maps reroll reason codes to words and keeps free text', () => {
    expect(auditReason({ reason: 'away' })).toBe('Not there');
    expect(auditReason({ reason: 'Planned hand-over' })).toBe('Planned hand-over');
    expect(auditReason({})).toBe('');
  });

  it('lists newest first and names the download', () => {
    const list = newestFirst([entry({ seq: 1 }), entry({ seq: 3 }), entry({ seq: 2 })]);
    expect(list.map((e) => e.seq)).toEqual([3, 2, 1]);
    expect(auditFileName('ABCDE')).toBe('dasoween-audit-ABCDE.json');
    expect(auditFileName('../x')).toBe('dasoween-audit-x.json');
  });

  it('says how long until a link expires', () => {
    expect(untilWords(1000 + 23 * 3600_000, 1000)).toBe('in 23 h');
    expect(untilWords(40 * 60_000, 0)).toBe('in 40 min');
    expect(untilWords(0, 10)).toBe('now');
  });
});

// ---------------------------------------------------------------------------
// Names panel
// ---------------------------------------------------------------------------

const player = (id: string, name: string, joinOrder: number, extra: { connected?: boolean; spectator?: boolean } = {}) => ({
  id,
  name,
  joinOrder,
  connected: extra.connected ?? true,
  spectator: extra.spectator ?? false,
});

const room = (over: Partial<PeopleInput> = {}): PeopleInput => ({
  players: {
    host: player('host', 'Marcus', 0),
    tv: player('tv', 'Stage laptop', 1),
    mod: player('mod', 'Ravi', 2),
    a: player('a', 'Priya', 3),
    b: player('b', 'xXghostXx', 4),
    c: player('c', 'Sam', 5, { connected: false }),
    w: player('w', 'Watcher', 6, { spectator: true }),
  },
  presenterId: 'host',
  screens: { tv: true },
  seats: { a: true, c: true },
  myId: 'mod',
  meCrew: true,
  crewIds: null,
  hiddenIds: null,
  ...over,
});

describe('names panel model', () => {
  it('lists everyone but big screens, with states in words', () => {
    const rows = buildPeople(room());
    expect(rows.find((r) => r.id === 'tv')).toBeUndefined();
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.host!.status).toBe('presenter');
    expect(by.mod!.status).toBe('crew');
    expect(by.mod!.me).toBe(true);
    expect(by.a!.status).toBe('onstage');
    expect(by.c!.away).toBe(true);
    expect(by.w!.status).toBe('watching');
    // Without the crew list, an unseated guest might be crew: say "Not on stage", not "Hidden".
    expect(by.b!.status).toBe('offstage');
    expect(by.b!.guest).toBe(true);
    expect(by.host!.guest).toBe(false);
  });

  it('says Hidden when the crew are known (or the server lists who is hidden)', () => {
    expect(buildPeople(room({ crewIds: ['mod'] })).find((r) => r.id === 'b')!.status).toBe('hidden');
    const listed = buildPeople(room({ hiddenIds: ['b'], seats: {} }));
    expect(listed.find((r) => r.id === 'b')!.status).toBe('hidden');
    expect(listed.find((r) => r.id === 'a')!.status).toBe('onstage');
  });

  it('puts the presenter and crew first, then hidden guests, then everyone in join order', () => {
    const rows = buildPeople(room({ crewIds: ['mod'] }));
    expect(rows.map((r) => r.id)).toEqual(['host', 'mod', 'b', 'a', 'c', 'w']);
  });

  it('filters by name ignoring case and accents, and summarises', () => {
    const rows = buildPeople(room({ players: { ...room().players!, z: player('z', 'Zoë', 7) }, seats: { a: true, c: true, z: true } }));
    expect(filterPeople(rows, 'zoe').map((r) => r.name)).toEqual(['Zoë']);
    expect(filterPeople(rows, '  ').length).toBe(rows.length);
    expect(peopleSummary(buildPeople(room({ crewIds: ['mod'] })))).toBe('6 people · 2 on stage · 1 hidden · 1 away');
  });
});

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

const facts = (over: Partial<ShowdownPreflightData> = {}): ShowdownPreflightData => ({
  at: 100_000,
  uptimeSeconds: 3 * 3600 + 12 * 60,
  startedAt: 0,
  commit: 'abc1234def',
  event: 'dasoween-2026',
  rehearsal: false,
  rounds: 2,
  specials: 2,
  backups: { issued: 1, online: 1 },
  station: { playerId: '', name: 'Marcus', ready: true, seenAgoMs: 1000 },
  blackbox: true,
  ...over,
});

const ready = (over: Partial<PreflightInput> = {}): PreflightInput => ({
  data: facts(),
  event: true,
  now: 100_000,
  presenterDevice: true,
  stageOpen: true,
  stageOpened: true,
  popupBlocked: false,
  station: { name: 'Marcus', seenAt: 98_000, ready: true },
  local: { ready: true, muted: false, sounds: true },
  manual: { share: true, join: true, freeze: true },
  customRounds: 2,
  ...over,
});

const row = (rows: ReturnType<typeof evaluatePreflight>, id: string) => rows.find((r) => r.id === id)!;

describe('preflight', () => {
  it('is GO when everything checks out (OPS-03: share window, sound, show, backup, server)', () => {
    const rows = evaluatePreflight(ready());
    expect(rows.map((r) => r.id)).toEqual(['stage', 'share', 'sound', 'show', 'backup', 'server', 'blackbox', 'popups', 'join', 'freeze']);
    expect(rows.every((r) => r.state === 'ok')).toBe(true);
    expect(row(rows, 'sound').detail).toBe('Sound: Marcus ✓ heard 2 s ago');
    expect(row(rows, 'server').detail).toBe('Up 3 h 12 min · not recently deployed · commit abc1234');
    expect(preflightSummary(rows)).toMatchObject({ verdict: 'go', headline: 'GO' });
  });

  it('fails without a stage window, with its fix', () => {
    const rows = evaluatePreflight(ready({ stageOpen: false }));
    expect(row(rows, 'stage')).toMatchObject({ state: 'fail', action: 'openStage', fix: 'Open stage window' });
    // It opened earlier, so pop-ups are known to be allowed.
    expect(row(rows, 'popups').state).toBe('ok');
    expect(preflightSummary(rows)).toMatchObject({ verdict: 'nogo', headline: 'NO-GO' });
  });

  it('checks pop-ups from what actually happened', () => {
    expect(row(evaluatePreflight(ready({ stageOpen: false, stageOpened: false })), 'popups').state).toBe('wait');
    expect(row(evaluatePreflight(ready({ stageOpen: false, stageOpened: false, popupBlocked: true })), 'popups').state).toBe('fail');
  });

  it('wants a fresh, ready heartbeat from the sound station', () => {
    expect(row(evaluatePreflight(ready({ station: { name: 'TV', seenAt: 90_000, ready: true } })), 'sound')).toMatchObject({
      state: 'fail',
      detail: 'TV: last heard 10 s ago',
    });
    expect(row(evaluatePreflight(ready({ station: { name: 'TV', seenAt: 99_000, ready: false } })), 'sound').state).toBe('fail');
    expect(
      row(
        evaluatePreflight(
          ready({
            station: { name: 'TV', seenAt: 0, ready: null },
            data: facts({ station: { playerId: 't', name: 'TV', ready: false, seenAgoMs: null } }),
          }),
        ),
        'sound',
      ).detail,
    ).toBe('No heartbeat from TV yet');
  });

  it('warns about the rehearsal boards and a missing special; fails with no boards', () => {
    expect(row(evaluatePreflight(ready({ data: facts({ rehearsal: true }) })), 'show').state).toBe('warn');
    expect(row(evaluatePreflight(ready({ data: facts({ specials: 1 }) })), 'show').detail).toBe('2 rounds, 1 with a special answer');
    expect(row(evaluatePreflight(ready({ data: facts({ rounds: 0, specials: 0 }) })), 'show').state).toBe('fail');
  });

  it('warns (never blocks) on backups, a recent deploy and snapshots off — GO with warnings', () => {
    const rows = evaluatePreflight(ready({ data: facts({ backups: { issued: 0, online: 0 }, uptimeSeconds: 240, blackbox: false }) }));
    expect(row(rows, 'backup').state).toBe('warn');
    expect(row(rows, 'server')).toMatchObject({ state: 'warn', detail: 'Restarted 4 min ago (a deploy or a restart) · commit abc1234' });
    expect(row(rows, 'blackbox').state).toBe('warn');
    expect(preflightSummary(rows)).toMatchObject({ verdict: 'go-warn', headline: 'GO' });
    expect(row(evaluatePreflight(ready({ data: facts({ backups: { issued: 2, online: 0 } }) })), 'backup').detail).toBe(
      '2 backup links, nobody holding one is here',
    );
  });

  it('is NOT READY until the manual checks are confirmed, and while the server is still answering', () => {
    expect(preflightSummary(evaluatePreflight(ready({ manual: {} })))).toMatchObject({ verdict: 'notready', sub: '7 of 10 confirmed.' });
    expect(row(evaluatePreflight(ready({ data: null })), 'server').state).toBe('wait');
  });

  it('on a crew device the stage window is a question for the presenter, and there is no pop-up row', () => {
    const rows = evaluatePreflight(ready({ presenterDevice: false, stageOpen: false, manual: {} }));
    expect(row(rows, 'stage')).toMatchObject({ manual: true, state: 'todo' });
    expect(rows.find((r) => r.id === 'popups')).toBeUndefined();
  });

  it('outside event rooms checks this console only', () => {
    const rows = evaluatePreflight(ready({ event: false, data: null, local: { ready: true, muted: true, sounds: true }, customRounds: 0 }));
    expect(rows.map((r) => r.id)).toEqual(['stage', 'share', 'sound', 'show', 'popups', 'join', 'freeze']);
    expect(row(rows, 'sound').detail).toBe('Sound is muted on this console');
    expect(row(rows, 'show').state).toBe('fail');
  });

  it('formats uptime', () => {
    expect(formatUptime(45)).toBe('45 s');
    expect(formatUptime(8 * 60 + 5)).toBe('8 min');
    expect(formatUptime(3 * 3600 + 12 * 60)).toBe('3 h 12 min');
  });
});

// ---------------------------------------------------------------------------
// Keyboard guard (K / D / A)
// ---------------------------------------------------------------------------

describe('picker shortcuts stay quiet while something else has the keyboard', () => {
  /** A fake element: `inside` = the selectors it sits inside (closest() finds them). */
  const el = (inside: string[] = [], opts: { editable?: boolean; boxes?: number } = {}) => ({
    closest: (sel: string) => (sel.split(',').some((s) => inside.includes(s.trim())) ? {} : null),
    isContentEditable: opts.editable ?? false,
    getClientRects: () => ({ length: opts.boxes ?? 1 }),
  });
  const doc = (nativeOpen: boolean, modals: Array<ReturnType<typeof el>> = []) => ({
    querySelector: (sel: string) => (sel === 'dialog[open]' && nativeOpen ? {} : null),
    querySelectorAll: (sel: string) => (sel === '[aria-modal="true"]' ? modals : []),
  });
  const key = (over: Partial<GuardEvent> = {}): GuardEvent => ({
    defaultPrevented: false,
    repeat: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    target: el(),
    ...over,
  });

  it('lets a plain key press through on the console', () => {
    expect(shortcutBlockedBy(key(), doc(false))).toBe(false);
    expect(shortcutBlockedBy(key(), null)).toBe(false);
  });

  it('stays quiet for modifiers, auto-repeat and keys already handled', () => {
    for (const k of ['defaultPrevented', 'repeat', 'altKey', 'metaKey', 'ctrlKey'] as const)
      expect(shortcutBlockedBy(key({ [k]: true }), doc(false)), k).toBe(true);
  });

  it('stays quiet while typing', () => {
    expect(shortcutBlockedBy(key({ target: el(['input']) }), doc(false))).toBe(true);
    expect(shortcutBlockedBy(key({ target: el(['textarea']) }), doc(false))).toBe(true);
    expect(shortcutBlockedBy(key({ target: el([], { editable: true }) }), doc(false))).toBe(true);
  });

  it('stays quiet inside any dialog: native, role="dialog" (the jukebox player) or role="alertdialog"', () => {
    expect(shortcutBlockedBy(key({ target: el(['dialog[open]']) }), doc(false))).toBe(true);
    expect(shortcutBlockedBy(key({ target: el(['[role="dialog"]']) }), doc(false))).toBe(true);
    expect(shortcutBlockedBy(key({ target: el(['[role="alertdialog"]']) }), doc(false))).toBe(true);
  });

  it('stays quiet while a native dialog or a visible aria-modal dialog is open anywhere', () => {
    expect(shortcutBlockedBy(key(), doc(true))).toBe(true);
    expect(shortcutBlockedBy(key(), doc(false, [el([], { boxes: 1 })]))).toBe(true);
    // A hidden (unrendered) aria-modal element doesn't block.
    expect(shortcutBlockedBy(key(), doc(false, [el([], { boxes: 0 })]))).toBe(false);
  });
});
