/**
 * The Presenter Tour's pictures around the stage: the big-picture diagram (chapter 1: your laptop,
 * the private console, the stage window shared into the meeting, the locked answers, optional
 * phones), a generic meeting app's share panel (chapter 2), the meeting chat and the stage window
 * frame. All decorative and generic — no meeting app's logo or interface is imitated; the captions
 * say what matters.
 */
import { type CSSProperties, type ReactNode } from 'react';
import type { ShowdownLook, ShowdownSettings } from '@dascade/shared/games/showdown';
import { PixelIcon } from '@dascade/ui';
import { Stage } from '../Stage.tsx';
import { Camera } from './MockConsole.tsx';
import { CONSOLE_WINDOW_TITLE } from '../consoleParts.tsx';
import { stageWindowTitle } from '../stageWindow.ts';
import { DEMO_ROUNDS } from './script.ts';
import type { ChatLine } from './timeline.ts';

/** The real stage (preview variant) in a 16:9 box. */
export function StageBox({ look, settings, className }: { look: ShowdownLook; settings: ShowdownSettings; className?: string }) {
  return (
    <div className={`tour-stagebox ${className ?? ''}`}>
      <Stage look={look} settings={settings} variant="preview" />
    </div>
  );
}

/** The stage window: a window frame around the stage, or the empty desk when it's closed. */
export function StageWindow({
  open,
  look,
  settings,
  title,
}: {
  open: boolean;
  look: ShowdownLook;
  settings: ShowdownSettings;
  title: string;
}) {
  return (
    <div className="tour-window" data-open={open ? 'true' : undefined}>
      <div className="tour-window__bar" aria-hidden>
        <i />
        <i />
        <i />
        <span className="tour-window__title">{open ? stageWindowTitle(title) : 'No stage window'}</span>
      </div>
      <div className="tour-window__body">
        {open ? (
          <StageBox look={look} settings={settings} />
        ) : (
          <div className="tour-window__closed">
            <PixelIcon name="maximize" />
            <span>The stage window is closed</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chapter 1: the big picture
// ---------------------------------------------------------------------------

const BIG_W = 1600;
const BIG_H = 780;

/**
 * Your laptop (the console and the stage window), the meeting, the server with the locked answers and
 * the optional phones; `step` lights them up one by one (0 laptop … 5 phones).
 */
export function BigPicture({
  step,
  look,
  settings,
  title,
  motion,
}: {
  step: number;
  look: ShowdownLook;
  settings: ShowdownSettings;
  title: string;
  motion: boolean;
}) {
  const answers = DEMO_ROUNDS[0].answers;
  /** Shown from step `n` on. */
  const on = (n: number) => (step >= n ? 'true' : 'false');
  return (
    <Camera w={BIG_W} h={BIG_H} point="" zoom={1} keyHint="" landed={0} pressed={false} motion={motion} screen="diagram" cursor={false}>
      <div className="tour-big" data-step={step} data-look={look}>
        <svg className="tour-big__wires" viewBox={`0 0 ${BIG_W} ${BIG_H}`} aria-hidden focusable="false">
          {/* stage window → meeting */}
          <path className="tour-big__share" data-on={on(3)} d="M902 330 C 990 330, 1000 300, 1080 300" />
          {/* console → server (the answers go up, locked) */}
          <path className="tour-big__up" data-on={on(4)} d="M300 140 C 300 60, 560 46, 700 46" />
          {/* server → stage window (one answer, when you flip it) */}
          <path className="tour-big__down" data-on={on(4)} d="M900 46 C 1010 46, 760 80, 720 150" />
          {/* server ⋯ phones */}
          <path className="tour-big__phones" data-on={on(5)} d="M900 70 C 1300 70, 1360 520, 1370 600" />
        </svg>

        <div className="tour-big__laptop" data-on="true">
          <div className="tour-big__screen">
            <div
              className="tour-big__win tour-big__win--console"
              data-focus={step === 1 ? 'true' : undefined}
              data-dim={step === 2 || step === 3 ? 'true' : undefined}
            >
              <div className="tour-big__winbar tour-big__winbar--private">
                <PixelIcon name="lock" /> {CONSOLE_WINDOW_TITLE.replace(/^🔒 /, '')}
              </div>
              <div className="tour-big__sheet">
                {answers.slice(0, 6).map((a, i) => (
                  <span key={i} className="tour-big__row" style={{ '--i': i } as CSSProperties}>
                    <b>{i + 1}</b>
                    <span>{a.text}</span>
                  </span>
                ))}
                <span className="tour-big__wrong">✕ Wrong</span>
              </div>
              <span className="tour-big__badge tour-big__badge--private" data-on={on(1)}>
                <PixelIcon name="lock" /> Only you
              </span>
            </div>
            <div
              className="tour-big__win tour-big__win--stage"
              data-focus={step === 2 ? 'true' : undefined}
              data-dim={step === 1 ? 'true' : undefined}
            >
              <div className="tour-big__winbar">
                <PixelIcon name="eye" /> {stageWindowTitle(title)}
              </div>
              <StageBox look={look} settings={settings} />
              <span className="tour-big__badge tour-big__badge--share" data-on={on(2)}>
                <PixelIcon name="share" /> Share this one
              </span>
            </div>
          </div>
          <div className="tour-big__base" />
          <span className="tour-big__caption">Your laptop</span>
        </div>

        <div className="tour-big__server" data-on={on(4)}>
          <span className="tour-big__cloud" aria-hidden />
          <span className="tour-big__servertext">
            <PixelIcon name="lock" /> Answers, locked
          </span>
        </div>
        <span className="tour-big__token tour-big__token--up" data-on={on(4)} aria-hidden>
          <PixelIcon name="lock" />
        </span>
        <span className="tour-big__token tour-big__token--down" data-on={on(4)} aria-hidden>
          #2
        </span>

        <div className="tour-big__meeting" data-on={on(3)} data-focus={step === 3 ? 'true' : undefined}>
          <div className="tour-big__meetbar">Your meeting</div>
          <StageBox look={look} settings={settings} className="tour-big__shared" />
          <div className="tour-big__people" aria-hidden>
            {['A', 'G', 'L', 'M', 'H'].map((c, i) => (
              <span key={c} style={{ '--i': i } as CSSProperties}>
                {c}
              </span>
            ))}
          </div>
          <span className="tour-big__sound" aria-hidden>
            <PixelIcon name="sound-on" />
            <i />
            <i />
            <i />
          </span>
          <span className="tour-big__sharelabel">
            Share → Window + <b>Include sound</b>
          </span>
        </div>

        <div className="tour-big__phones-row" data-on={on(5)}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="tour-big__phone" style={{ '--i': i } as CSSProperties} aria-hidden>
              <i>{['👻', '🎃', '👏'][i]}</i>
            </span>
          ))}
          <span className="tour-big__phonelabel">Phones: optional, to cheer along</span>
        </div>
      </div>
    </Camera>
  );
}

// ---------------------------------------------------------------------------
// Chapter 2: sharing the stage window (a generic meeting app)
// ---------------------------------------------------------------------------

const SHARE_W = 1120;
const SHARE_H = 700;
const SHARE_POINT = ['share-button', 'include-sound', 'window-stage'];

export function ShareMock({
  step,
  look,
  settings,
  title,
  motion,
}: {
  step: number;
  look: ShowdownLook;
  settings: ShowdownSettings;
  title: string;
  motion: boolean;
}) {
  const point = SHARE_POINT[Math.max(0, Math.min(2, step))]!;
  return (
    <Camera w={SHARE_W} h={SHARE_H} point={point} zoom={1} keyHint="" landed={step} pressed motion={motion} screen={`share:${step}`}>
      <div className="tour-share" data-step={step}>
        <div className="tour-share__call">
          <span className="tour-share__appname">Your meeting app</span>
          <div className="tour-share__tiles" aria-hidden>
            {['A', 'G', 'L', 'M'].map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <div className="tour-share__toolbar">
            <span className="tour-share__tool">
              <PixelIcon name="sound-on" /> Mic
            </span>
            <span className="tour-share__tool">
              <PixelIcon name="eye" /> Camera
            </span>
            <span className="tour-share__tool tour-share__tool--share" data-tour="share-button">
              <PixelIcon name="share" /> Share
            </span>
            <span className="tour-share__tool tour-share__tool--leave">Leave</span>
          </div>
        </div>
        <div className="tour-share__panel">
          <div className="tour-share__head">
            <b>Share content</b>
            <span className="tour-share__toggle" data-on={step >= 1 ? 'true' : undefined} data-tour="include-sound">
              <i aria-hidden />
              Include sound
            </span>
          </div>
          <div className="tour-share__tabs">
            <span>Screen</span>
            <span data-on="true">Window</span>
          </div>
          <div className="tour-share__windows">
            <div className="tour-share__win" data-picked={step >= 2 ? 'true' : undefined} data-tour="window-stage">
              <StageBox look={look} settings={settings} />
              <span className="tour-share__wintitle">
                {step >= 2 ? <PixelIcon name="check" /> : null} {stageWindowTitle(title)}
              </span>
            </div>
            <div className="tour-share__win tour-share__win--no">
              <div className="tour-share__fakeconsole tour-share__fakeconsole--private" aria-hidden>
                {Array.from({ length: 6 }, (_, i) => (
                  <i key={i} />
                ))}
              </div>
              <span className="tour-share__wintitle">{CONSOLE_WINDOW_TITLE}</span>
              <span className="tour-share__never">
                <PixelIcon name="lock" /> Never this one
              </span>
            </div>
          </div>
        </div>
      </div>
    </Camera>
  );
}

// ---------------------------------------------------------------------------
// The meeting chat
// ---------------------------------------------------------------------------

const CHAT_COLORS = ['#ff8a1f', '#b26bff', '#2dd4bf', '#f472b6', '#facc15', '#60a5fa', '#a3e635', '#fb7185'];

function colorOf(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return CHAT_COLORS[h % CHAT_COLORS.length]!;
}

/** "Your meeting chat": where the guesses come in (generic: no meeting app's look). */
export function MeetingChat({ lines, children }: { lines: readonly ChatLine[]; children?: ReactNode }) {
  const shown = lines.slice(-4);
  return (
    <section className="tour-chat" aria-label="Your meeting chat">
      <h3 className="tour-chat__title">
        <PixelIcon name="chat" /> Your meeting chat
      </h3>
      <ol className="tour-chat__list">
        {shown.length === 0 ? <li className="tour-chat__empty">Guesses arrive here.</li> : null}
        {shown.map((line, i) => (
          <li key={lines.length - shown.length + i} className="tour-chat__msg" style={{ '--who': colorOf(line.who) } as CSSProperties}>
            <span className="tour-chat__avatar" aria-hidden>
              {line.who.slice(0, 1)}
            </span>
            <span className="tour-chat__body">
              <span className="tour-chat__who">{line.who}</span>
              <span className="tour-chat__text">{line.text}</span>
            </span>
          </li>
        ))}
      </ol>
      {children}
    </section>
  );
}
