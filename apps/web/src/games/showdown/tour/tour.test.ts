/**
 * The Presenter Tour: the timeline's pure functions, the script's consistency with the console it
 * teaches (every cursor target exists on the mock, every control name in a caption is a real one),
 * the demo source, and the stage hooks reading a demo source only inside its provider.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { isValidRoomCode } from '@dascade/shared';
import { SHOWDOWN_CARD_INFO, SHOWDOWN_CUE_INFO } from '@dascade/shared/games/showdown';
import { showFeed } from '../fx.ts';
import { ShowSourceProvider } from '../source.ts';
import { useBoard, useCard, useClock, useShowCode, useShowPhase } from '../state.ts';
import { createDemoSource } from './demoSource.ts';
import { DEMO_CODE, DEMO_ROUNDS, TOUR_CHAPTERS } from './script.ts';
import {
  CLICK_AT,
  FILM_PACE,
  beatsOf,
  captionText,
  chapterLength,
  clicks,
  frameAt,
  holdOf,
  parseCaption,
  preFrameAt,
  showAt,
  tourLength,
  type TourChapter,
} from './timeline.ts';

const HERE = import.meta.dirname;
const read = (...parts: string[]) => readFileSync(join(HERE, ...parts), 'utf8');

describe('timeline', () => {
  const chapter: TourChapter = {
    id: 't',
    title: 'Test',
    setup: { phase: 'LOBBY', board: null, finale: null, card: null, sweep: false, clock: { max: 0, left: 0, running: false, show: true } },
    screen: 'lobby',
    stage: false,
    preset: false,
    beats: [
      { hold: 1000, caption: 'One', console: { point: 'a', zoom: 2 }, chat: { who: 'Ada', text: 'hi' } },
      { hold: 2000, console: { click: true, key: 'X', screen: 'console' }, show: { card: 'welcome' }, stage: true },
      { hold: 500, cut: 'film', boo: { say: 'Boo!', act: 'jump' } },
      { hold: 800, cut: 'tour', caption: 'Three', chat: { who: 'Grace', text: 'yo' } },
    ],
  };

  it('keeps each cut’s own beats and paces the film slower', () => {
    expect(beatsOf(chapter, false)).toHaveLength(3);
    expect(beatsOf(chapter, true)).toHaveLength(3);
    expect(chapterLength(chapter, false)).toBe(3800);
    expect(holdOf({ hold: 1000 }, true)).toBe(Math.round(1000 * FILM_PACE));
    expect(holdOf({ hold: 1000, filmHold: 1200 }, true)).toBe(1200);
  });

  it('builds a frame from every beat so far', () => {
    const f0 = frameAt(chapter, 0, false);
    expect(f0).toMatchObject({ caption: 'One', screen: 'lobby', point: 'a', zoom: 2, click: false, stage: false });
    expect(f0.chat).toEqual([{ who: 'Ada', text: 'hi' }]);
    const f1 = frameAt(chapter, 1, false);
    // A new screen with no point: the cursor rests and the camera pulls back.
    expect(f1).toMatchObject({ caption: 'One', screen: 'console', point: '', zoom: 1, click: true, key: 'X', stage: true });
    const f2 = frameAt(chapter, 2, false);
    expect(f2.click).toBe(false);
    expect(f2.chat).toHaveLength(2);
    expect(frameAt(chapter, -1, false)).toMatchObject({ caption: '', screen: 'lobby', chat: [] });
  });

  it('shows a click’s before-picture until it lands', () => {
    const pre = preFrameAt(chapter, 1, false);
    expect(pre).toMatchObject({ screen: 'lobby', point: 'a', stage: false, click: false, key: 'X' });
    expect(clicks(beatsOf(chapter, false)[1])).toBe(true);
  });

  it('carries Boo’s mood but not his line past its beat', () => {
    const film = frameAt(chapter, 2, true);
    expect(film.boo).toEqual({ say: 'Boo!', act: 'jump', mood: 'idle' });
  });

  it('adds up the show beat by beat', () => {
    expect(showAt(chapter, -1, false).card).toBeNull();
    expect(showAt(chapter, 1, false).card).toBe('welcome');
  });

  it('parses captions into words, control names, keys, app names and bold', () => {
    expect(parseCaption('Press [[Wrong]] (or {{X}}) in *Teams*, **now**.')).toEqual([
      { kind: 'text', text: 'Press ' },
      { kind: 'button', text: 'Wrong' },
      { kind: 'text', text: ' (or ' },
      { kind: 'key', text: 'X' },
      { kind: 'text', text: ') in ' },
      { kind: 'app', text: 'Teams' },
      { kind: 'text', text: ', ' },
      { kind: 'bold', text: 'now' },
      { kind: 'text', text: '.' },
    ]);
    expect(captionText('Press [[Wrong]] (or {{X}}).')).toBe('Press Wrong (or X).');
  });
});

describe('the tour script', () => {
  const all = TOUR_CHAPTERS.flatMap((c) => c.beats.map((b) => ({ chapter: c, beat: b })));

  it('has ten chapters of 8–35 s, about 3–4 minutes in all', () => {
    expect(TOUR_CHAPTERS).toHaveLength(10);
    for (const c of TOUR_CHAPTERS) {
      const ms = chapterLength(c, false);
      expect(ms, c.id).toBeGreaterThanOrEqual(8_000);
      expect(ms, c.id).toBeLessThanOrEqual(35_000);
    }
    const total = tourLength(TOUR_CHAPTERS, false);
    expect(total).toBeGreaterThan(150_000);
    expect(total).toBeLessThan(260_000);
    expect(new Set(TOUR_CHAPTERS.map((c) => c.id)).size).toBe(TOUR_CHAPTERS.length);
  });

  it('gives a clicking beat time to land', () => {
    for (const { chapter, beat } of all) if (clicks(beat)) expect(beat.hold, `${chapter.id}`).toBeGreaterThan(CLICK_AT);
  });

  it('points only at controls the mock console has', () => {
    const mock = read('MockConsole.tsx') + read('Illustrations.tsx');
    const targets = new Set([...mock.matchAll(/data-tour="([^"]+)"/g)].map((m) => m[1]!));
    // data-tour={cond ? 'a' : 'b'}
    for (const m of mock.matchAll(/data-tour=\{([^}]*)\}/g)) for (const q of m[1]!.matchAll(/'([^']+)'/g)) targets.add(q[1]!);
    for (let n = 1; n <= 10; n++) targets.add(`answer-${n}`);
    for (const card of Object.keys(SHOWDOWN_CARD_INFO)) targets.add(`card-${card}`);
    for (const tab of ['picker', 'sound', 'cards', 'fix']) targets.add(`tab-${tab}`);
    for (const { chapter, beat } of all) {
      const point = beat.console?.point;
      if (point) expect(targets.has(point), `${chapter.id}: ${point}`).toBe(true);
    }
    expect(mock).toContain('data-tour={`answer-${i + 1}`}');
    expect(mock).toContain('data-tour={`card-${c}`}');
    expect(mock).toContain('data-tour={`tab-${t.id}`}');
  });

  it('names controls exactly as the console does', () => {
    // The console, the lobby (Settings, Start game) and the shared card and cue titles.
    const dir = join(HERE, '..');
    const sources = [
      ...readdirSync(dir)
        .filter((f) => f.endsWith('.tsx'))
        .map((f) => read('..', f)),
      readFileSync(join(HERE, '..', '..', '..', 'shell', 'Lobby.tsx'), 'utf8'),
      ...Object.values(SHOWDOWN_CARD_INFO).map((c) => `'${c.title}'`),
      ...Object.values(SHOWDOWN_CUE_INFO).map((c) => `'${c.title}'`),
    ].join('\n');
    const names = new Set<string>();
    for (const { beat } of all) for (const part of parseCaption(beat.caption ?? '')) if (part.kind === 'button') names.add(part.text);
    expect(names.size).toBeGreaterThan(20);
    for (const name of names) {
      const quoted = new RegExp(`(?:['"\`>]|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:['"\`<]|\\s|\\{)`);
      expect(quoted.test(sources), name).toBe(true);
    }
  });

  it('uses the runbook’s keys', () => {
    const keys = new Set(
      all
        .flatMap(({ beat }) => [
          beat.console?.key,
          ...parseCaption(beat.caption ?? '')
            .filter((p) => p.kind === 'key')
            .map((p) => p.text),
        ])
        .filter(Boolean),
    );
    for (const key of keys)
      expect(
        ['Q', 'X', 'R', 'C', 'P', 'N', 'U', 'K', 'D', 'A', 'Space', 'Esc', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
        String(key),
      ).toContain(key);
    for (const key of ['X', 'R', 'C', 'P', 'N', 'U', 'Q', 'Space', 'Esc']) expect(keys.has(key), key).toBe(true);
  });

  it('flips only tiles the board shows, with the right flags', () => {
    for (const { chapter, beat } of all) {
      for (const e of beat.events ?? []) {
        if (e.type !== 'reveal') continue;
        const board = beat.show?.board;
        expect(board, chapter.id).toBeTruthy();
        const round = DEMO_ROUNDS[board!.round as 0 | 1];
        expect(board!.slots[e.slot]?.revealed, `${chapter.id} #${e.slot + 1}`).toBe(true);
        expect(e.text).toBe(round.answers[e.slot]!.text);
        expect(e.special).toBe(e.slot === round.special);
        expect(e.cleared).toBe(board!.slots.every((s) => s.revealed));
        expect(board!.stage).toBe(e.cleared ? 'done' : 'live');
      }
    }
  });

  it('plays the drumroll only before a hidden special answer, as the room does', () => {
    for (const { chapter, beat } of all) for (const e of beat.events ?? []) if (e.type === 'suspense') expect(e.slot, chapter.id).toBe(4);
  });

  it('uses a room code nobody can join', () => {
    expect(isValidRoomCode(DEMO_CODE)).toBe(false);
  });

  it('every chapter can start on its own', () => {
    for (const c of TOUR_CHAPTERS) {
      const end = showAt(c, beatsOf(c, false).length - 1, false);
      expect(end.phase, c.id).toMatch(/LOBBY|PLAYING|RESULTS/);
      expect(frameAt(c, beatsOf(c, false).length - 1, false).caption, c.id).not.toBe('');
    }
  });
});

describe('the demo source', () => {
  it('serves the stage’s state and its own feed, never the room’s', () => {
    const demo = createDemoSource('DEMO');
    expect(demo.get()).toMatchObject({ phase: 'LOBBY', code: 'DEMO', boardJson: '', card: '' });
    demo.set({ card: 'welcome' });
    expect(demo.get().card).toBe('welcome');
    const before = showFeed.get();
    demo.feed.event({ type: 'miss', rev: 1, round: 0, n: 1 });
    expect(demo.feed.get().last.miss?.e).toMatchObject({ n: 1 });
    expect(showFeed.get()).toBe(before);
    demo.reset({ ...demo.show(), card: null });
    expect(demo.feed.get().event).toBeNull();
    expect(demo.get().card).toBe('');
  });

  it('runs and freezes its clock', () => {
    const demo = createDemoSource('DEMO');
    demo.set({ clock: { max: 600_000, left: 300_000, running: true, show: true } });
    expect(demo.get().clockEndsAt).toBeGreaterThan(0);
    demo.freeze();
    const frozen = demo.get();
    expect(frozen.clockEndsAt).toBe(0);
    expect(frozen.clockLeft).toBeGreaterThan(299_000);
    demo.set({ clock: { max: 600_000, left: 120_000, running: true, show: true } });
    expect(demo.get()).toMatchObject({ clockEndsAt: 0, clockLeft: 120_000 });
    demo.thaw();
    expect(demo.get().clockEndsAt).toBeGreaterThan(0);
    expect(demo.clockLeft()).toBeLessThanOrEqual(120_000);
  });
});

describe('stage hooks', () => {
  function Probe() {
    const board = useBoard();
    const clock = useClock();
    return createElement('p', null, `${useShowPhase()}|${useShowCode()}|${useCard() ?? '-'}|${board?.title ?? '-'}|${clock.max}`);
  }

  it('read the demo source inside its provider', () => {
    const demo = createDemoSource('DEMO');
    demo.set({
      phase: 'PLAYING',
      card: 'prizes',
      board: TOUR_CHAPTERS[3]!.setup.board,
      clock: { max: 600_000, left: 1000, running: false, show: true },
    });
    const html = renderToString(createElement(ShowSourceProvider, { source: demo }, createElement(Probe)));
    expect(html).toContain('PLAYING|DEMO|prizes|Halloween Candy|600000');
  });

  it('read the room (nothing here: no room) without a provider', () => {
    const html = renderToString(createElement(Probe));
    expect(html).toContain('LOBBY||-|-|0');
  });
});
