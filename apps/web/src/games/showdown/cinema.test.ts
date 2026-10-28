import { afterEach, describe, expect, it } from 'vitest';
import { CINEMA_MAX_CLIPS, addClips, cinemaView, clipTime, isVideoFile, removeClip, selectClip } from './cinema.ts';

const video = (name: string, type = 'video/mp4') => new File([new Uint8Array(8)], name, { type });

afterEach(() => {
  for (const c of [...cinemaView().clips]) removeClip(c.id);
});

describe('cinema clips (they stay in this browser)', () => {
  it('takes video files only, by type or by name when the type is missing', () => {
    expect(isVideoFile({ type: 'video/mp4', name: 'a.bin' })).toBe(true);
    expect(isVideoFile({ type: '', name: 'Cartoon.MOV' })).toBe(true);
    expect(isVideoFile({ type: 'image/png', name: 'a.mp4' })).toBe(false);
    expect(isVideoFile({ type: '', name: 'notes.txt' })).toBe(false);
  });

  it('loads up to the cap, selects the first, and falls back to the next when the chosen one goes', () => {
    expect(addClips([video('one.mp4'), new File(['x'], 'notes.txt', { type: 'text/plain' }), video('two.webm', 'video/webm')])).toBe(2);
    const [one, two] = cinemaView().clips;
    expect(cinemaView().clipId).toBe(one!.id);
    expect(one!.url.startsWith('blob:')).toBe(true);
    selectClip(two!.id);
    expect(cinemaView().clipId).toBe(two!.id);
    removeClip(two!.id);
    expect(cinemaView().clipId).toBe(one!.id);
    removeClip(one!.id);
    expect(cinemaView()).toMatchObject({ clipId: '', clips: [] });
    const many = Array.from({ length: CINEMA_MAX_CLIPS + 2 }, (_, i) => video(`c${i}.mp4`));
    expect(addClips(many)).toBe(CINEMA_MAX_CLIPS);
    expect(addClips([video('extra.mp4')])).toBe(0);
  });

  it('reads times as minutes:seconds', () => {
    expect(clipTime(0)).toBe('0:00');
    expect(clipTime(64.9)).toBe('1:04');
    expect(clipTime(432)).toBe('7:12');
    expect(clipTime(Number.NaN)).toBe('0:00');
    expect(clipTime(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});
