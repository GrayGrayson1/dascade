/**
 * One arcade cabinet on the floor: a real <button> (so it's focusable,
 * keyboard-operable and announced) wrapping the SVG body, the lit marquee,
 * the live attract screen and a floor nameplate.
 *
 * First press selects the cabinet; pressing a selected cabinet plays it.
 */
import { memo, useId, useRef, useState, type CSSProperties } from 'react';
import type { GameCatalogEntry, GameId } from '@dascade/shared';
import { AttractCanvas } from './AttractCanvas.tsx';
import { CabinetArt, cabLayout, type Side } from './cabinetArt.tsx';
import { MarqueeLogo } from './Marquee.tsx';

export interface CabinetProps {
  game: GameCatalogEntry;
  index: number;
  count: number;
  selected: boolean;
  tabbable: boolean;
  isLast: boolean;
  onPress: (id: GameId, wasSelected: boolean) => void;
  onKeyboardFocus: (id: GameId) => void;
  onHover: (id: GameId) => void;
  setButton: (id: GameId, el: HTMLButtonElement | null) => void;
  setScreen: (id: GameId, el: HTMLElement | null) => void;
}

const SPARKS = Array.from({ length: 8 }, (_, i) => i);

function isKeyboardFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

export const Cabinet = memo(function Cabinet({ game, index, count, selected, tabbable, isLast, onPress, onKeyboardFocus, onHover, setButton, setScreen }: CabinetProps) {
  const side: Side = index < count / 2 ? 'right' : 'left';
  const half = (count - 1) / 2;
  const tilt = half > 0 ? ((index - half) / half) * -4.5 : 0;
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const pressedSelected = useRef<boolean | null>(null);
  const active = hover || focus || selected;
  const layout = cabLayout(side);
  const uid = `cab${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const players =
    game.capacity.minPlayers === game.capacity.maxPlayersLimit ? `${game.capacity.minPlayers}` : `${game.capacity.minPlayers}–${game.capacity.maxPlayersLimit}`;

  return (
    <li
      className="af-cab-slot"
      data-index={index}
      data-selected={selected ? 'true' : undefined}
      style={
        {
          '--tilt': `${tilt.toFixed(2)}deg`,
          '--p': game.accent.primary,
          '--s': game.accent.secondary,
          '--d': game.accent.deep,
          '--accent': game.accent.primary,
          '--i': index,
        } as CSSProperties
      }
    >
      <button
        ref={(el) => setButton(game.id, el)}
        type="button"
        className="af-cab"
        id={`cabinet-${game.id}`}
        data-game={game.id}
        data-side={side}
        data-active={active ? 'true' : undefined}
        data-selected={selected ? 'true' : undefined}
        data-last={isLast ? 'true' : undefined}
        aria-pressed={selected}
        aria-label={`${game.title} cabinet. ${game.tagline} ${players} players.`}
        tabIndex={tabbable ? 0 : -1}
        onPointerDown={() => {
          pressedSelected.current = selected;
        }}
        onPointerEnter={(e) => {
          if (e.pointerType !== 'mouse') return;
          setHover(true);
          onHover(game.id);
        }}
        onPointerLeave={() => setHover(false)}
        onFocus={(e) => {
          setFocus(true);
          if (isKeyboardFocus(e.currentTarget)) onKeyboardFocus(game.id);
        }}
        onBlur={() => setFocus(false)}
        onClick={() => {
          const was = pressedSelected.current ?? selected;
          pressedSelected.current = null;
          onPress(game.id, was);
        }}
      >
        <span className="af-cab__body">
          <span className="af-cab__halo" aria-hidden />
          <CabinetArt game={game} side={side} uid={uid} />
          <span className="af-cab__marquee" style={layout.marquee}>
            <MarqueeLogo game={game} />
          </span>
          <span className="af-cab__screen" ref={(el) => setScreen(game.id, el)} style={layout.screen}>
            <AttractCanvas game={game} active={active} offset={index * 0.83} />
            <span className="af-cab__glass" aria-hidden />
          </span>
          <span className="af-cab__sparks" aria-hidden style={{ left: layout.face.left, width: layout.face.width }}>
            {SPARKS.map((k) => (
              <i key={k} style={{ '--k': k } as CSSProperties} />
            ))}
          </span>
          <span className="af-cab__focus" aria-hidden />
        </span>
        <span className="af-cab__reflect" aria-hidden />
        <span className="af-cab__plate">
          <span className="af-cab__name">{game.title}</span>
          <span className="af-cab__tag">{selected ? 'Selected · press again to play' : game.tagline}</span>
        </span>
      </button>
    </li>
  );
});
