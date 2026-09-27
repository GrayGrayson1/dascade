/**
 * DASception sound cues (procedural; respect mute/volume via the shared audio buses).
 */
import { DECEPTION_MSG, type DeceptionEvent, type DeceptionTeam } from '@dascade/shared/games/deception';
import { useRoomMessage } from '../../net/hooks.ts';
import { sfx, synth } from '../../audio/audio.ts';

function blackout(): void {
  synth.tone({ type: 'sawtooth', freq: 220, to: 55, dur: 0.9, gain: 0.05 });
  synth.tone({ type: 'sine', freq: synth.note(45), start: 0.1, dur: 1.2, gain: 0.08, attack: 0.2 });
  synth.noise({ dur: 0.5, gain: 0.03, freq: 900, to: 200, type: 'lowpass' });
}

function reboot(): void {
  [60, 67, 72, 79].forEach((n, i) => synth.tone({ type: 'square', freq: synth.note(n), start: i * 0.07, dur: 0.12, gain: 0.05 }));
}

function corrupted(): void {
  for (let i = 0; i < 5; i++) synth.tone({ type: 'square', freq: 180 + ((i * 97) % 400), start: i * 0.045, dur: 0.05, gain: 0.05 });
  synth.noise({ start: 0.05, dur: 0.35, gain: 0.07, freq: 2400, q: 3 });
}

function shieldHeld(): void {
  synth.tone({ type: 'triangle', freq: synth.note(72), dur: 0.2, gain: 0.08 });
  synth.tone({ type: 'triangle', freq: synth.note(79), start: 0.12, dur: 0.35, gain: 0.08 });
}

function disconnectThud(): void {
  synth.tone({ type: 'sine', freq: 140, to: 40, dur: 0.5, gain: 0.16 });
  synth.noise({ dur: 0.25, gain: 0.05, freq: 600, type: 'lowpass' });
}

export function useDeceptionSounds(myTeam: DeceptionTeam | null): void {
  useRoomMessage<DeceptionEvent>(DECEPTION_MSG.event, (e) => {
    switch (e.type) {
      case 'boot':
        reboot();
        break;
      case 'night':
        blackout();
        break;
      case 'dawn':
        if (e.outcome === 'corrupted') corrupted();
        else if (e.outcome === 'blocked') shieldHeld();
        else reboot();
        break;
      case 'day':
        sfx('ding');
        break;
      case 'vote':
        sfx('select');
        break;
      case 'verdict':
        if (e.outcome === 'disconnected') disconnectThud();
        else sfx('whoosh');
        break;
      case 'left':
        sfx('leave');
        break;
      case 'final':
        sfx(myTeam === null ? 'win' : myTeam === e.winner ? 'bigwin' : 'lose');
        break;
    }
  });
}
