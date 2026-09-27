/**
 * One arcade cabinet in the lineup: a real <button> (focusable, keyboard
 * operable, announced) wrapping the SVG body, the lit marquee, the attract
 * screen and a floor nameplate. The lineup positions the <li> imperatively
 * (transform, z-index, side-panel reveal) so motion never re-renders React.
 */
import { memo, useId, type CSSProperties } from 'react';
import { cabinetPlayersLabel, type CabinetDef } from '@dascade/shared';
import { AttractCanvas } from './AttractCanvas.tsx';
import { CABINET_PLAYLISTS } from './attract.ts';
import { CabinetArt, cabLayout } from './cabinetArt.tsx';
import { MarqueeLogo } from './Marquee.tsx';

export interface CabinetProps {
  cabinet: CabinetDef;
  index: number;
  count: number;
  /** Centred in the lineup. */
  active: boolean;
  /** Attract screen animates (the centred cabinet and its neighbours). */
  running: boolean;
  tabbable: boolean;
  /** Returning from this cabinet: its screen is the view-transition target. */
  isLast: boolean;
  touch: boolean;
  onPress: (index: number) => void;
  onKeyboardFocus: (index: number) => void;
  onHover: (index: number) => void;
  setSlot: (index: number, el: HTMLLIElement | null) => void;
  setButton: (index: number, el: HTMLButtonElement | null) => void;
  setScreen: (index: number, el: HTMLElement | null) => void;
}

const SPARKS = Array.from({ length: 8 }, (_, i) => i);
const LAYOUT = cabLayout();

function isKeyboardFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

/** "DASino — Cards & Casino, 1–30 players, 5 games" */
export function cabinetLabel(cabinet: CabinetDef): string {
  const n = cabinet.games.length;
  return `${cabinet.title} — ${cabinet.family}, ${cabinetPlayersLabel(cabinet)}${n > 1 ? `, ${n} games` : ''}`;
}

export const Cabinet = memo(function Cabinet({
  cabinet,
  index,
  count,
  active,
  running,
  tabbable,
  isLast,
  touch,
  onPress,
  onKeyboardFocus,
  onHover,
  setSlot,
  setButton,
  setScreen,
}: CabinetProps) {
  const uid = `cab${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const multi = cabinet.games.length > 1;
  const describedBy = `${uid}-desc`;
  return (
    <li
      ref={(el) => setSlot(index, el)}
      className="af-slot"
      data-index={index}
      data-active={active ? 'true' : undefined}
      style={
        {
          '--p': cabinet.accent.primary,
          '--s': cabinet.accent.secondary,
          '--d': cabinet.accent.deep,
        } as CSSProperties
      }
    >
      <button
        ref={(el) => setButton(index, el)}
        type="button"
        className="af-cab"
        id={`cabinet-${cabinet.id}`}
        data-cabinet={cabinet.id}
        data-active={active ? 'true' : undefined}
        data-last={isLast ? 'true' : undefined}
        aria-current={active ? 'true' : undefined}
        aria-label={cabinetLabel(cabinet)}
        aria-describedby={describedBy}
        aria-roledescription="cabinet"
        tabIndex={tabbable ? 0 : -1}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') onHover(index);
        }}
        onFocus={(e) => {
          if (isKeyboardFocus(e.currentTarget)) onKeyboardFocus(index);
        }}
        onClick={() => onPress(index)}
      >
        <span className="visually-hidden" id={describedBy}>
          {`${index + 1} of ${count}. ${multi ? `Games: ${cabinet.games.map((g) => g.title).join(', ')}. ` : ''}${cabinet.tagline}`}
        </span>
        <span className="af-cab__body">
          <span className="af-cab__halo" aria-hidden />
          <CabinetArt cabinet={cabinet} uid={uid} />
          <span className="af-cab__marquee" style={LAYOUT.marquee}>
            <MarqueeLogo subject={cabinet} />
          </span>
          <span className="af-cab__screen" ref={(el) => setScreen(index, el)} style={LAYOUT.screen}>
            <AttractCanvas
              scenes={CABINET_PLAYLISTS[cabinet.id]}
              title={cabinet.marquee}
              accent={cabinet.accent}
              active={active}
              running={running}
              offset={index * 0.83}
            />
            <span className="af-cab__glass" aria-hidden />
          </span>
          <span className="af-cab__sparks" aria-hidden style={{ left: LAYOUT.face.left, width: LAYOUT.face.width }}>
            {SPARKS.map((k) => (
              <i key={k} style={{ '--k': k } as CSSProperties} />
            ))}
          </span>
          <span className="af-cab__focus" aria-hidden style={{ left: LAYOUT.face.left, width: LAYOUT.face.width }} />
        </span>
        <span className="af-cab__reflect" aria-hidden />
        <span className="af-cab__plate" aria-hidden>
          <span className="af-cab__name">{cabinet.title}</span>
          <span className="af-cab__family">
            {cabinet.family}
            {multi ? <b> · {cabinet.games.length} games</b> : null}
          </span>
          {touch ? <span className="af-cab__hint">{active ? 'Tap again to open' : ''}</span> : null}
        </span>
      </button>
    </li>
  );
});
