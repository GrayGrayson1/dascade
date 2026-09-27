/**
 * DAS Boardroom kit — procedural board sounds (WebAudio via the shared synth; respects mute/volume,
 * silent before the first user gesture) and a hook that turns kit events into sounds + toasts.
 */
import { useRef } from 'react';
import { boardMsg, type BoardEvent, type BoardSide } from '@dascade/shared/games/boardroom';
import { sfx, synth } from '../../audio/audio.ts';
import { useRoomMessage } from '../../net/hooks.ts';

function tock(start = 0, pitch = 1): void {
  synth.noise({ start, dur: 0.045, gain: 0.34, freq: 1500 * pitch, q: 3, type: 'bandpass' });
  synth.tone({ type: 'triangle', freq: 190 * pitch, to: 120 * pitch, start, dur: 0.07, gain: 0.16 });
}

export const boardSounds = {
  move(): void {
    tock();
  },
  capture(): void {
    synth.noise({ dur: 0.06, gain: 0.42, freq: 2600, q: 2, type: 'bandpass' });
    tock(0.035, 0.8);
  },
  castle(): void {
    tock();
    tock(0.1, 1.1);
  },
  check(): void {
    tock();
    synth.tone({ type: 'square', freq: synth.note(81), start: 0.03, dur: 0.09, gain: 0.05 });
    synth.tone({ type: 'square', freq: synth.note(76), start: 0.12, dur: 0.14, gain: 0.05 });
  },
  promote(): void {
    tock();
    [72, 76, 79, 84].forEach((n, i) =>
      synth.tone({ type: 'triangle', freq: synth.note(n), start: 0.04 + i * 0.06, dur: 0.14, gain: 0.07 }),
    );
  },
  illegal(): void {
    synth.tone({ type: 'sine', freq: 180, to: 140, dur: 0.12, gain: 0.08 });
  },
  offer(): void {
    sfx('ding', 200);
  },
  premove(): void {
    synth.tone({ type: 'sine', freq: synth.note(88), dur: 0.06, gain: 0.05 });
  },
  yourTurn(): void {
    synth.tone({ type: 'sine', freq: synth.note(84), dur: 0.08, gain: 0.05 });
  },
  lowTime(): void {
    sfx('tick', 400);
  },
  end(outcome: 'win' | 'loss' | 'draw' | 'neutral'): void {
    if (outcome === 'win') sfx('win');
    else if (outcome === 'loss') sfx('lose');
    else [67, 71, 74].forEach((n, i) => synth.tone({ type: 'triangle', freq: synth.note(n), start: i * 0.09, dur: 0.5, gain: 0.07 }));
  },
};

export interface BoardEventHandlers {
  /** Called for every kit event after the built-in sound (e.g. to toast). */
  onEvent?: (e: BoardEvent) => void;
}

/** Plays kit-event sounds (offers, flag, end) for the viewer. Game move sounds are the game's job. */
export function useBoardEventSounds(gameId: string, mySide: BoardSide | null, handlers: BoardEventHandlers = {}): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useRoomMessage<BoardEvent>(boardMsg(gameId, 'event'), (e) => {
    switch (e.type) {
      case 'offer':
        if (e.action === 'offer' && e.side !== mySide) boardSounds.offer();
        break;
      case 'flag':
        sfx('error', 200);
        break;
      case 'end':
        boardSounds.end(e.winner === 'draw' ? 'draw' : mySide === null ? 'neutral' : e.winner === mySide ? 'win' : 'loss');
        break;
      case 'undo':
        tock(0, 0.9);
        break;
      case 'rematch':
        sfx('start', 200);
        break;
    }
    ref.current.onEvent?.(e);
  });
}
