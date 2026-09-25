/** Table sounds: deals, chips, flips, checks, wins and the your-turn alert. */
import { useEffect, useRef } from 'react';
import { HOLDEM_MSG, type HoldemEvent } from '@dascade/shared/games/holdem';
import { useRoomMessage } from '../../net/hooks.ts';
import { sfx, synth } from '../../audio/audio.ts';

function knock(): void {
  synth.noise({ dur: 0.05, gain: 0.3, freq: 420, q: 2, type: 'bandpass' });
  synth.noise({ start: 0.09, dur: 0.05, gain: 0.26, freq: 380, q: 2, type: 'bandpass' });
}

function yourTurn(): void {
  synth.tone({ type: 'sine', freq: synth.note(84), dur: 0.12, gain: 0.1 });
  synth.tone({ type: 'sine', freq: synth.note(91), start: 0.1, dur: 0.22, gain: 0.1 });
}

export function useHoldemSounds(opts: { mySeat: number; myTurn: boolean; bigBlind: number; secondsLeft: number }): void {
  const { mySeat, myTurn, bigBlind, secondsLeft } = opts;
  // Pending sound timers (each removes itself when it fires, so the set never grows without bound).
  const timers = useRef(new Set<number>());

  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
      timers.current.clear();
    },
    [],
  );

  const later = (ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  };

  useRoomMessage<HoldemEvent>(HOLDEM_MSG.event, (e) => {
    switch (e.type) {
      case 'deal':
        for (let i = 0; i < Math.min(e.seats.length * 2, 12); i++) later(i * 70, () => sfx('card', 10));
        break;
      case 'action':
        if (e.action === 'check') knock();
        else if (e.action === 'fold') sfx('whoosh', 10);
        else sfx('chip', 10);
        if (e.action === 'allin') later(120, () => sfx('chip', 10));
        break;
      case 'street':
        e.cards.forEach((_, i) => later(i * 140, () => sfx('flip', 10)));
        break;
      case 'reveal':
        e.seats.forEach((_, i) => later(i * 160, () => sfx('flip', 10)));
        break;
      case 'win': {
        const mine = e.seats.indexOf(mySeat);
        if (mine >= 0) {
          const amount = e.amounts[mine] ?? 0;
          sfx(amount >= bigBlind * 40 ? 'bigwin' : 'win');
        } else {
          later(0, () => sfx('chip', 10));
          later(90, () => sfx('chip', 10));
        }
        break;
      }
    }
  });

  // Your-turn alert (and a light buzz on phones).
  const wasMyTurn = useRef(false);
  useEffect(() => {
    if (myTurn && !wasMyTurn.current) {
      yourTurn();
      try {
        navigator.vibrate?.(35);
      } catch {
        /* unsupported */
      }
    }
    wasMyTurn.current = myTurn;
  }, [myTurn]);

  // Last seconds of your clock tick.
  useEffect(() => {
    if (myTurn && secondsLeft > 0 && secondsLeft <= 5) sfx('tick');
  }, [myTurn, secondsLeft]);
}
