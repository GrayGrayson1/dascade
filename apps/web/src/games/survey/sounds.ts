/**
 * DAS Survey sound cues (restrained; sfx() respects mute/volume and never plays before a gesture).
 */
import { useRef } from 'react';
import { SURVEY_MSG, type SurveyEvent } from '@dascade/shared/games/survey';
import { useRoomMessage } from '../../net/hooks.ts';
import { sfx } from '../../audio/audio.ts';

export function useSurveySounds(meId: string | null): void {
  const last = useRef<string>('');
  useRoomMessage<SurveyEvent>(SURVEY_MSG.event, (e) => {
    const key = `${e.type}:${'q' in e ? e.q : ''}`;
    if (last.current === key) return;
    last.current = key;
    if (!meId) return;
    switch (e.type) {
      case 'question':
        sfx('whoosh');
        break;
      case 'answers-closed':
        sfx('ding', 200);
        break;
      case 'reveal':
        sfx(e.voided ? 'back' : 'flip');
        break;
      case 'final':
        break;
    }
  });
}
