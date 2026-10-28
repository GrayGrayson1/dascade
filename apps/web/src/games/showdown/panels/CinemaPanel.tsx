/**
 * Drawer → Cinema (Production Desk: Video A). Load the break videos from this computer (they stay in
 * this browser: nothing uploads), pick which one plays and its frame, and run it while Cinema is on the
 * stage. The video plays in the stage window only, the window Teams is sharing.
 */
import { useRef, useState } from 'react';
import { Button, IconButton, Kbd, PixelIcon, cx } from '@dascade/ui';
import { sfx } from '../../../audio/audio.ts';
import {
  CINEMA_FRAMES,
  CINEMA_MAX_CLIPS,
  addClips,
  cinemaPause,
  cinemaPlay,
  cinemaRestart,
  clipTime,
  removeClip,
  selectClip,
  setFrame,
  useCinema,
} from '../cinema.ts';
import { useSceneCard } from '../state.ts';

export function CinemaPanel({ onScene }: { onScene: (cinema: boolean) => void }) {
  const cinema = useCinema();
  const up = useSceneCard() === 'cinema';
  const file = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const clip = cinema.clips.find((c) => c.id === cinema.clipId) ?? null;
  const full = cinema.clips.length >= CINEMA_MAX_CLIPS;
  const progress = cinema.duration > 0 ? Math.min(1, cinema.time / cinema.duration) : 0;

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
      <div className="sdc-tabsection">
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
        <div className="sd-row sd-row--wrap">
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
            <span className="sd-muted" role="status">
              {note}
            </span>
          ) : null}
        </div>
        {cinema.clips.length ? (
          <ul className="sdc-cinema__clips" aria-label="Loaded videos">
            {cinema.clips.map((c) => (
              <li key={c.id} className={cx('sdc-cinema__clip', c.id === cinema.clipId && 'is-on')}>
                <label>
                  <input
                    type="radio"
                    name="sdc-cinema-clip"
                    checked={c.id === cinema.clipId}
                    onChange={() => selectClip(c.id)}
                    disabled={up && cinema.playing}
                  />
                  <span className="sdc-cinema__name">{c.name}</span>
                </label>
                <IconButton
                  icon="trash"
                  size="sm"
                  variant="ghost"
                  label={`Remove ${c.name}`}
                  disabled={up && c.id === cinema.clipId && cinema.playing}
                  onClick={() => removeClip(c.id)}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="sdc-tabsection">
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
            <PixelIcon name="warning" /> This browser wants one click in the stage window before it plays sound. Click anywhere in the stage
            window: the video starts.
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
              <b>{cinema.playing ? 'Playing' : cinema.ended ? 'Ended' : up ? 'Ready' : 'Loaded'}</b> {clip.name} ·{' '}
              <span className="dc-num">
                {clipTime(cinema.time)} / {clipTime(cinema.duration)}
              </span>
            </>
          ) : (
            'No video loaded.'
          )}
        </p>
        <div
          className="sdc-cinema__bar"
          role="progressbar"
          aria-label="Video progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <i style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="sd-row sd-row--wrap">
          {up ? (
            <>
              {cinema.playing ? (
                <Button size="sm" variant="primary" icon="pause" onClick={cinemaPause} data-part="showdown-cinema-pause">
                  Pause
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  icon="play"
                  disabled={!clip || !cinema.window}
                  onClick={() => void cinemaPlay()}
                  data-part="showdown-cinema-play"
                >
                  {cinema.ended ? 'Play again' : 'Play'}
                </Button>
              )}
              <Button size="sm" variant="ghost" icon="refresh" disabled={!clip} onClick={cinemaRestart}>
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
              disabled={!clip || !cinema.window}
              onClick={() => onScene(true)}
              data-part="showdown-cinema-up"
            >
              Put Cinema on the stage <Kbd>V</Kbd>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
