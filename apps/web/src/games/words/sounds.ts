/**
 * DASwords sound cues — procedural, restrained, respect mute/volume (the shared audio engine).
 */
import { useEffect, useRef } from 'react';
import { WORDS_MSG, type WordsEvent, type WordsPrivate } from '@dascade/shared/games/words';
import { useRoomMessage } from '../../net/hooks.ts';
import { sfx, synth } from '../../audio/audio.ts';

function jingle(notes: number[], step = 0.07, type: OscillatorType = 'square', gain = 0.07): void {
  notes.forEach((n, i) => synth.tone({ type, freq: synth.note(n), start: i * step, dur: 0.14, gain }));
}

/** Accepted word: a little rising chime, brighter for longer words. */
export function acceptSound(points: number): void {
  if (points >= 8) jingle([72, 76, 79, 84], 0.06, 'triangle', 0.09);
  else if (points >= 3) jingle([74, 79, 83], 0.06, 'triangle', 0.08);
  else jingle([76, 81], 0.06, 'triangle', 0.07);
}

export function useWordsSounds(): void {
  useRoomMessage<WordsEvent>(WORDS_MSG.event, (e) => {
    switch (e.type) {
      case 'round':
        jingle([60, 64, 67, 72]);
        break;
      case 'play':
      case 'link':
        sfx('go');
        break;
      case 'timeUp':
        sfx('whoosh');
        break;
      case 'linkReveal':
        sfx(e.eliminated.length ? 'lose' : 'flip');
        break;
      case 'reveal':
        sfx('ding');
        break;
    }
  });
}

/** Plays a cue for each new verdict in my private list. */
export function useVerdictSounds(priv: WordsPrivate | null): void {
  const lastSeq = useRef<number | null>(null);
  useEffect(() => {
    if (!priv) return;
    if (lastSeq.current === null) {
      lastSeq.current = priv.seq;
      return;
    }
    if (priv.seq === lastSeq.current) return;
    lastSeq.current = priv.seq;
    const v = priv.last;
    if (!v) return;
    if (v.ok) acceptSound(v.points);
    else if (v.reason === 'duplicate' || v.reason === 'answered') sfx('pop');
    else sfx('wrong');
  }, [priv]);
}
