/**
 * The network map: one node per player. Nodes are buttons whenever the viewer can act on them —
 * pick a night target / a vote (mode 'select') or cycle a private suspicion tag (mode 'tag').
 */
import type { CSSProperties, ReactNode } from 'react';
import type { PlayerView } from '@dascade/shared';
import { Avatar, cx } from '@dascade/ui';
import { Icon, type DxIconName } from './Icon.tsx';
import { DECEPTION_ROLE_INFO, type DeceptionFate, type DeceptionRole } from '@dascade/shared/games/deception';
import { ROLE_COLOR } from './art.ts';
import { RoleEmblem } from './RoleCard.tsx';
import type { NodeEntry, SuspicionTag } from './hooks.ts';

export interface NodeDecor {
  /** Stage flag (ready / voted / read card) — public info. */
  flag?: { done: boolean; label: string } | null;
  /** Viewer's Glitch ally (only ever set for Glitch viewers). */
  ally?: DeceptionRole | null;
  /** Glitch team view: allies who picked this node tonight. */
  pickedBy?: string[];
  /** Verdict: votes received and who cast them. */
  votes?: { count: number; voters: NodeEntry[]; sudo: boolean } | null;
  /** Night/vote target validity. */
  disabledReason?: string | null;
  /** Emphasis (dawn victim, disconnected player, runoff candidate). */
  spotlight?: 'victim' | 'runoff' | null;
}

export interface NetworkProps {
  nodes: NodeEntry[];
  players: Record<string, PlayerView>;
  meId: string | null;
  hostId: string;
  mode: 'select' | 'tag' | 'view';
  selected?: string | null;
  tags: Record<string, SuspicionTag>;
  decor?: (node: NodeEntry) => NodeDecor;
  /** Verb for select mode ("Scan", "Shield", "Vote for"…). */
  verb?: string;
  onSelect?: (id: string) => void;
  onTag?: (id: string) => void;
  label: string;
  /** Accent for the selection ring (role or vote colour). */
  accent?: string;
  footnote?: ReactNode;
}

const FATE_ICON: Record<Exclude<DeceptionFate, ''>, DxIconName> = {
  corrupted: 'skull',
  disconnected: 'wifi-off',
  left: 'leave',
};
const FATE_TEXT: Record<Exclude<DeceptionFate, ''>, string> = {
  corrupted: 'Corrupted',
  disconnected: 'Disconnected',
  left: 'Left',
};

export function Network({
  nodes,
  players,
  meId,
  hostId,
  mode,
  selected,
  tags,
  decor,
  verb,
  onSelect,
  onTag,
  label,
  accent,
  footnote,
}: NetworkProps) {
  const dense = nodes.length > 12;
  return (
    <section
      className={cx('dx-network', dense && 'dx-network--dense')}
      data-part="network"
      aria-label={label}
      style={accent ? ({ '--pick': accent } as CSSProperties) : undefined}
    >
      <ul className="dx-network__grid">
        {nodes.map((node) => (
          <li key={node.id}>
            <NodeCard
              node={node}
              player={players[node.id]}
              isMe={node.id === meId}
              isHost={node.id === hostId}
              mode={mode}
              selected={selected === node.id}
              tag={tags[node.id] ?? null}
              decor={decor?.(node) ?? {}}
              verb={verb}
              onSelect={onSelect}
              onTag={onTag}
            />
          </li>
        ))}
      </ul>
      {footnote ? <p className="dx-network__foot">{footnote}</p> : null}
    </section>
  );
}

interface NodeCardProps {
  node: NodeEntry;
  player: PlayerView | undefined;
  isMe: boolean;
  isHost: boolean;
  mode: NetworkProps['mode'];
  selected: boolean;
  tag: SuspicionTag | null;
  decor: NodeDecor;
  verb?: string;
  onSelect?: (id: string) => void;
  onTag?: (id: string) => void;
}

