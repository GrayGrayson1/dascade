/**
 * DASketch sound cues (procedural, via the shared audio engine).
 */
import { CHAT, type ChatMessage } from '@dascade/shared';
import { DASKETCH_MSG, type SketchGameEvent } from '@dascade/shared/games/dasketch';
import { useRoomMessage } from '../../net/hooks.ts';
import { sfx, synth } from '../../audio/audio.ts';

function roundJingle(): void {
  [67, 71, 74, 79].forEach((n, i) => synth.tone({ type: 'square', freq: synth.note(n), start: i * 0.08, dur: 0.16, gain: 0.08 }));
  synth.tone({ type: 'triangle', freq: synth.note(55), start: 0.32, dur: 0.5, gain: 0.1 });
}

function soClose(): void {
  synth.tone({ type: 'sine', freq: synth.note(81), dur: 0.1, gain: 0.08 });
  synth.tone({ type: 'sine', freq: synth.note(79), start: 0.09, dur: 0.16, gain: 0.07 });
}

export function useSketchSounds(meId: string | null): void {
  useRoomMessage<SketchGameEvent>(DASKETCH_MSG.event, (e) => {
    switch (e.type) {
      case 'round':
        roundJingle();
        break;
      case 'turn':
        if (e.artistId === meId) sfx('select');
        break;
      case 'drawing':
        sfx('pop');
        break;
      case 'hint':
        sfx('flip');
        break;
      case 'correct':
        sfx(e.playerId === meId ? 'correct' : 'ding');
        break;
      case 'reveal':
        sfx('whoosh');
        break;
    }
  });
  useRoomMessage<ChatMessage>(CHAT.msg, (m) => {
    if (m.kind === 'close') soClose();
  });
}
