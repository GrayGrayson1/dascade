/**
 * Drawer → Cinema (Production Desk: Video A). Load the break videos from this computer (they stay in
 * this browser: nothing uploads), pick which one plays and its frame, and run it while Cinema is on the
 * stage: play/pause, back and forward 10 s, restart, and a seek bar (drag, click or keys). The
 * video plays in the stage window only, the window Teams is sharing; this tab only drives it.
 *
 * Laid out for its own width (container queries in CinemaPanel.css): one column in the drawer, two in
 * a wider panel.
 */
import { useRef, useState } from 'react';
import { Button, IconButton, Kbd, PixelIcon, Slider, cx } from '@dascade/ui';
import { sfx } from '../../../audio/audio.ts';
import {
  CINEMA_FRAMES,
  CINEMA_MAX_CLIPS,
  CINEMA_SKIP,
  addClips,
  cinemaPause,
  cinemaPlay,
  cinemaRestart,
  cinemaSeek,
  cinemaSkip,
  clipTime,
  removeClip,
  selectClip,
  setFrame,
  useCinema,
} from '../cinema.ts';
import { useSceneCard } from '../state.ts';
import './CinemaPanel.css';

/**
 * The seek bar's keys (seconds): arrows 5 s, Page Up/Down the buttons' 10 s; Home and End are the
 * slider's own (the start, the end).
 */
const SEEK_KEYS: Readonly<Record<string, number>> = {
  ArrowRight: 5,
  ArrowUp: 5,
  ArrowLeft: -5,
  ArrowDown: -5,
  PageUp: CINEMA_SKIP,
  PageDown: -CINEMA_SKIP,
};

