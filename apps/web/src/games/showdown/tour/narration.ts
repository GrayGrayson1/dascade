/**
 * The film's words: every line Boo (and DASbot, in his cameo) says in "Boo's Backstage Tour", and
 * the optional voice-over cut's player.
 *
 * Voice clips are not part of the app: the film's recorder serves them at /tour-voice/<key>.mp3 while
 * it records (a missing clip is simply silent). They play through the show's one audio pipeline —
 * decoded into the shared AudioContext and played on the SFX bus, ducking the theme music and the
 * jukebox like any long show sound — never through an <audio> element.
 */
import { synth } from '../../../audio/audio.ts';
import { duckThemeMusic } from '../themeMusic.ts';
import { TOUR_CHAPTERS } from './script.ts';
import { beatsOf } from './timeline.ts';
import { beatKey } from './useTour.ts';

export type Speaker = 'boo' | 'dasbot';

export interface FilmLine {
  key: string;
  text: string;
  who: Speaker;
}

/** The film's intro and outro lines (the chapters' lines are on their beats). */
export const FILM_INTRO: FilmLine = {
  key: 'intro',
  text: 'Psst! Hey, you! Yes, you, the presenter! I’m Boo, your ghostly host. Come backstage, and I’ll show you how to run the whole show.',
  who: 'boo',
};
export const FILM_OUTRO: readonly FilmLine[] = [
  { key: 'outro-dasbot', text: 'Beep boop! After October, I’m your host.', who: 'dasbot' },
  { key: 'outro-boo', text: 'Hey! This is MY tour. …Fine. See you next Halloween!', who: 'boo' },
  { key: 'outro-end', text: 'Now go put on a spooktacular show!', who: 'boo' },
];

/** Every line of the film, in order (the recorder renders the voice-over from this list). */
export function filmLines(): FilmLine[] {
  const lines: FilmLine[] = [FILM_INTRO];
  for (const chapter of TOUR_CHAPTERS) {
    beatsOf(chapter, true).forEach((beat, i) => {
      if (beat.boo?.say) lines.push({ key: beatKey(chapter, i), text: beat.boo.say, who: 'boo' });
    });
  }
  return [...lines, ...FILM_OUTRO];
}

/** Where a line's voice clip is served while the film is recorded. */
export const voiceUrl = (key: string) => `/tour-voice/${key.replace(/[^a-z0-9-]+/gi, '-')}.mp3`;

const clips = new Map<string, Promise<AudioBuffer | null>>();

function clip(key: string, ctx: AudioContext): Promise<AudioBuffer | null> {
  let p = clips.get(key);
  if (!p) {
    p = fetch(voiceUrl(key))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((data) => ctx.decodeAudioData(data))
      .catch(() => null);
    clips.set(key, p);
  }
  return p;
}

/** Decodes every clip ahead of time (so each line starts on its beat). */
export function preloadVoice(): void {
  const ctx = synth.context;
  if (ctx) for (const line of filmLines()) void clip(line.key, ctx);
}

let holdSeq = 0;

/** Says a line, if its clip is there. */
export function narrate(key: string): void {
  const ctx = synth.context;
  if (!ctx) return;
  void clip(key, ctx).then((buffer) => {
    const bus = synth.sfxBus;
    if (!buffer || !bus || synth.context !== ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(bus);
    src.start();
    duckThemeMusic(buffer.duration);
    const hold = `tour-voice:${++holdSeq}`;
    synth.hold(hold, true);
    setTimeout(() => synth.hold(hold, false), buffer.duration * 1000);
  });
}
