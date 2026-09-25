/**
 * Guess + chat panel. Guesses go through the shared room chat (the server intercepts them).
 * Lines only visible to players who know the word are marked with a lock.
 * On phones the input sits on top (right under the canvas) and the newest line comes first,
 * so the guess box stays reachable above the on-screen keyboard.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { LIMITS, type ChatMessage } from '@dascade/shared';
import { Badge, IconButton, PixelIcon, TextInput, cx, type IconName } from '@dascade/ui';
import { session, useSessionStore } from '../../net/session.ts';

export type ChatMode = 'guess' | 'artist' | 'knower' | 'spectator' | 'open';

const PLACEHOLDER: Record<ChatMode, string> = {
  guess: 'Type your guess…',
  artist: 'Chat with players who got it…',
  knower: 'Chat with players who got it…',
  spectator: 'Chat with other spectators…',
  open: 'Say something…',
};

const CHANNEL: Record<ChatMode, { label: string; color: string; icon: IconName; hint: string }> = {
  guess: { label: 'Guessing', color: 'var(--accent-2)', icon: 'bolt', hint: 'Right answers stay hidden from everyone else.' },
  artist: { label: 'Secret channel', color: 'var(--green)', icon: 'lock', hint: 'Only players who guessed can read this.' },
  knower: { label: 'Secret channel', color: 'var(--green)', icon: 'lock', hint: 'Only players who guessed can read this.' },
  spectator: { label: 'Spectators', color: 'var(--purple)', icon: 'eye', hint: 'Players still guessing can’t see spectator chat.' },
  open: { label: 'Room chat', color: 'var(--accent)', icon: 'chat', hint: 'Everyone in the room can read this.' },
};

function Line({ m, meId }: { m: ChatMessage; meId: string | null }) {
  if (m.kind === 'system') {
    return <div className="sk-msg sk-msg--system">{m.text}</div>;
  }
  if (m.kind === 'correct') {
    return (
      <div className={cx('sk-msg sk-msg--correct', m.playerId === meId && 'is-me')}>
        <PixelIcon name="check" className="sk-msg__icon" />
        <span>{m.text}</span>
      </div>
    );
  }
  if (m.kind === 'close') {
    return (
      <div className="sk-msg sk-msg--close">
        <PixelIcon name="sparkle" className="sk-msg__icon" />
        <span>{m.text}</span>
      </div>
    );
  }
  return (
    <div className={cx('sk-msg', m.kind === 'guess' && 'sk-msg--secret', m.playerId === meId && 'is-me')} style={{ '--name': m.color ?? 'var(--text-1)' } as CSSProperties}>
      {m.kind === 'guess' ? <PixelIcon name="lock" className="sk-msg__icon" title="Only visible to players who know the word" /> : null}
      <span className="sk-msg__name">{m.name}</span>
      <span className="sk-msg__text">{m.text}</span>
    </div>
  );
}

export function SketchChat({ mode, meId, inputFirst, disabled }: { mode: ChatMode; meId: string | null; inputFirst: boolean; disabled?: boolean }) {
  const chat = useSessionStore((s) => s.chat);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !stick.current) return;
    el.scrollTop = inputFirst ? 0 : el.scrollHeight;
  }, [chat.length, inputFirst]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    session.lobby.chat(t);
    setText('');
  };
  const lines = inputFirst ? [...chat].reverse() : chat;

  const form = (
    <form
      className="sk-chat__form"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <TextInput
        value={text}
        maxLength={LIMITS.chat}
        disabled={disabled}
        placeholder={PLACEHOLDER[mode]}
        aria-label={mode === 'guess' ? 'Type your guess' : 'Chat message'}
        enterKeyHint="send"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-mode={mode}
        onChange={(e) => setText(e.currentTarget.value)}
      />
      <IconButton icon="arrow-right" label={mode === 'guess' ? 'Send guess' : 'Send message'} type="submit" variant="primary" disabled={disabled || !text.trim()} />
    </form>
  );

  return (
    <section className={cx('sk-chat', inputFirst && 'sk-chat--input-first')} aria-label="Guesses and chat" data-mode={mode}>
      {inputFirst ? null : (
        <header className="sk-chat__head" title={CHANNEL[mode].hint}>
          <span className="dc-label">Guesses &amp; chat</span>
          <Badge color={CHANNEL[mode].color} icon={CHANNEL[mode].icon}>
            {CHANNEL[mode].label}
          </Badge>
        </header>
      )}
      {inputFirst ? form : null}
      <div
        className="sk-chat__list"
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-label="Guesses and chat messages"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = inputFirst ? el.scrollTop < 40 : el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {lines.length === 0 ? <div className="sk-chat__empty">Guesses and chat show up here.</div> : null}
        {lines.map((m) => (
          <Line key={m.id} m={m} meId={meId} />
        ))}
      </div>
      {inputFirst ? null : form}
    </section>
  );
}
