/**
 * Private intel ("what my ability told me"), the public timeline, the Glitch team channel and the
 * chat panel with its ghost channel styling.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { LIMITS, type ChatMessage } from '@dascade/shared';
import { IconButton, TextInput, cx } from '@dascade/ui';
import { Icon } from './Icon.tsx';
import {
  DECEPTION_GHOST_PREFIX,
  DECEPTION_MSG,
  DECEPTION_ROLE_INFO,
  type DeceptionIntel,
  type DeceptionLogEntry,
  type DeceptionPrivate,
  type DeceptionTeamLine,
} from '@dascade/shared/games/deception';
import { session } from '../../net/hooks.ts';
import { ChatPanel } from '../../shell/common.tsx';
import { ROLE_COLOR } from './art.ts';
import type { NodeEntry } from './hooks.ts';

const nameOf = (nodes: Record<string, NodeEntry>, id: string | null | undefined) => (id ? (nodes[id]?.name ?? 'someone') : 'nobody');

export function IntelLine({ entry, nodes }: { entry: DeceptionIntel; nodes: Record<string, NodeEntry> }) {
  const night = <span className="dx-intel__night dc-num">N{entry.cycle}</span>;
  switch (entry.kind) {
    case 'scan':
      return (
        <li className="dx-intel__line" data-result={entry.result}>
          {night}
          <Icon name="eye" size={12} />
          <span>
            Scan: <strong>{nameOf(nodes, entry.targetId)}</strong> is{' '}
            {entry.result === 'jammed' ? (
              <span className="dx-intel__verdict is-jammed">JAMMED — no reading</span>
            ) : entry.result === 'glitch' ? (
              <span className="dx-intel__verdict is-glitch">a GLITCH</span>
            ) : (
              <span className="dx-intel__verdict is-clean">CLEAN</span>
            )}
          </span>
        </li>
      );
    case 'shield':
      return (
        <li className="dx-intel__line" data-result={entry.outcome}>
          {night}
          <Icon name="lock" size={12} />
          <span>
            Shielded <strong>{nameOf(nodes, entry.targetId)}</strong>
            {entry.outcome === 'held' ? (
              <span className="dx-intel__verdict is-clean"> — blocked an attack!</span>
            ) : entry.outcome === 'jammed' ? (
              <span className="dx-intel__verdict is-jammed"> — JAMMED, the shield failed</span>
            ) : (
              <span className="dc-muted"> — no attack on them</span>
            )}
          </span>
        </li>
      );
    case 'clue':
      return (
        <li className="dx-intel__line" data-result={entry.jammed ? 'jammed' : 'clue'}>
          {night}
          <Icon name="sparkle" size={12} />
          <span>
            {entry.jammed ? (
              <span className="dx-intel__verdict is-jammed">Clue JAMMED — no trace tonight</span>
            ) : entry.pair ? (
              <>
                Clue: exactly one of <strong>{nameOf(nodes, entry.pair[0])}</strong> or <strong>{nameOf(nodes, entry.pair[1])}</strong> is a
                Glitch
              </>
            ) : (
              <span className="dc-muted">No signal tonight</span>
            )}
          </span>
        </li>
      );
    case 'jam':
      return (
        <li className="dx-intel__line" data-result="jam">
          {night}
          <Icon name="wifi-off" size={12} />
          <span>
            You jammed <strong>{nameOf(nodes, entry.targetId)}</strong>
          </span>
        </li>
      );
    case 'attack':
      return (
        <li className="dx-intel__line" data-result={entry.outcome}>
          {night}
          <Icon name="skull" size={12} />
          <span>
            {entry.outcome === 'none' ? (
              <span className="dc-muted">Your team didn’t strike</span>
            ) : (
              <>
                Team hit <strong>{nameOf(nodes, entry.targetId)}</strong>
                {entry.outcome === 'blocked' ? (
                  <span className="dx-intel__verdict is-jammed"> — blocked by a shield</span>
                ) : (
                  <span> — corrupted</span>
                )}
              </>
            )}
          </span>
        </li>
      );
  }
}

const EMPTY_INTEL: Record<string, string> = {
  scanner: 'Your scan results will appear here.',
  firewall: 'Your shield reports will appear here.',
  tracer: 'Your nightly clues will appear here.',
  jammer: 'Your jams and your team’s strikes will appear here.',
  glitch: 'Your team’s strikes will appear here.',
  sudo: 'No night reports for you — your power is the Sudo vote.',
  sysop: 'No night reports for you — watch, listen and vote.',
};

export function IntelPanel({ me, nodes }: { me: DeceptionPrivate; nodes: Record<string, NodeEntry> }) {
  const entries = [...me.intel].reverse();
  return (
    <section className="dx-panel dx-intel" data-part="intel" aria-label="Your intel" style={{ '--role': ROLE_COLOR[me.role!] } as CSSProperties}>
      <h3 className="dx-panel__title">
        <Icon name="lock" size={12} /> Your intel <span className="dc-muted">· private</span>
      </h3>
      {entries.length ? (
        <ul className="dx-intel__list">
          {entries.map((e, i) => (
            <IntelLine key={`${e.cycle}-${e.kind}-${i}`} entry={e} nodes={nodes} />
          ))}
        </ul>
      ) : (
        <p className="dc-muted dx-intel__empty">{EMPTY_INTEL[me.role!]}</p>
      )}
    </section>
  );
}

export function Timeline({ log, nodes }: { log: DeceptionLogEntry[]; nodes: Record<string, NodeEntry> }) {
  if (!log.length) return <p className="dc-muted dx-timeline__empty">Nothing has happened yet. The first night is coming…</p>;
  return (
    <ol className="dx-timeline" data-part="timeline" aria-label="Match timeline">
      {[...log].reverse().map((e, i) => {
        const who = 'playerId' in e && e.playerId ? nameOf(nodes, e.playerId) : '';
        const role = 'role' in e && e.role ? ` (${DECEPTION_ROLE_INFO[e.role].name})` : '';
        let icon: 'skull' | 'lock' | 'check' | 'wifi-off' | 'leave' | 'flag';
        let text: string;
        if (e.kind === 'dawn') {
          icon = e.outcome === 'corrupted' ? 'skull' : e.outcome === 'blocked' ? 'lock' : 'check';
          text =
            e.outcome === 'corrupted' ? `${who} corrupted${role}` : e.outcome === 'blocked' ? 'Attack blocked by a shield' : 'Quiet night';
        } else if (e.kind === 'verdict') {
          icon = e.outcome === 'disconnected' ? 'wifi-off' : 'flag';
          text =
            e.outcome === 'disconnected'
              ? `${who} disconnected${role}`
              : e.outcome === 'tie'
                ? `${e.runoff ? 'Runoff' : 'Vote'} tied — nobody out`
                : e.outcome === 'skipped'
                  ? 'Vote skipped'
                  : 'No votes cast';
        } else {
          icon = 'leave';
          text = `${who} left${role}`;
        }
        return (
          <li key={i} className="dx-timeline__item" data-kind={e.kind}>
            <span className="dx-timeline__when dc-num">{e.kind === 'dawn' ? `N${e.cycle}` : `D${e.cycle}`}</span>
            <Icon name={icon} size={12} />
            <span>{text}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function TeamChannel({ lines, canSend, meId }: { lines: DeceptionTeamLine[]; canSend: boolean; meId: string | null }) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  const send = () => {
    const t = text.trim();
    if (!t) return;
    session.send(DECEPTION_MSG.teamSay, { text: t });
    setText('');
  };
  return (
    <section className="dx-panel dx-teamchan" data-part="team-channel" aria-label="Glitch channel">
      <h3 className="dx-panel__title">
        <Icon name="skull" size={12} /> Glitch channel <span className="dc-muted">· only Glitches see this</span>
      </h3>
      <div className="dx-teamchan__list" ref={listRef} role="log" aria-live="polite" aria-label="Glitch channel messages">
        {lines.length === 0 ? <p className="dc-muted">Coordinate your strike here. Sysops can’t read this.</p> : null}
        {lines.map((l) => (
          <p key={l.id} className={cx('dx-teamchan__line', l.playerId === meId && 'is-me')}>
            <span className="dx-teamchan__name">{l.name}</span>
            <span>{l.text}</span>
          </p>
        ))}
      </div>
      {canSend ? (
        <form
          className="dx-teamchan__form"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <TextInput
            value={text}
            maxLength={LIMITS.chat}
            placeholder="Whisper to your team…"
            aria-label="Glitch channel message"
            enterKeyHint="send"
            onChange={(e) => setText(e.currentTarget.value)}
          />
          <IconButton icon="arrow-right" label="Send to Glitch channel" type="submit" variant="primary" disabled={!text.trim()} />
        </form>
      ) : (
        <p className="dc-muted dx-teamchan__closed">The channel opens again at night.</p>
      )}
    </section>
  );
}

function renderChat(m: ChatMessage) {
  const ghost = m.id.startsWith(DECEPTION_GHOST_PREFIX);
  return (
    <div className={cx('chat__msg', ghost && 'dx-chat--ghost')} data-kind={m.kind}>
      {ghost ? (
        <span className="dx-chat__ghost" aria-label="Ghost channel">
          <Icon name="ghost" size={11} />
        </span>
      ) : null}
      {m.playerId && m.kind !== 'system' && m.kind !== 'correct' ? (
        <span className="chat__name" style={{ '--chat-name': m.color } as CSSProperties}>
          {m.name}
        </span>
      ) : null}
      <span className="chat__text">{m.text}</span>
    </div>
  );
}

export function DeceptionChat({ mode }: { mode: 'open' | 'blackout' | 'ghost' }) {
  const placeholder = mode === 'blackout' ? 'Blackout — chat is offline' : mode === 'ghost' ? 'Ghost chat…' : 'Say something…';
  return (
    <div className={cx('dx-chat', `dx-chat--${mode}`)}>
      {mode === 'ghost' ? (
        <p className="dx-chat__note">
          <Icon name="ghost" size={11} /> Ghost channel: online players can’t see what you write.
        </p>
      ) : null}
      <ChatPanel placeholder={placeholder} disabled={mode === 'blackout'} renderMessage={renderChat} emptyText="No messages yet." />
    </div>
  );
}