function NodeCard({ node, player, isMe, isHost, mode, selected, tag, decor, verb, onSelect, onTag }: NodeCardProps) {
  const offline = !node.alive;
  const gone = !player; // left the room
  const linkDown = Boolean(player && !player.connected);
  const revealed = node.role ? (node.role as DeceptionRole) : null;
  const selectable = mode === 'select' && !offline && !decor.disabledReason;
  const taggable = mode === 'tag' && !offline && !isMe;
  const interactive = selectable || taggable;
  const status = offline
    ? (FATE_TEXT[node.fate as Exclude<DeceptionFate, ''>] ?? 'Offline')
    : gone
      ? 'Left'
      : linkDown
        ? 'Reconnecting'
        : 'Online';

  const parts = [node.name, isMe ? '(you)' : '', status];
  if (revealed) parts.push(`revealed ${DECEPTION_ROLE_INFO[revealed].name}`);
  if (decor.ally) parts.push(`fellow Glitch (${DECEPTION_ROLE_INFO[decor.ally].name})`);
  if (tag) parts.push(tag === 'suspect' ? 'marked suspect' : 'marked trusted');
  if (decor.flag?.done) parts.push(decor.flag.label);
  if (decor.pickedBy?.length) parts.push(`picked by ${decor.pickedBy.join(', ')}`);
  if (decor.votes?.count) parts.push(`${decor.votes.count} vote${decor.votes.count === 1 ? '' : 's'}`);
  if (mode === 'select' && decor.disabledReason && !offline) parts.push(decor.disabledReason);
  if (selected) parts.push('selected');
  const ariaLabel = `${parts.filter(Boolean).join(', ')}${selectable && verb ? `. ${verb} ${node.name}` : taggable ? '. Tap to change your private note' : ''}`;

  const body = (
    <>
      <span className="dx-node__corner dx-node__corner--tl" aria-hidden="true" />
      <span className="dx-node__corner dx-node__corner--br" aria-hidden="true" />
      <span className="dx-node__port" aria-hidden="true">
        <Avatar avatar={node.avatar} color={node.color} size={40} offline={offline || gone} />
        <span className={cx('dx-node__led', offline ? 'is-off' : linkDown || gone ? 'is-warn' : 'is-on')} />
      </span>
      <span className="dx-node__name">
        {node.name}
        {isHost ? <Icon name="crown" size={10} className="dx-node__crown" /> : null}
      </span>
      <span className="dx-node__status">
        {offline ? <Icon name={FATE_ICON[node.fate as Exclude<DeceptionFate, ''>] ?? 'wifi-off'} size={10} /> : null}
        {isMe ? <span className="dx-node__you">You</span> : null}
        <span>{status}</span>
      </span>
      {revealed ? (
        <span className="dx-node__role" style={{ '--role': ROLE_COLOR[revealed] } as CSSProperties}>
          <RoleEmblem role={revealed} size={14} />
          {DECEPTION_ROLE_INFO[revealed].name}
        </span>
      ) : decor.ally ? (
        <span className="dx-node__role dx-node__role--ally" style={{ '--role': ROLE_COLOR[decor.ally] } as CSSProperties}>
          <RoleEmblem role={decor.ally} size={14} />
          Ally · {DECEPTION_ROLE_INFO[decor.ally].name}
        </span>
      ) : null}
      {tag && !offline ? (
        <span className={cx('dx-node__tag', `dx-node__tag--${tag}`)} aria-hidden="true">
          <Icon name={tag === 'suspect' ? 'warning' : 'check'} size={10} />
          {tag === 'suspect' ? 'Suspect' : 'Trusted'}
        </span>
      ) : null}
      {decor.flag?.done ? (
        <span className="dx-node__flag" aria-hidden="true" title={decor.flag.label}>
          <Icon name="check" size={10} />
        </span>
      ) : null}
      {decor.pickedBy?.length ? (
        <span className="dx-node__picks" aria-hidden="true">
          <Icon name="bolt" size={10} /> {decor.pickedBy.length}
        </span>
      ) : null}
      {decor.votes && decor.votes.count > 0 ? (
        <span className="dx-node__votes" aria-hidden="true">
          <span className="dx-node__votecount dc-num">{decor.votes.count}</span>
          <span className="dx-node__voters">
            {decor.votes.voters.slice(0, 5).map((v) => (
              <Avatar key={v.id} avatar={v.avatar} color={v.color} size={16} />
            ))}
            {decor.votes.voters.length > 5 ? <span className="dc-num">+{decor.votes.voters.length - 5}</span> : null}
          </span>
          {decor.votes.sudo ? <span className="dx-node__sudo">SUDO</span> : null}
        </span>
      ) : null}
      {selected ? (
        <span className="dx-node__target" aria-hidden="true">
          <Icon name="flag" size={10} /> {verb ?? 'Target'}
        </span>
      ) : null}
    </>
  );

  const className = cx(
    'dx-node',
    offline && 'is-offline',
    isMe && 'is-me',
    selected && 'is-selected',
    interactive && 'is-interactive',
    mode === 'select' && !selectable && !offline && 'is-blocked',
    decor.spotlight && `is-${decor.spotlight}`,
    tag && !offline && `has-${tag}`,
  );

  if (!interactive) {
    return (
      <div className={className} data-part="node-card" aria-label={ariaLabel} role="group">
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={className}
      data-part="node-card"
      aria-label={ariaLabel}
      aria-pressed={mode === 'select' ? selected : undefined}
      onClick={() => (selectable ? onSelect?.(node.id) : onTag?.(node.id))}
    >
      {body}
    </button>
  );
}