export function CinemaPanel({ onScene }: { onScene: (cinema: boolean) => void }) {
  const cinema = useCinema();
  const up = useSceneCard() === 'cinema';
  const file = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const clip = cinema.clips.find((c) => c.id === cinema.clipId) ?? null;
  const full = cinema.clips.length >= CINEMA_MAX_CLIPS;
  /** The clip's length is known (a recorded .webm may learn it only at its end). */
  const known = cinema.duration > 0;
  const time = known ? Math.min(cinema.time, cinema.duration) : cinema.time;
  const total = known ? clipTime(cinema.duration) : '–:––';
  /** A clip to drive, and a stage window to drive it in. */
  const live = Boolean(clip) && cinema.window;
  const state = cinema.playing ? 'playing' : cinema.ended ? 'ended' : up ? 'ready' : 'loaded';

  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const added = addClips(Array.from(files));
    const skipped = files.length - added;
    setNote(
      added === 0
        ? full
          ? `That’s the most videos at once (${CINEMA_MAX_CLIPS}): remove one first.`
          : 'That isn’t a video file. Try an MP4.'
        : skipped > 0
          ? `Loaded ${added}; ${skipped} ${skipped === 1 ? 'wasn’t a video' : 'weren’t videos'} (or didn’t fit).`
          : `Loaded ${added} video${added === 1 ? '' : 's'}.`,
    );
    if (file.current) file.current.value = '';
  };

  return (
    <div className="sdc-tab sdc-cinema" data-part="showdown-cinema-panel">
      <div className="sdc-cinema__body">
        <div className="sdc-tabsection sdc-cinema__videos">
          <h3 className="sd-panel__title">Videos</h3>
          <p className="sd-muted">From this computer. They play in the stage window and never leave this browser.</p>
          <input
            ref={file}
            type="file"
            accept="video/*,.mp4,.m4v,.webm,.mov"
            multiple
            hidden
            onChange={(e) => onFiles(e.currentTarget.files)}
            data-part="showdown-cinema-file"
          />
          <div className="sdc-cinema__load">
            <Button
              size="sm"
              variant="secondary"
              icon="plus"
              disabled={full}
              onClick={() => file.current?.click()}
              data-part="showdown-cinema-load"
            >
              Load video…
            </Button>
            {note ? (
              <span className="sdc-cinema__note" role="status">
                {note}
              </span>
            ) : null}
          </div>
          {cinema.clips.length ? (
            <ul className="sdc-cinema__clips" aria-label="Loaded videos">
              {cinema.clips.map((c) => {
                const on = c.id === cinema.clipId;
                return (
                  <li key={c.id} className={cx('sdc-cinema__clip', on && 'is-on')} data-part="showdown-cinema-clip">
                    <label className="sdc-cinema__pick" title={c.name}>
                      <input
                        type="radio"
                        className="sdc-cinema__radio"
                        name="sdc-cinema-clip"
                        checked={on}
                        onChange={() => selectClip(c.id)}
                        disabled={up && cinema.playing}
                      />
                      <span className="sdc-cinema__mark" aria-hidden />
                      <span className="sdc-cinema__name">{c.name}</span>
                      {on ? <span className="sdc-cinema__tag">{up && cinema.playing ? 'On air' : 'Plays next'}</span> : null}
                    </label>
                    <IconButton
                      icon="trash"
                      size="sm"
                      variant="ghost"
                      label={`Remove ${c.name}`}
                      disabled={up && on && cinema.playing}
                      onClick={() => removeClip(c.id)}
                    />
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        <div className="sdc-tabsection sdc-cinema__framepick">
          <h3 className="sd-panel__title">Frame</h3>
          <div className="sdc-cinema__frames" role="group" aria-label="Frame">
            {CINEMA_FRAMES.map((f) => (
              <button
                key={f.id}
                type="button"
                className="sdc-card"
                aria-pressed={cinema.frame === f.id}
                title={f.blurb}
                onClick={() => {
                  sfx('select');
                  setFrame(f.id);
                }}
                data-frame={f.id}
              >
                <span className="sdc-card__title">{f.title}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sdc-tabsection sdc-cinema__run">
          {!cinema.window ? (
            <p className="sdc-cinema__warn" role="status">
              <PixelIcon name="warning" /> Open the stage window first: the video plays there.
            </p>
          ) : null}
          {cinema.blocked ? (
            <p className="sdc-cinema__warn" role="status" data-part="showdown-cinema-blocked">
              <PixelIcon name="warning" /> This browser wants one click in the stage window before it plays sound. Click anywhere in the
              stage window: the video starts.
            </p>
          ) : null}
          {cinema.failed ? (
            <p className="sdc-cinema__warn" role="status">
              <PixelIcon name="warning" /> This browser can’t play that file. Try an MP4 (H.264 video, AAC sound).
            </p>
          ) : null}
          <p className="sdc-cinema__now" data-part="showdown-cinema-status">
            {clip ? (
              <>
                <b className="sdc-cinema__state" data-state={state}>
                  {cinema.playing ? 'Playing' : cinema.ended ? 'Ended' : up ? 'Ready' : 'Loaded'}
                </b>{' '}
                <span className="sdc-cinema__nowname" title={clip.name}>
                  {clip.name}
                </span>
              </>
            ) : (
              <span className="sdc-cinema__nowname">No video loaded.</span>
            )}
          </p>
          <div className="sdc-cinema__seek">
            <span className="dc-num sdc-cinema__time" data-part="showdown-cinema-time">
              {clipTime(time)}
            </span>
            <Slider
              className="sdc-cinema__slider"
              value={time}
              min={0}
              max={known ? cinema.duration : 0}
              step={0.01}
              onChange={cinemaSeek}
              disabled={!live || !known}
              aria-label="Seek"
              aria-valuetext={`${clipTime(time)} of ${total}`}
              onKeyDown={(e) => {
                const by = SEEK_KEYS[e.key];
                if (by === undefined) return;
                e.preventDefault();
                cinemaSkip(by);
              }}
              // Dragged with the mouse, it lets go of the focus: the console's keys (B: back to the
              // show) skip a focused input. From the keyboard it keeps it (arrows, Home, End).
              onPointerUp={(e) => e.currentTarget.blur()}
              data-part="showdown-cinema-seek"
            />
            <span className="dc-num sdc-cinema__time" data-part="showdown-cinema-length">
              {total}
            </span>
          </div>
          <div className="sdc-cinema__transport">
            {up ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="arrow-left"
                  disabled={!live}
                  onClick={() => cinemaSkip(-CINEMA_SKIP)}
                  aria-label={`Back ${CINEMA_SKIP} s`}
                  title={`Back ${CINEMA_SKIP} seconds`}
                  data-part="showdown-cinema-back10"
                >
                  <span className="dc-num">{CINEMA_SKIP} s</span>
                </Button>
                {cinema.playing ? (
                  <Button
                    size="sm"
                    variant="primary"
                    icon="pause"
                    className="sdc-cinema__main"
                    onClick={cinemaPause}
                    data-part="showdown-cinema-pause"
                  >
                    Pause
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    icon="play"
                    className="sdc-cinema__main"
                    disabled={!live}
                    onClick={() => void cinemaPlay()}
                    data-part="showdown-cinema-play"
                  >
                    {cinema.ended ? 'Play again' : 'Play'}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  iconRight="arrow-right"
                  disabled={!live}
                  onClick={() => cinemaSkip(CINEMA_SKIP)}
                  aria-label={`Forward ${CINEMA_SKIP} s`}
                  title={`Forward ${CINEMA_SKIP} seconds`}
                  data-part="showdown-cinema-fwd10"
                >
                  <span className="dc-num">{CINEMA_SKIP} s</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="refresh"
                  disabled={!clip}
                  onClick={cinemaRestart}
                  data-part="showdown-cinema-restart"
                >
                  Restart
                </Button>
                <Button size="sm" variant="secondary" icon="arrow-left" onClick={() => onScene(false)} data-part="showdown-cinema-back">
                  Back to the show <Kbd>B</Kbd>
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="primary"
                icon="play"
                className="sdc-cinema__up"
                disabled={!live}
                onClick={() => onScene(true)}
                data-part="showdown-cinema-up"
              >
                Put Cinema on the stage <Kbd>V</Kbd>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
